// Core WebSocket tunnel handler.
//
// Path encodes the protocol and user:
//   /<protocol>/<uuid-or-trojan-hash>  e.g. /vless/<uuid>
//   /<uuid>                            legacy — auto-detect
// Query params (same as common VLESS-WS clients):
//   ?host=...&path=...&sni=...&type=ws&security=tls
//
// The first binary frame is parsed according to the protocol;
// we then connect upstream (direct or via user-configured proxy)
// and pump bidirectional bytes.

import { parseFirstFrame, buildVlessResponse } from "./protocol/parsers.js";
import { connectDirect, connectProxy } from "./upstream/connect.js";
import { pump } from "./pump.js";
import { cgnatSubnet } from "../util/bytes.js";
import { sha224Hex } from "../util/crypto.js";
import { isDomainBlocked } from "./dns/doh.js";
import type { Env } from "../env.js";
import type { Protocol } from "./types.js";

type UserRow = {
  username: string;
  uuid: string;
  trojan_hash?: string | null;
  connection_type: string;
  is_active: number;
  limit_gb: number | null;
  used_gb: number | null;
  expiry_days: number | null;
  created_at: number | string;
  limit_req: number | null;
  used_req: number | null;
  ip_limit: number | null;
  block_porn: number;
  block_ads: number;
  block_malware: number;
  doh_url: string | null;
  user_socks5: string | null;
  user_proxy_iata: string | null;
  auto_rotate_proxy: number;
  route_direct: string | null;
  route_block: string | null;
};

export async function handleTunnel(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  // Determine allowed protocols
  let allowed: Set<Protocol> = new Set(["vless", "trojan"]);
  let identifierFromPath: string | undefined;

  if (parts.length >= 1 && ["vless", "trojan", "vmess"].includes(parts[0]!)) {
    const proto = parts[0] as Protocol;
    allowed = new Set([proto]);
    identifierFromPath = parts.slice(1).join("/");
  }
  // Otherwise, use a generic path (/ws, /, /whatever) and let the
  // protocol parser + UUID from the first frame identify the user.

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.binaryType = "arraybuffer";

  ctx.waitUntil(
    (async () => {
      try {
        await runSession(server, request, env, allowed, identifierFromPath);
      } catch (e) {
        try { server.close(1011, "session error"); } catch {}
        console.error("tunnel session error", e);
      }
    })()
  );

  return new Response(null, { status: 101, webSocket: client });
}

async function runSession(
  server: WebSocket,
  request: Request,
  env: Env,
  allowed: Set<Protocol>,
  identifierFromPath?: string
) {
  // Wait for first binary frame with a deadline.
  const firstFrame = await new Promise<Uint8Array>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("first-frame timeout")), 15_000);
    server.addEventListener("message", (ev: MessageEvent) => {
      clearTimeout(t);
      if (typeof ev.data === "string") return reject(new Error("text frame not expected"));
      resolve(ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data));
    }, { once: true });
    server.addEventListener("close", () => { clearTimeout(t); reject(new Error("closed")); }, { once: true });
    server.addEventListener("error", (e) => { clearTimeout(t); reject(e); }, { once: true });
  });

  const parsed = parseFirstFrame(firstFrame, allowed);
  const id =
    identifierFromPath ||
    parsed.uuid ||
    parsed.passwordHash ||
    "";

  // Lookup user by uuid OR trojan hash OR username.
  let user: UserRow | undefined;
  if (parsed.protocol === "trojan") {
    user = await env.DB.prepare(
      "SELECT * FROM users WHERE uuid = ? OR trojan_hash = ? LIMIT 1"
    ).bind(id, parsed.passwordHash ?? id).first<UserRow>().then((r) => r ?? undefined);
  } else {
    user = await env.DB.prepare("SELECT * FROM users WHERE uuid = ? OR username = ? COLLATE NOCASE LIMIT 1")
      .bind(id, id)
      .first<UserRow>().then((r) => r ?? undefined);
  }

  if (!user) { server.close(1008, "unauthorized"); return; }

  // Protocol allow check
  const connType = (user.connection_type || "vless").toLowerCase();
  const allowVless = connType.includes("vless");
  const allowTrojan = connType.includes("trojan");
  const allowVmess = connType.includes("vmess");
  if (parsed.protocol === "vless" && !allowVless) { server.close(1008, "protocol disabled"); return; }
  if (parsed.protocol === "trojan" && !allowTrojan) { server.close(1008, "protocol disabled"); return; }
  if (parsed.protocol === "vmess" && !allowVmess) { server.close(1008, "protocol disabled"); return; }

  // Trojan hash sanity check
  if (parsed.protocol === "trojan") {
    const expected = user.trojan_hash || (await sha224Hex(user.uuid));
    if (parsed.passwordHash !== expected) { server.close(1008, "bad password"); return; }
  } else if (parsed.uuid && parsed.uuid.toLowerCase() !== user.uuid.toLowerCase()) {
    server.close(1008, "bad uuid"); return;
  }

  if (user.is_active !== 1) { server.close(1008, "disabled"); return; }

  // Limits
  if (user.limit_gb != null && (user.used_gb ?? 0) >= user.limit_gb) { server.close(1008, "quota"); return; }
  if (user.limit_req != null && (user.used_req ?? 0) >= user.limit_req) { server.close(1008, "req quota"); return; }
  if (user.expiry_days != null) {
    const created = typeof user.created_at === "number" ? user.created_at : Date.parse(user.created_at as string) / 1000;
    if (Date.now() / 1000 > created + user.expiry_days * 86400) { server.close(1008, "expired"); return; }
  }

  // Track device / subnet in the UserState Durable Object.
  const rawIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const subnet = cgnatSubnet(rawIp);
  const ua = request.headers.get("User-Agent") || "";
  const doId = env.USER_STATE.idFromName(user.username);
  const doStub = env.USER_STATE.get(doId);
  const connRes = await doStub.fetch(
    new URL("http://do/connect?ipLimit=" + (user.ip_limit ?? 0), "http://do").toString(),
    { method: "POST", body: JSON.stringify({ ip: rawIp, subnet, ua }) }
  );
  if (!connRes.ok) {
    const j = await connRes.json<{ ok: boolean; code?: string }>();
    server.close(1008, j.code || "limit");
    return;
  }

  // Send protocol-specific response
  if (parsed.protocol === "vless") {
    server.send(buildVlessResponse());
  }
  // Trojan/VMess expect no response header before relaying.

  // Content filter check (best-effort, non-blocking)
  if (parsed.target.type === "domain" && (user.block_porn || user.block_ads || user.block_malware)) {
    try {
      const blocked = await isDomainBlocked(parsed.target.host, {
        porn: user.block_porn === 1,
        ads: user.block_ads === 1,
        malware: user.block_malware === 1,
        doh: user.doh_url || undefined,
      });
      if (blocked) { server.close(1008, "blocked"); return; }
    } catch {}
  }

  // Decide upstream
  let upstream;
  try {
    const proxy = await selectUpstream(user, env);
    if (proxy) {
      upstream = await connectProxy(proxy, parsed.target.host, parsed.target.port, parsed.payload);
    } else {
      upstream = await connectDirect(parsed.target.host, parsed.target.port, parsed.payload);
    }
  } catch (e) {
    // Fallback to Cloudflare proxyip hosts if direct/proxy fails
    try {
      const host = pickFallbackHost(env);
      if (host) {
        upstream = await connectDirect(host, parsed.target.port, parsed.payload);
      } else throw e;
    } catch {
      await doStub.fetch("http://do/disconnect", { method: "POST", body: JSON.stringify({ subnet }) });
      server.close(1011, "upstream failed");
      return;
    }
  }

  // Count request
  await env.DB.prepare("UPDATE users SET used_req = used_req + 1, last_active = ? WHERE username = ?")
    .bind(Math.floor(Date.now() / 1000), user.username)
    .run().catch(() => {});

  const stats = { up: 0, down: 0 };
  let startedAt = Date.now();
  pump(server, upstream, {
    grainBytes: 128 * 1024,
    onUp: (n) => {
      stats.up += n;
      doStub.fetch("http://do/addBytes", { method: "POST", body: JSON.stringify({ bytes: n }) }).catch(() => {});
    },
    onDown: (n) => {
      stats.down += n;
      doStub.fetch("http://do/addBytes", { method: "POST", body: JSON.stringify({ bytes: n }) }).catch(() => {});
    },
    onClose: () => {
      doStub.fetch("http://do/disconnect", { method: "POST", body: JSON.stringify({ subnet }) }).catch(() => {});
      // Record hourly time-series
      const hourBucket = Math.floor(startedAt / 3600000) * 3600;
      const totalBytes = stats.up + stats.down;
      env.DB.prepare(
        `INSERT INTO traffic_hourly (hour_bucket, username, bytes_up, bytes_down, requests)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(hour_bucket, username) DO UPDATE SET
           bytes_up = bytes_up + excluded.bytes_up,
           bytes_down = bytes_down + excluded.bytes_down,
           requests = requests + 1`
      ).bind(hourBucket, user.username, stats.up, stats.down).run().catch(() => {});
      // Write to Analytics Engine if available
      try {
        env.METRICS?.writeDataPoint?.({
          blobs: [user.username, "session"],
          doubles: [totalBytes, Date.now() - startedAt],
        });
      } catch {}
    },
  });
}

async function selectUpstream(user: UserRow, env: Env): Promise<string | null> {
  if (user.user_socks5) {
    try {
      if (user.user_socks5.trim().startsWith("[")) {
        const arr = JSON.parse(user.user_socks5) as string[];
        if (Array.isArray(arr) && arr.length) return arr[Math.floor(Math.random() * arr.length)]!;
      }
      return user.user_socks5;
    } catch {
      return user.user_socks5;
    }
  }
  if (user.user_proxy_iata) {
    try {
      const id = env.POOL_STATE.idFromName("global");
      const stub = env.POOL_STATE.get(id);
      const cc = user.user_proxy_iata.toUpperCase();
      const res = await stub.fetch(`http://do/pick?cc=${encodeURIComponent(cc)}`);
      if (res.ok) {
        const data = await res.json<{ uri: string }>();
        return data.uri;
      }
    } catch {
      // fall through to direct connection
    }
  }
  return null;
}

function pickFallbackHost(env: Env): string | null {
  const list = (env.PROXY_FALLBACK_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const iata = list[Math.floor(Math.random() * list.length)]!;
  return `${iata}.proxyip.cmliussss.net`;
}

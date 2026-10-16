// User CRUD + bulk operations.

import { Hono } from "hono";
import type { Env } from "../env.js";
import { csrfProtection, requireAuth, requireRole, type AppVars } from "../middleware/auth.js";
import { sha224Hex } from "../util/crypto.js";
import { nowSec, randomUUID } from "../util/bytes.js";

export const userRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

userRoutes.use("*", requireAuth);
userRoutes.use("*", csrfProtection);

userRoutes.get("/", async (c) => {
  const q = c.req.query("q") || "";
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(c.req.query("pageSize") || "50", 10));
  const off = (page - 1) * pageSize;
  const like = `%${q}%`;
  const rows = await c.env.DB.prepare(
    `SELECT * FROM users WHERE username LIKE ? OR uuid LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(like, like, pageSize, off).all();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE username LIKE ? OR uuid LIKE ?`
  ).bind(like, like).first<{ n: number }>();
  return c.json({ users: rows.results, total: total?.n ?? 0, page, pageSize });
});

userRoutes.get("/:username", async (c) => {
  const username = c.req.param("username");
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

userRoutes.post("/", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<Partial<UserPayload>>();
  if (!body.username) return c.json({ error: "username required" }, 400);
  const uuid = body.uuid || randomUUID();
  const trojanHash = await sha224Hex(uuid);
  const now = nowSec();
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (
        username, uuid, trojan_hash, limit_gb, expiry_days, limit_req,
        connection_type, tls, port, path, sni_host, fingerprint, fragment,
        alpn, ip_limit, block_porn, block_ads, block_malware, doh_url,
        user_socks5, user_proxy_iata, route_direct, route_block, auto_rotate_proxy,
        auto_reset_vol_days, auto_reset_req_days,
        last_reset_vol_time, last_reset_req_time,
        is_active, note, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      body.username, uuid, trojanHash,
      num(body.limitGb), num(body.expiryDays), num(body.limitReq),
      body.connectionType || "vless+trojan",
      body.tls || "on",
      num(body.port) ?? 443,
      body.path || "/",
      body.sniHost || null,
      body.fingerprint || "chrome",
      body.fragment || null,
      body.alpn || "h2,http/1.1",
      num(body.ipLimit),
      bool(body.blockPorn), bool(body.blockAds), bool(body.blockMalware),
      body.dohUrl || null,
      body.userSocks5 || null,
      body.userProxyIata || null,
      body.routeDirect || null,
      body.routeBlock || null,
      bool(body.autoRotateProxy),
      num(body.autoResetVolDays) ?? 0,
      num(body.autoResetReqDays) ?? 0,
      now, now,
      body.isActive === false ? 0 : 1,
      body.note || null,
      now, now
    ).run();
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  return c.json({ ok: true, uuid, trojanHash });
});

userRoutes.patch("/:username", requireRole("owner", "admin"), async (c) => {
  const username = c.req.param("username");
  const body = await c.req.json<Partial<UserPayload>>();
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, { col: string; val: unknown }> = {
    username: { col: "username", val: body.username },
    limitGb: { col: "limit_gb", val: num(body.limitGb) },
    expiryDays: { col: "expiry_days", val: num(body.expiryDays) },
    limitReq: { col: "limit_req", val: num(body.limitReq) },
    connectionType: { col: "connection_type", val: body.connectionType },
    tls: { col: "tls", val: body.tls },
    port: { col: "port", val: num(body.port) },
    path: { col: "path", val: body.path },
    sniHost: { col: "sni_host", val: body.sniHost },
    fingerprint: { col: "fingerprint", val: body.fingerprint },
    fragment: { col: "fragment", val: body.fragment },
    alpn: { col: "alpn", val: body.alpn },
    ipLimit: { col: "ip_limit", val: num(body.ipLimit) },
    blockPorn: { col: "block_porn", val: bool(body.blockPorn) },
    blockAds: { col: "block_ads", val: bool(body.blockAds) },
    blockMalware: { col: "block_malware", val: bool(body.blockMalware) },
    dohUrl: { col: "doh_url", val: body.dohUrl },
    userSocks5: { col: "user_socks5", val: body.userSocks5 },
    userProxyIata: { col: "user_proxy_iata", val: body.userProxyIata },
    routeDirect: { col: "route_direct", val: body.routeDirect },
    routeBlock: { col: "route_block", val: body.routeBlock },
    autoRotateProxy: { col: "auto_rotate_proxy", val: bool(body.autoRotateProxy) },
    isActive: { col: "is_active", val: body.isActive === undefined ? undefined : (body.isActive ? 1 : 0) },
    note: { col: "note", val: body.note },
    autoResetVolDays: { col: "auto_reset_vol_days", val: num(body.autoResetVolDays) },
    autoResetReqDays: { col: "auto_reset_req_days", val: num(body.autoResetReqDays) },
  };
  for (const k of Object.keys(body)) {
    const m = map[k];
    if (m && m.val !== undefined) {
      fields.push(`${m.col} = ?`);
      vals.push(m.val);
    }
  }
  if (!fields.length) return c.json({ ok: true });
  fields.push("updated_at = ?");
  vals.push(nowSec());
  vals.push(username);
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(", ")} WHERE username = ? COLLATE NOCASE`).bind(...vals).run();
  return c.json({ ok: true });
});

userRoutes.delete("/:username", requireRole("owner", "admin"), async (c) => {
  await c.env.DB.prepare("DELETE FROM users WHERE username = ? COLLATE NOCASE").bind(c.req.param("username")).run();
  return c.json({ ok: true });
});

userRoutes.post("/bulk", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{ usernames: string[]; action: "delete" | "disable" | "enable" | "resetVol" | "resetReq" }>();
  if (!body.usernames?.length) return c.json({ error: "no users" }, 400);
  const placeholders = body.usernames.map(() => "?").join(",");
  if (body.action === "delete") {
    await c.env.DB.prepare(`DELETE FROM users WHERE username IN (${placeholders})`).bind(...body.usernames).run();
  } else if (body.action === "disable" || body.action === "enable") {
    const v = body.action === "enable" ? 1 : 0;
    await c.env.DB.prepare(`UPDATE users SET is_active = ? WHERE username IN (${placeholders})`).bind(v, ...body.usernames).run();
  } else if (body.action === "resetVol") {
    await c.env.DB.prepare(`UPDATE users SET used_gb = 0 WHERE username IN (${placeholders})`).bind(...body.usernames).run();
  } else if (body.action === "resetReq") {
    await c.env.DB.prepare(`UPDATE users SET used_req = 0 WHERE username IN (${placeholders})`).bind(...body.usernames).run();
  }
  return c.json({ ok: true });
});

userRoutes.post("/:username/reset-uuid", requireRole("owner", "admin"), async (c) => {
  const uuid = randomUUID();
  const hash = await sha224Hex(uuid);
  await c.env.DB.prepare("UPDATE users SET uuid = ?, trojan_hash = ? WHERE username = ?")
    .bind(uuid, hash, c.req.param("username")).run();
  return c.json({ ok: true, uuid, trojanHash: hash });
});

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v: unknown): number {
  return v ? 1 : 0;
}

interface UserPayload {
  username?: string;
  uuid?: string;
  limitGb?: number;
  expiryDays?: number;
  limitReq?: number;
  connectionType?: string;
  tls?: string;
  port?: number;
  path?: string;
  sniHost?: string;
  fingerprint?: string;
  fragment?: string;
  alpn?: string;
  ipLimit?: number;
  blockPorn?: boolean;
  blockAds?: boolean;
  blockMalware?: boolean;
  dohUrl?: string;
  userSocks5?: string;
  userProxyIata?: string;
  routeDirect?: string;
  routeBlock?: string;
  autoRotateProxy?: boolean;
  autoResetVolDays?: number;
  autoResetReqDays?: number;
  isActive?: boolean;
  note?: string;
}

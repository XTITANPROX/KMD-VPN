// Node management: embedded core, external panels, agents and link-only nodes.

import { Hono } from "hono";
import { audit, getDb } from "../db/index.js";
import { XRAY_API_PORT } from "../env.js";
import { randomHex, realityKeyPair } from "../lib/crypto.js";
import { parseTags, serializeTags } from "../lib/tags.js";
import { nowSeconds } from "../lib/format.js";
import { validate } from "../lib/validate.js";
import { clientIp, ok, readJson, requireAdmin, requireApiAuth, requirePermission, safe, type AppVariables } from "../middleware.js";
import {
  createNode,
  deleteNode,
  getNode,
  getUser,
  getUserNodes,
  listNodes,
  listUsers,
  nodeUserCounts,
  updateNode,
} from "../services/store.js";
import { clientForNode, healthCheckAll, syncNodeUsers, syncUser } from "../services/nodes.js";
import { embeddedXray } from "../services/clients/local.js";
import { buildLink } from "../services/links.js";
import {
  WG_DEFAULT_DNS,
  WG_DEFAULT_MTU,
  WG_DEFAULT_PORT,
  ensureWireguardClient,
  ensureWireguardServerKeys,
  wireguardKeysForUser,
  wireguardNodePayload,
  writeWireguardServerConf,
} from "../services/wireguard.js";
import { AGENT_SECRET } from "../env.js";
import type { NodeRow } from "../types.js";

export const nodeRoutes = new Hono<{ Variables: AppVariables }>();

nodeRoutes.use("*", requireApiAuth);

const PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks", "wireguard"];
const TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade", "http", "quic", "xhttp"];
const SECURITIES = ["none", "tls", "reality"];
const KINDS = ["embedded", "panel", "agent", "custom"];

/* ---------------------------- embedded core ---------------------------- */

nodeRoutes.get(
  "/core/status",
  safe(async (c) => {
    const status = embeddedXray.status();
    const nodes = await listNodes({ kind: "embedded" });
    return ok(c, {
      ...status,
      api_port: XRAY_API_PORT,
      nodes: nodes.map((node) => ({ id: node.id, name: node.name, port: node.port, protocol: node.protocol, status: node.status })),
      config: status.installed ? embeddedXray.buildConfigJson() : null,
    });
  })
);

nodeRoutes.post(
  "/core/install",
  requirePermission("nodes"),
  safe(async (c) => {
    const body = await readJson(c).catch(() => ({}) as Record<string, unknown>);
    const version = String((body as { version?: string }).version ?? "");
    const installed = await embeddedXray.downloadCore(version);
    await embeddedXray.restart();
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "core_install", meta: { version: installed }, ip: clientIp(c) });
    return ok(c, { version: installed, message: "هسته Xray نصب و اجرا شد" });
  })
);

nodeRoutes.post(
  "/core/restart",
  requirePermission("nodes"),
  safe(async (c) => {
    await embeddedXray.restart();
    return ok(c, { message: "هسته ری‌استارت شد" });
  })
);

nodeRoutes.get(
  "/core/config",
  safe(async (c) => {
    return c.body(embeddedXray.buildConfigJson(), 200, { "content-type": "application/json; charset=utf-8" });
  })
);

/* -------------------------------- CRUD --------------------------------- */

nodeRoutes.get(
  "/",
  safe(async (c) => {
    const nodes = await listNodes();
    const counts = await nodeUserCounts();
    return ok(c, {
      nodes: nodes.map((node) => serializeNode(node, counts[node.id] ?? 0)),
      core: embeddedXray.status(),
    });
  })
);

nodeRoutes.post(
  "/",
  requirePermission("nodes"),
  safe(async (c) => {
    const body = await readJson(c);
    const input = validate<Record<string, unknown>>(body, (v) => {
      v.string("name", { required: true, max: 64, label: "نام نود" });
      v.enum("kind", KINDS, { def: "custom", label: "نوع نود" });
      v.enum("protocol", PROTOCOLS, { def: "vless", label: "پروتکل" });
      v.enum("transport", TRANSPORTS, { def: "ws", label: "ترانسپورت" });
      v.enum("security", SECURITIES, { def: "tls", label: "امنیت" });
      v.string("host", { required: true, max: 128, label: "آدرس" });
      v.int("port", { required: true, min: 1, max: 65535, label: "پورت" });
      v.string("sni", { max: 128 });
      v.string("path", { max: 128 });
      v.string("service_name", { max: 64 });
      v.string("flow", { max: 32 });
      v.string("fingerprint", { max: 32 });
      v.string("alpn", { max: 64 });
      v.string("reality_dest", { max: 128 });
      v.string("reality_short_id", { max: 32 });
      v.string("dns", { max: 128 });
      v.string("address_v4", { max: 64 });
      v.string("address_v6", { max: 64 });
      v.int("mtu", { min: 576, max: 9000 });
      v.int("panel_id", { min: 1 });
      v.string("inbound_id", { max: 64 });
      v.int("capacity", { def: 0, min: 0 });
      v.int("sort", { def: 0 });
      v.array("tags", { label: "برچسب‌ها" });
      v.bool("active", true);
    });

    let realityPrivate = String(body.reality_private_key ?? "");
    let realityPublic = String(body.reality_public_key ?? "");
    if (input.security === "reality" && (!realityPrivate || !realityPublic)) {
      const pair = realityKeyPair();
      realityPrivate = pair.privateKey;
      realityPublic = pair.publicKey;
    }

    const node = await createNode({
      name: String(input.name),
      kind: String(input.kind),
      protocol: String(input.protocol),
      transport: String(input.transport),
      security: String(input.security),
      host: String(input.host),
      port: Number(input.port),
      sni: (input.sni as string) ?? null,
      path: (input.path as string) ?? (input.transport === "ws" ? `/${randomHex(4)}` : null),
      service_name: (input.service_name as string) ?? (input.transport === "grpc" ? "grpc" : null),
      flow: (input.flow as string) ?? null,
      fingerprint: (input.fingerprint as string) ?? "chrome",
      alpn: (input.alpn as string) ?? null,
      reality_private_key: realityPrivate || null,
      reality_public_key: realityPublic || null,
      reality_short_id: (input.reality_short_id as string) || (input.security === "reality" ? randomHex(4) : null),
      reality_dest: (input.reality_dest as string) ?? (input.security === "reality" ? "www.cloudflare.com:443" : null),
      dns: (input.dns as string) ?? null,
      mtu: (input.mtu as number) ?? null,
      address_v4: (input.address_v4 as string) ?? null,
      address_v6: (input.address_v6 as string) ?? null,
      panel_id: (input.panel_id as number) ?? null,
      inbound_id: (input.inbound_id as string) ?? null,
      capacity: Number(input.capacity ?? 0),
      sort: Number(input.sort ?? 0),
      active: input.active === false ? 0 : 1,
      status: "unknown",
      tags: serializeTags(body.tags),
      settings: body.settings ? JSON.stringify(body.settings) : null,
    });

    let created = node;
    if (node.protocol === "wireguard") {
      // wg nodes get a server key pair and sensible tunnel defaults right away
      await ensureWireguardServerKeys(node);
      const patch: Record<string, unknown> = {};
      if (!node.address_v4) patch.address_v4 = "10.66.66.1/24";
      if (!node.dns) patch.dns = WG_DEFAULT_DNS;
      if (!node.mtu) patch.mtu = WG_DEFAULT_MTU;
      if (!node.port) patch.port = WG_DEFAULT_PORT;
      if (Object.keys(patch).length) await updateNode(node.id, patch);
      created = (await getNode(node.id)) ?? node;
    }
    if (created.kind === "embedded") await embeddedXray.restart();
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "node_create", target: created.name, ip: clientIp(c) });
    return ok(c, { node: serializeNode(created, 0) }, 201);
  })
);

nodeRoutes.get(
  "/:id",
  safe(async (c) => {
    const node = await getNode(Number(c.req.param("id")));
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    const counts = await nodeUserCounts();
    let describe: Record<string, unknown> | null = null;
    try {
      const client = await clientForNode(node);
      describe = node.kind === "panel" ? (await client.describe?.()) ?? null : null;
    } catch (error) {
      describe = { error: (error as Error).message };
    }
    return ok(c, { node: serializeNode(node, counts[node.id] ?? 0), describe });
  })
);

nodeRoutes.put(
  "/:id",
  requirePermission("nodes"),
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const node = await getNode(id);
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const patch: Record<string, unknown> = {};
    for (const key of [
      "name",
      "kind",
      "protocol",
      "transport",
      "security",
      "host",
      "port",
      "sni",
      "path",
      "service_name",
      "flow",
      "fingerprint",
      "alpn",
      "reality_private_key",
      "reality_public_key",
      "reality_short_id",
      "reality_dest",
      "private_key",
      "public_key",
      "dns",
      "mtu",
      "address_v4",
      "address_v6",
      "panel_id",
      "inbound_id",
      "capacity",
      "sort",
      "status",
      "active",
      "agent_secret",
    ]) {
      if (body[key] !== undefined) patch[key] = body[key] === "" ? null : body[key];
    }
    if (body.settings !== undefined) patch.settings = body.settings ? JSON.stringify(body.settings) : null;
    if (body.tags !== undefined) patch.tags = serializeTags(body.tags);
    await updateNode(id, patch);
    const updated = (await getNode(id))!;
    if (updated.kind === "embedded") await embeddedXray.restart();
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "node_update", target: updated.name, meta: patch, ip: clientIp(c) });
    return ok(c, { node: serializeNode(updated, 0) });
  })
);

nodeRoutes.delete(
  "/:id",
  requirePermission("nodes"),
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const node = await getNode(id);
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    await deleteNode(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "node_delete", target: node.name, ip: clientIp(c) });
    return ok(c, { message: "نود حذف شد" });
  })
);

/* ------------------------------- actions ------------------------------- */

nodeRoutes.post(
  "/:id/test",
  safe(async (c) => {
    const node = await getNode(Number(c.req.param("id")));
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    try {
      const client = await clientForNode(node);
      const health = await client.health();
      await updateNode(node.id, {
        status: health.status,
        cpu_load: health.cpuLoad ?? null,
        mem_load: health.memLoad ?? null,
        uptime_seconds: health.uptimeSeconds ?? null,
        core_version: health.coreVersion ?? null,
        last_error: health.error ?? null,
        last_heartbeat_at: nowSeconds(),
      });
      return ok(c, health);
    } catch (error) {
      await updateNode(node.id, { status: "error", last_error: (error as Error).message.slice(0, 300) });
      return c.json({ error: (error as Error).message, code: "node_error" }, 502);
    }
  })
);

nodeRoutes.post(
  "/:id/sync",
  requirePermission("nodes"),
  safe(async (c) => {
    const node = await getNode(Number(c.req.param("id")));
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    const result = await syncNodeUsers(node.id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "node_sync", target: node.name, meta: result, ip: clientIp(c) });
    return ok(c, result);
  })
);

nodeRoutes.get(
  "/:id/users",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const node = await getNode(id);
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    const rows = await getDb().all<Record<string, unknown>>(
      `SELECT u.* FROM users u JOIN user_nodes un ON un.user_id = u.id WHERE un.node_id = ? ORDER BY u.id DESC LIMIT 500`,
      [id]
    );
    return ok(c, { users: rows });
  })
);

nodeRoutes.post(
  "/:id/preview",
  safe(async (c) => {
    // builds a sample link for a node so admins can verify settings
    const id = Number(c.req.param("id"));
    const node = await getNode(id);
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    const sample = await getDb().get<{ username: string; uuid: string; password: string | null; id: number }>(
      "SELECT id, username, uuid, password FROM users ORDER BY id ASC LIMIT 1"
    );
    if (!sample) return c.json({ error: "برای پیش‌نمایش حداقل یک کاربر لازم است", code: "no_user" }, 400);
    if (node.protocol === "wireguard") {
      const real = await getUser(sample.id);
      if (!real) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
      await ensureWireguardClient(real, node);
      const keys = await wireguardKeysForUser(real.id);
      const entry = buildLink(node, real, { wireguardKeys: keys });
      return ok(c, { link: entry?.link ?? null, raw: entry?.raw ?? null });
    }
    const entry = buildLink(node, {
      ...sample,
      data_used_bytes: 0,
      data_limit_bytes: 0,
    } as never);
    return ok(c, { link: entry?.link ?? null, raw: entry?.raw ?? null });
  })
);

/**
 * WireGuard server config + peer table for a node. `?write=true` also stores
 * the config inside DATA_DIR so `wg-quick` (or the agent) can pick it up.
 */
nodeRoutes.get(
  "/:id/wireguard",
  safe(async (c) => {
    const node = await getNode(Number(c.req.param("id")));
    if (!node) return c.json({ error: "نود پیدا نشد", code: "not_found" }, 404);
    if (node.protocol !== "wireguard") return c.json({ error: "این نود WireGuard نیست", code: "wrong_protocol" }, 400);
    const users = await listUsers({ perPage: 500 });
    const create = c.req.query("create") !== "false";
    if (c.req.query("write") === "true") {
      const written = await writeWireguardServerConf(node, users.items, { create });
      return ok(c, {
        node: node.name,
        path: written.path,
        peers: written.peers.length,
        config: written.config,
      });
    }
    const payload = await wireguardNodePayload(node, users.items, { create });
    return ok(c, {
      node: node.name,
      node_id: node.id,
      server_address: payload.server_address,
      server_public_key: payload.server_public_key,
      port: payload.port,
      dns: node.dns || null,
      mtu: node.mtu ?? null,
      peers: payload.peers,
      config: payload.config,
    });
  })
);

/* -------------------------- bulk & provisioning ------------------------ */

nodeRoutes.post(
  "/bulk",
  requirePermission("nodes"),
  safe(async (c) => {
    const body = await readJson(c);
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number);
    const action = String(body.action ?? "");
    let affected = 0;
    for (const id of ids) {
      if (action === "delete") {
        await deleteNode(id);
        affected += 1;
      } else if (action === "enable" || action === "disable") {
        await updateNode(id, { active: action === "enable" ? 1 : 0 });
        affected += 1;
      } else if (action === "sync") {
        await syncNodeUsers(id);
        affected += 1;
      }
    }
    return ok(c, { affected });
  })
);

nodeRoutes.post(
  "/health-check",
  safe(async (c) => {
    await healthCheckAll();
    return ok(c, { message: "سلامت همه نودها بررسی شد" });
  })
);

/* ------------------------------- agent kit ----------------------------- */

nodeRoutes.get(
  "/agent/script",
  requirePermission("nodes"),
  safe(async (c) => {
    const panelUrl = process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || `localhost:${process.env.PORT ?? 8080}`;
    return ok(c, {
      secret: AGENT_SECRET,
      panel_url: panelUrl,
      install: [
        "# روی سرور نود (لینوکس) اجرا کنید:",
        "curl -fsSL https://raw.githubusercontent.com/XTITANPROX/KMD-VPN/main/railway/agent/agent.mjs -o agent.mjs",
        `AGENT_SECRET="${AGENT_SECRET}" PANEL_URL="https://${panelUrl}" node agent.mjs`,
        "",
        "# سپس در پنل، نود جدید با نوع «agent» بسازید و همان Secret را وارد کنید.",
      ].join("\n"),
    });
  })
);

nodeRoutes.post(
  "/agent/rotate-secret",
  requirePermission("nodes"),
  safe(async (c) => {
    return c.json(
      { ok: false, error: "برای چرخش Secret متغیر AGENT_SECRET را در ریلوی تغییر دهید", code: "env_only" },
      400
    );
  })
);

/* ------------------------------- helpers ------------------------------- */

function serializeNode(node: NodeRow, userCount: number) {
  return {
    ...node,
    settings: node.settings ? safeJson(node.settings) : null,
    active: Boolean(node.active),
    user_count: userCount,
    reality_public_key: node.reality_public_key,
    has_reality_private: Boolean(node.reality_private_key),
    wireguard_public_key: node.protocol === "wireguard" ? node.public_key : undefined,
    has_wireguard_private: node.protocol === "wireguard" ? Boolean(node.private_key) : undefined,
    tags: parseTags(node.tags),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export { syncUser, getUserNodes, listUsers };

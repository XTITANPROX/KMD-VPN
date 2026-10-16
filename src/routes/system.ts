// System maintenance endpoints: backup, restore, settings.

import { Hono } from "hono";
import type { Env } from "../env.js";
import { csrfProtection, requireAuth, requireRole, type AppVars } from "../middleware/auth.js";
import { nowSec } from "../util/bytes.js";

export const systemRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
systemRoutes.use("*", requireAuth);
systemRoutes.use("*", csrfProtection);

systemRoutes.get("/backup", requireRole("owner", "admin"), async (c) => {
  const env = c.env;
  const [users, settings, proxies, admins] = await Promise.all([
    env.DB.prepare("SELECT * FROM users").all(),
    env.DB.prepare("SELECT * FROM settings").all(),
    env.DB.prepare("SELECT * FROM proxies").all(),
    env.DB.prepare("SELECT id, username, role, is_active, created_at FROM admins").all(),
  ]);
  const dump = {
    version: 1,
    exportedAt: nowSec(),
    users: users.results,
    settings: settings.results,
    proxies: proxies.results,
    admins: admins.results,
  };
  // Persist to R2 too (if bound).
  try {
    await env.BUCKET?.put?.(`backup-${nowSec()}.json`, JSON.stringify(dump), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {}
  return c.body(JSON.stringify(dump, null, 2), 200, {
    "content-type": "application/json",
    "content-disposition": `attachment; filename="kalfetela-backup-${nowSec()}.json"`,
  });
});

systemRoutes.post("/restore", requireRole("owner"), async (c) => {
  const env = c.env;
  const body = await c.req.json<{
    users?: Array<Record<string, unknown>>;
    settings?: Array<{ key: string; value: string }>;
    proxies?: Array<{ uri: string; country?: string; source?: string }>;
  }>();
  let userCount = 0, proxyCount = 0;
  if (Array.isArray(body.users)) {
    const stmts = body.users.map((u) =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO users
         (username, uuid, trojan_hash, limit_gb, used_gb, lifetime_gb, expiry_days,
          limit_req, used_req, ip_limit, active_ips, connection_type, tls, port,
          path, sni_host, fingerprint, fragment, cipher_suites, alpn, allow_insecure,
          block_porn, block_ads, block_malware, doh_url, route_direct, route_block,
          user_proxy_iata, user_socks5, user_proxy_ip, auto_rotate_proxy,
          auto_rotate_ip, rotate_minutes, ip_operator, ip_count, ips, last_rotate_time,
          auto_reset_vol_days, auto_reset_req_days, last_reset_vol_time, last_reset_req_time,
          is_active, start_on_first_connect, first_connection_time, last_active, note, group_id,
          created_at, updated_at)
         VALUES (@username,@uuid,@trojan_hash,@limit_gb,@used_gb,@lifetime_gb,@expiry_days,
          @limit_req,@used_req,@ip_limit,@active_ips,@connection_type,@tls,@port,
          @path,@sni_host,@fingerprint,@fragment,@cipher_suites,@alpn,@allow_insecure,
          @block_porn,@block_ads,@block_malware,@doh_url,@route_direct,@route_block,
          @user_proxy_iata,@user_socks5,@user_proxy_ip,@auto_rotate_proxy,
          @auto_rotate_ip,@rotate_minutes,@ip_operator,@ip_count,@ips,@last_rotate_time,
          @auto_reset_vol_days,@auto_reset_req_days,@last_reset_vol_time,@last_reset_req_time,
          @is_active,@start_on_first_connect,@first_connection_time,@last_active,@note,@group_id,
          @created_at,@updated_at)`
      ).bind(u)
    );
    await env.DB.batch(stmts);
    userCount = stmts.length;
  }
  if (Array.isArray(body.proxies)) {
    const stmts = body.proxies.map((p) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO proxies (uri, country, source, is_active, last_checked, created_at) VALUES (?, ?, ?, 1, 0, ?)"
      ).bind(p.uri, p.country || null, p.source || "restore", nowSec())
    );
    await env.DB.batch(stmts);
    proxyCount = stmts.length;
  }
  if (Array.isArray(body.settings)) {
    const stmts = body.settings.map((s) =>
      env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(s.key, s.value, nowSec())
    );
    await env.DB.batch(stmts);
  }
  return c.json({ ok: true, users: userCount, proxies: proxyCount });
});

systemRoutes.get("/settings", async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings").all();
  const obj: Record<string, string> = {};
  for (const r of rows.results as Array<{ key: string; value: string }>) obj[r.key] = r.value;
  return c.json(obj);
});

systemRoutes.put("/settings", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const stmts = Object.entries(body).map(([k, v]) =>
    c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(k, v, nowSec())
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

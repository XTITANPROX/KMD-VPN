// KALFETELA — main entry.
//
// Responsibilities:
//  - Route WebSocket upgrades into the tunnel handler.
//  - Serve subscription (/sub, /feed) and status pages.
//  - Mount Hono API under /api.
//  - Serve the panel SPA at /panel.
//  - Run scheduled tasks (cron): IP rotation, quota resets, proxy health.
//  - Consume batched traffic writes from the Queue.

import { Hono } from "hono";
import { logger } from "hono/logger";

import type { Env } from "./env.js";
import { handleTunnel } from "./core/tunnel.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { proxyRoutes, syncPool } from "./routes/proxies.js";
import { systemRoutes } from "./routes/system.js";
import { scannerRoutes } from "./routes/scanner.js";
import { panelHtml, loginHtml, notFoundHtml, statusHtml } from "./ui/panel.js";
import { generateSubscription } from "./services/subscription.js";
import { handleDoh } from "./services/doh.js";
import { requireAuth, type AppVars } from "./middleware/auth.js";
import type { UserRow } from "./db/types.js";
import { UserState } from "./do/UserState.js";
import { PoolState } from "./do/PoolState.js";
import { RateLimiter } from "./do/RateLimiter.js";
import { PWA_MANIFEST, ICON_SVG, SW_JS } from "./ui/assets.js";

export { UserState, PoolState, RateLimiter };

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

app.use("*", logger());

/* ---------------- PWA / static ---------------- */
app.get("/manifest.json", (c) =>
  c.json(JSON.parse(PWA_MANIFEST), 200, { "content-type": "application/manifest+json" })
);
app.get("/icon.svg", (c) => c.body(ICON_SVG, 200, { "content-type": "image/svg+xml" }));
app.get("/sw.js", (c) => c.body(SW_JS, 200, { "content-type": "application/javascript" }));

/* ---------------- API ---------------- */
app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/proxies", proxyRoutes);
app.route("/api/system", systemRoutes);
app.route("/api/scanner", scannerRoutes);

app.get("/api/health", (c) => c.json({ ok: true, name: "KALFETELA", version: c.env.APP_VERSION, ts: Date.now() }));

// Private DNS-over-HTTPS endpoint. The upstream is fixed by DEFAULT_DOH,
// therefore callers cannot turn this route into an open HTTP proxy.
app.on(["GET", "POST"], "/dns-query", (c) => handleDoh(c.req.raw, c.env));

app.get("/api/traffic/:username", requireAuth, async (c) => {
  const username = c.req.param("username");
  const hours = Math.min(168, parseInt(c.req.query("hours") || "24", 10));
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const rows = await c.env.DB.prepare(
    "SELECT hour_bucket, bytes_up, bytes_down, requests FROM traffic_hourly WHERE username = ? AND hour_bucket >= ? ORDER BY hour_bucket"
  ).bind(username, since).all();
  return c.json({ username, hours, points: rows.results });
});

app.get("/api/stats", requireAuth, async (c) => {
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const active = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_active = 1").first<{ n: number }>();
  const gb = await c.env.DB.prepare("SELECT COALESCE(SUM(used_gb),0) AS s FROM users").first<{ s: number }>();
  const req = await c.env.DB.prepare("SELECT COALESCE(SUM(used_req),0) AS s FROM users").first<{ s: number }>();
  return c.json({
    users: total?.n ?? 0,
    active: active?.n ?? 0,
    usedGb: gb?.s ?? 0,
    usedReq: req?.s ?? 0,
  });
});

/* ---------------- Subscription & status ---------------- */
async function getCleanIps(env: Env): Promise<string[] | undefined> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key='clean_ips'").first<{ value: string }>();
  if (r?.value) {
    try { const arr = JSON.parse(r.value); if (Array.isArray(arr) && arr.length) return arr; } catch {}
  }
  return undefined;
}

app.get("/sub/:user", async (c) => {
  const username = decodeURIComponent(c.req.param("user"));
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE OR uuid = ?").bind(username, username).first<UserRow>();
  if (!row) return c.text("not found", 404);
  if (!isUserAvailable(row)) return c.text("subscription unavailable", 410);
  const requested = c.req.query("format") || "base64";
  const supported = new Set(["base64", "raw", "clash", "singbox", "xray"]);
  if (!supported.has(requested)) return c.text("unsupported format", 400);
  const fmt = requested as "clash" | "singbox" | "xray" | "raw" | "base64";
  const { body, contentType } = await generateSubscription(row, {
    host: new URL(c.req.url).hostname,
    port: (row as { port?: number }).port ?? 443,
    tls: (row as { tls?: string }).tls !== "off",
    cleanIps: await getCleanIps(c.env),
  }, fmt);
  // Increment request count (skip for browsers)
  const ua = (c.req.header("user-agent") || "").toLowerCase();
  if (!ua.includes("mozilla") && !ua.includes("chrome")) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE users SET used_req = used_req + 1 WHERE username = ?").bind((row as { username: string }).username).run()
    );
  }
  return c.body(body, 200, {
    "content-type": contentType,
    "profile-update-interval": "12",
    "subscription-userinfo": `upload=0; download=${Math.floor(((row as { used_gb?: number }).used_gb ?? 0) * 1024 * 1024 * 1024)}; total=${Math.floor(((row as { limit_gb?: number }).limit_gb ?? 0) * 1024 * 1024 * 1024)}; expire=${Math.floor(Date.now() / 1000) + ((row as { expiry_days?: number }).expiry_days ?? 0) * 86400}`,
  });
});
app.get("/feed/:user", (c) => c.redirect("/sub/" + encodeURIComponent(c.req.param("user")), 302));

function isUserAvailable(user: UserRow): boolean {
  if (user.is_active !== 1) return false;
  if (user.limit_gb != null && user.used_gb >= user.limit_gb) return false;
  if (user.limit_req != null && user.used_req >= user.limit_req) return false;
  if (user.expiry_days != null) {
    const raw = user.created_at;
    const created = typeof raw === "number" ? raw : Number(raw) || Date.parse(raw) / 1000;
    if (Number.isFinite(created) && Date.now() / 1000 > created + user.expiry_days * 86400) return false;
  }
  return true;
}

app.get("/status/:user", async (c) => {
  const username = decodeURIComponent(c.req.param("user"));
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE OR uuid = ?").bind(username, username).first<UserRow>();
  if (!row) return c.text("not found", 404);
  if (!isUserAvailable(row)) return c.text("account unavailable", 410);
  const { body } = await generateSubscription(row, {
    host: new URL(c.req.url).hostname,
    port: (row as { port?: number }).port ?? 443,
    tls: (row as { tls?: string }).tls !== "off",
    cleanIps: await getCleanIps(c.env),
  }, "raw");
  return c.html(statusHtml(row as never, body));
});

/* ---------------- Panel UI ---------------- */
app.get("/panel", (c) => c.html(panelHtml(c.env.APP_VERSION, false)));
app.get("/login", (c) => c.html(loginHtml()));
app.get("/", (c) => c.redirect("/panel", 302));
app.get("*", (c) => c.html(notFoundHtml(), 404));

/* ---------------- WebSocket tunnel — must be before app.fetch ---------------- */
const rawFetch: ExportedHandlerFetchHandler<Env> = async (request, env, ctx) => {
  ctx.waitUntil(ensurePoolSynced(env));
  const url = new URL(request.url);
  const upgrade = request.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() === "websocket") {
    return handleTunnel(request, env, ctx);
  }
  return app.fetch(request, env, ctx);
};

/* ---------------- Scheduled ---------------- */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env, ctx) => {
  const now = Date.now();
  if (event.cron === "* * * * *") {
    // every minute: proxy pool health (handled inside PoolState)
    const id = env.POOL_STATE.idFromName("global");
    ctx.waitUntil(env.POOL_STATE.get(id).fetch("http://do/health-check"));
  }
  if (event.cron === "*/5 * * * *") {
    // every 5 minutes: clean IP rotation
    ctx.waitUntil(autoRotateIps(env));
  }
  if (event.cron === "0 * * * *") {
    // hourly: quota auto-reset
    ctx.waitUntil(autoResetQuotas(env));
  }
};

/* ---------------- Queue consumer ---------------- */
const queue: ExportedHandlerQueueHandler<Env> = async (batch, env) => {
  const updates = new Map<string, { bytes: number; requests: number }>();
  for (const msg of batch.messages) {
    const body = msg.body as { type?: string; username?: string; bytes?: number; requests?: number };
    if (body?.type === "traffic" && body.username) {
      const u = updates.get(body.username) || { bytes: 0, requests: 0 };
      u.bytes += body.bytes || 0;
      u.requests += body.requests || 0;
      updates.set(body.username, u);
    }
  }
  for (const [username, delta] of updates) {
    const gb = delta.bytes / (1024 * 1024 * 1024);
    await env.DB.prepare(
      "UPDATE users SET used_gb = used_gb + ?, lifetime_gb = lifetime_gb + ?, used_req = used_req + ? WHERE username = ?"
    ).bind(gb, gb, delta.requests, username).run();
  }
};

async function autoRotateIps(env: Env) {
  try {
    const now = Date.now();
    const { results } = await env.DB.prepare(
      "SELECT * FROM users WHERE auto_rotate_ip = 1 AND rotate_minutes > 0 AND ? >= (last_rotate_time + rotate_minutes * 60000)"
    ).bind(now).all();
    if (!results?.length) return;
    const res = await fetch(env.PRIMARY_FETCH).catch(() => null);
    if (!res || !res.ok) return;
    const text = await res.text();
    const blocks = text.split(/----------+/);
    const byOp: Record<string, string[]> = {};
    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      let op = "unknown";
      const ips: string[] = [];
      for (const line of lines) {
        if (line.startsWith("#")) op = line.slice(1).trim();
        else if (!line.startsWith("[")) ips.push(line);
      }
      if (ips.length) byOp[op] = ips;
    }
    for (const u of results as Array<Record<string, unknown>>) {
      const pool = u.ip_operator === "all"
        ? Object.values(byOp).flat()
        : byOp[String(u.ip_operator || "all")] || [];
      if (!pool.length) continue;
      const count = Number(u.ip_count) || 15;
      const chosen: string[] = [];
      for (let i = 0; i < count && pool.length; i++) chosen.push(pool[Math.floor(Math.random() * pool.length)]!);
      await env.DB.prepare("UPDATE users SET ips = ?, last_rotate_time = ? WHERE id = ?")
        .bind(JSON.stringify(chosen), now, u.id).run();
    }
  } catch (e) {
    console.error("autoRotateIps", e);
  }
}

// Cache to ensure pool sync happens only once per isolate.
let poolSynced = false;
async function ensurePoolSynced(env: Env) {
  if (poolSynced) return;
  poolSynced = true;
  try {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM proxies").first<{ n: number }>();
    if (count && count.n > 0) {
      await syncPool(env);
    }
  } catch (e) {
    console.error("ensurePoolSynced", e);
  }
}

async function autoResetQuotas(env: Env) {
  const now = Date.now();
  const todayUtc = Math.floor(now / 86400000) * 86400000;
  await env.DB.prepare(
    `UPDATE users SET used_gb = 0, is_active = 1, last_reset_vol_time = ?
      WHERE auto_reset_vol_days > 0 AND ? >= (last_reset_vol_time + auto_reset_vol_days * 86400000)`
  ).bind(todayUtc, todayUtc).run();
  await env.DB.prepare(
    `UPDATE users SET used_req = 0, is_active = 1, last_reset_req_time = ?
      WHERE auto_reset_req_days > 0 AND ? >= (last_reset_req_time + auto_reset_req_days * 86400000)`
  ).bind(todayUtc, todayUtc).run();
}

export default { fetch: rawFetch, scheduled, queue } satisfies ExportedHandler<Env>;

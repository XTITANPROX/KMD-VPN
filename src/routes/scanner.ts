// Scanner routes — clean-IP scanner and proxy tester.
//
//   POST /api/scanner/ips        { ips?: string[], port?: number }
//   POST /api/scanner/proxies    { proxies: string[] }
//   GET  /api/scanner/preset     known-good Cloudflare clean IPs
//   PUT  /api/scanner/clean      { ips: string[] }  persist chosen IPs
//   GET  /api/scanner/clean      currently saved clean IPs

import { Hono } from "hono";
import type { Env } from "../env.js";
import { csrfProtection, requireAuth, requireRole, type AppVars } from "../middleware/auth.js";
import { scanIps, scanProxies } from "../services/scanner.js";
import { findProxies } from "../services/proxyFinder.js";
import { DEFAULT_CLEAN_IPS } from "../services/cleanIps.js";
import { nowSec } from "../util/bytes.js";

export const scannerRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
scannerRoutes.use("*", requireAuth);
scannerRoutes.use("*", csrfProtection);

scannerRoutes.get("/preset", (c) =>
  c.json({ ips: DEFAULT_CLEAN_IPS })
);

scannerRoutes.post("/ips", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{ ips?: string[]; port?: number; concurrency?: number; timeoutMs?: number }>();
  let ips = (body.ips || []).map((x) => x.trim()).filter(Boolean);
  if (!ips.length) ips = DEFAULT_CLEAN_IPS;
  if (ips.length > 200) ips = ips.slice(0, 200);
  const results = await scanIps({
    ips,
    port: body.port || 443,
    concurrency: body.concurrency,
    timeoutMs: body.timeoutMs,
  });
  const working = results
    .filter((r) => r.ok)
    .sort((a, b) => a.latencyMs - b.latencyMs);
  return c.json({
    total: results.length,
    alive: working.length,
    dead: results.length - working.length,
    results,
    top: working.slice(0, 20),
  });
});

scannerRoutes.post("/proxies", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{ proxies: string[]; testHost?: string; testPort?: number }>();
  if (!Array.isArray(body.proxies) || !body.proxies.length) {
    return c.json({ error: "proxies[] required" }, 400);
  }
  const list = body.proxies.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 100);
  const results = await scanProxies({
    proxies: list,
    testHost: body.testHost || "example.com",
    testPort: body.testPort || 443,
  });
  const working = results.filter((r) => r.ok).sort((a, b) => a.latencyMs - b.latencyMs);
  return c.json({
    total: results.length,
    alive: working.length,
    dead: results.length - working.length,
    results,
    top: working.slice(0, 30),
  });
});

scannerRoutes.get("/clean", async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'clean_ips'").first<{ value: string }>();
  let ips: string[] = [];
  if (row?.value) {
    try { ips = JSON.parse(row.value); } catch { ips = []; }
  }
  return c.json({ ips: ips.length ? ips : DEFAULT_CLEAN_IPS.slice(0, 20), custom: !!ips.length });
});

scannerRoutes.put("/clean", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{ ips: string[] }>();
  const ips = (body.ips || []).map((x) => x.trim()).filter(Boolean).slice(0, 50);
  await c.env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('clean_ips', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).bind(JSON.stringify(ips), nowSec()).run();
  return c.json({ ok: true, count: ips.length });
});

// Auto proxy finder: scrape public lists, return unique candidates.
// Proxies can't be TCP-probed from a Worker (raw connect() is restricted
// to Cloudflare-owned ranges), so reachability is tested in the browser.
scannerRoutes.post("/finder/run", requireRole("owner", "admin"), async (c) => {
  const body: { schemes?: ("socks5" | "http")[]; maxPerSource?: number; maxTotal?: number } =
    await c.req.json().catch(() => ({}));
  const result = await findProxies({
    schemes: body.schemes,
    maxPerSource: body.maxPerSource,
    maxTotal: body.maxTotal,
  });
  return c.json(result);
});

// Convenience: run finder AND import a slice into the pool in one call.
scannerRoutes.post("/finder/import", requireRole("owner", "admin"), async (c) => {
  const body: { schemes?: ("socks5" | "http")[]; max?: number; uris?: string[] } =
    await c.req.json().catch(() => ({}));
  // If the caller already tested in the browser and passed the alive URIs,
  // just import those. Otherwise pull a fresh list and import the first N.
  let uris: string[] = [];
  if (Array.isArray(body.uris) && body.uris.length) {
    uris = body.uris.slice(0, 50);
  } else {
    const r = await findProxies({ schemes: body.schemes, maxTotal: body.max || 100 });
    uris = r.candidates.slice(0, 30).map((c) => c.uri);
  }
  if (!uris.length) return c.json({ ok: true, imported: 0 });
  const stmts = uris.map((uri) =>
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO proxies (uri, country, source, is_active, last_checked, created_at) VALUES (?, ?, ?, 1, 0, ?)"
    ).bind(uri, "AUTO", "finder", nowSec())
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, imported: uris.length });
});

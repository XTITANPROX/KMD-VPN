// Proxy pool management API.
//  GET    /api/proxies?country=US   list proxies (optionally filtered)
//  POST   /api/proxies/import      bulk import { country, list[] } or { url, country? }
//  POST   /api/proxies/pool/reload ask PoolState to re-ingest from DB
//  POST   /api/proxies/health      trigger a health check
//  DELETE /api/proxies/:id
//  GET    /api/proxies/countries   distinct countries with counts

import { Hono } from "hono";
import type { Env } from "../env.js";
import { csrfProtection, requireAuth, requireRole, type AppVars } from "../middleware/auth.js";
import { nowSec } from "../util/bytes.js";

export const proxyRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();
proxyRoutes.use("*", requireAuth);
proxyRoutes.use("*", csrfProtection);

proxyRoutes.get("/", async (c) => {
  const country = (c.req.query("country") || "").toUpperCase();
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(c.req.query("pageSize") || "50", 10));
  const off = (page - 1) * pageSize;
  const where = country ? "WHERE country = ?" : "";
  const args: unknown[] = country ? [country, pageSize, off] : [pageSize, off];
  const rows = await c.env.DB.prepare(
    `SELECT * FROM proxies ${where} ORDER BY latency_ms IS NULL, latency_ms ASC LIMIT ? OFFSET ?`
  ).bind(...args).all();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM proxies ${where}`
  ).bind(...(country ? [country] : [])).first<{ n: number }>();
  return c.json({ proxies: rows.results, total: total?.n ?? 0 });
});

proxyRoutes.get("/countries", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT UPPER(country) AS country, COUNT(*) AS count, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM proxies WHERE country IS NOT NULL GROUP BY UPPER(country) ORDER BY count DESC"
  ).all();
  return c.json({ countries: rows.results });
});

proxyRoutes.post("/import", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{
    country?: string;
    list?: string[];
    url?: string;
    rawText?: string;
    source?: string;
  }>();
  let entries: { uri: string; country: string }[] = [];
  if (body.url) {
    const res = await fetch(body.url).catch(() => null);
    if (!res || !res.ok) return c.json({ error: "fetch failed" }, 400);
    const text = await res.text();
    entries = parseProxyList(text, body.country);
  } else if (body.rawText) {
    entries = parseProxyList(body.rawText, body.country);
  } else if (Array.isArray(body.list)) {
    entries = body.list
      .map((u) => normalizeUri(u))
      .filter(Boolean)
      .map((uri) => ({ uri: uri!, country: (body.country || "XX").toUpperCase() }));
  }
  if (!entries.length) return c.json({ error: "no proxies parsed" }, 400);

  // Bulk upsert with INSERT OR IGNORE to avoid duplicates.
  const stmts = entries.map((e) =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO proxies (uri, country, source, is_active, last_checked, created_at)
       VALUES (?, ?, ?, 1, 0, ?)`
    ).bind(e.uri, e.country, body.source || "manual", nowSec())
  );
  await c.env.DB.batch(stmts);

  // Re-sync PoolState with the new rows.
  await syncPool(c.env);
  return c.json({ ok: true, imported: entries.length });
});

proxyRoutes.post("/pool/reload", requireRole("owner", "admin"), async (c) => {
  const n = await syncPool(c.env);
  return c.json({ ok: true, active: n });
});

proxyRoutes.post("/health", requireRole("owner", "admin"), async (c) => {
  const id = c.env.POOL_STATE.idFromName("global");
  c.executionCtx.waitUntil(c.env.POOL_STATE.get(id).fetch("http://do/health-check"));
  return c.json({ ok: true, scheduled: true });
});

proxyRoutes.delete("/:id", requireRole("owner", "admin"), async (c) => {
  await c.env.DB.prepare("DELETE FROM proxies WHERE id = ?").bind(c.req.param("id")).run();
  await syncPool(c.env);
  return c.json({ ok: true });
});

proxyRoutes.post("/:id/toggle", requireRole("owner", "admin"), async (c) => {
  const row = await c.env.DB.prepare("SELECT is_active FROM proxies WHERE id = ?").bind(c.req.param("id")).first<{ is_active: number }>();
  if (!row) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("UPDATE proxies SET is_active = ? WHERE id = ?").bind(row.is_active ? 0 : 1, c.req.param("id")).run();
  await syncPool(c.env);
  return c.json({ ok: true });
});

// Browser-reported ping results: the Worker can't open arbitrary TCP
// sockets, so the user's browser does the reachability probe and posts
// RTTs back here. We persist latency, fail_count, success_rate and
// last_checked, and auto-disable proxies that have failed 5 times.
proxyRoutes.post("/bulk-ping", requireRole("owner", "admin"), async (c) => {
  const body: { results?: Array<{ uri: string; ok: boolean; latencyMs?: number; country?: string }> } =
    await c.req.json().catch(() => ({}));
  const results = Array.isArray(body.results) ? body.results : [];
  if (!results.length) return c.json({ ok: true, updated: 0 });
  const now = nowSec();
  const stmts = results.slice(0, 500).map((r) => {
    const ok = r.ok ? 1 : 0;
    const newRate = r.ok ? 100 : 0;
    return c.env.DB.prepare(
      `UPDATE proxies
       SET latency_ms = CASE WHEN ? = 1 THEN ? ELSE latency_ms END,
           last_checked = ?,
           fail_count = CASE WHEN ? = 1 THEN 0 ELSE fail_count + 1 END,
           success_rate = CASE
             WHEN success_rate = 100 AND last_checked = 0 THEN ?
             ELSE CAST((success_rate * 4 + ?) / 5 AS INTEGER)
           END,
           is_active = CASE WHEN fail_count >= 5 THEN 0 ELSE is_active END,
           country = COALESCE(?, country)
       WHERE uri = ?`
    ).bind(ok, r.latencyMs ?? null, now, ok, newRate, newRate, r.country || null, r.uri);
  });
  await c.env.DB.batch(stmts);
  await syncPool(c.env);
  return c.json({ ok: true, updated: stmts.length });
});

// Server-side GeoIP lookup for proxy hostnames/IPs. Browser can't call
// ip-api.com directly (no CORS on free tier), so the Worker proxies
// and caches results in KV for 24h.
proxyRoutes.post("/geoip", async (c) => {
  const body: { hosts?: string[] } = await c.req.json().catch(() => ({}));
  const hosts = Array.from(new Set((body.hosts || []).slice(0, 100))).filter(Boolean);
  if (!hosts.length) return c.json({ results: {} });

  const cacheKey = (h: string) => "geoip:" + h;
  const out: Record<string, { country?: string; countryCode?: string; city?: string; isp?: string }> = {};
  const missing: string[] = [];
  await Promise.all(
    hosts.map(async (h) => {
      const cached = await c.env.KV.get(cacheKey(h), "json").catch(() => null) as typeof out[string] | null;
      if (cached) out[h] = cached;
      else missing.push(h);
    })
  );

  if (missing.length) {
    try {
      const r = await fetch("http://ip-api.com/batch?fields=status,country,countryCode,city,isp,query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(missing),
      });
      if (r.ok) {
        const arr = (await r.json()) as Array<{
          status: string; query: string; country?: string; countryCode?: string; city?: string; isp?: string;
        }>;
        for (const item of arr) {
          if (item.status !== "success") continue;
          const data = {
            country: item.country,
            countryCode: item.countryCode,
            city: item.city,
            isp: item.isp,
          };
          out[item.query] = data;
          c.executionCtx.waitUntil(
            c.env.KV.put(cacheKey(item.query), JSON.stringify(data), { expirationTtl: 86400 })
          );
        }
      }
    } catch (e) {
      console.warn("geoip failed", e);
    }
  }
  return c.json({ results: out });
});

/* -------- helpers -------- */

function normalizeUri(u: string): string | null {
  const t = u.trim();
  if (!t || t.startsWith("#")) return null;
  if (/^(socks4|socks5|socks|http|https):\/\//i.test(t)) return t;
  // bare host:port -> default to socks5
  if (/^[\w.-]+:\d{2,5}$/.test(t)) return `socks5://${t}`;
  return null;
}

function parseProxyList(text: string, countryOverride?: string): { uri: string; country: string }[] {
  const out: { uri: string; country: string }[] = [];
  let currentCountry = (countryOverride || "XX").toUpperCase();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#") || t.startsWith("//")) {
      // Treat "# US" / "#IR" as country marker
      const m = t.match(/[#/]\s*([A-Za-z]{2})\b/);
      if (m) currentCountry = m[1]!.toUpperCase();
      continue;
    }
    if (t.startsWith("[")) continue; // [source] markers
    const uri = normalizeUri(t);
    if (uri) out.push({ uri, country: currentCountry });
  }
  return out;
}

/** Push all active proxies from D1 into the PoolState Durable Object. */
export async function syncPool(env: Env): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT uri, country FROM proxies WHERE is_active = 1"
  ).all<{ uri: string; country: string }>();
  const byCountry: Record<string, string[]> = {};
  for (const r of rows.results || []) {
    const cc = (r.country || "XX").toUpperCase();
    (byCountry[cc] ||= []).push(r.uri);
  }
  const id = env.POOL_STATE.idFromName("global");
  const stub = env.POOL_STATE.get(id);
  let total = 0;
  for (const [cc, list] of Object.entries(byCountry)) {
    await stub.fetch("http://do/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: cc, list }),
    });
    total += list.length;
  }
  return total;
}

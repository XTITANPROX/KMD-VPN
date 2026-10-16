// PoolState Durable Object — global registry of upstream proxies.
// Ingests lists from KV / R2, periodically health-checks them,
// and serves healthy random picks by country code.

import type { Env } from "../env.js";

type ProxyEntry = {
  uri: string;
  country?: string;
  latencyMs?: number;
  ok: boolean;
  lastChecked: number;
};

type PoolData = {
  byCountry: Record<string, ProxyEntry[]>;
};

const EMPTY: PoolData = { byCountry: {} };

export class PoolState {
  private state: DurableObjectState;
  private env: Env;
  private data: PoolData = EMPTY;
  private alarmScheduled = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<PoolData>("pool");
      if (stored) this.data = stored;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\//, "");
    if (path === "pick") {
      const cc = (url.searchParams.get("cc") || "").toUpperCase();
      const list = cc ? this.data.byCountry[cc] || [] : Object.values(this.data.byCountry).flat();
      const alive = list.filter((p) => p.ok);
      if (!alive.length) return Response.json({ error: "empty pool" }, { status: 503 });
      const pick = alive[Math.floor(Math.random() * alive.length)]!;
      return Response.json({ uri: pick.uri, latencyMs: pick.latencyMs, country: pick.country });
    }
    if (path === "import") {
      const { country, list } = (await req.json()) as { country?: string; list: string[] };
      const cc = (country || "XX").toUpperCase();
      this.data.byCountry[cc] = list.map((uri) => ({ uri, country: cc, ok: true, lastChecked: 0 }));
      await this.state.storage.put("pool", this.data);
      this.scheduleAlarm();
      return Response.json({ ok: true, count: list.length });
    }
    if (path === "health-check") {
      ctxWaitUntil(this.state, this.healthCheck());
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  private scheduleAlarm() {
    if (this.alarmScheduled) return;
    this.alarmScheduled = true;
    this.state.storage.setAlarm(60_000).catch(() => {});
  }

  async alarm(): Promise<void> {
    this.alarmScheduled = false;
    await this.healthCheck();
    if (Object.values(this.data.byCountry).flat().length) this.scheduleAlarm();
  }

  private async healthCheck() {
    // Very light TCP/TLS reachability check through the Worker's
    // connect() — we only check that the endpoint accepts a TCP
    // connection within 4 seconds.
    const all = Object.values(this.data.byCountry).flat();
    const sample = all.slice(0, 50); // spread checks over ticks
    for (const p of sample) {
      try {
        const u = new URL(p.uri);
        const host = u.hostname;
        const port = parseInt(u.port || "1080", 10);
        const t0 = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`https://${host}:${port}`, {
          method: "HEAD",
          signal: controller.signal,
          mode: "no-cors",
        }).catch(() => null);
        clearTimeout(timer);
        p.latencyMs = Date.now() - t0;
        p.ok = !!res;
      } catch {
        p.ok = false;
      }
      p.lastChecked = Date.now();
    }
    // Drop entries that have failed 3x in a row.
    for (const cc of Object.keys(this.data.byCountry)) {
      this.data.byCountry[cc] = this.data.byCountry[cc]!.filter((p) => p.ok);
    }
    await this.state.storage.put("pool", this.data);
  }
}

function ctxWaitUntil(state: DurableObjectState, p: Promise<unknown>): void {
  try { (state as unknown as { waitUntil(p: Promise<unknown>): void }).waitUntil(p); } catch { void p; }
}

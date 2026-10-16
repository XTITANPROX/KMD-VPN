// Per-user Durable Object. Holds online counts, un-flushed
// traffic counters, and connection metadata in memory; persists
// counters to storage with blockConcurrencyWhile so even an
// isolate eviction does not lose bytes (unlike ZEUS's Map-based
// approach).

import type { Env } from "../env.js";

type ConnInfo = {
  ip: string;
  subnet: string;
  ua: string;
  startedAt: number;
};

type State = {
  bytesUnflushed: number;
  requestsUnflushed: number;
  lastFlush: number;
  active: Record<string, ConnInfo>;
};

const DEFAULT_STATE: State = {
  bytesUnflushed: 0,
  requestsUnflushed: 0,
  lastFlush: 0,
  active: {},
};

const FLUSH_BYTES = 25 * 1024 * 1024;
const FLUSH_MS = 30_000;

export class UserState {
  private state: DurableObjectState;
  private env: Env;
  private data: State = { ...DEFAULT_STATE };
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<State>("data");
      if (stored) this.data = stored;
    });
    this.flushTimer = setInterval(() => {
      this.state.waitUntil(this.flush());
    }, FLUSH_MS);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const action = url.pathname.replace(/^\//, "");

    switch (action) {
      case "connect": {
        const { ip, subnet, ua } = (await req.json()) as { ip: string; subnet: string; ua: string };
        const limit = parseInt(url.searchParams.get("ipLimit") || "0", 10);
        const keys = Object.keys(this.data.active);
        if (limit > 0 && keys.length >= limit && !this.data.active[subnet]) {
          return Response.json({ ok: false, code: "ip_limit", active: keys.length });
        }
        this.data.active[subnet] = { ip, subnet, ua, startedAt: Date.now() };
        await this.persist();
        return Response.json({ ok: true, active: Object.keys(this.data.active).length });
      }
      case "disconnect": {
        const { subnet } = (await req.json()) as { subnet: string };
        delete this.data.active[subnet];
        await this.persist();
        return Response.json({ ok: true, active: Object.keys(this.data.active).length });
      }
      case "addBytes": {
        const { bytes, requests } = (await req.json()) as { bytes: number; requests?: number };
        this.data.bytesUnflushed += bytes | 0;
        this.data.requestsUnflushed += (requests || 0) | 0;
        if (this.data.bytesUnflushed >= FLUSH_BYTES) {
          this.state.waitUntil(this.flush());
        }
        return Response.json({ ok: true, unflushed: this.data.bytesUnflushed });
      }
      case "status": {
        return Response.json({
          active: Object.keys(this.data.active).length,
          unflushedBytes: this.data.bytesUnflushed,
          unflushedRequests: this.data.requestsUnflushed,
          connections: this.data.active,
        });
      }
      case "flush": {
        await this.flush();
        return Response.json({ ok: true });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  }

  private async persist() {
    await this.state.storage.put("data", this.data);
  }

  private async flush() {
    if (this.data.bytesUnflushed === 0 && this.data.requestsUnflushed === 0) return;
    const bytes = this.data.bytesUnflushed;
    const reqs = this.data.requestsUnflushed;
    this.data.bytesUnflushed = 0;
    this.data.requestsUnflushed = 0;
    this.data.lastFlush = Date.now();
    await this.persist();
    try {
      const user = this.state.id.name?.toString() || "";
      if (user) {
        const gb = bytes / (1024 * 1024 * 1024);
        await this.env.DB.prepare(
          `UPDATE users
             SET used_gb = used_gb + ?,
                 lifetime_gb = lifetime_gb + ?,
                 used_req = used_req + ?,
                 last_active = ?
           WHERE username = ?`
        )
          .bind(gb, gb, reqs, Math.floor(Date.now() / 1000), user)
          .run();
      }
    } catch (e) {
      // Roll back on failure so we don't lose bytes.
      this.data.bytesUnflushed += bytes;
      this.data.requestsUnflushed += reqs;
      await this.persist();
      console.error("UserState flush failed", e);
    }
  }
}

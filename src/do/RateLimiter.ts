// Tiny in-memory + Durable Storage rate limiter used for login attempts.
// Keyed by IP, with a sliding 15-minute window.

import type { Env } from "../env.js";

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private state: DurableObjectState;
  private env: Env;
  private bucket: Bucket = { count: 0, resetAt: 0 };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Bucket>("b");
      if (stored) this.bucket = stored;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/reset") {
      this.bucket = { count: 0, resetAt: 0 };
      await this.state.storage.delete("b");
      return Response.json({ ok: true });
    }
    const limit = parseInt(url.searchParams.get("limit") || "5", 10);
    const windowMs = parseInt(url.searchParams.get("window") || "900000", 10);
    const now = Date.now();
    if (now > this.bucket.resetAt) {
      this.bucket = { count: 0, resetAt: now + windowMs };
    }
    this.bucket.count += 1;
    await this.state.storage.put("b", this.bucket);
    return Response.json({
      ok: this.bucket.count <= limit,
      count: this.bucket.count,
      remaining: Math.max(0, limit - this.bucket.count),
      resetAt: this.bucket.resetAt,
    });
  }
}

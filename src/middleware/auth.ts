// Authentication middleware for the panel API.
// - Session cookie (HttpOnly) issued at login
// - Scoped API token (Authorization: Bearer <token>)
// - Rate limiter hook via the RATE_LIMIT Durable Object

import type { Context, Next } from "hono";
import { sha256Hex } from "../util/crypto.js";
import type { Env } from "../env.js";

export type AppVars = {
  actor: string;
  adminId?: number;
  role?: string;
  authKind?: "session" | "token";
  scopes?: string[];
};

const SESSION_COOKIE = "kalfetela_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export async function requireAuth(c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) {
  const env = c.env as Env;

  // 1) API token
  const auth = c.req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const raw = auth.slice(7).trim();
    const hash = await sha256Hex(raw);
    const token = await env.DB.prepare(
      "SELECT * FROM api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)"
    ).bind(hash, Math.floor(Date.now() / 1000)).first<{ id: number; name: string; scopes: string }>();
    if (token) {
      c.set("actor", `token:${token.name}`);
      c.set("scopes", safeParse(token.scopes) || []);
      c.set("authKind", "token");
      await env.DB.prepare("UPDATE api_tokens SET last_used = ? WHERE id = ?")
        .bind(Math.floor(Date.now() / 1000), token.id).run().catch(() => {});
      return next();
    }
  }

  // 2) Session cookie
  const cookie = c.req.header("cookie") || "";
  const m = cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith(SESSION_COOKIE + "="));
  if (m) {
    const raw = m.split("=").slice(1).join("=");
    const hash = await sha256Hex(raw);
    const row = await env.DB.prepare(
      `SELECT s.*, a.username, a.role
         FROM sessions s JOIN admins a ON a.id = s.admin_id
        WHERE s.token_hash = ? AND s.expires_at > ?`
    ).bind(hash, Math.floor(Date.now() / 1000)).first<{ admin_id: number; username: string; role: string; scopes?: string[] }>();
    if (row) {
      c.set("actor", row.username);
      c.set("adminId", row.admin_id);
      c.set("role", row.role);
      c.set("authKind", "session");
      return next();
    }
  }

  return c.json({ error: "unauthorized" }, 401);
}

export function requireRole(...roles: string[]) {
  return async (c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) => {
    const role = c.get("role") as string | undefined;
    const kind = c.get("authKind") as string | undefined;
    if (kind === "token") {
      // Tokens don't carry role but have scopes; check for "admin" scope.
      const scopes = (c.get("scopes") as string[] | undefined) || [];
      if (!scopes.includes("admin")) return c.json({ error: "forbidden" }, 403);
      return next();
    }
    if (!role || !roles.includes(role)) return c.json({ error: "forbidden" }, 403);
    return next();
  };
}

export async function issueSession(c: Context<{ Bindings: Env; Variables: AppVars }>, adminId: number, env: Env) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const hash = await sha256Hex(token);
  const ua = c.req.header("user-agent") || "";
  const ip = c.req.header("CF-Connecting-IP") || "";
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, admin_id, user_agent, ip, expires_at, created_at) VALUES (?,?,?,?,?,?)"
  ).bind(hash, adminId, ua, ip, now + SESSION_TTL_SEC, now).run();
  setSessionCookie(c, token, SESSION_TTL_SEC);
}

export async function destroySession(c: Context<{ Bindings: Env; Variables: AppVars }>, env: Env) {
  const cookie = c.req.header("cookie") || "";
  const m = cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith(SESSION_COOKIE + "="));
  if (m) {
    const raw = m.split("=").slice(1).join("=");
    const hash = await sha256Hex(raw);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run().catch(() => {});
  }
  setSessionCookie(c, "", 0);
}

function setSessionCookie(c: Context, value: string, expireSec: number) {
  const secure = true;
  const sameSite = "Lax";
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${expireSec}`,
    "HttpOnly",
    sameSite ? `SameSite=${sameSite}` : "",
    secure ? "Secure" : "",
  ].filter(Boolean);
  c.header("Set-Cookie", parts.join("; "));
}

export async function csrfProtection(c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) {
  // Browser-issued POSTs must carry an Origin or Referer matching
  // our host; tokens (Authorization header) bypass this check.
  const method = c.req.method;
  if (method === "GET" || method === "HEAD") return next();
  if (c.req.header("authorization")) return next();
  const origin = c.req.header("origin") || c.req.header("referer") || "";
  const host = c.req.header("host") || "";
  if (!origin) return c.json({ error: "missing origin" }, 403);
  try {
    const u = new URL(origin);
    if (u.host !== host) return c.json({ error: "csrf" }, 403);
  } catch {
    return c.json({ error: "bad origin" }, 403);
  }
  return next();
}

function safeParse(s: string): string[] | null {
  try { return JSON.parse(s); } catch { return null; }
}

export { SESSION_COOKIE, SESSION_TTL_SEC };

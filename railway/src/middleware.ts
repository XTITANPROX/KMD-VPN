// Hono middleware: admin sessions, API tokens, agent authentication and the
// tiny helpers routes use for validation errors.

import type { Context, MiddlewareHandler, Next } from "hono";
import { AGENT_SECRET, COOKIE_NAME } from "./env.js";
import { getSession, tokenHasScope, type SessionRow } from "./services/auth.js";
import { getAdmin, getApiToken } from "./services/store.js";
import { constantTimeEqual } from "./lib/crypto.js";
import { ValidationError } from "./lib/validate.js";
import type { AdminRow } from "./types.js";

export interface AppVariables {
  admin: AdminRow;
  session: SessionRow;
  apiToken?: { id: number; name: string; scopes: string | null };
}

export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "0.0.0.0";
}

/** Public base URL derived from the incoming request (proxy aware). */
export function requestBase(c: Context): string {
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || "";
  return host ? `${proto}://${host}` : "";
}

let cachedBase = "";

/**
 * Remembers the public base URL the panel is being reached with, so links in
 * bot messages / API responses stay correct even without PUBLIC_URL.
 */
export async function observeBase(c: Context): Promise<string> {
  const base = requestBase(c);
  if (base && base !== cachedBase) {
    cachedBase = base;
    try {
      const { setSetting } = await import("./db/index.js");
      await setSetting("runtime_base", base);
    } catch {
      /* database not ready yet — ignore */
    }
  }
  return base || cachedBase;
}

export function cachedBaseUrl(): string {
  return cachedBase;
}

function readCookie(c: Context, name: string): string | undefined {
  const header = c.req.header("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionTokenFrom(c: Context): string | undefined {
  const bearer = c.req.header("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return readCookie(c, COOKIE_NAME) ?? c.req.header("x-session-token") ?? undefined;
}

/** Requires a valid panel session (admin). */
export const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const found = await getSession(sessionTokenFrom(c));
  if (!found) return c.json({ error: "برای دسترسی باید وارد شوید", code: "unauthorized" }, 401);
  c.set("admin", found.admin);
  c.set("session", found.session);
  await next();
};

/** Requires the owner (super admin) role. */
export const requireOwner: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const admin = c.get("admin") as AdminRow | undefined;
  if (!admin) return c.json({ error: "برای دسترسی باید وارد شوید", code: "unauthorized" }, 401);
  if (admin.role !== "owner") return c.json({ error: "این بخش فقط برای مدیر اصلی است", code: "forbidden" }, 403);
  await next();
};

/** Permission gate for section level access. */
export function requirePermission(permission: "nodes" | "admins" | "billing" | "bot"): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const admin = c.get("admin") as AdminRow | undefined;
    if (!admin) return c.json({ error: "برای دسترسی باید وارد شوید", code: "unauthorized" }, 401);
    if (admin.role === "owner") return next();
    const allowed =
      (permission === "nodes" && admin.can_manage_nodes) ||
      (permission === "admins" && admin.can_manage_admins) ||
      (permission === "bot" && admin.can_use_bot) ||
      permission === "billing";
    if (!allowed) return c.json({ error: "دسترسی شما به این بخش محدود شده است", code: "forbidden" }, 403);
    return next();
  };
}

/** Public API: accepts a panel session OR an API token (`X-API-Key`). */
export const requireApiAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const apiKey = c.req.header("x-api-key") ?? c.req.query("api_key");
  if (apiKey) {
    const token = await getApiToken(apiKey);
    if (!token) return c.json({ error: "کلید API نامعتبر است", code: "unauthorized" }, 401);
    c.set("apiToken", { id: token.id, name: token.name, scopes: token.scopes });
    // read-only tokens (scopes: `read`) may only read
    const scopes = (token.scopes ?? "*").split(/[,|\s]+/).filter(Boolean);
    const readOnly = !scopes.includes("*") && scopes.includes("read") && !scopes.includes("write");
    if (readOnly && c.req.method !== "GET") {
      return c.json({ error: "این کلید API فقط اجازه‌ی خواندن دارد", code: "forbidden" }, 403);
    }
    if (!c.get("admin")) {
      // a session always wins; otherwise the token acts as its creator
      const session = await getSession(sessionTokenFrom(c));
      const acting = session?.admin ?? (token.created_by ? await getAdmin(token.created_by) : undefined);
      if (!acting) return c.json({ error: "کلید API به مدیر معتبری متصل نیست", code: "unauthorized" }, 401);
      c.set("admin", acting);
    }
    await next();
    return;
  }
  return requireAdmin(c, next);
};

export function requireScope(scope: string): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const token = c.get("apiToken");
    if (token && !tokenHasScope(token.scopes, scope)) {
      return c.json({ error: `کلید API به ${scope} دسترسی ندارد`, code: "forbidden" }, 403);
    }
    await next();
  };
}

/** Node agents authenticate with a shared secret or the node specific secret. */
export function agentAuthorized(c: Context): boolean {
  const provided = c.req.header("x-agent-secret") ?? c.req.query("secret") ?? "";
  if (!provided) return false;
  return constantTimeEqual(provided, AGENT_SECRET);
}

/* ------------------------- error / validation glue ---------------------- */

export function errorResponse(c: Context, error: unknown) {
  if (error instanceof ValidationError) {
    return c.json({ error: error.message, code: "validation", fields: error.fields }, 400);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error("[api]", message);
  return c.json({ error: message, code: "server_error" }, 500);
}

export function notFound(c: Context) {
  return c.json({ error: "مسیر مورد نظر پیدا نشد", code: "not_found" }, 404);
}

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ ok: true, data }, status as 200);
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Wraps a handler so thrown ValidationErrors become JSON 400 responses. */
export function safe<C extends Context>(handler: (c: C) => Promise<Response> | Response) {
  return async (c: C): Promise<Response> => {
    try {
      return await handler(c);
    } catch (error) {
      return errorResponse(c, error) as Response;
    }
  };
}

export type { Next };

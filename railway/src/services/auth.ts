// Sessions, login throttling, one-time codes (telegram login & 2FA).

import { getDb } from "../db/index.js";
import { SESSION_TTL_HOURS } from "../env.js";
import { randomToken, signSession, verifySessionToken } from "../lib/crypto.js";
import { nowSeconds } from "../lib/format.js";
import type { AdminRow } from "../types.js";

export interface SessionRow {
  id: string;
  admin_id: number | null;
  type: string;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
}

export async function createSession(
  adminId: number,
  meta: { ip?: string | null; userAgent?: string | null; type?: string } = {}
): Promise<{ token: string; expiresAt: number }> {
  const id = randomToken(32);
  const now = nowSeconds();
  const expiresAt = now + SESSION_TTL_HOURS * 3600;
  await getDb().insert(
    "INSERT INTO sessions (id, admin_id, type, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, adminId, meta.type ?? "admin", meta.ip ?? null, meta.userAgent ?? null, now, expiresAt]
  );
  return { token: signSession(id), expiresAt };
}

export async function getSession(token: string | undefined | null): Promise<{ session: SessionRow; admin: AdminRow } | null> {
  if (!token) return null;
  const id = verifySessionToken(token);
  if (!id) return null;
  const db = getDb();
  const session = await db.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", [id]);
  if (!session) return null;
  if (session.expires_at * 1000 < Date.now()) {
    await db.run("DELETE FROM sessions WHERE id = ?", [id]);
    return null;
  }
  const admin = await db.get<AdminRow>("SELECT * FROM admins WHERE id = ?", [session.admin_id ?? 0]);
  if (!admin || admin.status === "disabled") return null;
  return { session, admin };
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  const id = token ? verifySessionToken(token) : null;
  if (id) await getDb().run("DELETE FROM sessions WHERE id = ?", [id]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await getDb().run("DELETE FROM sessions WHERE expires_at < ?", [nowSeconds()]);
}

/* --------------------------- login throttling --------------------------- */

interface AttemptRecord {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

export function loginAllowed(ip: string, max = 6, windowMs = 600_000): boolean {
  const record = attempts.get(ip);
  if (!record) return true;
  if (record.blockedUntil && record.blockedUntil > Date.now()) return false;
  if (Date.now() - record.firstAt > windowMs) {
    attempts.delete(ip);
    return true;
  }
  return record.count < max;
}

export function recordFailedLogin(ip: string, max = 6, windowMs = 600_000): void {
  const record = attempts.get(ip) ?? { count: 0, firstAt: Date.now(), blockedUntil: 0 };
  if (Date.now() - record.firstAt > windowMs) {
    record.count = 0;
    record.firstAt = Date.now();
  }
  record.count += 1;
  if (record.count >= max) record.blockedUntil = Date.now() + windowMs;
  attempts.set(ip, record);
}

export function clearFailedLogins(ip: string): void {
  attempts.delete(ip);
}

export function loginBlockedFor(ip: string): number {
  const record = attempts.get(ip);
  if (!record || !record.blockedUntil) return 0;
  return Math.max(0, Math.ceil((record.blockedUntil - Date.now()) / 1000));
}

/* ----------------------- one time codes (bot login) --------------------- */

interface CodeRecord {
  code: string;
  adminId: number;
  expiresAt: number;
  used: boolean;
}

const codes = new Map<string, CodeRecord>();

export function issueLoginCode(adminId: number, kind = "login"): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  codes.set(`${kind}:${code}`, { code, adminId, expiresAt: Date.now() + 5 * 60_000, used: false });
  return code;
}

export function consumeLoginCode(code: string, kind = "login"): number | null {
  const key = `${kind}:${code}`;
  const record = codes.get(key);
  if (!record) return null;
  if (record.used || record.expiresAt < Date.now()) {
    codes.delete(key);
    return null;
  }
  record.used = true;
  codes.delete(key);
  return record.adminId;
}

/* ------------------------------- API tokens ----------------------------- */

export function tokenHasScope(scopes: string | null, required: string): boolean {
  if (!scopes) return true;
  const list = scopes.split(",").map((item) => item.trim());
  return list.includes("*") || list.includes(required);
}

// The data layer: typed helpers on top of the Db abstraction.
//
// Everything the API, the bot, the subscription service and the scheduler
// need lives here so business rules (quota, expiry, status) are enforced in
// exactly one place.

import { getDb, utcDay } from "../db/index.js";
import { nowSeconds } from "../lib/format.js";
import { hashPassword, randomToken, randomUuid, verifyPassword } from "../lib/crypto.js";
import type {
  AdminRow,
  ApiTokenRow,
  DashboardStats,
  NodeRow,
  PanelRow,
  PaymentRow,
  PlanRow,
  TicketMessageRow,
  TicketRow,
  TrafficPoint,
  UserNodeRow,
  UserRow,
} from "../types.js";

/* ------------------------------------------------------------------ *
 * Status change hook (wired to node sync + telegram notifications)
 * ------------------------------------------------------------------ */

export type UserStatusHandler = (user: UserRow, previous: string, next: string) => void | Promise<void>;
let statusHandler: UserStatusHandler | null = null;
export function setUserStatusHandler(handler: UserStatusHandler | null): void {
  statusHandler = handler;
}
async function fireStatusChange(user: UserRow, previous: string, next: string): Promise<void> {
  if (previous === next || !statusHandler) return;
  try {
    await statusHandler(user, previous, next);
  } catch (error) {
    console.warn("[store] status handler failed:", (error as Error).message);
  }
}

/* ------------------------------------------------------------------ *
 * Status / quota helpers
 * ------------------------------------------------------------------ */

export function effectiveStatus(user: Pick<UserRow, "status" | "data_limit_bytes" | "data_used_bytes" | "expires_at" | "on_hold">): string {
  if (user.status === "disabled") return "disabled";
  if (user.status === "on_hold" || user.on_hold) return "on_hold";
  if (user.expires_at && user.expires_at * 1000 <= Date.now()) return "expired";
  if (user.data_limit_bytes > 0 && user.data_used_bytes >= user.data_limit_bytes) return "limited";
  return "active";
}

export function remainingBytes(user: Pick<UserRow, "data_limit_bytes" | "data_used_bytes">): number {
  if (user.data_limit_bytes <= 0) return -1; // unlimited
  return Math.max(0, user.data_limit_bytes - user.data_used_bytes);
}

export function usagePercent(user: Pick<UserRow, "data_limit_bytes" | "data_used_bytes">): number {
  if (user.data_limit_bytes <= 0) return 0;
  return Math.min(100, Math.round((user.data_used_bytes / user.data_limit_bytes) * 100));
}

/** Recomputes the stored status; returns the previous status when it changed. */
export async function refreshUserStatus(userId: number): Promise<{ user: UserRow; previous: string; changed: boolean } | null> {
  const db = getDb();
  const user = await getUser(userId);
  if (!user) return null;
  const previous = user.status;
  const next = effectiveStatus(user);
  if (next !== previous) {
    await db.run("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [next, nowSeconds(), userId]);
    user.status = next;
    await fireStatusChange(user, previous, next);
  }
  return { user, previous, changed: next !== previous };
}

/* ------------------------------------------------------------------ *
 * Adapters / users
 * ------------------------------------------------------------------ */

export interface UserListFilter {
  page?: number;
  perPage?: number;
  search?: string;
  status?: string;
  adminId?: number | null;
  planId?: number | null;
  onlineOnly?: boolean;
  sort?: "newest" | "oldest" | "usage" | "expiry" | "name";
  telegramId?: string | null;
}

export async function listUsers(filter: UserListFilter = {}): Promise<{ items: UserRow[]; total: number; page: number; perPage: number }> {
  const db = getDb();
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(5, filter.perPage ?? 20));
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.search) {
    where.push("(username LIKE ? OR email LIKE ? OR telegram_id LIKE ? OR uuid LIKE ? OR sub_token LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like, like, like);
  }
  if (filter.status && filter.status !== "all") {
    if (filter.status === "online") {
      const window_ = Number(process.env.ONLINE_WINDOW_SECONDS || 300);
      where.push("last_online_at >= ?");
      params.push(nowSeconds() - window_);
    } else {
      where.push("status = ?");
      params.push(filter.status);
    }
  }
  if (filter.adminId) {
    where.push("admin_id = ?");
    params.push(filter.adminId);
  }
  if (filter.planId) {
    where.push("plan_id = ?");
    params.push(filter.planId);
  }
  if (filter.telegramId) {
    where.push("telegram_id = ?");
    params.push(filter.telegramId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql =
    {
      newest: "created_at DESC",
      oldest: "created_at ASC",
      usage: "data_used_bytes DESC",
      expiry: "expires_at IS NULL, expires_at ASC",
      name: "username ASC",
    }[filter.sort ?? "newest"] ?? "created_at DESC";

  const totalRow = await db.get<{ count: number | string }>(`SELECT COUNT(*) AS count FROM users ${whereSql}`, params);
  const total = Number(totalRow?.count ?? 0);
  const items = await db.all<UserRow>(
    `SELECT * FROM users ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage]
  );
  return { items, total, page, perPage };
}

export async function getUser(id: number): Promise<UserRow | undefined> {
  return getDb().get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
}

export async function getUserByUsername(username: string): Promise<UserRow | undefined> {
  return getDb().get<UserRow>("SELECT * FROM users WHERE username = ?", [username]);
}

export async function getUserBySubToken(token: string): Promise<UserRow | undefined> {
  return getDb().get<UserRow>("SELECT * FROM users WHERE sub_token = ?", [token]);
}

export async function getUserByTelegram(telegramId: string): Promise<UserRow | undefined> {
  return getDb().get<UserRow>("SELECT * FROM users WHERE telegram_id = ? ORDER BY id DESC", [telegramId]);
}

export async function getUsersByTelegram(telegramId: string): Promise<UserRow[]> {
  return getDb().all<UserRow>("SELECT * FROM users WHERE telegram_id = ? ORDER BY id DESC", [telegramId]);
}

export async function getUsersByUuid(uuid: string): Promise<UserRow | undefined> {
  return getDb().get<UserRow>("SELECT * FROM users WHERE uuid = ?", [uuid]);
}

export interface CreateUserInput {
  username: string;
  dataLimitBytes?: number;
  days?: number;
  deviceLimit?: number;
  speedLimitMbps?: number;
  adminId?: number | null;
  planId?: number | null;
  telegramId?: string | null;
  email?: string | null;
  note?: string | null;
  nodeIds?: number[] | null;
  uuid?: string;
  password?: string;
  subToken?: string;
  expiresAt?: number | null;
  status?: string;
  createdAt?: number;
  activated?: boolean;
  provider?: string;
  panelId?: number | null;
  resetStrategy?: string;
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const db = getDb();
  const now = nowSeconds();
  const uuid = input.uuid || randomUuid();
  const subToken = input.subToken || randomToken(18);
  const expires =
    input.expiresAt !== undefined && input.expiresAt !== null
      ? input.expiresAt
      : input.days && input.days > 0
        ? now + input.days * 86400
        : null;

  const id = await db.insert(
    `INSERT INTO users (username, uuid, password, email, telegram_id, provider, panel_id, admin_id, plan_id,
      data_limit_bytes, data_used_bytes, upload_bytes, download_bytes, request_limit, request_used, expires_at,
      created_at, activated_at, sub_token, sub_updated_at, device_limit, speed_limit_mbps, status, note,
      reset_strategy, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.username,
      uuid,
      input.password || randomToken(10),
      input.email ?? null,
      input.telegramId ?? null,
      input.provider ?? "local",
      input.panelId ?? null,
      input.adminId ?? null,
      input.planId ?? null,
      input.dataLimitBytes ?? 0,
      expires,
      input.createdAt ?? now,
      input.activated === false ? null : now,
      subToken,
      now,
      input.deviceLimit ?? 0,
      input.speedLimitMbps ?? 0,
      input.status ?? "active",
      input.note ?? null,
      input.resetStrategy ?? "no_reset",
      now,
    ]
  );

  if (input.nodeIds && input.nodeIds.length) {
    await setUserNodes(id, input.nodeIds);
  }
  return (await getUser(id))!;
}

export async function updateUser(id: number, patch: Partial<UserRow>): Promise<void> {
  const db = getDb();
  const allowed = Object.keys(patch).filter((key) => key !== "id" && key !== "username");
  if (!allowed.length) return;
  const sets = allowed.map((key) => `${key} = ?`).join(", ");
  const values = allowed.map((key) => (patch as Record<string, unknown>)[key] ?? null);
  await db.run(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowSeconds(), id]);
}

export async function deleteUser(id: number): Promise<void> {
  const db = getDb();
  await db.tx(async (tx) => {
    await tx.run("DELETE FROM user_nodes WHERE user_id = ?", [id]);
    await tx.run("DELETE FROM devices WHERE user_id = ?", [id]);
    await tx.run("DELETE FROM users WHERE id = ?", [id]);
  });
}

/** Fine grained counters used by every traffic report. */
export async function applyUsage(
  userId: number,
  upload: number,
  download: number,
  options: { nodeId?: number | null; adminId?: number | null; record?: boolean } = {}
): Promise<{ user: UserRow | null; statusChanged: boolean; previous: string }> {
  const db = getDb();
  if (upload <= 0 && download <= 0) {
    const user = await getUser(userId);
    return { user: user ?? null, statusChanged: false, previous: user?.status ?? "" };
  }
  const total = upload + download;
  await db.run(
    `UPDATE users SET upload_bytes = upload_bytes + ?, download_bytes = download_bytes + ?,
      data_used_bytes = data_used_bytes + ?, last_online_at = ?, updated_at = ? WHERE id = ?`,
    [upload, download, total, nowSeconds(), nowSeconds(), userId]
  );

  if (options.adminId) {
    await db.run("UPDATE admins SET used_bytes = used_bytes + ? WHERE id = ?", [total, options.adminId]);
  }

  const day = utcDay();
  const hour = new Date().getHours();
  const existing = await db.get<{ id: number }>(
    "SELECT id FROM traffic_log WHERE user_id = ? AND day = ? AND hour = ?",
    [userId, day, hour]
  );
  if (existing) {
    await db.run(
      "UPDATE traffic_log SET upload_bytes = upload_bytes + ?, download_bytes = download_bytes + ? WHERE id = ?",
      [upload, download, existing.id]
    );
  } else {
    await db.insert(
      "INSERT INTO traffic_log (user_id, node_id, upload_bytes, download_bytes, day, hour, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, options.nodeId ?? null, upload, download, day, hour, nowSeconds()]
    );
  }

  const result = await refreshUserStatus(userId);
  return {
    user: result?.user ?? null,
    statusChanged: result?.changed ?? false,
    previous: result?.previous ?? "",
  };
}

export async function resetUserTraffic(id: number, options: { keepHistory?: boolean } = {}): Promise<void> {
  const db = getDb();
  await db.run(
    "UPDATE users SET data_used_bytes = 0, upload_bytes = 0, download_bytes = 0, request_used = 0, last_reset_at = ?, updated_at = ? WHERE id = ?",
    [nowSeconds(), nowSeconds(), id]
  );
  if (!options.keepHistory) {
    // keep the aggregated log (billing history) but clear per-user hourly points older than today
    await db.run("DELETE FROM traffic_log WHERE user_id = ? AND day < ?", [id, utcDay()]);
  }
  await refreshUserStatus(id);
}

export async function extendUser(id: number, days: number, options: { fromToday?: boolean } = {}): Promise<UserRow | null> {
  const user = await getUser(id);
  if (!user) return null;
  const now = nowSeconds();
  const base = options.fromToday === false && user.expires_at ? Math.max(user.expires_at, now) : now;
  const expires = days > 0 ? base + days * 86400 : null;
  await getDb().run("UPDATE users SET expires_at = ?, updated_at = ? WHERE id = ?", [expires, now, id]);
  await refreshUserStatus(id);
  return (await getUser(id)) ?? null;
}

export async function setUserNodes(userId: number, nodeIds: number[]): Promise<void> {
  const db = getDb();
  const user = await getUser(userId);
  if (!user) return;
  const now = nowSeconds();
  await db.run("DELETE FROM user_nodes WHERE user_id = ?", [userId]);
  for (const nodeId of nodeIds) {
    await db.insert(
      "INSERT INTO user_nodes (user_id, node_id, client_id, label, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
      [userId, nodeId, user.uuid, user.username, now]
    );
  }
}

export async function getUserNodes(userId: number): Promise<Array<UserNodeRow & { node?: NodeRow }>> {
  const rows = await getDb().all<UserNodeRow>("SELECT * FROM user_nodes WHERE user_id = ?", [userId]);
  if (!rows.length) return [];
  const out: Array<UserNodeRow & { node?: NodeRow }> = [];
  for (const row of rows) {
    const node = await getNode(row.node_id);
    out.push({ ...row, node: node ?? undefined });
  }
  return out;
}

export async function setUserNodeClientId(userId: number, nodeId: number, clientId: string): Promise<void> {
  await getDb().run("UPDATE user_nodes SET client_id = ? WHERE user_id = ? AND node_id = ?", [clientId, userId, nodeId]);
}

export async function touchUserOnline(userId: number): Promise<void> {
  await getDb().run("UPDATE users SET last_online_at = ? WHERE id = ?", [nowSeconds(), userId]);
}

export async function countUsers(adminId?: number | null): Promise<number> {
  const db = getDb();
  const row = adminId
    ? await db.get<{ count: number | string }>("SELECT COUNT(*) AS count FROM users WHERE admin_id = ?", [adminId])
    : await db.get<{ count: number | string }>("SELECT COUNT(*) AS count FROM users");
  return Number(row?.count ?? 0);
}

/** Recomputes the aggregate usage of a reseller from its users. */
export async function recomputeAdminUsage(adminId: number): Promise<number> {
  const db = getDb();
  const row = await db.get<{ total: number | string | null }>(
    "SELECT SUM(data_used_bytes) AS total FROM users WHERE admin_id = ?",
    [adminId]
  );
  const total = Number(row?.total ?? 0);
  await db.run("UPDATE admins SET used_bytes = ? WHERE id = ?", [total, adminId]);
  return total;
}

/**
 * Per-admin (reseller) quota cutoff: recomputes usage and, when an admin's
 * traffic quota is exhausted, puts that admin's users on hold so their
 * services stop until the reseller tops the quota up.
 */
export async function enforceAdminQuotas(): Promise<Array<{ admin: AdminRow; used: number; held: number }>> {
  const db = getDb();
  const admins = await db.all<AdminRow>("SELECT * FROM admins WHERE role <> 'owner' AND quota_bytes > 0 AND status <> 'disabled'");
  const out: Array<{ admin: AdminRow; used: number; held: number }> = [];
  for (const admin of admins) {
    const used = await recomputeAdminUsage(admin.id);
    if (used < admin.quota_bytes) continue;
    const result = await db.run("UPDATE users SET status = 'on_hold', hold_reason = ?, updated_at = ? WHERE admin_id = ? AND status NOT IN ('disabled','on_hold')", [
      "اتمام سقف حجم نماینده",
      nowSeconds(),
      admin.id,
    ]);
    const held = Number((result as { changes?: number })?.changes ?? 0);
    out.push({ admin, used, held });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Admins
 * ------------------------------------------------------------------ */

export async function listAdmins(): Promise<AdminRow[]> {
  return getDb().all<AdminRow>("SELECT * FROM admins ORDER BY role = 'owner' DESC, id ASC");
}

export async function getAdmin(id: number): Promise<AdminRow | undefined> {
  return getDb().get<AdminRow>("SELECT * FROM admins WHERE id = ?", [id]);
}

export async function getAdminByUsername(username: string): Promise<AdminRow | undefined> {
  return getDb().get<AdminRow>("SELECT * FROM admins WHERE username = ?", [username]);
}

export async function getAdminByTelegram(telegramId: string): Promise<AdminRow | undefined> {
  return getDb().get<AdminRow>("SELECT * FROM admins WHERE telegram_id = ?", [telegramId]);
}

export async function countAdmins(): Promise<number> {
  const row = await getDb().get<{ count: number | string }>("SELECT COUNT(*) AS count FROM admins");
  return Number(row?.count ?? 0);
}

export interface AdminInput {
  username: string;
  password?: string;
  role?: string;
  credit?: number;
  quotaBytes?: number;
  maxUsers?: number;
  canManageNodes?: boolean;
  canManageAdmins?: boolean;
  canUseBot?: boolean;
  telegramId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  note?: string | null;
  status?: string;
}

export async function createAdmin(input: AdminInput): Promise<AdminRow> {
  const now = nowSeconds();
  const id = await getDb().insert(
    `INSERT INTO admins (username, password_hash, role, credit, quota_bytes, used_bytes, max_users,
      can_manage_nodes, can_manage_admins, can_use_bot, telegram_id, first_name, last_name, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.username,
      hashPassword(input.password || randomToken(8)),
      input.role ?? "admin",
      input.credit ?? 0,
      input.quotaBytes ?? 0,
      input.maxUsers ?? 0,
      input.canManageNodes === false ? 0 : 1,
      input.canManageAdmins ? 1 : 0,
      input.canUseBot === false ? 0 : 1,
      input.telegramId ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
      input.note ?? null,
      input.status ?? "active",
      now,
    ]
  );
  return (await getAdmin(id))!;
}

export async function updateAdmin(id: number, patch: Record<string, unknown>): Promise<void> {
  const allowed = [
    "role",
    "credit",
    "quota_bytes",
    "max_users",
    "can_manage_nodes",
    "can_manage_admins",
    "can_use_bot",
    "telegram_id",
    "first_name",
    "last_name",
    "note",
    "status",
    "last_login_at",
    "last_login_ip",
    "last_seen_at",
  ];
  const keys = Object.keys(patch).filter((key) => allowed.includes(key));
  if (patch.password) {
    await getDb().run("UPDATE admins SET password_hash = ? WHERE id = ?", [hashPassword(String(patch.password)), id]);
  }
  if (!keys.length) return;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (patch[key] as unknown) ?? null);
  await getDb().run(`UPDATE admins SET ${sets} WHERE id = ?`, [...values, id]);
}

export async function deleteAdmin(id: number): Promise<void> {
  await getDb().run("DELETE FROM admins WHERE id = ?", [id]);
  await getDb().run("UPDATE users SET admin_id = NULL WHERE admin_id = ?", [id]);
}

export async function verifyAdminLogin(username: string, password: string): Promise<AdminRow | null> {
  const admin = await getAdminByUsername(username);
  if (!admin) return null;
  if (admin.status === "disabled") return null;
  if (!verifyPassword(password, admin.password_hash)) return null;
  await getDb().run("UPDATE admins SET last_login_at = ?, last_login_ip = ? WHERE id = ?", [
    nowSeconds(),
    null,
    admin.id,
  ]);
  return admin;
}

/* ------------------------------------------------------------------ *
 * Panels (upstream x-ui / marzban / ...)
 * ------------------------------------------------------------------ */

export async function listPanels(): Promise<PanelRow[]> {
  return getDb().all<PanelRow>("SELECT * FROM panels ORDER BY id ASC");
}

export async function getPanel(id: number): Promise<PanelRow | undefined> {
  return getDb().get<PanelRow>("SELECT * FROM panels WHERE id = ?", [id]);
}

export async function createPanel(input: Partial<PanelRow> & { name: string; base_url: string }): Promise<PanelRow> {
  const id = await getDb().insert(
    `INSERT INTO panels (name, type, base_url, username, password, api_token, sub_base_url, proxy_url, extra, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.type ?? "x-ui",
      input.base_url.replace(/\/+$/, ""),
      input.username ?? null,
      input.password ?? null,
      input.api_token ?? null,
      input.sub_base_url ?? null,
      input.proxy_url ?? null,
      input.extra ?? null,
      "unknown",
      nowSeconds(),
    ]
  );
  return (await getPanel(id))!;
}

export async function updatePanel(id: number, patch: Record<string, unknown>): Promise<void> {
  const allowed = ["name", "type", "base_url", "username", "password", "api_token", "sub_base_url", "proxy_url", "extra", "status", "last_error", "last_checked_at"];
  const keys = Object.keys(patch).filter((key) => allowed.includes(key));
  if (!keys.length) return;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (patch[key] as unknown) ?? null);
  await getDb().run(`UPDATE panels SET ${sets} WHERE id = ?`, [...values, id]);
}

export async function deletePanel(id: number): Promise<void> {
  await getDb().run("DELETE FROM panels WHERE id = ?", [id]);
}

/* ------------------------------------------------------------------ *
 * Nodes
 * ------------------------------------------------------------------ */

export async function listNodes(options: { activeOnly?: boolean; kind?: string; panelId?: number } = {}): Promise<NodeRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.activeOnly) where.push("active = 1");
  if (options.kind) {
    where.push("kind = ?");
    params.push(options.kind);
  }
  if (options.panelId) {
    where.push("panel_id = ?");
    params.push(options.panelId);
  }
  const sql = `SELECT * FROM nodes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY sort ASC, id ASC`;
  return getDb().all<NodeRow>(sql, params);
}

export async function getNode(id: number): Promise<NodeRow | undefined> {
  return getDb().get<NodeRow>("SELECT * FROM nodes WHERE id = ?", [id]);
}

export async function createNode(input: Partial<NodeRow> & { name: string; host: string; port: number }): Promise<NodeRow> {
  const now = nowSeconds();
  const id = await getDb().insert(
    `INSERT INTO nodes (name, kind, panel_id, inbound_id, protocol, transport, security, host, port, sni, path, service_name,
      flow, fingerprint, alpn, reality_public_key, reality_private_key, reality_short_id, reality_dest, private_key, public_key,
      dns, mtu, address_v4, address_v6, settings, capacity, status, sort, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.kind ?? "panel",
      input.panel_id ?? null,
      input.inbound_id ?? null,
      input.protocol ?? "vless",
      input.transport ?? "ws",
      input.security ?? "tls",
      input.host,
      input.port,
      input.sni ?? null,
      input.path ?? null,
      input.service_name ?? null,
      input.flow ?? null,
      input.fingerprint ?? null,
      input.alpn ?? null,
      input.reality_public_key ?? null,
      input.reality_private_key ?? null,
      input.reality_short_id ?? null,
      input.reality_dest ?? null,
      input.private_key ?? null,
      input.public_key ?? null,
      input.dns ?? null,
      input.mtu ?? null,
      input.address_v4 ?? null,
      input.address_v6 ?? null,
      input.settings ?? null,
      input.capacity ?? 0,
      input.status ?? "unknown",
      input.sort ?? 0,
      input.active ?? 1,
      now,
      now,
    ]
  );
  return (await getNode(id))!;
}

export async function updateNode(id: number, patch: Record<string, unknown>): Promise<void> {
  const allowed = [
    "name", "kind", "panel_id", "inbound_id", "protocol", "transport", "security", "host", "port", "sni", "path",
    "service_name", "flow", "fingerprint", "alpn", "reality_public_key", "reality_private_key", "reality_short_id",
    "reality_dest", "private_key", "public_key", "dns", "mtu", "address_v4", "address_v6", "settings", "capacity",
    "status", "cpu_load", "mem_load", "uptime_seconds", "last_heartbeat_at", "last_error", "sort", "active",
    "agent_secret", "xray_json", "core_version", "health",
  ];
  const keys = Object.keys(patch).filter((key) => allowed.includes(key));
  if (!keys.length) return;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (patch[key] as unknown) ?? null);
  await getDb().run(`UPDATE nodes SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowSeconds(), id]);
}

export async function deleteNode(id: number): Promise<void> {
  await getDb().run("DELETE FROM user_nodes WHERE node_id = ?", [id]);
  await getDb().run("DELETE FROM nodes WHERE id = ?", [id]);
}

/** Live per-node user counters (used by the nodes page). */
export async function nodeUserCounts(): Promise<Record<number, number>> {
  const rows = await getDb().all<{ node_id: number; count: number | string }>(
    "SELECT node_id, COUNT(*) AS count FROM user_nodes GROUP BY node_id"
  );
  const out: Record<number, number> = {};
  for (const row of rows) out[Number(row.node_id)] = Number(row.count);
  return out;
}

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

export async function listPlans(publicOnly = false): Promise<PlanRow[]> {
  const sql = `SELECT * FROM plans ${publicOnly ? "WHERE visible = 1" : ""} ORDER BY sort ASC, price ASC, id ASC`;
  return getDb().all<PlanRow>(sql);
}

export async function getPlan(id: number): Promise<PlanRow | undefined> {
  return getDb().get<PlanRow>("SELECT * FROM plans WHERE id = ?", [id]);
}

export async function createPlan(input: Partial<PlanRow> & { name: string }): Promise<PlanRow> {
  const id = await getDb().insert(
    `INSERT INTO plans (name, price, reseller_price, days, data_gb, device_limit, speed_mbps, protocol, node_ids, icon, description, sort, visible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.price ?? 0,
      input.reseller_price ?? 0,
      input.days ?? 30,
      input.data_gb ?? 0,
      input.device_limit ?? 1,
      input.speed_mbps ?? 0,
      input.protocol ?? null,
      input.node_ids ?? null,
      input.icon ?? null,
      input.description ?? null,
      input.sort ?? 0,
      input.visible ?? 1,
      nowSeconds(),
    ]
  );
  return (await getPlan(id))!;
}

export async function updatePlan(id: number, patch: Record<string, unknown>): Promise<void> {
  const allowed = ["name", "price", "reseller_price", "days", "data_gb", "device_limit", "speed_mbps", "protocol", "node_ids", "icon", "description", "sort", "visible"];
  const keys = Object.keys(patch).filter((key) => allowed.includes(key));
  if (!keys.length) return;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (patch[key] as unknown) ?? null);
  await getDb().run(`UPDATE plans SET ${sets} WHERE id = ?`, [...values, id]);
}

export async function deletePlan(id: number): Promise<void> {
  await getDb().run("DELETE FROM plans WHERE id = ?", [id]);
}

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export interface PaymentInput {
  userId?: number | null;
  adminId?: number | null;
  planId?: number | null;
  telegramId?: string | null;
  amount: number;
  discount?: number;
  method?: string;
  gateway?: string | null;
  refId?: string | null;
  receiptFile?: string | null;
  status?: string;
  note?: string | null;
}

export async function createPayment(input: PaymentInput): Promise<PaymentRow> {
  const id = await getDb().insert(
    `INSERT INTO payments (user_id, admin_id, plan_id, telegram_id, amount, discount, method, gateway, ref_id, receipt_file, status, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId ?? null,
      input.adminId ?? null,
      input.planId ?? null,
      input.telegramId ?? null,
      input.amount,
      input.discount ?? 0,
      input.method ?? "manual",
      input.gateway ?? null,
      input.refId ?? null,
      input.receiptFile ?? null,
      input.status ?? "pending",
      input.note ?? null,
      nowSeconds(),
    ]
  );
  return (await getDb().get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id]))!;
}

export async function getPayment(id: number): Promise<PaymentRow | undefined> {
  return getDb().get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id]);
}

export async function updatePayment(id: number, patch: Record<string, unknown>): Promise<void> {
  const allowed = ["user_id", "admin_id", "plan_id", "telegram_id", "amount", "discount", "method", "gateway", "ref_id", "receipt_file", "status", "note", "reviewed_at", "reviewed_by"];
  const keys = Object.keys(patch).filter((key) => allowed.includes(key));
  if (!keys.length) return;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (patch[key] as unknown) ?? null);
  await getDb().run(`UPDATE payments SET ${sets} WHERE id = ?`, [...values, id]);
}

export interface PaymentFilter {
  status?: string;
  method?: string;
  userId?: number;
  telegramId?: string;
  adminId?: number;
  from?: number;
  to?: number;
  limit?: number;
}

export async function listPayments(filter: PaymentFilter = {}): Promise<PaymentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status && filter.status !== "all") {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.method) {
    where.push("method = ?");
    params.push(filter.method);
  }
  if (filter.userId) {
    where.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.telegramId) {
    where.push("telegram_id = ?");
    params.push(filter.telegramId);
  }
  if (filter.adminId) {
    where.push("admin_id = ?");
    params.push(filter.adminId);
  }
  if (filter.from) {
    where.push("created_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("created_at <= ?");
    params.push(filter.to);
  }
  const sql = `SELECT * FROM payments ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
  return getDb().all<PaymentRow>(sql, [...params, filter.limit ?? 200]);
}

export async function revenueSummary(): Promise<{ today: number; month: number; total: number; pending: number }> {
  const db = getDb();
  const now = nowSeconds();
  const dayStart = now - (now % 86400);
  const monthStart = now - 30 * 86400;
  const approved = "status = 'approved'";
  const rows = await db.all<{ bucket: string; total: number | string }>(
    `SELECT 'today' AS bucket, SUM(amount) AS total FROM payments WHERE ${approved} AND reviewed_at >= ?
     UNION ALL
     SELECT 'month' AS bucket, SUM(amount) AS total FROM payments WHERE ${approved} AND reviewed_at >= ?
     UNION ALL
     SELECT 'total' AS bucket, SUM(amount) AS total FROM payments WHERE ${approved}
     UNION ALL
     SELECT 'pending' AS bucket, SUM(amount) AS total FROM payments WHERE status = 'pending'`,
    [dayStart, monthStart]
  );
  const out = { today: 0, month: 0, total: 0, pending: 0 };
  for (const row of rows) {
    out[row.bucket as keyof typeof out] = Number(row.total ?? 0);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Tickets
 * ------------------------------------------------------------------ */

export async function listTickets(filter: { status?: string; limit?: number; telegramId?: string } = {}): Promise<TicketRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status && filter.status !== "all") {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.telegramId) {
    where.push("telegram_id = ?");
    params.push(filter.telegramId);
  }
  return getDb().all<TicketRow>(
    `SELECT * FROM tickets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`,
    [...params, filter.limit ?? 100]
  );
}

export async function getTicket(id: number): Promise<{ ticket: TicketRow; messages: TicketMessageRow[] } | null> {
  const ticket = await getDb().get<TicketRow>("SELECT * FROM tickets WHERE id = ?", [id]);
  if (!ticket) return null;
  const messages = await getDb().all<TicketMessageRow>("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC", [id]);
  return { ticket, messages };
}

export async function createTicket(input: {
  subject: string;
  body: string;
  userId?: number | null;
  telegramId?: string | null;
  name?: string | null;
  category?: string;
  priority?: string;
}): Promise<TicketRow> {
  const db = getDb();
  const now = nowSeconds();
  const id = await db.insert(
    "INSERT INTO tickets (user_id, telegram_id, name, subject, category, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
    [input.userId ?? null, input.telegramId ?? null, input.name ?? null, input.subject, input.category ?? "other", input.priority ?? "normal", now, now]
  );
  await db.insert("INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'user', ?, ?)", [id, input.body, now]);
  return (await db.get<TicketRow>("SELECT * FROM tickets WHERE id = ?", [id]))!;
}

export async function addTicketMessage(ticketId: number, author: string, body: string, adminId?: number | null): Promise<void> {
  const db = getDb();
  const now = nowSeconds();
  await db.insert("INSERT INTO ticket_messages (ticket_id, author, admin_id, body, created_at) VALUES (?, ?, ?, ?, ?)", [
    ticketId,
    author,
    adminId ?? null,
    body,
    now,
  ]);
  await db.run("UPDATE tickets SET updated_at = ?, status = ? WHERE id = ?", [now, author === "admin" ? "answered" : "open", ticketId]);
}

export async function updateTicket(id: number, patch: Record<string, unknown>): Promise<void> {
  const allowed = ["subject", "category", "status", "priority"];
  const keys = Object.keys(patch).filter((key) => allowed.includes(key));
  if (!keys.length) return;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (patch[key] as unknown) ?? null);
  await getDb().run(`UPDATE tickets SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowSeconds(), id]);
}

export async function deleteTicket(id: number): Promise<void> {
  await getDb().run("DELETE FROM ticket_messages WHERE ticket_id = ?", [id]);
  await getDb().run("DELETE FROM tickets WHERE id = ?", [id]);
}

/* ------------------------------------------------------------------ *
 * API tokens
 * ------------------------------------------------------------------ */

export async function listApiTokens(): Promise<ApiTokenRow[]> {
  return getDb().all<ApiTokenRow>("SELECT * FROM api_tokens ORDER BY id DESC");
}

export async function getApiToken(token: string): Promise<ApiTokenRow | undefined> {
  const row = await getDb().get<ApiTokenRow>("SELECT * FROM api_tokens WHERE token = ? AND active = 1", [token]);
  if (!row) return undefined;
  if (row.expires_at && row.expires_at * 1000 < Date.now()) return undefined;
  await getDb().run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [nowSeconds(), row.id]);
  return row;
}

export async function createApiToken(name: string, scopes: string, createdBy?: number | null, expiresAt?: number | null): Promise<ApiTokenRow> {
  const token = `kf_${randomToken(24)}`;
  const id = await getDb().insert(
    "INSERT INTO api_tokens (name, token, scopes, created_by, created_at, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
    [name, token, scopes, createdBy ?? null, nowSeconds(), expiresAt ?? null]
  );
  return (await getDb().get<ApiTokenRow>("SELECT * FROM api_tokens WHERE id = ?", [id]))!;
}

export async function deleteApiToken(id: number): Promise<void> {
  await getDb().run("DELETE FROM api_tokens WHERE id = ?", [id]);
}

/* ------------------------------------------------------------------ *
 * Aggregates: charts & dashboard
 * ------------------------------------------------------------------ */

export async function trafficSeries(days = 14): Promise<TrafficPoint[]> {
  const db = getDb();
  const from = utcDay(nowSeconds() - days * 86400);
  const rows = await db.all<{ day: string; upload_bytes: number | string; download_bytes: number | string }>(
    "SELECT day, SUM(upload_bytes) AS upload_bytes, SUM(download_bytes) AS download_bytes FROM traffic_log WHERE day >= ? GROUP BY day ORDER BY day ASC",
    [from]
  );
  const map = new Map(rows.map((row) => [row.day, row]));
  const out: TrafficPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = utcDay(nowSeconds() - i * 86400);
    const row = map.get(day);
    out.push({
      day,
      upload_bytes: Number(row?.upload_bytes ?? 0),
      download_bytes: Number(row?.download_bytes ?? 0),
    });
  }
  return out;
}

export async function userTrafficSeries(userId: number, days = 14): Promise<TrafficPoint[]> {
  const db = getDb();
  const from = utcDay(nowSeconds() - days * 86400);
  const rows = await db.all<{ day: string; upload_bytes: number | string; download_bytes: number | string }>(
    "SELECT day, SUM(upload_bytes) AS upload_bytes, SUM(download_bytes) AS download_bytes FROM traffic_log WHERE user_id = ? AND day >= ? GROUP BY day ORDER BY day ASC",
    [userId, from]
  );
  const map = new Map(rows.map((row) => [row.day, row]));
  const out: TrafficPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = utcDay(nowSeconds() - i * 86400);
    const row = map.get(day);
    out.push({ day, upload_bytes: Number(row?.upload_bytes ?? 0), download_bytes: Number(row?.download_bytes ?? 0) });
  }
  return out;
}

async function countWhere(sql: string, params: unknown[] = []): Promise<number> {
  const row = await getDb().get<{ count: number | string }>(sql, params);
  return Number(row?.count ?? 0);
}

export async function dashboardStats(): Promise<DashboardStats> {
  const db = getDb();
  const now = nowSeconds();
  const onlineWindow = now - 300;
  const dayStart = now - (now % 86400);

  const [total, active, disabled, limited, expired, online, newToday, usedAgg, todayAgg, nodesTotal, nodesOnline] = await Promise.all([
    countWhere("SELECT COUNT(*) AS count FROM users"),
    countWhere("SELECT COUNT(*) AS count FROM users WHERE status = 'active'"),
    countWhere("SELECT COUNT(*) AS count FROM users WHERE status = 'disabled'"),
    countWhere("SELECT COUNT(*) AS count FROM users WHERE status = 'limited'"),
    countWhere("SELECT COUNT(*) AS count FROM users WHERE status = 'expired'"),
    countWhere("SELECT COUNT(*) AS count FROM users WHERE last_online_at >= ?", [onlineWindow]),
    countWhere("SELECT COUNT(*) AS count FROM users WHERE created_at >= ?", [dayStart]),
    db.get<{ up: number | string | null; down: number | string | null }>("SELECT SUM(upload_bytes) AS up, SUM(download_bytes) AS down FROM users"),
    db.get<{ total: number | string | null }>("SELECT SUM(upload_bytes + download_bytes) AS total FROM traffic_log WHERE day = ?", [utcDay()]),
    countWhere("SELECT COUNT(*) AS count FROM nodes"),
    countWhere("SELECT COUNT(*) AS count FROM nodes WHERE status = 'online'"),
  ]);

  const revenue = await revenueSummary();
  const admins = await countWhere("SELECT COUNT(*) AS count FROM admins");
  const resellers = await countWhere("SELECT COUNT(*) AS count FROM admins WHERE role = 'reseller'");
  const openTickets = await countWhere("SELECT COUNT(*) AS count FROM tickets WHERE status = 'open'");
  const series = await trafficSeries(14);

  return {
    users: { total, active, disabled, limited, expired, online, newToday },
    traffic: {
      used: Number(usedAgg?.up ?? 0) + Number(usedAgg?.down ?? 0),
      upload: Number(usedAgg?.up ?? 0),
      download: Number(usedAgg?.down ?? 0),
      today: Number(todayAgg?.total ?? 0),
    },
    nodes: { total: nodesTotal, online: nodesOnline, offline: Math.max(0, nodesTotal - nodesOnline) },
    revenue,
    admins: { total: admins },
    resellers: { total: resellers },
    tickets: { open: openTickets },
    series,
  };
}

/** Users whose service must be disabled/restored by the scheduler. */
export async function sweepExpired(): Promise<UserRow[]> {
  const db = getDb();
  const now = nowSeconds();
  const users = await db.all<UserRow>(
    "SELECT * FROM users WHERE status IN ('active','limited','expired') AND ((expires_at IS NOT NULL AND expires_at <= ?) OR (data_limit_bytes > 0 AND data_used_bytes >= data_limit_bytes) OR (status = 'expired' AND (expires_at IS NULL OR expires_at > ?)) OR (status = 'limited' AND (data_limit_bytes = 0 OR data_used_bytes < data_limit_bytes)))",
    [now, now]
  );
  const changed: UserRow[] = [];
  for (const user of users) {
    const result = await refreshUserStatus(user.id);
    if (result?.changed) changed.push(result.user);
  }
  return changed;
}

/** Automatic monthly/quota resets (used by the cron loop). */
export async function applyTrafficReset(): Promise<number> {
  const db = getDb();
  const now = nowSeconds();
  const candidates = await db.all<UserRow>(
    "SELECT * FROM users WHERE reset_strategy IN ('daily','weekly','monthly') AND status IN ('limited','active','expired')"
  );
  let count = 0;
  for (const user of candidates) {
    const last = user.last_reset_at ?? user.created_at;
    const period = { daily: 86400, weekly: 7 * 86400, monthly: 30 * 86400 }[user.reset_strategy as "daily" | "weekly" | "monthly"];
    if (!period) continue;
    if (now - last < period) continue;
    await resetUserTraffic(user.id);
    await db.run("UPDATE users SET last_reset_at = ? WHERE id = ?", [now, user.id]);
    count += 1;
  }
  return count;
}

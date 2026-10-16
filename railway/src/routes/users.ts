// User / account management API.

import { Hono } from "hono";
import { audit, getDb, getSetting } from "../db/index.js";
import { nowSeconds } from "../lib/format.js";
import { randomUuid, randomToken } from "../lib/crypto.js";
import { gbToBytes, validate } from "../lib/validate.js";
import { parseTags, serializeTags } from "../lib/tags.js";
import {
  applyUsage,
  countUsers,
  createUser,
  dashboardStats,
  deleteUser,
  extendUser,
  getAdmin,
  getPlan,
  getUser,
  getUserNodes,
  listUsers,
  recomputeAdminUsage,
  QUOTA_HOLD_REASON,
  refreshUserStatus,
  resetUserTraffic,
  setUserNodes,
  updateUser,
  userTrafficSeries,
} from "../services/store.js";
import { removeUserFromNode, syncUser } from "../services/nodes.js";
import { buildClashConfig, buildLinks, buildSingboxConfig, buildWireguardConf, buildXrayConfig, subscriptionPayload } from "../services/links.js";
import {
  buildWireguardConfFor,
  ensureWireguardClient,
  wireguardKeysForUser,
  wireguardPeerFor,
} from "../services/wireguard.js";
import { clientIp, observeBase, ok, readJson, requireAdmin, requireApiAuth, requestBase, safe, type AppVariables } from "../middleware.js";
import type { NodeRow, UserRow } from "../types.js";

export const userRoutes = new Hono<{ Variables: AppVariables }>();

userRoutes.use("*", async (c, next) => {
  await observeBase(c);
  await next();
});
userRoutes.use("*", requireApiAuth);

/* --------------------------------- list -------------------------------- */

userRoutes.get(
  "/",
  safe(async (c) => {
    const query = c.req.query();
    const admin = c.get("admin");
    const scopedAdminId = admin.role === "owner" ? undefined : admin.id;
    const result = await listUsers({
      page: Number(query.page ?? 1),
      perPage: Number(query.per_page ?? query.perPage ?? 20),
      search: query.search ?? "",
      status: query.status ?? "all",
      adminId: query.admin_id ? Number(query.admin_id) : scopedAdminId,
      planId: query.plan_id ? Number(query.plan_id) : undefined,
      sort: (query.sort as "newest" | "oldest" | "usage" | "expiry" | "name") ?? "newest",
      tag: query.tag ?? null,
    });
    const online = await getDb().get<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM users WHERE last_online_at >= ?",
      [nowSeconds() - 300]
    );
    return ok(c, {
      users: result.items.map((user) => {
        const serialized = serializeUser(user);
        if (query.with_tokens === "1") {
          serialized.sub_token = user.sub_token;
        }
        return serialized;
      }),
      total: result.total,
      page: result.page,
      per_page: result.perPage,
      pages: Math.max(1, Math.ceil(result.total / result.perPage)),
      summary: {
        online: Number(online?.count ?? 0),
        active: await countWhere("status = 'active'"),
        disabled: await countWhere("status = 'disabled'"),
        limited: await countWhere("status = 'limited'"),
        expired: await countWhere("status = 'expired'"),
      },
    });
  })
);

userRoutes.get(
  "/export",
  safe(async (c) => {
    const all: UserRow[] = [];
    let page = 1;
    for (;;) {
      const batch = await listUsers({ page, perPage: 200 });
      all.push(...batch.items);
      if (all.length >= batch.total || !batch.items.length) break;
      page += 1;
    }
    const format = c.req.query("format") ?? "json";
    if (format === "csv") {
      const header = "username,uuid,data_limit_bytes,data_used_bytes,expires_at,status,device_limit,telegram_id,created_at";
      const lines = all.map((user) =>
        [
          user.username,
          user.uuid,
          user.data_limit_bytes,
          user.data_used_bytes,
          user.expires_at ?? "",
          user.status,
          user.device_limit,
          user.telegram_id ?? "",
          user.created_at,
        ].join(",")
      );
      return c.body([header, ...lines].join("\n"), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="kalfetela-users.csv"`,
      });
    }
    return c.json({ ok: true, data: { users: all.map((user) => serializeUser(user)) } });
  })
);

userRoutes.post(
  "/import",
  safe(async (c) => {
    const body = await readJson(c);
    const users = Array.isArray(body.users) ? (body.users as Record<string, unknown>[]) : [];
    let created = 0;
    let skipped = 0;
    for (const item of users) {
      const username = String(item.username ?? "").trim();
      if (!username) {
        skipped += 1;
        continue;
      }
      const existing = await getDb().get<{ id: number }>("SELECT id FROM users WHERE username = ?", [username]);
      if (existing) {
        skipped += 1;
        continue;
      }
      await createUser({
        username,
        uuid: typeof item.uuid === "string" ? item.uuid : randomUuid(),
        dataLimitBytes: Number(item.data_limit_bytes ?? 0),
        expiresAt: item.expires_at ? Number(item.expires_at) : null,
        deviceLimit: Number(item.device_limit ?? 0),
        telegramId: item.telegram_id ? String(item.telegram_id) : null,
        adminId: c.get("admin").id,
        subToken: typeof item.sub_token === "string" ? item.sub_token : undefined,
        note: item.note ? String(item.note) : null,
      });
      created += 1;
    }
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "users_import", meta: { created, skipped }, ip: clientIp(c) });
    return ok(c, { created, skipped });
  })
);

/* ------------------------- bulk provisioning --------------------------- */

/**
 * Creates many accounts in one request (tens or hundreds), optionally spreading
 * them round-robin over the selected nodes/panels — the fastest way to fill a
 * fleet of Railway deployments.
 */
userRoutes.post(
  "/bulk-create",
  safe(async (c) => {
    const body = await readJson(c);
    const admin = c.get("admin");
    const count = Math.min(500, Math.max(1, Number(body.count ?? 10)));
    const startIndex = Math.max(0, Number(body.start ?? 1));
    const prefix = String(body.prefix ?? "user").trim().replace(/[^\w.-]/g, "") || "user";
    const padding = Math.min(6, Math.max(0, Number(body.padding ?? 0)));
    const randomSuffix = body.random_suffix === true;
    const dataGb = Number(body.data_gb ?? 0);
    const days = Number(body.days ?? 30);
    const deviceLimit = Number(body.device_limit ?? 0);
    const speedMbps = Number(body.speed_mbps ?? 0);
    const note = body.note ? String(body.note).slice(0, 255) : null;
    const tags = serializeTags(body.tags);
    const plan = body.plan_id ? await getPlan(Number(body.plan_id)) : undefined;
    const distribution = String(body.distribution ?? "all") === "round_robin" ? "round_robin" : "all";

    let nodeIds = (Array.isArray(body.node_ids) ? body.node_ids : []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (plan?.node_ids) {
      try {
        const parsed = JSON.parse(plan.node_ids) as number[];
        if (Array.isArray(parsed) && parsed.length) nodeIds = parsed.map(Number);
      } catch {
        /* keep the explicit list */
      }
    }
    if (!nodeIds.length) {
      const nodes = await getDb().all<{ id: number }>("SELECT id FROM nodes WHERE active = 1 ORDER BY sort ASC");
      nodeIds = nodes.map((node) => node.id);
    }

    let ownerId = admin.id;
    if (admin.role === "owner" && body.admin_id) {
      const target = await getAdmin(Number(body.admin_id));
      if (!target) return c.json({ error: "نماینده پیدا نشد", code: "not_found" }, 404);
      ownerId = target.id;
    }
    if (admin.role !== "owner" && admin.max_users > 0) {
      const current = await countUsers(admin.id);
      if (current + count > admin.max_users) {
        return c.json({ error: `با این تعداد از سقف کاربران شما (${admin.max_users}) عبور می‌کند`, code: "limit" }, 403);
      }
    }

    // pick the first free index so repeated calls never collide
    const taken = new Set(
      (await getDb().all<{ username: string }>("SELECT username FROM users WHERE username LIKE ?", [`${prefix}%`])).map((row) => row.username)
    );
    const created: Array<Record<string, unknown>> = [];
    const skipped: string[] = [];
    let index = startIndex;
    while (created.length < count) {
      const number = padding > 0 ? String(index).padStart(padding, "0") : String(index);
      const suffix = randomSuffix ? `_${randomToken(3).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4)}` : "";
      const username = `${prefix}${number}${suffix}`;
      index += 1;
      if (taken.has(username)) {
        skipped.push(username);
        if (skipped.length > count * 3) break;
        continue;
      }
      taken.add(username);
      const assigned = distribution === "round_robin" && nodeIds.length ? [nodeIds[created.length % nodeIds.length]!] : nodeIds;
      try {
        const user = await createUser({
          username,
          dataLimitBytes: plan?.data_gb ? gbToBytes(plan.data_gb) : dataGb ? gbToBytes(dataGb) : 0,
          days: plan?.days || days,
          deviceLimit: plan?.device_limit ?? deviceLimit,
          speedLimitMbps: plan?.speed_mbps ?? speedMbps,
          planId: plan?.id ?? null,
          adminId: ownerId,
          nodeIds: assigned,
          note,
          tags,
        });
        created.push({
          id: user.id,
          username: user.username,
          uuid: user.uuid,
          sub_token: user.sub_token,
          node_ids: assigned,
          expires_at: user.expires_at,
        });
      } catch (error) {
        skipped.push(`${username} (${(error as Error).message})`);
      }
    }

    await audit({
      adminId: admin.id,
      actor: admin.username,
      action: "users_bulk_create",
      meta: { prefix, count: created.length, skipped: skipped.length, node_ids: nodeIds, distribution },
      ip: clientIp(c),
    });
    const origin = requestBase(c);
    return ok(
      c,
      {
        created,
        skipped,
        count: created.length,
        nodes: nodeIds,
        subscription_base: `${origin}/sub/`,
      },
      201
    );
  })
);

/* -------------------------------- create ------------------------------- */

userRoutes.post(
  "/",
  safe(async (c) => {
    const body = await readJson(c);
    const input = validate<{
      username: string;
      data_gb: number;
      days: number;
      device_limit: number;
      speed_mbps: number;
      telegram_id?: string;
      email?: string;
      note?: string;
      plan_id?: number;
      node_ids?: number[];
      ip_limit?: number;
      admin_id?: number;
      uuid?: string;
      password?: string;
      tags?: string[] | string;
    }>(body, (v) => {
      v.username();
      v.number("data_gb", { def: 0, min: 0, max: 100_000, label: "حجم" });
      v.int("days", { def: 30, min: 0, max: 3650, label: "مدت اعتبار" });
      v.int("device_limit", { def: 0, min: 0, max: 1000, label: "تعداد دستگاه" });
      v.int("speed_mbps", { def: 0, min: 0, max: 10_000, label: "محدودیت سرعت" });
      v.int("plan_id", { min: 0, label: "پلن" });
      v.string("telegram_id", { max: 32 });
      v.string("email", { max: 128 });
      v.string("note", { max: 255 });
      v.array("node_ids", { label: "نودها" });
      v.array("tags", { label: "برچسب‌ها" });
      v.int("admin_id", { min: 0, label: "نماینده" });
      v.string("uuid", { max: 64 });
      v.string("password", { max: 64 });
    });

    const existing = await getDb().get<{ id: number }>("SELECT id FROM users WHERE username = ?", [input.username]);
    if (existing) return c.json({ error: "این نام کاربری قبلاً استفاده شده است", code: "conflict" }, 409);

    const admin = c.get("admin");
    // the owner may create the account on behalf of any reseller
    let ownerId = admin.id;
    if (admin.role === "owner" && input.admin_id) {
      const target = await getAdmin(Number(input.admin_id));
      if (!target) return c.json({ error: "نماینده پیدا نشد", code: "not_found" }, 404);
      ownerId = target.id;
    }
    if (admin.role !== "owner" && admin.max_users > 0) {
      const count = await getDb().get<{ count: number | string }>("SELECT COUNT(*) AS count FROM users WHERE admin_id = ?", [admin.id]);
      if (Number(count?.count ?? 0) >= admin.max_users) {
        return c.json({ error: "به سقف تعداد کاربران مجاز خود رسیده‌اید", code: "limit" }, 403);
      }
    }
    // Quota is checked against the *target* admin, so a reseller cannot fill up
    // another (already exhausted) reseller either. The owner may override, and
    // in that case the new account starts on hold until the quota is topped up.
    const targetAdmin = ownerId === admin.id ? admin : await getAdmin(ownerId);
    let quotaWarning: string | null = null;
    if (targetAdmin && targetAdmin.role !== "owner" && targetAdmin.quota_bytes > 0 && (await recomputeAdminUsage(targetAdmin.id)) >= targetAdmin.quota_bytes) {
      if (admin.role !== "owner") {
        return c.json({ error: "سقف حجم نمایندگی تکمیل شده است؛ برای ساخت کاربر جدید سقف را شارژ کنید", code: "quota" }, 403);
      }
      quotaWarning = `سقف حجم نماینده «${targetAdmin.username}» تکمیل است؛ کاربر ساخته شد ولی تا شارژ سقف روی حالت انتظار می‌ماند.`;
    }

    let plan = input.plan_id ? await getPlan(input.plan_id) : undefined;
    let nodeIds = (input.node_ids ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (plan?.node_ids) {
      try {
        const parsed = JSON.parse(plan.node_ids) as number[];
        if (Array.isArray(parsed) && parsed.length) nodeIds = parsed.map(Number);
      } catch {
        /* ignore malformed plan nodes */
      }
    }
    if (!nodeIds.length) {
      const nodes = await getDb().all<{ id: number }>("SELECT id FROM nodes WHERE active = 1 ORDER BY sort ASC");
      nodeIds = nodes.map((node) => node.id).slice(0, 1);
    }

    const user = await createUser({
      username: input.username,
      uuid: input.uuid && /^[0-9a-f-]{36}$/i.test(String(input.uuid)) ? String(input.uuid) : undefined,
      password: input.password ? String(input.password) : undefined,
      tags: input.tags,
      dataLimitBytes: input.data_gb ? gbToBytes(input.data_gb) : 0,
      days: input.days,
      deviceLimit: input.device_limit,
      speedLimitMbps: input.speed_mbps,
      telegramId: input.telegram_id ?? null,
      email: input.email ?? null,
      note: input.note ?? null,
      planId: plan?.id ?? null,
      adminId: ownerId,
      nodeIds,
    });

    const sync = await syncUser(user.id);
    await audit({
      adminId: admin.id,
      actor: admin.username,
      action: "user_create",
      target: user.username,
      meta: { sync: sync.synced, failed: sync.errors },
      ip: clientIp(c),
    });
    if (quotaWarning) {
      await updateUser(user.id, { status: "on_hold", on_hold: 1, hold_reason: QUOTA_HOLD_REASON });
      await refreshUserStatus(user.id);
    }
    const fresh = quotaWarning ? (await getUser(user.id))! : user;
    return ok(
      c,
      {
        user: serializeUser(fresh),
        subscription: await subscriptionUrls(fresh, requestBase(c)),
        sync,
        warning: quotaWarning,
      },
      201
    );
  })
);

/* --------------------------- detail / update --------------------------- */

userRoutes.get(
  "/:id",
  safe(async (c) => {
    const user = await getUser(Number(c.req.param("id")));
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const links = await userLinkPayload(user);
    const nodes = await getUserNodes(user.id);
    const series = await userTrafficSeries(user.id, Number(c.req.query("days") ?? 14));
    const payments = await getDb().all("SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 20", [user.id]);
    return ok(c, {
      user: serializeUser(user, { withSecrets: true }),
      nodes: nodes.map((entry) => ({
        node_id: entry.node_id,
        name: entry.node?.name ?? "?",
        protocol: entry.node?.protocol ?? "?",
        enabled: Boolean(entry.enabled),
      })),
      links: links.entries,
      subscriptions: await subscriptionUrls(user, requestBase(c)),
      series,
      payments,
    });
  })
);

userRoutes.put(
  "/:id",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const patch: Record<string, unknown> = {};
    if (body.data_gb !== undefined) patch.data_limit_bytes = gbToBytes(Number(body.data_gb));
    if (body.device_limit !== undefined) patch.device_limit = Number(body.device_limit);
    if (body.speed_mbps !== undefined) patch.speed_limit_mbps = Number(body.speed_mbps);
    if (body.telegram_id !== undefined) patch.telegram_id = body.telegram_id ? String(body.telegram_id) : null;
    if (body.email !== undefined) patch.email = body.email ? String(body.email) : null;
    if (body.note !== undefined) patch.note = body.note ? String(body.note) : null;
    if (body.status !== undefined && ["active", "disabled", "on_hold"].includes(String(body.status))) {
      patch.status = String(body.status);
      patch.on_hold = body.status === "on_hold" ? 1 : 0;
    }
    if (body.expires_at !== undefined) patch.expires_at = body.expires_at ? Number(body.expires_at) : null;
    if (body.reset_strategy !== undefined) patch.reset_strategy = String(body.reset_strategy);
    if (body.username && String(body.username) !== user.username) patch.username = String(body.username);
    if (body.request_limit !== undefined) patch.request_limit = Number(body.request_limit);
    if (body.tags !== undefined) patch.tags = serializeTags(body.tags);
    if (body.status === "active") patch.hold_reason = null;
    await updateUser(id, patch as Partial<UserRow>);
    if (body.reset_usage === true) await resetUserTraffic(id);
    await refreshUserStatus(id);
    const updated = (await getUser(id))!;
    const sync = await syncUser(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "user_update", target: updated.username, meta: patch, ip: clientIp(c) });
    return ok(c, { user: serializeUser(updated, { withSecrets: true }), sync });
  })
);

userRoutes.delete(
  "/:id",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const nodes = await getUserNodes(id);
    for (const entry of nodes) if (entry.node) await removeUserFromNode(user, entry.node);
    await deleteUser(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "user_delete", target: user.username, ip: clientIp(c) });
    return ok(c, { message: "کاربر حذف شد" });
  })
);

/* ------------------------------- actions ------------------------------- */

userRoutes.post(
  "/:id/reset",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    await resetUserTraffic(id);
    const sync = await syncUser(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "user_reset", target: user.username, ip: clientIp(c) });
    return ok(c, { message: "مصرف صفر شد", sync });
  })
);

userRoutes.post(
  "/:id/extend",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readJson(c);
    const days = Number(body.days ?? 30);
    const addDataGb = Number(body.data_gb ?? 0);
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    await extendUser(id, days, { fromToday: body.from_today !== false });
    if (addDataGb > 0) {
      await updateUser(id, { data_limit_bytes: user.data_limit_bytes + gbToBytes(addDataGb) });
    }
    await refreshUserStatus(id);
    await syncUser(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "user_extend", target: user.username, meta: { days, addDataGb }, ip: clientIp(c) });
    return ok(c, { message: "کاربر تمدید شد" });
  })
);

userRoutes.post(
  "/:id/status",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readJson(c);
    const status = String(body.status ?? "active");
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    if (!["active", "disabled", "on_hold"].includes(status)) {
      return c.json({ error: "وضعیت نامعتبر است", code: "validation" }, 400);
    }
    await updateUser(id, { status, on_hold: status === "on_hold" ? 1 : 0 });
    await refreshUserStatus(id);
    const sync = await syncUser(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "user_status", target: user.username, meta: { status }, ip: clientIp(c) });
    return ok(c, { message: "وضعیت تغییر کرد", sync });
  })
);

userRoutes.post(
  "/:id/nodes",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readJson(c);
    const nodeIds = (Array.isArray(body.node_ids) ? body.node_ids : []).map(Number).filter((value) => Number.isFinite(value));
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const previous = await getUserNodes(id);
    const removed = previous.filter((entry) => !nodeIds.includes(entry.node_id));
    await setUserNodes(id, nodeIds);
    for (const entry of removed) if (entry.node) await removeUserFromNode(user, entry.node);
    const sync = await syncUser(id);
    return ok(c, { message: "نودهای کاربر به‌روزرسانی شد", sync });
  })
);

userRoutes.post(
  "/:id/sync",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const sync = await syncUser(id);
    return ok(c, sync);
  })
);

userRoutes.post(
  "/:id/usage",
  safe(async (c) => {
    // manual usage bookkeeping (for link-only nodes / importing history)
    const id = Number(c.req.param("id"));
    const body = await readJson(c);
    const user = await getUser(id);
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const upload = Number(body.upload_bytes ?? 0);
    const download = Number(body.download_bytes ?? 0);
    const result = await applyUsage(id, upload, download, { adminId: user.admin_id });
    return ok(c, { user: serializeUser(result.user ?? user), status_changed: result.statusChanged });
  })
);

/* --------------------------------- bulk -------------------------------- */

userRoutes.post(
  "/bulk",
  safe(async (c) => {
    const body = await readJson(c);
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((value) => Number.isFinite(value));
    const action = String(body.action ?? "");
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    let affected = 0;
    for (const id of ids) {
      const user = await getUser(id);
      if (!user) continue;
      switch (action) {
        case "delete": {
          const nodes = await getUserNodes(id);
          for (const entry of nodes) if (entry.node) await removeUserFromNode(user, entry.node);
          await deleteUser(id);
          affected += 1;
          break;
        }
        case "enable":
        case "disable":
        case "on_hold": {
          const status = action === "enable" ? "active" : action === "on_hold" ? "on_hold" : "disabled";
          await updateUser(id, { status, on_hold: status === "on_hold" ? 1 : 0 });
          await refreshUserStatus(id);
          await syncUser(id);
          affected += 1;
          break;
        }
        case "reset": {
          await resetUserTraffic(id);
          await syncUser(id);
          affected += 1;
          break;
        }
        case "extend": {
          await extendUser(id, Number(payload.days ?? 30));
          await syncUser(id);
          affected += 1;
          break;
        }
        case "add_data": {
          await updateUser(id, { data_limit_bytes: user.data_limit_bytes + gbToBytes(Number(payload.data_gb ?? 0)) });
          await refreshUserStatus(id);
          affected += 1;
          break;
        }
        case "set_nodes": {
          const nodeIds = (Array.isArray(payload.node_ids) ? payload.node_ids : []).map(Number);
          await setUserNodes(id, nodeIds);
          await syncUser(id);
          affected += 1;
          break;
        }
        case "set_plan": {
          const planId = Number(payload.plan_id ?? 0);
          const plan = planId ? await getPlan(planId) : undefined;
          if (plan) {
            await updateUser(id, {
              plan_id: plan.id,
              data_limit_bytes: plan.data_gb > 0 ? gbToBytes(plan.data_gb) : 0,
              device_limit: plan.device_limit,
              speed_limit_mbps: plan.speed_mbps,
              expires_at: nowSeconds() + plan.days * 86400,
              status: "active",
            });
            if (plan.node_ids) {
              try {
                const parsed = JSON.parse(plan.node_ids) as number[];
                if (Array.isArray(parsed) && parsed.length) await setUserNodes(id, parsed.map(Number));
              } catch {
                /* ignore */
              }
            }
            await refreshUserStatus(id);
            await syncUser(id);
            affected += 1;
          }
          break;
        }
        default:
          break;
      }
    }
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: `bulk_${action}`, meta: { ids, payload }, ip: clientIp(c) });
    return ok(c, { affected });
  })
);

/* --------------------------------- links ------------------------------- */

userRoutes.get(
  "/:id/links",
  safe(async (c) => {
    const user = await getUser(Number(c.req.param("id")));
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const format = c.req.query("format") ?? "raw";
    const payload = await userLinkPayload(user);
    switch (format) {
      case "clash":
        return c.body(payload.clash, 200, { "content-type": "text/yaml; charset=utf-8" });
      case "singbox":
        return c.body(payload.singbox, 200, { "content-type": "application/json; charset=utf-8" });
      case "xray":
        return c.body(payload.xray, 200, { "content-type": "application/json; charset=utf-8" });
      case "base64":
        return c.body(subscriptionPayload(payload.entries), 200, { "content-type": "text/plain; charset=utf-8" });
      default:
        return ok(c, { links: payload.entries, subscriptions: await subscriptionUrls(user, requestBase(c)) });
    }
  })
);

userRoutes.get(
  "/:id/wireguard",
  safe(async (c) => {
    const user = await getUser(Number(c.req.param("id")));
    if (!user) return c.json({ error: "کاربر پیدا نشد", code: "not_found" }, 404);
    const attach = c.req.query("create") !== "false";
    const rows = await getUserNodes(user.id);
    const nodes = rows
      .map((entry) => entry.node)
      .filter((node): node is NodeRow => Boolean(node) && node!.protocol === "wireguard" && node!.active === 1);
    const configs: Array<Record<string, unknown>> = [];
    for (const node of nodes) {
      const peer = attach ? await ensureWireguardClient(user, node) : await wireguardPeerFor(user, node);
      if (!peer) continue;
      const conf = await buildWireguardConfFor(user, node);
      configs.push({
        node_id: node.id,
        node_name: node.name,
        address: peer.address,
        public_key: peer.public_key,
        server_public_key: node.public_key,
        endpoint: `${node.host}:${node.port}`,
        dns: node.dns || null,
        mtu: node.mtu ?? null,
        config: conf,
        download_name: `kalfetela-${user.username}-${node.id}.conf`,
      });
    }
    return ok(c, { configs });
  })
);

/* ------------------------------- helpers ------------------------------- */

async function countWhere(clause: string): Promise<number> {
  const row = await getDb().get<{ count: number | string }>(`SELECT COUNT(*) AS count FROM users WHERE ${clause}`);
  return Number(row?.count ?? 0);
}

export function serializeUser(user: UserRow, options: { withSecrets?: boolean } = {}) {
  const percent = user.data_limit_bytes > 0 ? Math.min(100, Math.round((user.data_used_bytes / user.data_limit_bytes) * 100)) : 0;
  return {
    id: user.id,
    username: user.username,
    uuid: user.uuid,
    password: options.withSecrets ? user.password : undefined,
    email: user.email,
    telegram_id: user.telegram_id,
    admin_id: user.admin_id,
    plan_id: user.plan_id,
    status: user.status,
    data_limit_bytes: user.data_limit_bytes,
    data_used_bytes: user.data_used_bytes,
    upload_bytes: user.upload_bytes,
    download_bytes: user.download_bytes,
    remaining_bytes: user.data_limit_bytes > 0 ? Math.max(0, user.data_limit_bytes - user.data_used_bytes) : null,
    percent,
    expires_at: user.expires_at,
    created_at: user.created_at,
    last_online_at: user.last_online_at,
    device_limit: user.device_limit,
    speed_limit_mbps: user.speed_limit_mbps,
    note: user.note,
    sub_token: options.withSecrets ? user.sub_token : undefined,
    online_ips: user.online_ips ? JSON.parse(user.online_ips) : [],
    reset_strategy: user.reset_strategy,
    on_hold: Boolean(user.on_hold),
    hold_reason: user.hold_reason ?? null,
    tags: parseTags(user.tags),
  };
}

export async function userLinkPayload(user: UserRow, extraNodes?: NodeRow[]) {
  const links = await getUserNodes(user.id);
  let nodes: NodeRow[] = links.map((entry) => entry.node).filter((node): node is NodeRow => Boolean(node));
  if (!nodes.length && extraNodes) nodes = extraNodes;
  const fallbackNodes = nodes.length ? nodes : await getDb().all<NodeRow>("SELECT * FROM nodes WHERE active = 1 ORDER BY sort ASC LIMIT 1");
  const options = {
    title: await getSetting("panel_name", "KalFetela"),
    blockAds: (await getSetting("xray_block_ads", "true")) === "true",
    routeIran: (await getSetting("xray_route_iran", "true")) === "true",
    fragment: await getSetting("xray_fragment", "100-200,1-3,tlshello"),
    wireguardKeys: await wireguardKeysForUser(user.id),
  };
  const entries = buildLinks(user, fallbackNodes, options);
  return {
    entries,
    nodes: fallbackNodes,
    clash: buildClashConfig(user, fallbackNodes, options),
    singbox: buildSingboxConfig(user, fallbackNodes, options),
    xray: buildXrayConfig(user, fallbackNodes, options),
    wireguard: fallbackNodes
      .filter((node) => node.protocol === "wireguard")
      .map((node) => ({
        node_id: node.id,
        node_name: node.name,
        config: buildWireguardConf(node, user, options.wireguardKeys[node.id]),
      })),
  };
}

export async function subscriptionUrls(user: UserRow, requestOrigin?: string) {
  const { PUBLIC_URL } = await import("../env.js");
  const { cachedBaseUrl, requestBase } = await import("../middleware.js");
  const stored = await getSetting("runtime_base", "");
  const base =
    requestOrigin ||
    (PUBLIC_URL ? `https://${PUBLIC_URL}` : "") ||
    cachedBaseUrl() ||
    stored;
  void requestBase;
  const tokenPath = `/sub/${user.sub_token}`;
  return {
    token: user.sub_token,
    base64: `${base}${tokenPath}`,
    raw: `${base}${tokenPath}?format=raw`,
    clash: `${base}${tokenPath}?format=clash`,
    singbox: `${base}${tokenPath}?format=singbox`,
    xray: `${base}${tokenPath}?format=xray`,
    page: `${base}${tokenPath}?format=page`,
    qr: `${base}${tokenPath}?format=page`,
  };
}

export { dashboardStats, randomUuid, randomToken };

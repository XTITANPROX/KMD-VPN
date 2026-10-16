// Sub-admin / reseller management (permissions, quota, wallet, impersonation).

import { Hono } from "hono";
import { audit, getDb } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { nowSeconds } from "../lib/format.js";
import { validate } from "../lib/validate.js";
import { clientIp, ok, readJson, requireAdmin, requireOwner, safe, type AppVariables } from "../middleware.js";
import { setSessionCookie } from "./auth.js";
import {
  createAdmin,
  deleteAdmin,
  getAdmin,
  getAdminByUsername,
  listAdmins,
  recomputeAdminUsage,
  updateAdmin,
} from "../services/store.js";
import { createSession } from "../services/auth.js";
import { createPayment, updatePayment } from "../services/store.js";

export const adminRoutes = new Hono<{ Variables: AppVariables }>();

adminRoutes.use("*", requireAdmin);

adminRoutes.get(
  "/",
  safe(async (c) => {
    const admins = await listAdmins();
    const rows = await getDb().all<{ admin_id: number; count: number | string; used: number | string | null }>(
      "SELECT admin_id, COUNT(*) AS count, SUM(data_used_bytes) AS used FROM users GROUP BY admin_id"
    );
    const map = new Map(rows.map((row) => [Number(row.admin_id), row]));
    const current = c.get("admin");
    return ok(c, {
      admins: admins
        .filter((admin) => current.role === "owner" || admin.id === current.id)
        .map((admin) => {
          const stats = map.get(admin.id);
          return {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            status: admin.status,
            credit: admin.credit,
            quota_bytes: admin.quota_bytes,
            used_bytes: Number(stats?.used ?? admin.used_bytes ?? 0),
            max_users: admin.max_users,
            user_count: Number(stats?.count ?? 0),
            telegram_id: admin.telegram_id,
            first_name: admin.first_name,
            last_name: admin.last_name,
            note: admin.note,
            can_manage_nodes: Boolean(admin.can_manage_nodes),
            can_manage_admins: Boolean(admin.can_manage_admins),
            can_use_bot: Boolean(admin.can_use_bot),
            created_at: admin.created_at,
            last_login_at: admin.last_login_at,
            limit_reached: admin.quota_bytes > 0 && Number(stats?.used ?? 0) >= admin.quota_bytes,
          };
        }),
    });
  })
);

adminRoutes.post(
  "/",
  requireOwner,
  safe(async (c) => {
    const body = await readJson(c);
    const input = validate<{ username: string; password: string }>(body, (v) => {
      v.username();
      v.password();
    });
    const existing = await getAdminByUsername(input.username);
    if (existing) return c.json({ error: "این نام کاربری قبلاً ثبت شده است", code: "conflict" }, 409);
    const admin = await createAdmin({
      username: input.username,
      password: input.password,
      role: String(body.role ?? "reseller"),
      credit: Number(body.credit ?? 0),
      quotaBytes: Number(body.quota_bytes ?? 0),
      maxUsers: Number(body.max_users ?? 0),
      canManageNodes: body.can_manage_nodes !== false,
      canManageAdmins: Boolean(body.can_manage_admins),
      canUseBot: body.can_use_bot !== false,
      telegramId: body.telegram_id ? String(body.telegram_id) : null,
      firstName: body.first_name ? String(body.first_name) : null,
      lastName: body.last_name ? String(body.last_name) : null,
      note: body.note ? String(body.note) : null,
    });
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "admin_create", target: admin.username, ip: clientIp(c) });
    return ok(c, { admin: { id: admin.id, username: admin.username, role: admin.role } }, 201);
  })
);

adminRoutes.put(
  "/:id",
  requireOwner,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const admin = await getAdmin(id);
    if (!admin) return c.json({ error: "ادمین پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const patch: Record<string, unknown> = {};
    for (const key of ["role", "status", "note", "first_name", "last_name"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.telegram_id !== undefined) patch.telegram_id = body.telegram_id ? String(body.telegram_id) : null;
    if (body.credit !== undefined) patch.credit = Number(body.credit);
    if (body.quota_bytes !== undefined) patch.quota_bytes = Number(body.quota_bytes);
    if (body.max_users !== undefined) patch.max_users = Number(body.max_users);
    if (body.can_manage_nodes !== undefined) patch.can_manage_nodes = body.can_manage_nodes ? 1 : 0;
    if (body.can_manage_admins !== undefined) patch.can_manage_admins = body.can_manage_admins ? 1 : 0;
    if (body.can_use_bot !== undefined) patch.can_use_bot = body.can_use_bot ? 1 : 0;
    if (body.password) await updateAdmin(id, { password: String(body.password) });
    await updateAdmin(id, patch);
    if (body.reset_usage === true) await recomputeAdminUsage(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "admin_update", target: admin.username, meta: patch, ip: clientIp(c) });
    return ok(c, { message: "ادمین به‌روزرسانی شد" });
  })
);

adminRoutes.delete(
  "/:id",
  requireOwner,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const admin = await getAdmin(id);
    if (!admin) return c.json({ error: "ادمین پیدا نشد", code: "not_found" }, 404);
    if (admin.role === "owner") return c.json({ error: "مدیر اصلی قابل حذف نیست", code: "forbidden" }, 403);
    if (admin.id === c.get("admin").id) return c.json({ error: "حساب خودتان را نمی‌توانید حذف کنید", code: "forbidden" }, 403);
    await deleteAdmin(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "admin_delete", target: admin.username, ip: clientIp(c) });
    return ok(c, { message: "ادمین حذف شد" });
  })
);

/** Wallet: adds credit to a reseller balance and records the transaction. */
adminRoutes.post(
  "/:id/credit",
  requireOwner,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const admin = await getAdmin(id);
    if (!admin) return c.json({ error: "ادمین پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const amount = Number(body.amount ?? 0);
    const mode = String(body.mode ?? "add");
    const credit = mode === "set" ? amount : Math.max(0, admin.credit + (mode === "subtract" ? -amount : amount));
    await updateAdmin(id, { credit });
    const payment = await createPayment({
      adminId: id,
      amount,
      method: "wallet",
      status: "approved",
      note: `شارژ کیف پول (${mode}) توسط ${c.get("admin").username}`,
    });
    await updatePayment(payment.id, { reviewed_at: nowSeconds(), reviewed_by: c.get("admin").id });
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "admin_credit", target: admin.username, meta: { amount, mode }, ip: clientIp(c) });
    return ok(c, { credit });
  })
);

/** Owner-only impersonation: open a session as another admin. */
adminRoutes.post(
  "/:id/impersonate",
  requireOwner,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const admin = await getAdmin(id);
    if (!admin) return c.json({ error: "ادمین پیدا نشد", code: "not_found" }, 404);
    const { token } = await createSession(admin.id, { ip: clientIp(c), userAgent: "impersonation" });
    setSessionCookie(c, token);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "admin_impersonate", target: admin.username, ip: clientIp(c) });
    return ok(c, { message: `اکنون به عنوان ${admin.username} وارد شده‌اید` });
  })
);

/** Password reset by an owner (no current password required). */
adminRoutes.post(
  "/:id/password",
  requireOwner,
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readJson(c);
    const password = String(body.password ?? "");
    if (password.length < 6) return c.json({ error: "رمز باید حداقل ۶ کاراکتر باشد", code: "validation" }, 400);
    await getDb().run("UPDATE admins SET password_hash = ? WHERE id = ?", [hashPassword(password), id]);
    return ok(c, { message: "رمز عبور بازنشانی شد" });
  })
);

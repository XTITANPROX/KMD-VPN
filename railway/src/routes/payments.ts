// Payments / orders / billing + reports.

import { Hono } from "hono";
import { audit, getDb } from "../db/index.js";
import { nowSeconds } from "../lib/format.js";
import { gbToBytes } from "../lib/validate.js";
import { clientIp, ok, readJson, requireAdmin, requireApiAuth, safe, type AppVariables } from "../middleware.js";
import {
  createPayment,
  createUser,
  getPayment,
  getPlan,
  getUser,
  getUserByTelegram,
  listPayments,
  refreshUserStatus,
  revenueSummary,
  setUserNodes,
  updatePayment,
  updateUser,
} from "../services/store.js";
import { randomUuid, randomToken } from "../lib/crypto.js";
import { syncUser } from "../services/nodes.js";
import { subscriptionUrls } from "./users.js";
import { bot } from "../services/bot.js";
import { sendTelegramMessage } from "../services/telegram.js";
import { fmtBytes, jalaliDate } from "../lib/format.js";

export const paymentRoutes = new Hono<{ Variables: AppVariables }>();

paymentRoutes.use("*", requireApiAuth);

paymentRoutes.get(
  "/",
  safe(async (c) => {
    const query = c.req.query();
    const payments = await listPayments({
      status: query.status ?? "all",
      method: query.method,
      userId: query.user_id ? Number(query.user_id) : undefined,
      telegramId: query.telegram_id,
      limit: Number(query.limit ?? 200),
    });
    return ok(c, { payments, revenue: await revenueSummary() });
  })
);

/** Manual payment registration (e.g. cash/card handled outside the bot). */
paymentRoutes.post(
  "/",
  safe(async (c) => {
    const body = await readJson(c);
    const payment = await createPayment({
      userId: body.user_id ? Number(body.user_id) : null,
      adminId: body.admin_id ? Number(body.admin_id) : c.get("admin").id,
      planId: body.plan_id ? Number(body.plan_id) : null,
      telegramId: body.telegram_id ? String(body.telegram_id) : null,
      amount: Number(body.amount ?? 0),
      discount: Number(body.discount ?? 0),
      method: String(body.method ?? "manual"),
      refId: body.ref_id ? String(body.ref_id) : null,
      receiptFile: body.receipt_file ? String(body.receipt_file) : null,
      status: String(body.status ?? "pending"),
      note: body.note ? String(body.note) : null,
    });
    if (body.status === "approved") {
      await updatePayment(payment.id, { reviewed_at: nowSeconds(), reviewed_by: c.get("admin").id });
      await approvePayment(payment.id, c.get("admin").id);
    }
    return ok(c, { payment }, 201);
  })
);

paymentRoutes.post(
  "/:id/approve",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const payment = await getPayment(id);
    if (!payment) return c.json({ error: "پرداخت پیدا نشد", code: "not_found" }, 404);
    if (payment.status === "approved") return c.json({ error: "قبلاً تایید شده است", code: "conflict" }, 409);
    await updatePayment(id, { status: "approved", reviewed_at: nowSeconds(), reviewed_by: c.get("admin").id });
    const result = await approvePayment(id, c.get("admin").id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "payment_approve", target: String(id), ip: clientIp(c) });
    return ok(c, result);
  })
);

paymentRoutes.post(
  "/:id/reject",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const payment = await getPayment(id);
    if (!payment) return c.json({ error: "پرداخت پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c).catch((): Record<string, unknown> => ({}));
    await updatePayment(id, {
      status: "rejected",
      reviewed_at: nowSeconds(),
      reviewed_by: c.get("admin").id,
      note: body.reason ? String(body.reason) : payment.note,
    });
    if (payment.telegram_id) {
      await sendTelegramMessage(payment.telegram_id, `❌ سفارش #${id} رد شد.${body.reason ? `\nدلیل: ${body.reason}` : ""}`);
    }
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "payment_reject", target: String(id), ip: clientIp(c) });
    return ok(c, { message: "سفارش رد شد" });
  })
);

paymentRoutes.post(
  "/:id/refund",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const payment = await getPayment(id);
    if (!payment) return c.json({ error: "پرداخت پیدا نشد", code: "not_found" }, 404);
    await updatePayment(id, { status: "refunded", reviewed_at: nowSeconds(), reviewed_by: c.get("admin").id });
    if (payment.admin_id) {
      const admin = await getDb().get<{ credit: number }>("SELECT credit FROM admins WHERE id = ?", [payment.admin_id]);
      await getDb().run("UPDATE admins SET credit = credit + ? WHERE id = ?", [payment.amount, payment.admin_id]);
      void admin;
    }
    return ok(c, { message: "مبلغ بازگشت داده شد" });
  })
);

paymentRoutes.delete(
  "/:id",
  safe(async (c) => {
    await getDb().run("DELETE FROM payments WHERE id = ?", [Number(c.req.param("id"))]);
    return ok(c, { message: "پرداخت حذف شد" });
  })
);

/** Financial report: revenue by day, by method, top resellers. */
paymentRoutes.get(
  "/report",
  safe(async (c) => {
    const days = Number(c.req.query("days") ?? 30);
    const from = nowSeconds() - days * 86400;
    const daily = await getDb().all<{ day: string; total: number | string; count: number | string }>(
      `SELECT substr(CAST(created_at AS TEXT), 1, 10) AS day, SUM(amount) AS total, COUNT(*) AS count
       FROM payments WHERE status = 'approved' AND created_at >= ? GROUP BY day ORDER BY day DESC`,
      [from]
    );
    const byMethod = await getDb().all<{ method: string; total: number | string; count: number | string }>(
      "SELECT method, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE status = 'approved' AND created_at >= ? GROUP BY method",
      [from]
    );
    const topAdmins = await getDb().all<{ username: string; total: number | string }>(
      `SELECT a.username AS username, SUM(p.amount) AS total FROM payments p JOIN admins a ON a.id = p.admin_id
       WHERE p.status = 'approved' AND p.created_at >= ? GROUP BY a.username ORDER BY total DESC LIMIT 10`,
      [from]
    );
    const social = await getDb().all<{ status: string; total: number | string; count: number | string }>(
      "SELECT status, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE created_at >= ? GROUP BY status",
      [from]
    );
    return ok(c, { daily, by_method: byMethod, top_admins: topAdmins, by_status: social, revenue: await revenueSummary() });
  })
);

/** Shared approval logic (bot + panel). */
async function approvePayment(paymentId: number, reviewer: number) {
  const payment = await getPayment(paymentId);
  if (!payment) return { message: "پرداخت پیدا نشد" };
  const plan = payment.plan_id ? await getPlan(payment.plan_id) : undefined;
  const telegramId = payment.telegram_id ?? "";
  let user = payment.user_id ? await getUser(payment.user_id) : telegramId ? await getUserByTelegram(telegramId) : undefined;

  if (!user) {
    user = await createUser({
      username: `kf_${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      uuid: randomUuid(),
      password: randomToken(8),
      telegramId: telegramId || null,
      dataLimitBytes: plan && plan.data_gb > 0 ? gbToBytes(plan.data_gb) : 0,
      days: plan?.days ?? 30,
      deviceLimit: plan?.device_limit ?? 1,
      speedLimitMbps: plan?.speed_mbps ?? 0,
      planId: plan?.id ?? null,
      provider: "local",
    });
  } else if (plan) {
    const now = nowSeconds();
    await updateUser(user.id, {
      plan_id: plan.id,
      data_limit_bytes: user.data_limit_bytes + (plan.data_gb > 0 ? gbToBytes(plan.data_gb) : 0),
      device_limit: plan.device_limit || user.device_limit,
      speed_limit_mbps: plan.speed_mbps || user.speed_limit_mbps,
      expires_at: (user.expires_at && user.expires_at > now ? user.expires_at : now) + (plan.days || 0) * 86400,
      status: "active",
    });
    await refreshUserStatus(user.id);
  }

  if (plan?.node_ids) {
    try {
      const parsed = JSON.parse(plan.node_ids) as number[];
      if (Array.isArray(parsed) && parsed.length) await setUserNodes(user.id, parsed.map(Number));
    } catch {
      /* ignore */
    }
  }
  await syncUser(user.id);
  await updatePayment(paymentId, { user_id: user.id });
  const fresh = (await getUser(user.id))!;
  const urls = await subscriptionUrls(fresh);

  if (telegramId) {
    await sendTelegramMessage(
      telegramId,
      `🎉 <b>سرویس شما فعال شد</b>\n\n👤 <code>${fresh.username}</code>\n📦 ${fresh.data_limit_bytes > 0 ? fmtBytes(fresh.data_limit_bytes) : "نامحدود"}\n` +
        `⏳ ${fresh.expires_at ? jalaliDate(fresh.expires_at) : "بدون انقضا"}\n\n🔗 لینک ساب:\n<code>${urls.base64}</code>\n🖼 صفحه QR: ${urls.page}`,
      { disable_web_page_preview: true }
    );
  }
  void reviewer;
  void bot;
  return { message: "سرویس ساخته/تمدید شد", user_id: user.id, subscription: urls };
}

export { approvePayment };

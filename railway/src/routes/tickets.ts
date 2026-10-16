// Support tickets.

import { Hono } from "hono";
import { audit } from "../db/index.js";
import { clientIp, ok, readJson, requireAdmin, requireApiAuth, safe, type AppVariables } from "../middleware.js";
import { addTicketMessage, createTicket, deleteTicket, getTicket, listTickets, updateTicket } from "../services/store.js";
import { notifyAdmins, sendTelegramMessage } from "../services/telegram.js";
import { escapeHtml } from "../services/telegram.js";

export const ticketRoutes = new Hono<{ Variables: AppVariables }>();

ticketRoutes.use("*", requireApiAuth);

ticketRoutes.get(
  "/",
  safe(async (c) => {
    const query = c.req.query();
    const tickets = await listTickets({ status: query.status ?? "all", limit: Number(query.limit ?? 100) });
    return ok(c, {
      tickets,
      counts: {
        open: tickets.filter((ticket) => ticket.status === "open").length,
        answered: tickets.filter((ticket) => ticket.status === "answered").length,
      },
    });
  })
);

ticketRoutes.get(
  "/:id",
  safe(async (c) => {
    const ticket = await getTicket(Number(c.req.param("id")));
    if (!ticket) return c.json({ error: "تیکت پیدا نشد", code: "not_found" }, 404);
    return ok(c, ticket);
  })
);

ticketRoutes.post(
  "/",
  safe(async (c) => {
    const body = await readJson(c);
    const ticket = await createTicket({
      subject: String(body.subject ?? "پشتیبانی"),
      body: String(body.body ?? ""),
      userId: body.user_id ? Number(body.user_id) : null,
      telegramId: body.telegram_id ? String(body.telegram_id) : null,
      name: body.name ? String(body.name) : c.get("admin").username,
      category: String(body.category ?? "other"),
      priority: String(body.priority ?? "normal"),
    });
    return ok(c, { ticket }, 201);
  })
);

ticketRoutes.post(
  "/:id/reply",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const ticket = await getTicket(id);
    if (!ticket) return c.json({ error: "تیکت پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const text = String(body.body ?? "").trim();
    if (!text) return c.json({ error: "متن پاسخ خالی است", code: "validation" }, 400);
    const admin = c.get("admin");
    await addTicketMessage(id, "admin", text, admin.id);
    if (ticket.ticket.telegram_id) {
      await sendTelegramMessage(ticket.ticket.telegram_id, `📬 <b>پاسخ پشتیبانی (تیکت #${id})</b>\n\n${escapeHtml(text)}`);
    }
    await audit({ adminId: admin.id, actor: admin.username, action: "ticket_reply", target: String(id), ip: clientIp(c) });
    return ok(c, { message: "پاسخ ارسال شد" });
  })
);

ticketRoutes.put(
  "/:id",
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readJson(c);
    await updateTicket(id, body);
    return ok(c, { ticket: await getTicket(id) });
  })
);

ticketRoutes.delete(
  "/:id",
  safe(async (c) => {
    await deleteTicket(Number(c.req.param("id")));
    return ok(c, { message: "تیکت حذف شد" });
  })
);

/** Broadcast from the panel to all (or selected) users. */
ticketRoutes.post(
  "/broadcast",
  safe(async (c) => {
    const body = await readJson(c);
    const text = String(body.text ?? "").trim();
    if (!text) return c.json({ error: "متن پیام خالی است", code: "validation" }, 400);
    const { listUsers } = await import("../services/store.js");
    const targets = Array.isArray(body.user_ids) && body.user_ids.length ? (body.user_ids as number[]).map(Number) : [];
    const users = targets.length
      ? await Promise.all(targets.map((id) => import("../services/store.js").then((module_) => module_.getUser(id))))
      : (await listUsers({ perPage: 200 })).items;
    let sent = 0;
    for (const user of users) {
      if (!user?.telegram_id) continue;
      await sendTelegramMessage(user.telegram_id, text);
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "broadcast_panel", meta: { sent }, ip: clientIp(c) });
    return ok(c, { sent });
  })
);

export { notifyAdmins };

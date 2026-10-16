// Telegram bot: self-service shop, account lookup, support tickets, admin
// commands and push notifications.

import { getSetting, getSettings, audit } from "../db/index.js";
import { PUBLIC_URL, APP_NAME } from "../env.js";
import { gbToBytes } from "../lib/validate.js";
import { fmtBytes, jalaliDate, nowSeconds } from "../lib/format.js";
import { escapeHtml, notifyAdmins, sendTelegramMessage, setMyCommands, telegramApi, botToken, type InlineKeyboardButton } from "./telegram.js";
import {
  createPayment,
  createTicket,
  createUser,
  addTicketMessage,
  getPayment,
  getPlan,
  getAdminByTelegram,
  getUsersByTelegram,
  getUserByTelegram,
  getUser,
  listPlans,
  updatePayment,
  updateUser,
  extendUser,
  refreshUserStatus,
  resetUserTraffic,
  listUsers,
} from "./store.js";
import { syncUser, statusEnforcement } from "./nodes.js";
import { randomToken, randomUuid } from "../lib/crypto.js";
import { subscriptionUrls } from "../routes/users.js";
import type { PlanRow, UserRow } from "../types.js";

interface ChatState {
  flow: string;
  data: Record<string, unknown>;
  expiresAt: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    text?: string;
    photo?: Array<{ file_id: string }>;
    caption?: string;
    document?: { file_id: string; file_name?: string };
    reply_to_message?: { message_id: number; text?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number }; text?: string };
  };
}

class KalBot {
  private offset = 0;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private states = new Map<number, ChatState>();
  private notificationsSeen = new Set<string>();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.offset = Number(await getSetting("bot_offset", "0")) || 0;
    void setMyCommands([
      { command: "start", description: "شروع / منوی اصلی" },
      { command: "myaccount", description: "اکانت‌های من" },
      { command: "buy", description: "خرید سرویس" },
      { command: "support", description: "پشتیبانی" },
      { command: "help", description: "راهنما" },
    ]);
    this.loop();
    console.log("[bot] long polling started");
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  setState(chatId: number, flow: string, data: Record<string, unknown> = {}, ttlMinutes = 15): void {
    this.states.set(chatId, { flow, data, expiresAt: Date.now() + ttlMinutes * 60_000 });
  }

  getState(chatId: number): ChatState | null {
    const state = this.states.get(chatId);
    if (!state) return null;
    if (state.expiresAt < Date.now()) {
      this.states.delete(chatId);
      return null;
    }
    return state;
  }

  clearState(chatId: number): void {
    this.states.delete(chatId);
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    const token = await botToken();
    if (!token) {
      this.timer = setTimeout(() => this.loop(), 15_000);
      return;
    }
    try {
      const updates = await telegramApi<TelegramUpdate[]>(
        "getUpdates",
        { offset: this.offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
        token
      );
      for (const update of updates) {
        this.offset = update.update_id + 1;
        try {
          await this.handleUpdate(update);
        } catch (error) {
          console.warn("[bot] update failed:", (error as Error).message);
        }
      }
      if (updates.length) {
        const { setSetting } = await import("../db/index.js");
        await setSetting("bot_offset", String(this.offset));
      }
    } catch (error) {
      console.warn("[bot] poll error:", (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    this.timer = setTimeout(() => this.loop(), 300);
  }

  /* ----------------------------- dispatch ----------------------------- */

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.handleCallback(update.callback_query);
    if (update.message) return this.handleMessage(update.message);
  }

  private async handleCallback(query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = query.message?.chat.id ?? query.from.id;
    const data = query.data ?? "";
    const { answerCallbackQuery, editTelegramMessage } = await import("./telegram.js");
    await answerCallbackQuery(query.id);

    if (data.startsWith("buy:")) {
      const planId = Number(data.split(":")[1]);
      return this.startPurchase(chatId, planId);
    }
    if (data.startsWith("pay_ok:") || data.startsWith("pay_no:")) {
      return this.reviewPayment(chatId, query.message?.message_id ?? 0, data);
    }
    if (data === "menu") {
      return this.sendMenu(chatId);
    }
    if (data === "my_account") {
      return this.sendAccount(chatId, query.from.id);
    }
    if (data === "trial") {
      return this.claimTrial(chatId, query.from.id, query.from.username, query.from.first_name);
    }
    if (data === "support") {
      this.setState(chatId, "ticket_subject");
      return this.send(chatId, "📝 موضوع پیام پشتیبانی را در یک خط بنویسید:");
    }
    if (data.startsWith("tik:")) {
      const ticketId = Number(data.split(":")[1]);
      const admin = await getAdminByTelegram(String(chatId));
      if (!admin) return this.send(chatId, "⛔️ فقط مدیران می‌توانند پاسخ دهند.");
      this.setState(chatId, "ticket_reply", { ticketId });
      return this.send(chatId, `✍️ پاسخ خود را برای تیکت #${ticketId} بنویسید:`);
    }
    if (data.startsWith("acc_sub:")) {
      const userId = Number(data.split(":")[1]);
      const user = await getUser(userId);
      if (!user) return this.send(chatId, "کاربر پیدا نشد.");
      const urls = await subscriptionUrls(user);
      return this.send(chatId, `🔗 لینک ساب شما:\n<code>${urls.base64}</code>`, { disable_web_page_preview: true });
    }
    if (data.startsWith("acc_qr:")) {
      const userId = Number(data.split(":")[1]);
      const user = await getUser(userId);
      if (!user) return this.send(chatId, "کاربر پیدا نشد.");
      const urls = await subscriptionUrls(user);
      return this.send(chatId, `🖼 صفحه اختصاصی و QR:\n${urls.page}`);
    }
    if (data.startsWith("acc_links:")) {
      const userId = Number(data.split(":")[1]);
      const user = await getUser(userId);
      if (!user) return this.send(chatId, "کاربر پیدا نشد.");
      const { userLinkPayload } = await import("../routes/users.js");
      const payload = await userLinkPayload(user);
      const text = payload.entries.map((entry) => `<b>${escapeHtml(entry.nodeName)}</b>\n<code>${entry.link}</code>`).join("\n\n");
      return this.send(chatId, text || "نودی برای شما تنظیم نشده است.");
    }
    if (data.startsWith("plan_del:")) {
      const admin = await getAdminByTelegram(String(chatId));
      if (!admin) return;
      const planId = Number(data.split(":")[1]);
      const { deletePlan } = await import("./store.js");
      await deletePlan(planId);
      return this.send(chatId, "🗑 پلن حذف شد.");
    }
    void editTelegramMessage;
  }

  private async handleMessage(message: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    const chatId = message.chat.id;
    const fromId = message.from?.id ?? chatId;
    const text = (message.text ?? "").trim();
    const state = this.getState(chatId);
    const settings = await getSettings();
    const admin = await getAdminByTelegram(String(fromId));

    /* admin commands */
    if (text.startsWith("/") && admin) {
      const [command, ...args] = text.split(/\s+/);
      switch (command) {
        case "/stats": {
          const { dashboardStats } = await import("./store.js");
          const stats = await dashboardStats();
          return this.send(
            chatId,
            `📊 <b>آمار ${escapeHtml(settings.panel_name)}</b>\n\n` +
              `👥 کاربران: ${stats.users.total} (فعال: ${stats.users.active} · آنلاین: ${stats.users.online})\n` +
              `📈 مصرف امروز: ${fmtBytes(stats.traffic.today)}\n` +
              `🌐 نودها: ${stats.nodes.online}/${stats.nodes.total} آنلاین\n` +
              `💰 درآمد امروز: ${stats.revenue.today.toLocaleString("fa-IR")} تومان\n` +
              `🆔 در انتظار تایید: ${stats.revenue.pending ? "دارد" : "ندارد"}\n` +
              `🎫 تیکت‌های باز: ${stats.tickets.open}`
          );
        }
        case "/pending": {
          const { listPayments } = await import("./store.js");
          const pending = await listPayments({ status: "pending", limit: 10 });
          if (!pending.length) return this.send(chatId, "✅ سفارش در انتظار تاییدی وجود ندارد.");
          for (const payment of pending) {
            await this.sendPaymentReview(chatId, payment.id);
          }
          return;
        }
        case "/adduser": {
          const [username, gb, days] = args;
          if (!username) return this.send(chatId, "استفاده: /adduser نام حجم_گیگ روز");
          const user = await createUser({
            username,
            uuid: randomUuid(),
            dataLimitBytes: gbToBytes(Number(gb ?? 5)),
            days: Number(days ?? 30),
            adminId: admin.id,
          });
          await syncUser(user.id);
          const urls = await subscriptionUrls(user);
          return this.send(chatId, `✅ کاربر ساخته شد:\n<code>${urls.base64}</code>`);
        }
        case "/broadcast": {
          const body = args.join(" ");
          if (!body) return this.send(chatId, "استفاده: /broadcast متن پیام");
          const users = await listUsers({ perPage: 200 });
          let sent = 0;
          for (const user of users.items) {
            if (!user.telegram_id) continue;
            await sendTelegramMessage(user.telegram_id, body);
            sent += 1;
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          await audit({ adminId: admin.id, actor: admin.username, action: "broadcast", meta: { sent } });
          return this.send(chatId, `📣 پیام برای ${sent} کاربر ارسال شد.`);
        }
        case "/panel": {
          const base = PUBLIC_URL ? `https://${PUBLIC_URL}` : "";
          return this.send(chatId, `🖥 پنل مدیریت: ${base}${await getSetting("panel_path", "/panel")}`);
        }
        case "/help":
        case "/start": {
          if (text === "/start" && !admin) break;
          return this.send(
            chatId,
            `🤖 <b>دستورات مدیر</b>\n/stats — آمار کلی\n/pending — سفارش‌های در انتظار\n/adduser نام حجم روز\n/broadcast متن\n/panel — لینک پنل`
          );
        }
        default:
          break;
      }
    }

    /* state driven flows */
    if (state) {
      if (state.flow === "receipt" && (message.photo?.length || message.document)) {
        return this.finishReceipt(chatId, fromId, state, message.photo?.[0]?.file_id ?? message.document?.file_id ?? "");
      }
      if (state.flow === "receipt" && text) {
        return this.finishReceipt(chatId, fromId, state, "", text);
      }
      if (state.flow === "ticket_subject" && text) {
        this.setState(chatId, "ticket_message", { subject: text });
        return this.send(chatId, "📄 متن پیام را بنویسید:");
      }
      if (state.flow === "ticket_message" && text) {
        this.clearState(chatId);
        const ticket = await createTicket({
          subject: String(state.data.subject ?? "پشتیبانی"),
          body: text,
          telegramId: String(fromId),
          name: message.from?.first_name ?? null,
        });
        await notifyAdmins(
          `🎫 <b>تیکت جدید #${ticket.id}</b>\n👤 ${escapeHtml(message.from?.first_name ?? "")} (@${escapeHtml(message.from?.username ?? "-")})\n📝 ${escapeHtml(String(state.data.subject ?? ""))}\n\n${escapeHtml(text)}`,
          { inline_keyboard: [[{ text: "✍️ پاسخ", callback_data: `tik:${ticket.id}` }]] }
        );
        return this.send(chatId, `✅ پیام شما ثبت شد (تیکت #${ticket.id}). به‌زودی پاسخ می‌گیرید.`);
      }
      if (state.flow === "ticket_reply" && text && admin) {
        this.clearState(chatId);
        const ticketId = Number(state.data.ticketId);
        await addTicketMessage(ticketId, "admin", text, admin.id);
        const { getTicket } = await import("./store.js");
        const ticket = await getTicket(ticketId);
        if (ticket?.ticket.telegram_id) {
          await sendTelegramMessage(
            ticket.ticket.telegram_id,
            `📬 <b>پاسخ پشتیبانی (تیکت #${ticketId})</b>\n\n${escapeHtml(text)}`
          );
        }
        return this.send(chatId, "✅ پاسخ ارسال شد.");
      }
    }

    /* default user commands */
    switch (text.split(" ")[0]) {
      case "/start":
        return this.sendWelcome(chatId, fromId, message.from?.first_name);
      case "/buy":
        return this.sendPlans(chatId);
      case "/myaccount":
      case "/myconfig":
        return this.sendAccount(chatId, fromId);
      case "/support":
        this.setState(chatId, "ticket_subject");
        return this.send(chatId, "📝 موضوع پیام پشتیبانی را بنویسید:");
      case "/help":
        return this.send(
          chatId,
          `ℹ️ <b>راهنمای ${escapeHtml(settings.panel_name)}</b>\n\n` +
            `🛒 خرید سرویس: /buy\n👤 اکانت‌های من: /myaccount\n🎫 پشتیبانی: /support\n\n` +
            `پس از خرید، لینک ساب در همین چت ارسال می‌شود.`
        );
      default:
        if (text) return this.sendWelcome(chatId, fromId, message.from?.first_name);
    }
  }

  /* ------------------------------- flows ------------------------------ */

  private async send(chatId: number, text: string, options: Parameters<typeof sendTelegramMessage>[2] = {}): Promise<void> {
    await sendTelegramMessage(chatId, text, options);
  }

  private async sendWelcome(chatId: number, fromId: number, firstName?: string): Promise<void> {
    const settings = await getSettings();
    const users = await getUsersByTelegram(String(fromId));
    const buttons: InlineKeyboardButton[][] = [
      [{ text: "🛒 خرید سرویس", callback_data: "buy_menu" }, { text: "👤 اکانت من", callback_data: "my_account" }],
      [{ text: "🎫 پشتیبانی", callback_data: "support" }],
    ];
    if (settings.trial_enabled === "true" && users.length === 0) {
      buttons.splice(1, 0, [{ text: "🎁 دریافت تست رایگان", callback_data: "trial" }]);
    }
    if (settings.channel_link) buttons.push([{ text: "📣 کانال ما", url: settings.channel_link }]);
    await this.send(
      chatId,
      `${settings.bot_welcome || `سلام! به ${settings.panel_name} خوش آمدید.`}\n\n` +
        (firstName ? `👋 ${escapeHtml(firstName)} عزیز\n` : "") +
        `از منوی زیر انتخاب کنید.`,
      { reply_markup: { inline_keyboard: buttons } }
    );
    if (settings.announcement_active === "true" && settings.announcement) {
      await this.send(chatId, `📢 ${escapeHtml(settings.announcement)}`);
    }
  }

  private async sendMenu(chatId: number): Promise<void> {
    await this.send(chatId, "منوی اصلی:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛒 خرید سرویس", callback_data: "buy_menu" }, { text: "👤 اکانت من", callback_data: "my_account" }],
          [{ text: "🎫 پشتیبانی", callback_data: "support" }],
        ],
      },
    });
  }

  private async sendPlans(chatId: number): Promise<void> {
    const settings = await getSettings();
    if (settings.bot_shop_enabled !== "true") return this.send(chatId, "🛑 فروش از طریق ربات در حال حاضر غیرفعال است.");
    const plans = await listPlans(true);
    if (!plans.length) return this.send(chatId, "در حال حاضر پلنی برای فروش وجود ندارد.");
    for (const plan of plans) {
      const text =
        `💎 <b>${escapeHtml(plan.name)}</b>\n` +
        `💰 ${plan.price.toLocaleString("fa-IR")} تومان\n` +
        `📦 ${plan.data_gb > 0 ? `${plan.data_gb} گیگابایت` : "حجم نامحدود"} · ⏳ ${plan.days || "بدون"} روز\n` +
        `📱 ${plan.device_limit > 0 ? `${plan.device_limit} دستگاه` : "دستگاه نامحدود"}` +
        (plan.description ? `\n📝 ${escapeHtml(plan.description)}` : "");
      await this.send(chatId, text, {
        reply_markup: { inline_keyboard: [[{ text: "🛍 انتخاب این پلن", callback_data: `buy:${plan.id}` }]] },
      });
    }
  }

  private async startPurchase(chatId: number, planId: number): Promise<void> {
    const settings = await getSettings();
    const plan = planId ? await getPlan(planId) : undefined;
    if (!plan) return this.sendPlans(chatId);
    const card = settings.card_number
      ? `💳 <b>${escapeHtml(settings.card_number)}</b>\nبه نام: ${escapeHtml(settings.card_holder)}\n`
      : "";
    this.setState(chatId, "receipt", { planId: plan.id, amount: plan.price });
    await this.send(
      chatId,
      `🧾 <b>${escapeHtml(plan.name)}</b> — ${plan.price.toLocaleString("fa-IR")} تومان\n\n` +
        `${card}\n${escapeHtml(settings.payment_instructions || "")}\n\n` +
        `پس از واریز، <b>عکس رسید</b> یا شماره پیگیری را همین‌جا بفرستید.`,
      { reply_markup: { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "menu" }]] } }
    );
  }

  private async finishReceipt(
    chatId: number,
    fromId: number,
    state: ChatState,
    receiptFile: string,
    note = ""
  ): Promise<void> {
    this.clearState(chatId);
    const settings = await getSettings();
    const plan = await getPlan(Number(state.data.planId));
    if (!plan) return this.send(chatId, "پلن انتخاب شده پیدا نشد. لطفاً دوباره تلاش کنید.");
    const existing = await getUserByTelegram(String(fromId));
    const payment = await createPayment({
      userId: existing?.id ?? null,
      planId: plan.id,
      telegramId: String(fromId),
      amount: plan.price,
      method: settings.card_number ? "card" : "manual",
      receiptFile: receiptFile || null,
      status: settings.bot_auto_approve === "true" ? "approved" : "pending",
      note,
    });
    if (payment.status === "approved") {
      await this.deliverPlan(payment.id, existing, plan, String(fromId));
      return;
    }
    await notifyAdmins(
      `🧾 <b>سفارش جدید #${payment.id}</b>\n👤 ${existing?.username ?? "کاربر جدید"} (${fromId})\n💎 ${escapeHtml(plan.name)}\n💰 ${plan.price.toLocaleString("fa-IR")} تومان\n${note ? `📝 ${escapeHtml(note)}` : "📷 رسید ارسال شد"}`,
      {
        inline_keyboard: [
          [
            { text: "✅ تایید و ساخت", callback_data: `pay_ok:${payment.id}` },
            { text: "❌ رد", callback_data: `pay_no:${payment.id}` },
          ],
        ],
      }
    );
    await this.send(chatId, "⏳ رسید شما ثبت شد و در انتظار تایید مدیر است. پس از تایید، کانفیگ برای شما ارسال می‌شود.");
  }

  private async reviewPayment(chatId: number, messageId: number, data: string): Promise<void> {
    const admin = await getAdminByTelegram(String(chatId));
    if (!admin) return this.send(chatId, "⛔️ دسترسی ندارید.");
    const [action, idRaw] = data.split(":");
    const paymentId = Number(idRaw);
    const payment = await getPayment(paymentId);
    if (!payment) return this.send(chatId, "سفارش پیدا نشد.");
    if (payment.status !== "pending") return this.send(chatId, "این سفارش قبلاً بررسی شده است.");

    if (action === "pay_no") {
      await updatePayment(paymentId, { status: "rejected", reviewed_at: nowSeconds(), reviewed_by: admin.id });
      if (payment.telegram_id) await this.send(Number(payment.telegram_id), `❌ سفارش #${paymentId} رد شد. برای پیگیری با پشتیبانی در تماس باشید.`);
      return this.send(chatId, `سفارش #${paymentId} رد شد.`);
    }

    const plan = payment.plan_id ? await getPlan(payment.plan_id) : undefined;
    const user = payment.user_id ? await getUser(payment.user_id) : await getUserByTelegram(String(payment.telegram_id ?? ""));
    await updatePayment(paymentId, { status: "approved", reviewed_at: nowSeconds(), reviewed_by: admin.id });
    await this.deliverPlan(paymentId, user, plan, payment.telegram_id ?? "");
    await this.send(chatId, `✅ سفارش #${paymentId} تایید و سرویس ساخته شد.`);
    void messageId;
  }

  /** Applies a purchased plan for a user (creates the account when needed). */
  async deliverPlan(paymentId: number, existing: UserRow | undefined | null, plan: PlanRow | undefined, telegramId: string): Promise<UserRow | null> {
    if (!plan) return null;
    const settings = await getSettings();
    let user = existing ?? null;
    if (!user) {
      const username = `kf_${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}`;
      user = await createUser({
        username,
        uuid: randomUuid(),
        password: randomToken(8),
        telegramId: telegramId || null,
        dataLimitBytes: plan.data_gb > 0 ? gbToBytes(plan.data_gb) : 0,
        days: plan.days || 0,
        deviceLimit: plan.device_limit,
        speedLimitMbps: plan.speed_mbps,
        planId: plan.id,
      });
    } else {
      const limit = plan.data_gb > 0 ? gbToBytes(plan.data_gb) : 0;
      const now = nowSeconds();
      await updateUser(user.id, {
        plan_id: plan.id,
        data_limit_bytes: user.data_limit_bytes + limit,
        device_limit: plan.device_limit || user.device_limit,
        speed_limit_mbps: plan.speed_mbps || user.speed_limit_mbps,
        expires_at: (user.expires_at && user.expires_at > now ? user.expires_at : now) + (plan.days || 0) * 86400,
        status: "active",
      });
      await refreshUserStatus(user.id);
      user = (await getUser(user.id))!;
    }
    if (plan.node_ids) {
      try {
        const parsed = JSON.parse(plan.node_ids) as number[];
        if (Array.isArray(parsed) && parsed.length) {
          const { setUserNodes } = await import("./store.js");
          await setUserNodes(user.id, parsed.map(Number));
        }
      } catch {
        /* ignore */
      }
    }
    await syncUser(user.id);
    const urls = await subscriptionUrls(user);
    await updatePayment(paymentId, { user_id: user.id });
    if (telegramId) {
      await sendTelegramMessage(
        telegramId,
        `🎉 <b>سرویس شما آماده است!</b>\n\n` +
          `👤 نام کاربری: <code>${user.username}</code>\n` +
          `📦 حجم: ${user.data_limit_bytes > 0 ? fmtBytes(user.data_limit_bytes) : "نامحدود"}\n` +
          `⏳ انقضا: ${user.expires_at ? jalaliDate(user.expires_at) : "بدون انقضا"}\n\n` +
          `🔗 لینک ساب (برای همه اپ‌ها):\n<code>${urls.base64}</code>\n\n` +
          `🌐 لینک Clash: ${urls.clash}\n🖼 صفحه QR: ${urls.page}`,
        { disable_web_page_preview: true }
      );
    }
    void settings;
    return user;
  }

  private async claimTrial(chatId: number, fromId: number, username?: string, firstName?: string): Promise<void> {
    const settings = await getSettings();
    if (settings.trial_enabled !== "true") return this.send(chatId, "🎁 تست رایگان غیرفعال است.");
    const existing = await getUsersByTelegram(String(fromId));
    if (existing.length) return this.send(chatId, "شما قبلاً اکانت دارید. برای خرید سرویس از /buy استفاده کنید.");
    const days = Number(settings.trial_days || 1);
    const gb = Number(settings.trial_gb || 1);
    const name = `trial_${Math.random().toString(36).slice(2, 8)}`;
    const user = await createUser({
      username: name,
      uuid: randomUuid(),
      password: randomToken(8),
      telegramId: String(fromId),
      dataLimitBytes: gbToBytes(gb),
      days,
      deviceLimit: 1,
      note: `تست رایگان — @${username ?? firstName ?? ""}`,
    });
    await syncUser(user.id);
    const urls = await subscriptionUrls(user);
    await this.send(
      chatId,
      `🎁 <b>اکانت تست شما فعال شد</b>\n👤 <code>${user.username}</code>\n📦 ${gb} گیگابایت · ⏳ ${days} روز\n\n<code>${urls.base64}</code>`
    );
    await notifyAdmins(`🎁 کاربر جدید (@${username ?? "-"}) تست رایگان دریافت کرد: ${user.username}`);
  }

  private async sendAccount(chatId: number, fromId: number): Promise<void> {
    const users = await getUsersByTelegram(String(fromId));
    if (!users.length) {
      return this.send(chatId, "شما هنوز اکانتی ندارید.", {
        reply_markup: { inline_keyboard: [[{ text: "🛒 خرید سرویس", callback_data: "buy_menu" }]] },
      });
    }
    for (const user of users) {
      await refreshUserStatus(user.id);
      const fresh = (await getUser(user.id)) ?? user;
      const urls = await subscriptionUrls(fresh);
      const percent = fresh.data_limit_bytes > 0 ? Math.round((fresh.data_used_bytes / fresh.data_limit_bytes) * 100) : 0;
      await this.send(
        chatId,
        `👤 <b>${escapeHtml(fresh.username)}</b> — ${fresh.status === "active" ? "✅ فعال" : fresh.status === "expired" ? "⌛️ منقضی" : fresh.status === "limited" ? "📉 حجم تمام" : "⛔️ غیرفعال"}\n` +
          `📊 مصرف: ${fmtBytes(fresh.data_used_bytes)}${fresh.data_limit_bytes > 0 ? ` از ${fmtBytes(fresh.data_limit_bytes)} (${percent}%)` : " (نامحدود)"}\n` +
          `⏳ انقضا: ${fresh.expires_at ? jalaliDate(fresh.expires_at) : "بدون انقضا"}\n` +
          `📱 دستگاه: ${fresh.device_limit || "نامحدود"}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔗 لینک ساب", callback_data: `acc_sub:${fresh.id}` },
                { text: "⚙️ کانفیگ‌ها", callback_data: `acc_links:${fresh.id}` },
              ],
              [
                { text: "🖼 QR", callback_data: `acc_qr:${fresh.id}` },
                { text: "🔄 تمدید", callback_data: "buy_menu" },
              ],
            ],
          },
        }
      );
      void urls;
    }
  }

  /* ---------------------------- notifications -------------------------- */

  async notifyUser(user: UserRow, text: string): Promise<void> {
    if (!user.telegram_id) return;
    await sendTelegramMessage(user.telegram_id, text);
  }

  /** Expiry / quota notifications (called by the scheduler). */
  async runNotifications(): Promise<number> {
    const settings = await getSettings();
    const users = await listUsers({ perPage: 200 });
    const more = await listUsers({ perPage: 200, page: 2 });
    const all = [...users.items, ...more.items];
    let sent = 0;
    const notifyDays = (settings.notify_expiry_days || "3,1").split(",").map((value) => Number(value.trim())).filter(Boolean);
    const lowPercent = Number(settings.notify_low_quota_percent || 15);
    for (const user of all) {
      if (!user.telegram_id) continue;
      const key = (type: string) => `${type}:${user.id}:${user.expires_at ?? 0}:${Math.floor(user.data_used_bytes / (1024 ** 3))}`;
      if (settings.telegram_notify_expiry === "true" && user.expires_at) {
        const daysLeft = Math.ceil((user.expires_at * 1000 - Date.now()) / 86_400_000);
        if (notifyDays.includes(daysLeft) && !this.notificationsSeen.has(key(`exp${daysLeft}`))) {
          this.notificationsSeen.add(key(`exp${daysLeft}`));
          await this.notifyUser(
            user,
            `⏳ <b>${escapeHtml(user.username)}</b>\nسرویس شما ${daysLeft} روز دیگر منقضی می‌شود.\nبرای تمدید از /buy استفاده کنید.`
          );
          sent += 1;
        }
      }
      if (settings.telegram_notify_quota === "true" && user.data_limit_bytes > 0) {
        const percent = Math.round((user.data_used_bytes / user.data_limit_bytes) * 100);
        if (percent >= 100 - lowPercent && !this.notificationsSeen.has(key("low"))) {
          this.notificationsSeen.add(key("low"));
          await this.notifyUser(
            user,
            `📉 <b>${escapeHtml(user.username)}</b>\n${percent}% از حجم سرویس شما مصرف شده است.\nبرای خرید حجم اضافه از /buy استفاده کنید.`
          );
          sent += 1;
        }
      }
      if (user.status === "limited" && !this.notificationsSeen.has(key("limited"))) {
        this.notificationsSeen.add(key("limited"));
        await this.notifyUser(user, `⛔️ <b>${escapeHtml(user.username)}</b>\nحجم سرویس شما تمام شد و اتصال قطع شد. برای تمدید /buy را بزنید.`);
        sent += 1;
      }
    }
    if (this.notificationsSeen.size > 5000) this.notificationsSeen.clear();
    return sent;
  }

  async sendPaymentReview(chatId: number, paymentId: number): Promise<void> {
    const payment = await getPayment(paymentId);
    if (!payment) return;
    const plan = payment.plan_id ? await getPlan(payment.plan_id) : undefined;
    await this.send(
      chatId,
      `🧾 <b>سفارش #${payment.id}</b>\n👤 ${payment.telegram_id ?? "-"}\n💎 ${escapeHtml(plan?.name ?? "-")}\n💰 ${payment.amount.toLocaleString("fa-IR")} تومان\n🕒 ${jalaliDate(payment.created_at)}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ تایید", callback_data: `pay_ok:${payment.id}` },
              { text: "❌ رد", callback_data: `pay_no:${payment.id}` },
            ],
          ],
        },
      }
    );
  }
}

export const bot = new KalBot();

/** Wires the enforcement hook so status changes push/remove clients. */
export function installBotHooks(): void {
  void statusEnforcement;
  void APP_NAME;
}

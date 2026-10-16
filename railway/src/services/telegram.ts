// Minimal Telegram Bot API transport (no external dependencies).

import { getSetting, getSettings } from "../db/index.js";
import { TELEGRAM_TOKEN_ENV } from "../env.js";

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type ReplyMarkup = { inline_keyboard: InlineKeyboardButton[][] } | { keyboard: Array<Array<{ text: string }>>; resize_keyboard?: boolean };

export interface SendOptions {
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: ReplyMarkup;
  disable_web_page_preview?: boolean;
  chat_id?: string | number;
  message_thread_id?: number;
}

export async function botToken(): Promise<string> {
  const stored = await getSetting("bot_token", "");
  return stored || TELEGRAM_TOKEN_ENV || "";
}

export async function telegramApi<T = unknown>(method: string, payload: Record<string, unknown> = {}, token?: string): Promise<T> {
  const activeToken = token ?? (await botToken());
  if (!activeToken) throw new Error("توکن ربات تنظیم نشده است");
  const response = await fetch(`https://api.telegram.org/bot${activeToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description || `Telegram API error (${method})`);
  return data.result as T;
}

export async function sendTelegramMessage(chatId: string | number, text: string, options: SendOptions = {}): Promise<number | null> {
  try {
    const result = await telegramApi<{ message_id: number }>("sendMessage", {
      chat_id: options.chat_id ?? chatId,
      text,
      parse_mode: options.parse_mode ?? "HTML",
      disable_web_page_preview: options.disable_web_page_preview ?? true,
      ...(options.reply_markup ? { reply_markup: options.reply_markup } : {}),
    });
    return result?.message_id ?? null;
  } catch (error) {
    console.warn("[telegram] send failed:", (error as Error).message);
    return null;
  }
}

export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  options: SendOptions = {}
): Promise<void> {
  try {
    await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parse_mode ?? "HTML",
      ...(options.reply_markup ? { reply_markup: options.reply_markup } : {}),
    });
  } catch (error) {
    console.warn("[telegram] edit failed:", (error as Error).message);
  }
}

export async function answerCallbackQuery(id: string, text?: string, alert = false): Promise<void> {
  try {
    await telegramApi("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
  } catch {
    /* ignore */
  }
}

export async function sendChatAction(chatId: string | number, action = "typing"): Promise<void> {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action });
  } catch {
    /* ignore */
  }
}

export async function sendPhoto(chatId: string | number, photoUrl: string, caption?: string): Promise<void> {
  try {
    await telegramApi("sendPhoto", { chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" });
  } catch {
    /* ignore */
  }
}

export async function getBotInfo(): Promise<{ id: number; username: string; first_name: string } | null> {
  try {
    return await telegramApi<{ id: number; username: string; first_name: string }>("getMe");
  } catch {
    return null;
  }
}

export async function setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
  try {
    await telegramApi("setMyCommands", { commands });
  } catch {
    /* ignore */
  }
}

/** Returns the chat ids that should receive admin notifications. */
export async function adminChatIds(): Promise<string[]> {
  const { listAdmins } = await import("./store.js");
  const settings = await getSettings();
  const admins = await listAdmins();
  const ids = new Set<string>();
  for (const admin of admins) {
    if (admin.telegram_id && admin.status !== "disabled" && admin.can_use_bot) ids.add(String(admin.telegram_id));
  }
  for (const id of (settings.bot_owner_ids || "").split(/[\s,]+/)) {
    if (id.trim()) ids.add(id.trim());
  }
  const envIds = (process.env.TELEGRAM_ADMIN_IDS || "").split(/[\s,]+/);
  for (const id of envIds) if (id.trim()) ids.add(id.trim());
  return [...ids];
}

export async function notifyAdmins(text: string, markup?: ReplyMarkup): Promise<void> {
  const ids = await adminChatIds();
  for (const id of ids) {
    await sendTelegramMessage(id, text, { reply_markup: markup });
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

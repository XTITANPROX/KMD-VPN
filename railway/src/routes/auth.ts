// Login / logout / session endpoints.

import { Hono } from "hono";
import { COOKIE_NAME, SESSION_TTL_HOURS, BOOTSTRAP_USERNAME, BOOTSTRAP_PASSWORD } from "../env.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { audit, getSetting, setSetting } from "../db/index.js";
import { countAdmins, createAdmin, getAdminByTelegram, getAdminByUsername, listAdmins, updateAdmin, verifyAdminLogin } from "../services/store.js";
import {
  clearFailedLogins,
  consumeLoginCode,
  createSession,
  destroySession,
  issueLoginCode,
  loginAllowed,
  loginBlockedFor,
  recordFailedLogin,
} from "../services/auth.js";
import { clientIp, ok, readJson, requireAdmin, safe, sessionTokenFrom, type AppVariables } from "../middleware.js";
import { sendTelegramMessage } from "../services/telegram.js";

export const authRoutes = new Hono<{ Variables: AppVariables }>();

/* --------------------------- first run bootstrap ------------------------ */

authRoutes.get(
  "/status",
  safe(async (c) => {
    const total = await countAdmins();
    return ok(c, {
      installed: total > 0,
      login_captcha: (await getSetting("login_captcha", "false")) === "true",
      default_credentials: (await getSetting("default_credentials", "false")) === "true",
      panel_name: await getSetting("panel_name", "KalFetela"),
      panel_path: await getSetting("panel_path", "/KalFetela"),
      brand_tagline: await getSetting("brand_tagline", ""),
    });
  })
);

/** Creates the first owner account (only while the admins table is empty). */
authRoutes.post(
  "/install",
  safe(async (c) => {
    const total = await countAdmins();
    const body = await readJson(c);
    const username = String(body.username ?? BOOTSTRAP_USERNAME ?? "").trim();
    const password = String(body.password ?? BOOTSTRAP_PASSWORD ?? "");
    if (total > 0) return c.json({ error: "پنل قبلاً نصب شده است", code: "already_installed" }, 409);
    if (username.length < 3) return c.json({ error: "نام کاربری باید حداقل ۳ کاراکتر باشد", code: "validation" }, 400);
    if (password.length < 6) return c.json({ error: "رمز عبور باید حداقل ۶ کاراکتر باشد", code: "validation" }, 400);
    const admin = await createAdmin({ username, password, role: "owner", canManageAdmins: true, canManageNodes: true });
    const { token } = await createSession(admin.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null });
    await audit({ adminId: admin.id, actor: username, action: "install", ip: clientIp(c) });
    setSessionCookie(c, token);
    return ok(c, { admin: publicAdmin(admin) }, 201);
  })
);

/* -------------------------------- login -------------------------------- */

authRoutes.post(
  "/login",
  safe(async (c) => {
    const ip = clientIp(c);
    const max = Number(await getSetting("login_rate_limit", "6")) || 6;
    if (!loginAllowed(ip, max)) {
      return c.json(
        { error: `تلاش‌های ناموفق زیاد بود. ${loginBlockedFor(ip)} ثانیه دیگر تلاش کنید`, code: "rate_limited" },
        429
      );
    }
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const admin = await verifyAdminLogin(username, password);
    if (!admin) {
      recordFailedLogin(ip, max);
      await audit({ actor: username, action: "login_failed", ip });
      return c.json({ error: "نام کاربری یا رمز عبور اشتباه است", code: "invalid_credentials" }, 401);
    }
    await updateAdmin(admin.id, { last_login_ip: ip });

    const twoFactor = (await getSetting("security_2fa", "false")) === "true";
    if (twoFactor && admin.telegram_id) {
      const code = issueLoginCode(admin.id, "login");
      await sendTelegramMessage(admin.telegram_id, `🔐 کد ورود پنل KalFetela: <b>${code}</b>\n(۵ دقیقه اعتبار دارد)`);
      return ok(c, { two_factor: true, message: "کد تایید به تلگرام شما ارسال شد" });
    }

    clearFailedLogins(ip);
    const { token } = await createSession(admin.id, { ip, userAgent: c.req.header("user-agent") ?? null });
    setSessionCookie(c, token);
    await audit({ adminId: admin.id, actor: admin.username, action: "login", ip });
    return ok(c, { admin: publicAdmin(admin) });
  })
);

authRoutes.post(
  "/verify-code",
  safe(async (c) => {
    const body = await readJson(c);
    const code = String(body.code ?? "").trim();
    const username = String(body.username ?? "").trim();
    const adminId = consumeLoginCode(code, "login");
    if (!adminId) return c.json({ error: "کد نامعتبر یا منقضی شده است", code: "invalid_code" }, 400);
    const admins = await listAdmins();
    const admin = admins.find((item) => item.id === adminId && (!username || item.username === username));
    if (!admin) return c.json({ error: "حساب یافت نشد", code: "not_found" }, 404);
    const { token } = await createSession(admin.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null });
    setSessionCookie(c, token);
    return ok(c, { admin: publicAdmin(admin) });
  })
);

/** Sends a one-time login code to the admin's telegram account. */
authRoutes.post(
  "/telegram-code",
  safe(async (c) => {
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    const admin = await getAdminByUsername(username);
    if (!admin || !admin.telegram_id) return c.json({ error: "برای این حساب تلگرام ثبت نشده است", code: "no_telegram" }, 400);
    const code = issueLoginCode(admin.id, "login");
    await sendTelegramMessage(admin.telegram_id, `🔐 کد ورود پنل KalFetela: <b>${code}</b>\n(۵ دقیقه اعتبار دارد)`);
    return ok(c, { message: "کد ورود ارسال شد" });
  })
);

/* ------------------------------- session ------------------------------- */

authRoutes.get(
  "/me",
  requireAdmin,
  safe(async (c) => {
    const admin = c.get("admin");
    const defaultPassword = await defaultPasswordFlag();
    return ok(c, {
      admin: { ...publicAdmin(admin), default_password: defaultPassword },
      panel_path: await getSetting("panel_path", "/KalFetela"),
      permissions: {
        owner: admin.role === "owner",
        nodes: admin.role === "owner" || Boolean(admin.can_manage_nodes),
        admins: admin.role === "owner" || Boolean(admin.can_manage_admins),
        bot: admin.role === "owner" || Boolean(admin.can_use_bot),
      },
    });
  })
);

authRoutes.post(
  "/logout",
  safe(async (c) => {
    await destroySession(sessionTokenFrom(c));
    c.header("set-cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return ok(c, { message: "خارج شدید" });
  })
);

authRoutes.post(
  "/password",
  requireAdmin,
  safe(async (c) => {
    const admin = c.get("admin");
    const body = await readJson(c);
    const current = String(body.current_password ?? "");
    const next = String(body.new_password ?? "");
    if (!verifyPassword(current, admin.password_hash)) {
      return c.json({ error: "رمز عبور فعلی اشتباه است", code: "invalid_password" }, 400);
    }
    if (next.length < 6) return c.json({ error: "رمز عبور جدید باید حداقل ۶ کاراکتر باشد", code: "validation" }, 400);
    await updateAdmin(admin.id, { password: next });
    await setSetting("default_credentials", "false");
    await audit({ adminId: admin.id, actor: admin.username, action: "password_change", ip: clientIp(c) });
    return ok(c, { message: "رمز عبور تغییر کرد" });
  })
);

/** Links the current admin account to a Telegram chat id (for alerts/2FA). */
authRoutes.post(
  "/telegram-link",
  requireAdmin,
  safe(async (c) => {
    const admin = c.get("admin");
    const body = await readJson(c);
    const telegramId = String(body.telegram_id ?? "").replace(/[^\d-]/g, "");
    if (!telegramId) return c.json({ error: "آیدی تلگرام نامعتبر است", code: "validation" }, 400);
    const owner = await getAdminByTelegram(telegramId);
    if (owner && owner.id !== admin.id) return c.json({ error: "این آیدی به حساب دیگری وصل است", code: "conflict" }, 409);
    await updateAdmin(admin.id, { telegram_id: telegramId });
    return ok(c, { message: "تلگرام متصل شد" });
  })
);

/* ------------------------------- helpers ------------------------------- */

function publicAdmin(admin: {
  id: number;
  username: string;
  role: string;
  credit: number;
  quota_bytes: number;
  used_bytes: number;
  max_users: number;
  status: string;
  telegram_id: string | null;
  can_manage_nodes: number;
  can_manage_admins: number;
  can_use_bot: number;
  first_name?: string | null;
  last_name?: string | null;
  last_login_at?: number | null;
  default_password?: boolean;
}) {
  return {
    id: admin.id,
    username: admin.username,
    role: admin.role,
    credit: admin.credit,
    quota_bytes: admin.quota_bytes,
    used_bytes: admin.used_bytes,
    max_users: admin.max_users,
    status: admin.status,
    telegram_id: admin.telegram_id,
    can_manage_nodes: Boolean(admin.can_manage_nodes),
    can_manage_admins: Boolean(admin.can_manage_admins),
    can_use_bot: Boolean(admin.can_use_bot),
    first_name: admin.first_name ?? null,
    last_name: admin.last_name ?? null,
    last_login_at: admin.last_login_at ?? null,
    default_password: admin.default_password === true,
  };
}

export async function defaultPasswordFlag(): Promise<boolean> {
  return (await getSetting("default_credentials", "false")) === "true";
}

export function setSessionCookie(c: { header: (name: string, value: string) => void }, token: string): void {
  const secure = process.env.COOKIE_INSECURE === "true" ? "" : " Secure";
  c.header(
    "set-cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}; HttpOnly; SameSite=Lax${secure}`
  );
}

export { hashPassword };

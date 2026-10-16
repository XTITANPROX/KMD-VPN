// Panel settings, backups, audit log, API tokens and maintenance helpers.

import { Hono } from "hono";
import { audit, getDb, getSettings, setSettings } from "../db/index.js";
import { DEFAULT_SETTINGS } from "../db/schema.js";
import { nowSeconds } from "../lib/format.js";
import { clientIp, ok, readJson, requireAdmin, requireOwner, safe, type AppVariables } from "../middleware.js";
import { createApiToken, deleteApiToken, listApiTokens } from "../services/store.js";
import { createBackup, dumpDatabase, listBackups, pruneBackups, readBackup, restoreBackup } from "../services/backup.js";
import { bot } from "../services/bot.js";
import { getBotInfo, notifyAdmins } from "../services/telegram.js";
import { embeddedXray } from "../services/clients/local.js";

export const settingsRoutes = new Hono<{ Variables: AppVariables }>();

settingsRoutes.use("*", requireAdmin);

const SECRET_KEYS = ["bot_token", "usdt_wallet"];

settingsRoutes.get(
  "/",
  safe(async (c) => {
    const settings = await getSettings();
    const admin = c.get("admin");
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      const isSecret = SECRET_KEYS.includes(key) && value;
      out[key] = isSecret && admin.role !== "owner" ? "••••••" : value;
    }
    return ok(c, {
      settings: out,
      defaults: DEFAULT_SETTINGS,
      panel_url: process.env.PUBLIC_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN ?? "",
      env_overrides: {
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
        XRAY_ENABLED: process.env.XRAY_ENABLED ?? "auto",
        PANEL_SECRET_SET: Boolean(process.env.PANEL_SECRET),
        AGENT_SECRET_SET: Boolean(process.env.AGENT_SECRET),
        RAILWAY: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
      },
    });
  })
);

settingsRoutes.put(
  "/",
  safe(async (c) => {
    const admin = c.get("admin");
    const body = await readJson(c);
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === "settings" && typeof value === "object" && value !== null) {
        for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
          if (innerKey === "bot_token" && admin.role !== "owner" && String(innerValue).startsWith("•")) continue;
          values[innerKey] = innerValue === null || innerValue === undefined ? "" : String(innerValue);
        }
        continue;
      }
      if (key === "bot_token" && admin.role !== "owner" && String(value).startsWith("•")) continue;
      values[key] = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    await setSettings(values);
    await audit({ adminId: admin.id, actor: admin.username, action: "settings_update", meta: Object.keys(values), ip: clientIp(c) });
    return ok(c, { updated: Object.keys(values).length });
  })
);

/* --------------------------------- bot --------------------------------- */

settingsRoutes.get(
  "/bot/status",
  safe(async (c) => {
    const settings = await getSettings();
    const info = settings.bot_token ? await getBotInfo() : null;
    return ok(c, {
      polling: bot.isRunning(),
      token_set: Boolean(settings.bot_token || process.env.TELEGRAM_BOT_TOKEN),
      info,
      shop_enabled: settings.bot_shop_enabled === "true",
      owners: settings.bot_owner_ids,
    });
  })
);

settingsRoutes.post(
  "/bot/connect",
  requireOwner,
  safe(async (c) => {
    const body = await readJson(c);
    const token = String(body.token ?? "").trim();
    if (!token) return c.json({ error: "توکن ربات را وارد کنید", code: "validation" }, 400);
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
    const data = (await response.json()) as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string };
    if (!data.ok) return c.json({ error: data.description ?? "توکن نامعتبر است", code: "invalid_token" }, 400);
    await setSettings({ bot_token: token });
    bot.stop();
    void bot.start();
    await notifyAdmins(`🤖 ربات ${data.result?.username ? `@${data.result.username}` : ""} به پنل متصل شد.`);
    return ok(c, { info: data.result });
  })
);

settingsRoutes.post(
  "/bot/disconnect",
  requireOwner,
  safe(async (c) => {
    await setSettings({ bot_token: "" });
    bot.stop();
    return ok(c, { message: "ربات قطع شد" });
  })
);

settingsRoutes.post(
  "/bot/test",
  safe(async (c) => {
    const body = await readJson(c);
    const chatId = String(body.chat_id ?? "").trim();
    const text = String(body.text ?? "✅ پیام تست از پنل KalFetela");
    if (chatId) {
      const { sendTelegramMessage } = await import("../services/telegram.js");
      await sendTelegramMessage(chatId, text);
      return ok(c, { message: "پیام تست ارسال شد" });
    }
    await notifyAdmins(text);
    return ok(c, { message: "پیام تست برای مدیران ارسال شد" });
  })
);

/* ------------------------------ backups -------------------------------- */

settingsRoutes.get(
  "/backup/download",
  safe(async (c) => {
    const name = c.req.query("name");
    if (name) {
      const payload = readBackup(name);
      if (!payload) return c.json({ error: "بکاپ پیدا نشد", code: "not_found" }, 404);
      return c.body(JSON.stringify(payload, null, 2), 200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      });
    }
    const payload = await dumpDatabase();
    return c.body(JSON.stringify(payload, null, 2), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="kalfetela-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  })
);

settingsRoutes.get(
  "/backups",
  safe(async (c) => {
    return ok(c, { backups: listBackups() });
  })
);

settingsRoutes.post(
  "/backups",
  requireOwner,
  safe(async (c) => {
    const result = await createBackup("manual");
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "backup_create", meta: result, ip: clientIp(c) });
    return ok(c, result, 201);
  })
);

settingsRoutes.post(
  "/restore",
  requireOwner,
  safe(async (c) => {
    const body = await readJson(c);
    let payload = null;
    if (typeof body.payload === "object" && body.payload) payload = body.payload as never;
    else if (body.name) payload = readBackup(String(body.name)) as never;
    if (!payload) return c.json({ error: "فایل یا نام بکاپ را مشخص کنید", code: "validation" }, 400);
    const inserted = await restoreBackup(payload, { wipe: body.wipe !== false });
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "backup_restore", meta: inserted, ip: clientIp(c) });
    return ok(c, { inserted });
  })
);

settingsRoutes.delete(
  "/backups",
  requireOwner,
  safe(async (c) => {
    const removed = pruneBackups(0);
    return ok(c, { removed });
  })
);

/* -------------------------------- audit -------------------------------- */

settingsRoutes.get(
  "/audit",
  safe(async (c) => {
    const limit = Math.min(500, Number(c.req.query("limit") ?? 100));
    const rows = await getDb().all(
      "SELECT a.id, a.action, a.target, a.meta, a.ip, a.created_at, ad.username AS actor FROM audit_log a LEFT JOIN admins ad ON ad.id = a.admin_id ORDER BY a.id DESC LIMIT ?",
      [limit]
    );
    return ok(c, { entries: rows });
  })
);

/* ------------------------------ API tokens ----------------------------- */

settingsRoutes.get(
  "/tokens",
  safe(async (c) => {
    const tokens = await listApiTokens();
    return ok(c, { tokens: tokens.map((token) => ({ ...token, token: `${token.token.slice(0, 10)}…` })) });
  })
);

settingsRoutes.post(
  "/tokens",
  requireOwner,
  safe(async (c) => {
    const body = await readJson(c);
    const token = await createApiToken(
      String(body.name ?? "API"),
      String(body.scopes ?? "*"),
      c.get("admin").id,
      body.expires_at ? Number(body.expires_at) : null
    );
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "token_create", target: token.name, ip: clientIp(c) });
    return ok(c, { token: token.token, id: token.id }, 201);
  })
);

settingsRoutes.delete(
  "/tokens/:id",
  requireOwner,
  safe(async (c) => {
    await deleteApiToken(Number(c.req.param("id")));
    return ok(c, { message: "کلید حذف شد" });
  })
);

/* --------------------------- xray rule helpers ------------------------- */

settingsRoutes.get(
  "/xray-rules",
  safe(async (c) => {
    const settings = await getSettings();
    const blocked = (settings.blocked_domains || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const direct = (settings.direct_domains || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const rules = [
      ...(settings.xray_block_ads === "true" ? [{ type: "field", outboundTag: "block", domain: ["geosite:category-ads-all"] }] : []),
      ...(blocked.length ? [{ type: "field", outboundTag: "block", domain: blocked }] : []),
      {
        type: "field",
        outboundTag: "direct",
        domain: ["geosite:category-ir", "domain:.ir", "regexp:.*\\.ir$", ...direct],
      },
      { type: "field", outboundTag: "direct", ip: ["geoip:ir"] },
    ];
    return ok(c, { rules: JSON.stringify(rules, null, 2), blocked, direct });
  })
);

/* ----------------------------- maintenance ----------------------------- */

settingsRoutes.post(
  "/maintenance",
  requireOwner,
  safe(async (c) => {
    const body = await readJson(c);
    const action = String(body.action ?? "");
    const db = getDb();
    switch (action) {
      case "purge-traffic": {
        const days = Number(body.days ?? 90);
        const cutoff = new Date((nowSeconds() - days * 86400) * 1000).toISOString().slice(0, 10);
        const result = await db.run("DELETE FROM traffic_log WHERE day < ?", [cutoff]);
        return ok(c, { removed: result.changes });
      }
      case "purge-sessions": {
        const result = await db.run("DELETE FROM sessions WHERE expires_at < ?", [nowSeconds()]);
        return ok(c, { removed: result.changes });
      }
      case "purge-devices": {
        const result = await db.run("DELETE FROM devices WHERE seen_at < ?", [nowSeconds() - 7 * 86400]);
        return ok(c, { removed: result.changes });
      }
      case "vacuum": {
        if (db.dialect === "sqlite") await db.exec("VACUUM;");
        return ok(c, { message: "بهینه‌سازی انجام شد" });
      }
      case "restart-xray": {
        await embeddedXray.restart();
        return ok(c, { message: "هسته Xray ری‌استارت شد" });
      }
      default:
        return c.json({ error: "عملیات ناشناخته", code: "validation" }, 400);
    }
  })
);

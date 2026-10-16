// Public routes: subscription feeds, landing data, node-agent API.

import { Hono } from "hono";
import { audit, getDb, getSetting, getSettings } from "../db/index.js";
import { AGENT_SECRET, PUBLIC_URL } from "../env.js";
import { nowSeconds } from "../lib/format.js";
import { agentAuthorized, clientIp, observeBase, ok, readJson, requestBase, safe } from "../middleware.js";
import { CLIENT_APPS, SETUP_STEPS } from "../lib/clients.js";
import { qrSvg } from "../lib/qr.js";
import { applyUsage, createTicket, getNode, getUserBySubToken, listPlans, listUsers, refreshUserStatus, updateNode } from "../services/store.js";
import { buildClashConfig, buildLinks, buildSingboxConfig, buildXrayConfig, subscriptionHtml, subscriptionPayload } from "../services/links.js";
import { wireguardKeysForUser, wireguardNodePayload } from "../services/wireguard.js";
import { subscriptionUrls } from "./users.js";
import type { NodeRow, UserRow } from "../types.js";

export const publicRoutes = new Hono();

publicRoutes.use("*", async (c, next) => {
  // remember the host we are served from (Railway domains change)
  c.req.path.startsWith("/api/public") || c.req.path.startsWith("/sub") ? await observeBase(c) : undefined;
  await next();
});

/* ---------------------------- subscriptions ---------------------------- */

function detectFormat(userAgent: string, explicit?: string | null): string {
  if (explicit) return explicit;
  const ua = userAgent.toLowerCase();
  if (ua.includes("clash") || ua.includes("mihomo") || ua.includes("stash")) return "clash";
  if (ua.includes("sing-box") || ua.includes("singbox") || ua.includes("hiddify")) return "singbox";
  if (ua.includes("shadowrocket") || ua.includes("quantumult")) return "raw";
  if (ua.includes("v2rayng") || ua.includes("v2ray") || ua.includes("nekobox") || ua.includes("streisand")) return "raw";
  return "base64";
}

async function userNodesFor(user: UserRow): Promise<NodeRow[]> {
  const rows = await getDb().all<NodeRow>(
    `SELECT n.* FROM nodes n JOIN user_nodes un ON un.node_id = n.id WHERE un.user_id = ? AND n.active = 1 ORDER BY n.sort ASC`,
    [user.id]
  );
  if (rows.length) return rows;
  return getDb().all<NodeRow>("SELECT * FROM nodes WHERE active = 1 ORDER BY sort ASC LIMIT 1");
}

export async function subscriptionResponse(user: UserRow, format: string, userAgent: string, origin = ""): Promise<{ body: string; contentType: string }> {
  const settings = await getSettings();
  const nodes = await userNodesFor(user);
  const options = {
    title: settings.panel_name,
    routeIran: settings.xray_route_iran === "true",
    blockAds: settings.xray_block_ads === "true",
    fragment: settings.xray_fragment,
    extraDirectDomains: (settings.direct_domains || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    wireguardKeys: await wireguardKeysForUser(user.id),
  };
  const resolved = detectFormat(userAgent, format);
  switch (resolved) {
    case "clash":
      return { body: buildClashConfig(user, nodes, options), contentType: "text/yaml; charset=utf-8" };
    case "singbox":
    case "sing-box":
      return { body: buildSingboxConfig(user, nodes, options), contentType: "application/json; charset=utf-8" };
    case "xray":
      return { body: buildXrayConfig(user, nodes, options), contentType: "application/json; charset=utf-8" };
    case "raw":
      return {
        body: buildLinks(user, nodes, options)
          .map((entry) => entry.link)
          .join("\n"),
        contentType: "text/plain; charset=utf-8",
      };
    case "page": {
      const base = `${origin || (PUBLIC_URL ? `https://${PUBLIC_URL}` : "")}/sub/${user.sub_token}`;
      const urls = {
        base64: base,
        clash: `${base}?format=clash`,
        singbox: `${base}?format=singbox`,
        xray: `${base}?format=xray`,
        raw: `${base}?format=raw`,
      };
      return {
        body: subscriptionHtml(user, buildLinks(user, nodes, options), {
          panelName: settings.panel_name,
          supportId: settings.support_id,
          subscriptionUrl: base,
          announce: settings.announcement_active === "true" ? settings.announcement : undefined,
          formats: [
            { key: "base64", label: "ساب Base64", url: urls.base64 },
            { key: "clash", label: "Clash / Mihomo", url: urls.clash },
            { key: "singbox", label: "sing-box", url: urls.singbox },
            { key: "xray", label: "Xray", url: urls.xray },
            { key: "raw", label: "لینک خام", url: urls.raw },
          ],
          deep: { raw: urls.raw, clash: urls.clash, singbox: urls.singbox, xray: urls.xray },
          note: settings.support_channel ? `کانال: ${settings.support_channel}` : undefined,
        }),
        contentType: "text/html; charset=utf-8",
      };
    }
    default:
      return { body: subscriptionPayload(buildLinks(user, nodes, options)), contentType: "text/plain; charset=utf-8" };
  }
}

publicRoutes.get(
  "/sub/:token",
  safe(async (c) => {
    const token = String(c.req.param("token")).replace(/\.(txt|yaml|yml|json|conf)$/, "");
    const user = await getUserBySubToken(token);
    if (!user) return c.text("لینک اشتراک نامعتبر است", 404);
    await refreshUserStatus(user.id);
    const fresh = (await getUserBySubToken(token))!;
    if (["expired", "limited", "disabled", "on_hold"].includes(fresh.status)) {
      const settings = await getSettings();
      const message =
        fresh.status === "expired"
          ? "⏳ اعتبار سرویس شما به پایان رسیده است."
          : fresh.status === "limited"
            ? "📉 حجم سرویس شما تمام شده است."
            : "⛔️ این سرویس غیرفعال شده است.";
      if ((c.req.query("format") ?? "") === "page") {
        return c.html(
          `<html dir="rtl"><body style="font-family:system-ui;background:#0b1220;color:#e6edf7;display:grid;place-items:center;height:100vh">
            <div style="text-align:center"><h2>${settings.panel_name}</h2><p>${message}</p><p>پشتیبانی: ${settings.support_id}</p></div></body></html>`,
          403
        );
      }
      return c.text(message, 403);
    }
    const { body, contentType } = await subscriptionResponse(fresh, c.req.query("format") ?? "", c.req.header("user-agent") ?? "", requestBase(c));
    const headers: Record<string, string> = {
      "content-type": contentType,
      "cache-control": "no-store",
      "profile-title": `base64:${Buffer.from(await getSetting("panel_name", "KalFetela")).toString("base64")}`,
      "profile-update-interval": "12",
      "subscription-userinfo": `upload=${fresh.upload_bytes}; download=${fresh.download_bytes}; total=${fresh.data_limit_bytes}; expire=${fresh.expires_at ?? 0}`,
      "profile-web-page-url": `${requestBase(c) || (PUBLIC_URL ? `https://${PUBLIC_URL}` : "")}/sub/${fresh.sub_token}?format=page`,
    };
    if (fresh.status === "limited" || fresh.status === "expired") headers["content-disposition"] = "attachment";
    return c.body(body, 200, headers);
  })
);

/** JSON info endpoint used by the subscription page and third-party apps. */
publicRoutes.get(
  "/sub/:token/info",
  safe(async (c) => {
    const user = await getUserBySubToken(String(c.req.param("token")));
    if (!user) return c.json({ error: "not found" }, 404);
    const nodes = await userNodesFor(user);
    return ok(c, {
      username: user.username,
      status: user.status,
      used_bytes: user.data_used_bytes,
      limit_bytes: user.data_limit_bytes,
      expires_at: user.expires_at,
      device_limit: user.device_limit,
      nodes: nodes.map((node) => ({ id: node.id, name: node.name, protocol: node.protocol, host: node.host, port: node.port })),
      subscriptions: await subscriptionUrls(user, requestBase(c)),
    });
  })
);

/* ------------------------------ landing data --------------------------- */

publicRoutes.get(
  "/api/public/info",
  safe(async (c) => {
    const settings = await getSettings();
    return ok(c, {
      panel_name: settings.panel_name,
      tagline: settings.brand_tagline,
      support_id: settings.support_id,
      support_link: settings.support_link,
      channel_link: settings.channel_link,
      server_location: settings.server_location,
      announcement: settings.announcement_active === "true" ? settings.announcement : "",
      shop_enabled: settings.bot_shop_enabled === "true",
      registration: settings.register_enabled === "true",
      trial: settings.trial_enabled === "true",
      bot_username: settings.bot_token ? "" : "",
      card: settings.card_number ? { number: settings.card_number, holder: settings.card_holder } : null,
      plans: (await listPlans(true)).map((plan) => ({
        id: plan.id,
        name: plan.name,
        price: plan.price,
        days: plan.days,
        data_gb: plan.data_gb,
        device_limit: plan.device_limit,
        protocol: plan.protocol,
        description: plan.description,
        icon: plan.icon,
      })),
    });
  })
);

/** Contact form → creates a support ticket. */
publicRoutes.post(
  "/api/public/ticket",
  safe(async (c) => {
    const body = await readJson(c);
    const ip = clientIp(c);
    const recent = await getDb().get<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM tickets WHERE created_at >= ? AND telegram_id = ?",
      [nowSeconds() - 900, `web:${ip}`]
    );
    if (Number(recent?.count ?? 0) >= 3) {
      return c.json({ error: "تعداد پیام‌ها زیاد است، کمی بعد تلاش کنید", code: "rate_limited" }, 429);
    }
    const ticket = await createTicket({
      subject: String(body.subject ?? "پیام از سایت").slice(0, 120),
      body: String(body.message ?? "").slice(0, 4000),
      telegramId: `web:${ip}`,
      name: String(body.name ?? "").slice(0, 64) || "بازدیدکننده",
      category: String(body.category ?? "other"),
    });
    const { notifyAdmins } = await import("../services/telegram.js");
    await notifyAdmins(`🌐 پیام جدید از سایت (تیکت #${ticket.id})\n👤 ${ticket.name}\n📝 ${ticket.subject}\n\n${String(body.message ?? "").slice(0, 800)}`);
    return ok(c, { ticket_id: ticket.id }, 201);
  })
);

/** Self-service signup with trial (when enabled). */
publicRoutes.post(
  "/api/public/register",
  safe(async (c) => {
    if ((await getSetting("register_enabled", "false")) !== "true") {
      return c.json({ error: "ثبت‌نام عمومی غیرفعال است", code: "disabled" }, 403);
    }
    const body = await readJson(c);
    const username = String(body.username ?? "").trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      return c.json({ error: "نام کاربری نامعتبر است", code: "validation" }, 400);
    }
    const existing = await getDb().get("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) return c.json({ error: "این نام کاربری موجود است", code: "conflict" }, 409);
    const { createUser } = await import("../services/store.js");
    const { randomUuid, randomToken } = await import("../lib/crypto.js");
    const { gbToBytes } = await import("../lib/validate.js");
    const { syncUser } = await import("../services/nodes.js");
    const trialDays = Number(await getSetting("trial_days", "1"));
    const trialGb = Number(await getSetting("trial_gb", "1"));
    const trialEnabled = (await getSetting("trial_enabled", "true")) === "true";
    const user = await createUser({
      username,
      uuid: randomUuid(),
      password: randomToken(8),
      telegramId: body.telegram_id ? String(body.telegram_id) : null,
      dataLimitBytes: trialEnabled ? gbToBytes(trialGb) : 0,
      days: trialEnabled ? trialDays : 0,
      deviceLimit: 1,
      note: "ثبت‌نام از سایت",
    });
    await syncUser(user.id);
    await audit({ actor: `web:${clientIp(c)}`, action: "public_register", target: username });
    return ok(c, { user: { id: user.id, username: user.username }, subscriptions: await subscriptionUrls(user) }, 201);
  })
);

/* --------------------------- node agent API ---------------------------- */

publicRoutes.use("/api/agent/*", async (c, next) => {
  if (!agentAuthorized(c)) return c.json({ error: "کلید ایجنت نامعتبر است", code: "unauthorized" }, 401);
  await next();
});

/** Pull model: an agent asks what it should run. */
publicRoutes.get(
  "/api/agent/config",
  safe(async (c) => {
    const nodeId = Number(c.req.query("node_id") ?? 0);
    const node = nodeId ? await getNode(nodeId) : (await getDb().get<NodeRow>("SELECT * FROM nodes WHERE kind = 'agent' ORDER BY id ASC LIMIT 1"));
    if (!node) return c.json({ error: "نودی با نوع agent ثبت نشده است", code: "not_found" }, 404);
    const users = await getDb().all<UserRow>(
      `SELECT u.* FROM users u JOIN user_nodes un ON un.user_id = u.id WHERE un.node_id = ? AND u.status NOT IN ('disabled','on_hold')`,
      [node.id]
    );
    const settings = await getSettings();
    return ok(c, {
      node: {
        id: node.id,
        name: node.name,
        protocol: node.protocol,
        transport: node.transport,
        security: node.security,
        port: node.port,
        sni: node.sni,
        path: node.path,
        service_name: node.service_name,
        flow: node.flow,
        reality: node.security === "reality"
          ? {
              privateKey: node.reality_private_key,
              shortIds: node.reality_short_id ? [node.reality_short_id] : [],
              dest: node.reality_dest,
            }
          : null,
      },
      clients: users.map((user) => ({
        email: user.username,
        uuid: user.uuid,
        password: user.password,
        limitBytes: user.data_limit_bytes,
        usedBytes: user.data_used_bytes,
        expiresAt: user.expires_at,
        deviceLimit: user.device_limit,
      })),
      settings: {
        log_level: settings.xray_log_level,
        dns: settings.xray_dns,
        route_iran: settings.xray_route_iran === "true",
        block_ads: settings.xray_block_ads === "true",
      },
    });
  })
);

/** Agents push traffic/health reports back to the panel. */
publicRoutes.post(
  "/api/agent/report",
  safe(async (c) => {
    const body = await readJson(c);
    const nodeId = Number(body.node_id ?? 0);
    const node = nodeId ? await getNode(nodeId) : undefined;
    const usages = Array.isArray(body.usages) ? (body.usages as Array<Record<string, unknown>>) : [];
    let applied = 0;
    for (const usage of usages) {
      const email = String(usage.email ?? "");
      const upload = Number(usage.upload ?? 0);
      const download = Number(usage.download ?? 0);
      if (!email || upload + download <= 0) continue;
      const user = await getDb().get<UserRow>("SELECT * FROM users WHERE username = ?", [email]);
      if (!user) continue;
      await applyUsage(user.id, upload, download, { nodeId: node?.id ?? null, adminId: user.admin_id });
      applied += 1;
    }
    if (node) {
      await updateNode(node.id, {
        status: "online",
        last_heartbeat_at: nowSeconds(),
        cpu_load: body.cpu !== undefined ? Number(body.cpu) : null,
        mem_load: body.mem !== undefined ? Number(body.mem) : null,
        uptime_seconds: body.uptime !== undefined ? Number(body.uptime) : null,
        core_version: body.version ? String(body.version) : null,
      });
    }
    return ok(c, { applied, server_time: nowSeconds() });
  })
);

/**
 * WireGuard payload for an agent: server config + peer table (keys are created
 * on demand). `?create=false` only reports peers that already have keys.
 */
publicRoutes.get(
  "/api/agent/wireguard/:nodeId",
  safe(async (c) => {
    const node = await getNode(Number(c.req.param("nodeId")));
    if (!node) return c.json({ error: "not found" }, 404);
    if (node.protocol !== "wireguard") return c.json({ error: "این نود WireGuard نیست", code: "wrong_protocol" }, 400);
    const users = await listUsers({ perPage: 500 });
    const payload = await wireguardNodePayload(node, users.items, { create: c.req.query("create") !== "false" });
    return ok(c, {
      node: node.name,
      node_id: node.id,
      server_address: payload.server_address,
      server_public_key: payload.server_public_key,
      port: payload.port,
      dns: node.dns || "",
      mtu: node.mtu ?? null,
      peers: payload.peers.map((peer) => ({
        email: peer.email,
        user_id: peer.user_id,
        address: peer.address,
        public_key: peer.public_key,
        enabled: peer.enabled,
        used_bytes: peer.data_used_bytes,
        limit_bytes: peer.data_limit_bytes,
        expires_at: peer.expires_at,
      })),
      config: payload.config,
    });
  })
);

/** Client apps + setup guide, consumed by the landing page and the panel. */
publicRoutes.get(
  "/api/public/apps",
  safe(async (c) => {
    return ok(c, { apps: CLIENT_APPS, steps: SETUP_STEPS });
  })
);

/** QR code rendering (UTF-8 text in the query string). */
publicRoutes.get(
  "/api/qr",
  safe(async (c) => {
    const data = c.req.query("data") ?? c.req.query("text") ?? "";
    if (!data) return c.json({ error: "پارامتر data لازم است", code: "validation" }, 400);
    if (data.length > 250) return c.json({ error: "متن طولانی است", code: "too_long" }, 400);
    const scale = Math.min(16, Math.max(2, Number(c.req.query("scale") ?? 6)));
    const light = c.req.query("dark") ?? "0b1220";
    const svg = qrSvg(data, { scale, dark: `#${light.replace(/^#/, "")}`, light: c.req.query("bg") === "transparent" ? "none" : "#ffffff" });
    return c.body(svg, 200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" });
  })
);

export { AGENT_SECRET };

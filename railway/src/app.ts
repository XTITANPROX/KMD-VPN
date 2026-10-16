// Route wiring for the KalFetela panel (kept separate from the server
// bootstrap so tests can exercise the API without opening a port).

import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { APP_NAME, APP_VERSION } from "./env.js";
import { getSetting } from "./db/index.js";
import { errorResponse } from "./middleware.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { nodeRoutes } from "./routes/nodes.js";
import { panelRoutes } from "./routes/panels.js";
import type { Context } from "hono";
import { planRoutes } from "./routes/plans.js";
import { adminRoutes } from "./routes/admins.js";
import { paymentRoutes } from "./routes/payments.js";
import { ticketRoutes } from "./routes/tickets.js";
import { settingsRoutes } from "./routes/settings.js";
import { systemRoutes } from "./routes/system.js";
import { publicRoutes } from "./routes/public.js";

const publicDir = new URL("../public/", import.meta.url).pathname.replace(/\/$/, "");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveFile(file: string, cache: string): Response | null {
  try {
    const data = fs.readFileSync(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
        "cache-control": cache,
        "x-panel": APP_VERSION,
      },
    });
  } catch {
    return null;
  }
}

export function createApp(options: { withLogger?: boolean } = {}): Hono {
  const app = new Hono();
  if (options.withLogger) app.use("*", logger());

  /* ------------------------------ JSON API ----------------------------- */
  app.route("/api/auth", authRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/nodes", nodeRoutes);
  app.route("/api/panels", panelRoutes);
  app.route("/api/plans", planRoutes);
  app.route("/api/admins", adminRoutes);
  app.route("/api/payments", paymentRoutes);
  app.route("/api/tickets", ticketRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/system", systemRoutes);

  /* ------------------------- public + static --------------------------- */
  app.route("/", publicRoutes);

  app.get("/healthz", (c) => c.json({ ok: true, name: APP_NAME, version: APP_VERSION }));
  app.get("/api/healthz", (c) => c.json({ ok: true }));

  /**
   * Admin panel HTML. Reachable at `/KalFetela` (primary), `/panel` and at the
   * custom `panel_path` setting, so the URL can be hidden like the reference
   * panels do (`/sp-admin-xxxx`).
   */
  const panelHandler = async (c: Context) => {
    const file = serveFile(path.join(publicDir, "panel.html"), "no-cache");
    if (!file) return c.text("panel.html missing", 500);
    const panelPath = await getSetting("panel_path", "/KalFetela");
    const html = await file.text();
    return c.html(html.replaceAll("%PANEL_PATH%", panelPath));
  };
  for (const route of ["/KalFetela", "/KalFetela/", "/panel", "/panel/"]) app.get(route, panelHandler);
  app.get("/kalfetela", panelHandler);

  app.get("/", async () => serveFile(path.join(publicDir, "landing.html"), "no-cache") ?? new Response("not found", { status: 404 }));

  for (const [route, file, cache] of [
    ["/app.js", "app.js", "no-cache"],
    ["/style.css", "style.css", "no-cache"],
    ["/icon.svg", "icon.svg", "public, max-age=86400"],
    ["/manifest.webmanifest", "manifest.webmanifest", "public, max-age=86400"],
    ["/sw.js", "sw.js", "no-cache"],
  ] as const) {
    app.get(route, () => serveFile(path.join(publicDir, file), cache) ?? new Response("not found", { status: 404 }));
  }

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/sub/")) {
      return c.json({ error: "مسیر پیدا نشد", code: "not_found" }, 404);
    }
    return c.redirect("/");
  });

  app.onError((error, c) => errorResponse(c, error));

  return app;
}

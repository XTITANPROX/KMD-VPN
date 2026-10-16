// KalFetela Panel — server bootstrap.
//
//   /                → landing page (plans, support, contact form)
//   /panel           → admin SPA
//   /sub/:token      → subscription feed (base64/raw/clash/singbox/xray/page)
//   /api/*           → JSON API (session cookie, bearer token or X-API-Key)
//   /api/agent/*     → node agent API (AGENT_SECRET)
//   /healthz         → health probe for Railway

import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { APP_NAME, APP_VERSION, HOST, PORT, PUBLIC_URL, XRAY_ENABLED } from "./env.js";
import { initDb } from "./db/index.js";
import { BOOTSTRAP_PASSWORD, BOOTSTRAP_USERNAME } from "./env.js";
import { pendingEmbeddedDeltas, startScheduler, stopScheduler } from "./services/scheduler.js";
import { bot } from "./services/bot.js";
import { embeddedXray } from "./services/clients/local.js";
import { setUserStatusHandler } from "./services/store.js";
import { statusEnforcement } from "./services/nodes.js";

export const app = createApp({ withLogger: true });

let server: ReturnType<typeof serve> | null = null;

async function bootstrapOwner(): Promise<void> {
  if (!BOOTSTRAP_USERNAME || !BOOTSTRAP_PASSWORD) return;
  const { countAdmins, createAdmin, getAdminByUsername } = await import("./services/store.js");
  if ((await countAdmins()) > 0) return;
  if (await getAdminByUsername(BOOTSTRAP_USERNAME)) return;
  await createAdmin({
    username: BOOTSTRAP_USERNAME,
    password: BOOTSTRAP_PASSWORD,
    role: "owner",
    canManageAdmins: true,
    canManageNodes: true,
  });
  console.log(`[bootstrap] owner account "${BOOTSTRAP_USERNAME}" created from environment`);
}

export async function bootstrap(): Promise<void> {
  await initDb();
  await bootstrapOwner();
  setUserStatusHandler(statusEnforcement);

  embeddedXray.onUsage((deltas) => {
    pendingEmbeddedDeltas.push(...deltas);
    if (pendingEmbeddedDeltas.length > 5000) {
      pendingEmbeddedDeltas.splice(0, pendingEmbeddedDeltas.length - 5000);
    }
  });

  if (XRAY_ENABLED) {
    try {
      await embeddedXray.start();
      const status = embeddedXray.status();
      console.log(`[xray] installed=${status.installed} running=${status.running} version=${status.version ?? "-"}`);
    } catch (error) {
      console.warn("[xray] start failed:", (error as Error).message);
    }
  }

  startScheduler();
  try {
    await bot.start();
  } catch (error) {
    console.warn("[bot] start failed:", (error as Error).message);
  }

  server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    console.log(`\n  ${APP_NAME} v${APP_VERSION}`);
    console.log("  ──────────────────────────────────────");
    console.log(`  پنل:        http://${info.address}:${info.port}/panel`);
    if (PUBLIC_URL) console.log(`  آدرس عمومی: https://${PUBLIC_URL}`);
    console.log(`  سلامت:      http://${info.address}:${info.port}/healthz\n`);
  });
}

function shutdown(signal: string): void {
  console.log(`\n[server] ${signal} — shutting down`);
  stopScheduler();
  bot.stop();
  embeddedXray.stop();
  server?.close();
  setTimeout(() => process.exit(0), 400);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain || process.env.FORCE_BOOTSTRAP === "true") {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => console.error("[unhandled]", reason));
  process.on("uncaughtException", (error) => console.error("[uncaught]", error));

  bootstrap().catch((error) => {
    console.error("[bootstrap] failed:", error);
    process.exit(1);
  });
}

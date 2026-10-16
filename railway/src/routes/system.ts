// System information, live stats stream and update check.

import os from "node:os";
import fs from "node:fs";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDb, getSetting } from "../db/index.js";
import { APP_NAME, APP_VERSION, DATA_DIR, IS_RAILWAY, XRAY_DIR } from "../env.js";
import { jalaliDateTime } from "../lib/format.js";
import { ok, requireAdmin, requireApiAuth, safe, type AppVariables } from "../middleware.js";
import { dashboardStats } from "../services/store.js";
import { embeddedXray } from "../services/clients/local.js";
import { checkUpdate, getUpdateInfo } from "../services/scheduler.js";
import { IS_RAILWAY as RAILWAY } from "../env.js";

export const systemRoutes = new Hono<{ Variables: AppVariables }>();

function diskUsage(dir: string): { total: number; free: number; used: number } | null {
  try {
    const stat = fs.statfsSync(dir);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

export async function systemInfo() {
  const db = getDb();
  const memory = { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() };
  const load = os.loadavg();
  const cpus = os.cpus();
  const disk = diskUsage(DATA_DIR) ?? diskUsage("/");
  const uptime = os.uptime();
  const embedded = embeddedXray.status();
  const usersRow = await db.get<{ count: number | string }>("SELECT COUNT(*) AS count FROM users");
  const trafficRow = await db.get<{ total: number | string | null }>(
    "SELECT SUM(data_used_bytes) AS total FROM users"
  );
  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      dialect: db.dialect,
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      railway: RAILWAY,
      started_at: startedAt,
    },
    cpu: {
      model: cpus[0]?.model ?? "unknown",
      cores: cpus.length,
      load1: Number(load[0]?.toFixed(2) ?? 0),
      load5: Number(load[1]?.toFixed(2) ?? 0),
      load15: Number(load[2]?.toFixed(2) ?? 0),
      usage_percent: Math.min(100, Math.round((load[0]! / Math.max(1, cpus.length)) * 100)),
    },
    memory: {
      total: memory.total,
      free: memory.free,
      used: memory.used,
      percent: Math.round((memory.used / memory.total) * 100),
    },
    disk: disk
      ? {
          total: disk.total,
          free: disk.free,
          used: disk.used,
          percent: disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0,
        }
      : null,
    process: {
      pid: process.pid,
      uptime_seconds: Math.floor(process.uptime()),
      rss: process.memoryUsage().rss,
      heap_used: process.memoryUsage().heapUsed,
    },
    host: {
      hostname: os.hostname(),
      uptime_seconds: uptime,
      region: process.env.RAILWAY_REGION ?? os.hostname(),
      service: process.env.RAILWAY_SERVICE_NAME ?? "kalfetela",
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? (IS_RAILWAY ? "railway" : "local"),
      provider: IS_RAILWAY ? "Railway" : "Unknown",
    },
    xray: embedded,
    data_dir: DATA_DIR,
    users: Number(usersRow?.count ?? 0),
    traffic_total: Number(trafficRow?.total ?? 0),
    stats: await dashboardStats(),
    server_time: jalaliDateTime(new Date()),
    update: getUpdateInfo(),
  };
}

let startedAt = Math.floor(Date.now() / 1000);

systemRoutes.get(
  "/info",
  requireApiAuth,
  safe(async (c) => ok(c, await systemInfo()))
);

/** Live metrics stream used by the dashboard (SSE). */
systemRoutes.get(
  "/stream",
  requireApiAuth,
  (c) =>
    streamSSE(c, async (stream) => {
      let stopped = false;
      stream.onAbort(() => {
        stopped = true;
      });
      while (!stopped) {
        try {
          const info = await systemInfo();
          await stream.writeSSE({
            event: "stats",
            data: JSON.stringify({
              cpu: info.cpu,
              memory: info.memory,
              disk: info.disk,
              xray: info.xray,
              online: info.stats.users.online,
              today_traffic: info.stats.traffic.today,
              series: info.stats.series.slice(-14),
            }),
          });
        } catch (error) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: (error as Error).message }) });
        }
        await stream.sleep(5000);
      }
    })
);

systemRoutes.get(
  "/update",
  requireApiAuth,
  safe(async (c) => {
    const latest = await checkUpdate();
    return ok(c, { current: APP_VERSION, latest });
  })
);

systemRoutes.get(
  "/logs",
  requireApiAuth,
  safe(async (c) => {
    const lines = Math.min(500, Number(c.req.query("lines") ?? 100));
    const readTail = (file: string) => {
      try {
        if (!fs.existsSync(file)) return "";
        const content = fs.readFileSync(file, "utf8");
        return content.split("\n").slice(-lines).join("\n");
      } catch {
        return "";
      }
    };
    return ok(c, {
      xray_error: readTail(`${XRAY_DIR}/error.log`),
      xray_access: readTail(`${XRAY_DIR}/access.log`),
      embedded: embeddedXray.status(),
    });
  })
);

systemRoutes.get(
  "/health",
  safe(async (c) => {
    const db = getDb();
    await db.get("SELECT 1 AS ok");
    return c.json({ ok: true, version: APP_VERSION, name: APP_NAME });
  })
);

systemRoutes.get(
  "/config-check",
  requireApiAuth,
  safe(async (c) => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const settings = {
      panel_name: await getSetting("panel_name", ""),
      support_id: await getSetting("support_id", ""),
    };
    checks.push({ name: "دیتابیس", ok: true, detail: getDb().dialect });
    checks.push({ name: "برند", ok: Boolean(settings.panel_name), detail: settings.panel_name });
    const xray = embeddedXray.status();
    checks.push({
      name: "هسته Xray",
      ok: xray.installed,
      detail: xray.installed ? `v${xray.version ?? "?"} — ${xray.running ? "در حال اجرا" : "متوقف"}` : "نصب نشده",
    });
    const nodes = await getDb().all<{ count: number | string }>("SELECT COUNT(*) AS count FROM nodes");
    checks.push({ name: "نودها", ok: Number(nodes[0]?.count ?? 0) > 0, detail: `${nodes[0]?.count ?? 0} نود` });
    const botToken = await getSetting("bot_token", "");
    checks.push({ name: "ربات تلگرام", ok: Boolean(botToken), detail: botToken ? "تنظیم شده" : "تنظیم نشده" });
    return ok(c, { checks });
  })
);

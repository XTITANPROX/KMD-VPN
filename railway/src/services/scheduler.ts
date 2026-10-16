// Background scheduler: quota enforcement, traffic collection, node health,
// notifications, backups and the update check.

import { getSetting, setSetting, utcDay } from "../db/index.js";
import { nowSeconds } from "../lib/format.js";
import { createBackup, pruneBackups } from "./backup.js";
import { bot } from "./bot.js";
import { notifyAdmins } from "./telegram.js";
import { applyTrafficReset, dashboardStats, enforceAdminQuotas, sweepExpired, recomputeAdminUsage, listAdmins } from "./store.js";
import { collectTraffic, enforceDeviceLimits, healthCheckAll } from "./nodes.js";
import { purgeExpiredSessions } from "./auth.js";
import { UPDATE_REPO, DISABLE_UPDATE_CHECK, APP_VERSION } from "../env.js";

interface Task {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
  lastRun?: number;
}

let timer: NodeJS.Timeout | null = null;
let lastBackupDay = "";

const tasks: Task[] = [
  {
    name: "quota-sweep",
    intervalMs: 60_000,
    run: async () => {
      const changed = await sweepExpired();
      for (const user of changed) {
        if (user.status === "limited" || user.status === "expired") {
          await notifyAdmins(`⛔️ سرویس <b>${user.username}</b> ${user.status === "limited" ? "به دلیل اتمام حجم" : "به دلیل انقضا"} غیرفعال شد.`);
        }
      }
    },
  },
  {
    name: "traffic-collect",
    intervalMs: 180_000,
    run: async () => {
      await collectTraffic();
      // flush the counters reported by the embedded Xray core
      const pending = pendingEmbeddedDeltas.splice(0, pendingEmbeddedDeltas.length);
      if (pending.length) {
        const { applyEmbeddedUsage } = await import("./nodes.js");
        await applyEmbeddedUsage(pending);
      }
    },
  },
  {
    name: "node-health",
    intervalMs: 300_000,
    run: async () => {
      await healthCheckAll();
    },
  },
  {
    name: "device-limits",
    intervalMs: 120_000,
    run: async () => {
      const violations = await enforceDeviceLimits();
      for (const violation of violations) {
        await notifyAdmins(
          `⚠️ کاربر <b>${violation.user.username}</b> با ${violation.ips.length} دستگاه (مجاز: ${violation.user.device_limit}) متصل شده است.\nIPها: ${violation.ips.join(", ")}`
        );
      }
    },
  },
  {
    name: "admin-quota",
    intervalMs: 900_000,
    run: async () => {
      if ((await getSetting("admin_quota_cutoff", "true")) !== "true") return;
      const cut = await enforceAdminQuotas();
      for (const item of cut) {
        await notifyAdmins(
          `⛔️ سقف حجم نماینده <b>${item.admin.username}</b> تمام شد (${(item.used / 1024 ** 3).toFixed(2)} GB).\n` +
            `${item.held} کاربر روی حالت «نگهداری» قرار گرفتند تا سقف شارژ شود.`
        );
      }
    },
  },
  {
    name: "hourly",
    intervalMs: 3_600_000,
    run: async () => {
      await purgeExpiredSessions();
      await applyTrafficReset();
      if (await shouldNotify("telegram_notify_expiry")) await bot.runNotifications();
      const admins = await listAdmins();
      for (const admin of admins) if (admin.role !== "owner") await recomputeAdminUsage(admin.id);
    },
  },
  {
    name: "daily",
    intervalMs: 6 * 3_600_000,
    run: async () => {
      const today = utcDay();
      if (lastBackupDay === today) return;
      lastBackupDay = today;
      const keepDays = Number(await getSetting("backup_keep_days", "14"));
      await createBackup("auto");
      await pruneBackups(keepDays);
    },
  },
  {
    name: "daily-report",
    intervalMs: 6 * 3_600_000,
    run: async () => {
      if ((await getSetting("telegram_report_daily", "true")) !== "true") return;
      if (lastReportDay === utcDay()) return;
      const hour = new Date().getHours();
      if (hour < 8) return;
      lastReportDay = utcDay();
      const stats = await dashboardStats();
      await notifyAdmins(
        `📊 <b>گزارش روزانه</b>\n👥 کاربران: ${stats.users.total} (آنلاین: ${stats.users.online})\n🆕 جدید امروز: ${stats.users.newToday}\n` +
          `📈 مصرف امروز: ${(stats.traffic.today / 1024 ** 3).toFixed(2)} GB\n💰 درآمد امروز: ${stats.revenue.today.toLocaleString("fa-IR")} تومان\n` +
          `🌐 نودهای آنلاین: ${stats.nodes.online}/${stats.nodes.total}\n🎫 تیکت باز: ${stats.tickets.open}`
      );
    },
  },
  {
    name: "update-check",
    intervalMs: 6 * 3_600_000,
    run: async () => {
      if (DISABLE_UPDATE_CHECK || !UPDATE_REPO) return;
      const latest = await checkUpdate();
      if (latest && latest.version !== APP_VERSION) {
        await setUpdateCache(latest);
        if ((await getSetting("notify_update_once", "false")) !== latest.version) {
          await setSetting("notify_update_once", latest.version);
          await notifyAdmins(`🚀 نسخه جدید ${latest.version} پنل KalFetela موجود است.\n${latest.url}`);
        }
      }
    },
  },
];

let lastReportDay = "";
let updateCache: { version: string; url: string; notes: string; checkedAt: number } | null = null;

async function shouldNotify(key: string): Promise<boolean> {
  return (await getSetting(key, "true")) === "true";
}

function setUpdateCache(value: { version: string; url: string; notes: string }): void {
  updateCache = { ...value, checkedAt: nowSeconds() };
}

export function getUpdateInfo(): { version: string; url: string; notes: string; checkedAt: number } | null {
  return updateCache;
}

export async function checkUpdate(): Promise<{ version: string; url: string; notes: string } | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "KalFetela" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string; html_url?: string; body?: string; name?: string };
    return {
      version: (data.tag_name ?? "").replace(/^v/, "") || "unknown",
      url: data.html_url ?? `https://github.com/${UPDATE_REPO}`,
      notes: (data.body ?? "").slice(0, 600),
    };
  } catch {
    return null;
  }
}

export function startScheduler(): void {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    for (const task of tasks) {
      const now = Date.now();
      if (task.lastRun && now - task.lastRun < task.intervalMs) continue;
      task.lastRun = now;
      try {
        await task.run();
      } catch (error) {
        console.warn(`[scheduler] ${task.name} failed:`, (error as Error).message);
      }
    }
    running = false;
  }, 15_000);
  console.log("[scheduler] started");
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Deltas reported by the embedded core, flushed to the DB periodically. */
export const pendingEmbeddedDeltas: Array<{ email: string; upload: number; download: number }> = [];


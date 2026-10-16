// Database bootstrap: picks the driver, runs migrations, seeds defaults and
// exposes a handful of tiny query helpers used across the app.

import { DATABASE_URL, SQLITE_FILE } from "../env.js";
import { nowSeconds } from "../lib/format.js";
import { DEFAULT_SETTINGS, SCHEMA_POSTGRES, SCHEMA_SQLITE } from "./schema.js";
import { PostgresDb } from "./postgres.js";
import { SqliteDb } from "./sqlite.js";
import type { Db } from "./types.js";

let instance: Db | null = null;

export function getDb(): Db {
  if (!instance) throw new Error("database not initialised");
  return instance;
}

export function setDb(db: Db): void {
  instance = db;
}

/** Columns added after the first release — applied automatically on boot. */
const ADDITIVE_COLUMNS: Record<string, Record<string, string>> = {
  admins: {
    can_use_bot: "INTEGER NOT NULL DEFAULT 1",
    last_seen_at: "INTEGER",
  },
  users: {
    hwid: "TEXT",
    sub_updated_at: "INTEGER",
    on_hold: "INTEGER NOT NULL DEFAULT 0",
    hold_reason: "TEXT",
    ping_ms: "INTEGER",
    traffic_reset_at: "INTEGER",
  },
  nodes: {
    agent_secret: "TEXT",
    xray_json: "TEXT",
    core_version: "TEXT",
    health: "TEXT",
  },
  settings: {
    updated_at: "INTEGER",
  },
  payments: {
    discount: "INTEGER NOT NULL DEFAULT 0",
    coupon: "TEXT",
  },
};

async function applySchema(db: Db): Promise<void> {
  const schema = db.dialect === "sqlite" ? SCHEMA_SQLITE : SCHEMA_POSTGRES;
  if (db.dialect === "sqlite") {
    await db.exec(schema);
  } else {
    for (const statement of schema.split(";")) {
      const trimmed = statement.trim();
      if (trimmed) await db.exec(`${trimmed};`);
    }
  }
  await applyAdditiveColumns(db);
}

async function tableColumns(db: Db, table: string): Promise<Set<string>> {
  try {
    if (db.dialect === "sqlite") {
      const rows = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
      return new Set(rows.map((row) => row.name));
    }
    const rows = await db.all<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
      [table]
    );
    return new Set(rows.map((row) => row.column_name));
  } catch {
    return new Set();
  }
}

async function applyAdditiveColumns(db: Db): Promise<void> {
  for (const [table, columns] of Object.entries(ADDITIVE_COLUMNS)) {
    const existing = await tableColumns(db, table);
    if (existing.size === 0) continue;
    for (const [column, definition] of Object.entries(columns)) {
      if (existing.has(column)) continue;
      try {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
        console.log(`[db] added column ${table}.${column}`);
      } catch (error) {
        console.warn(`[db] could not add ${table}.${column}:`, (error as Error).message);
      }
    }
  }
}

export async function initDb(): Promise<Db> {
  const db = DATABASE_URL ? new PostgresDb(DATABASE_URL) : new SqliteDb(SQLITE_FILE);
  setDb(db);
  await applySchema(db);
  await seedSettings(db);
  console.log(`[db] ready (${db.dialect})`);
  return db;
}

async function seedSettings(db: Db): Promise<void> {
  const now = nowSeconds();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await db.get<{ key: string }>("SELECT key FROM settings WHERE key = ?", [key]);
    if (!existing) {
      try {
        await db.insert("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [key, value, now]);
      } catch {
        await db.insert("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
      }
    }
  }
}

/* --------------------------- settings helpers --------------------------- */

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const row = await getDb().get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? fallback;
}

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await getDb().all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = getDb();
  const existing = await db.get<{ key: string }>("SELECT key FROM settings WHERE key = ?", [key]);
  if (existing) await db.run("UPDATE settings SET value = ? WHERE key = ?", [value, key]);
  else await db.insert("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
}

export async function setSettings(values: Record<string, string>): Promise<void> {
  const db = getDb();
  await db.tx(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      const existing = await tx.get<{ key: string }>("SELECT key FROM settings WHERE key = ?", [key]);
      if (existing) await tx.run("UPDATE settings SET value = ? WHERE key = ?", [value, key]);
      else await tx.insert("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
  });
}

export async function getBoolSetting(key: string, fallback = false): Promise<boolean> {
  const value = await getSetting(key, fallback ? "true" : "false");
  return ["1", "true", "on", "yes"].includes(value.toLowerCase());
}

export async function getNumberSetting(key: string, fallback = 0): Promise<number> {
  const value = Number(await getSetting(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

/* ------------------------------ audit log ------------------------------ */

export interface AuditEntry {
  adminId?: number | null;
  actor?: string | null;
  action: string;
  target?: string | null;
  meta?: unknown;
  ip?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await getDb().insert(
      "INSERT INTO audit_log (admin_id, actor, action, target, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        entry.adminId ?? null,
        entry.actor ?? null,
        entry.action,
        entry.target ?? null,
        entry.meta === undefined ? null : JSON.stringify(entry.meta),
        entry.ip ?? null,
        nowSeconds(),
      ]
    );
  } catch (error) {
    console.warn("[audit] failed:", (error as Error).message);
  }
}

/* --------------------------- daily statistics -------------------------- */

export function utcDay(timestamp = nowSeconds()): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export async function bumpDailyStats(delta: {
  uploadBytes?: number;
  downloadBytes?: number;
  newUsers?: number;
  income?: number;
}): Promise<void> {
  const db = getDb();
  const day = utcDay();
  const existing = await db.get<{ id: number }>("SELECT id FROM stats_daily WHERE day = ?", [day]);
  if (existing) {
    await db.run(
      `UPDATE stats_daily SET upload_bytes = upload_bytes + ?, download_bytes = download_bytes + ?,
        new_users = new_users + ?, income = income + ? WHERE day = ?`,
      [delta.uploadBytes ?? 0, delta.downloadBytes ?? 0, delta.newUsers ?? 0, delta.income ?? 0, day]
    );
  } else {
    await db.insert(
      "INSERT INTO stats_daily (day, upload_bytes, download_bytes, new_users, income) VALUES (?, ?, ?, ?, ?)",
      [day, delta.uploadBytes ?? 0, delta.downloadBytes ?? 0, delta.newUsers ?? 0, delta.income ?? 0]
    );
  }
}

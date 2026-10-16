// Backup / restore helpers (JSON dumps stored on the data volume).

import fs from "node:fs";
import path from "node:path";
import { BACKUP_DIR } from "../env.js";
import { getDb } from "../db/index.js";
import { nowSeconds } from "../lib/format.js";

const TABLES = [
  "admins",
  "panels",
  "nodes",
  "users",
  "user_nodes",
  "plans",
  "payments",
  "tickets",
  "ticket_messages",
  "settings",
  "api_tokens",
  "stats_daily",
];

export interface BackupPayload {
  version: string;
  created_at: number;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function dumpDatabase(): Promise<BackupPayload> {
  const db = getDb();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of TABLES) {
    try {
      tables[table] = await db.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
    } catch (error) {
      console.warn(`[backup] table ${table} skipped:`, (error as Error).message);
      tables[table] = [];
    }
  }
  return { version: "2.0.0", created_at: nowSeconds(), tables };
}

export async function createBackup(kind = "manual"): Promise<{ file: string; bytes: number }> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const payload = await dumpDatabase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUP_DIR, `kalfetela-${kind}-${stamp}.json`);
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(file, json);
  return { file, bytes: Buffer.byteLength(json) };
}

export function listBackups(): Array<{ file: string; name: string; bytes: number; createdAt: number }> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const file = path.join(BACKUP_DIR, name);
        const stat = fs.statSync(file);
        return { file, name, bytes: stat.size, createdAt: Math.floor(stat.mtimeMs / 1000) };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function readBackup(name: string): BackupPayload | null {
  const safeName = path.basename(name);
  const file = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as BackupPayload;
  } catch {
    return null;
  }
}

export function pruneBackups(keepDays = 14): number {
  const cutoff = Date.now() - keepDays * 86_400_000;
  let removed = 0;
  for (const backup of listBackups()) {
    if (backup.createdAt * 1000 < cutoff) {
      try {
        fs.unlinkSync(backup.file);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

export async function restoreBackup(payload: BackupPayload, options: { wipe?: boolean } = {}): Promise<Record<string, number>> {
  const db = getDb();
  const inserted: Record<string, number> = {};
  await db.tx(async (tx) => {
    for (const table of [...TABLES].reverse()) {
      if (!payload.tables[table]) continue;
      if (options.wipe) {
        try {
          await tx.run(`DELETE FROM ${table}`);
        } catch {
          /* ignore */
        }
      }
    }
    for (const table of TABLES) {
      const rows = payload.tables[table] ?? [];
      inserted[table] = 0;
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const placeholders = columns.map(() => "?").join(", ");
        try {
          await tx.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`, columns.map((key) => row[key]));
          inserted[table] = (inserted[table] ?? 0) + 1;
        } catch (error) {
          console.warn(`[backup] row insert failed on ${table}:`, (error as Error).message);
        }
      }
    }
  });
  return inserted;
}

// SQLite driver (better-sqlite3) — default storage on the Railway volume.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Mutex, normalizeParam, type Db, type Params, type RunResult } from "./types.js";

export class SqliteDb implements Db {
  readonly dialect = "sqlite" as const;
  private readonly db: Database.Database;
  private readonly writeMutex = new Mutex();
  private inTx = false;

  constructor(file: string) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");
  }

  private prep(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  async all<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
    return this.prep(sql).all(...params.map(normalizeParam)) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | undefined> {
    return this.prep(sql).get(...params.map(normalizeParam)) as T | undefined;
  }

  async run(sql: string, params: Params = []): Promise<RunResult> {
    const exec = () => {
      const info = this.prep(sql).run(...params.map(normalizeParam));
      return { changes: Number(info.changes) };
    };
    if (this.inTx) return exec();
    return this.writeMutex.run(async () => exec());
  }

  async insert(sql: string, params: Params = []): Promise<number> {
    const exec = () => {
      const info = this.prep(sql).run(...params.map(normalizeParam));
      return Number(info.lastInsertRowid);
    };
    if (this.inTx) return exec();
    return this.writeMutex.run(async () => exec());
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    return this.writeMutex.run(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      this.inTx = true;
      try {
        const result = await fn(this);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw error;
      } finally {
        this.inTx = false;
      }
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Escape hatch for CLI tooling (backups, vacuum, ...). */
  raw(): Database.Database {
    return this.db;
  }
}

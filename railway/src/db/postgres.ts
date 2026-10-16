// PostgreSQL driver (pg) — used automatically when DATABASE_URL exists.

import { Pool, type PoolClient } from "pg";
import { normalizeParam, type Db, type Params, type RunResult } from "./types.js";

/** Rewrites `?` placeholders into `$1, $2, …` for PostgreSQL. */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  let out = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    if (char === "?" && !inSingle && !inDouble) {
      index += 1;
      out += `$${index}`;
    } else {
      out += char;
    }
  }
  return out;
}

export class PostgresDb implements Db {
  readonly dialect = "postgres" as const;
  private readonly pool: Pool;
  private readonly clientOverride: PoolClient | null;

  constructor(connectionString: string, client: PoolClient | null = null, pool?: Pool) {
    this.clientOverride = client;
    this.pool =
      pool ??
      new Pool({
        connectionString,
        max: Number(process.env.PG_POOL_MAX || 10),
        ssl: process.env.PG_NO_SSL === "true" ? undefined : { rejectUnauthorized: false },
      });
  }

  private async query(sql: string, params: Params = []) {
    const text = toPgPlaceholders(sql);
    const values = params.map(normalizeParam);
    const runner = this.clientOverride ?? (await this.pool.connect());
    try {
      return await runner.query(text, values);
    } finally {
      if (!this.clientOverride) (runner as PoolClient).release();
    }
  }

  async all<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
    const res = await this.query(sql, params);
    return res.rows as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | undefined> {
    const res = await this.query(sql, params);
    return res.rows[0] as T | undefined;
  }

  async run(sql: string, params: Params = []): Promise<RunResult> {
    const res = await this.query(sql, params);
    return { changes: res.rowCount ?? 0 };
  }

  async insert(sql: string, params: Params = []): Promise<number> {
    const text = /returning/i.test(sql) ? sql : `${sql} RETURNING id`;
    const res = await this.query(text, params);
    const row = res.rows[0] as { id?: number | string } | undefined;
    return row?.id === undefined ? 0 : Number(row.id);
  }

  async exec(sql: string): Promise<void> {
    await this.query(sql);
  }

  async tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.clientOverride) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scoped = new PostgresDb("", client, this.pool);
      const result = await fn(scoped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.clientOverride) await this.pool.end();
  }
}

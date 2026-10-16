// Database abstraction: one small async interface implemented by SQLite
// (default, zero-config, stored on the Railway volume) and PostgreSQL
// (used automatically when DATABASE_URL is present).

export type Params = unknown[];

export interface RunResult {
  changes: number;
}

export interface Db {
  readonly dialect: "sqlite" | "postgres";
  all<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T | undefined>;
  run(sql: string, params?: Params): Promise<RunResult>;
  /** INSERT helper returning the generated primary key. */
  insert(sql: string, params?: Params): Promise<number>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Simple async mutex — used to serialise SQLite write transactions. */
export class Mutex {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.catch(() => undefined);
    return result;
  }
}

export function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return value;
}

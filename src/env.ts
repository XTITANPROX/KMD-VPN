// Shared environment types for KALFETELA
export type Env = {
  // Bindings (see wrangler.toml)
  DB: D1Database;
  KV: KVNamespace;
  BUCKET?: R2Bucket;            // optional — requires R2 (paid)
  METRICS?: AnalyticsEngineDataset;
  WRITE_QUEUE: Queue<QueueMessage>;

  USER_STATE: DurableObjectNamespace;
  POOL_STATE: DurableObjectNamespace;
  RATE_LIMIT: DurableObjectNamespace;

  // Secrets
  PANEL_SECRET: string;

  // Public vars
  APP_NAME: string;
  APP_VERSION: string;
  PRIMARY_FETCH: string;
  DEFAULT_DOH: string;
  PROXY_FALLBACK_HOSTS: string;

  // Non-production
  ADMIN_BOOTSTRAP_PASSWORD?: string;
};

export type QueueMessage =
  | { type: "traffic"; username: string; bytes: number; requests: number }
  | { type: "request"; username: string; ts: number }
  | { type: "audit"; actor: string; action: string; meta: Record<string, unknown> };

// Environment / runtime configuration for the KalFetela Railway panel.
//
// Everything here is optional except a DATABASE (SQLite by default) and a
// signed cookie secret (auto-generated and persisted on the data volume when
// not provided).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const APP_NAME = process.env.APP_NAME || "KalFetela";
export const APP_VERSION = "2.0.0";

function pickDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  // Railway volumes are usually mounted at /data or /app/data.
  for (const candidate of ["/data", "/app/data"]) {
    try {
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return path.resolve(process.cwd(), "data");
}

export const DATA_DIR = pickDataDir();
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const XRAY_DIR = path.join(DATA_DIR, "xray");
export const STATE_DIR = path.join(DATA_DIR, "state");

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR, STATE_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

export const PORT = Number(process.env.PORT || 8080);
export const HOST = process.env.HOST || "0.0.0.0";

/** PostgreSQL (Railway plugin) takes precedence when DATABASE_URL is present. */
export const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const SQLITE_FILE = path.resolve(process.env.SQLITE_FILE || path.join(DATA_DIR, "kalfetela.db"));

/** Public base URL (used in subscription links, bot messages, webhooks). */
export const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

export const COOKIE_NAME = process.env.COOKIE_NAME || "kalfetela_session";
export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24 * 7);

/** Secrets are persisted so restarts do not invalidate sessions. */
function persistedSecret(name: string, envValue?: string): string {
  if (envValue && envValue.length >= 16) return envValue;
  const file = path.join(STATE_DIR, `${name}.key`);
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* create below */
  }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(file, generated, { mode: 0o600 });
  } catch {
    /* non-persistent runtime is acceptable */
  }
  return generated;
}

export const PANEL_SECRET = persistedSecret("panel-secret", process.env.PANEL_SECRET);
export const AGENT_SECRET = persistedSecret("agent-secret", process.env.AGENT_SECRET);

/** First-run bootstrap: if the admins table is empty these are used. */
export const BOOTSTRAP_USERNAME = process.env.ADMIN_USERNAME || "";
export const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || "";
/** Optional guard for the /install wizard. */
export const SETUP_TOKEN = process.env.SETUP_TOKEN || "";

/** Embedded Xray core (Railway) — enabled by default inside the container. */
export const XRAY_ENABLED = (process.env.XRAY_ENABLED ?? "auto").toLowerCase() !== "false";
export const XRAY_BINARY = path.resolve(process.env.XRAY_BINARY || path.join(XRAY_DIR, "xray"));
export const XRAY_API_PORT = Number(process.env.XRAY_API_PORT || 10085);
export const XRAY_START_PORT = Number(process.env.XRAY_START_PORT || 10000);
export const LOCAL_NODE_HOST = process.env.LOCAL_NODE_HOST || PUBLIC_URL.split(":")[0] || "localhost";

/** Telegram bot long-polling is disabled when no token is configured. */
export const TELEGRAM_TOKEN_ENV = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_ADMINS_ENV = process.env.TELEGRAM_ADMIN_IDS || "";

/** Update check target (kept configurable / disable-able for private forks). */
export const UPDATE_REPO = process.env.UPDATE_REPO || "XTITANPROX/KMD-VPN";
export const DISABLE_UPDATE_CHECK = process.env.DISABLE_UPDATE_CHECK === "true";

/**
 * Some corporate networks / sandboxes intercept TLS. Setting
 * XRAY_INSECURE_TLS=true relaxes certificate verification for outbound
 * downloads (Xray core, update checks). Off by default.
 */
if (process.env.XRAY_INSECURE_TLS === "true" || process.env.INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn("[env] TLS verification disabled for outbound requests (XRAY_INSECURE_TLS=true)");
}

export const IS_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
export const TRUST_PROXY = process.env.TRUST_PROXY !== "false";

-- KALFETELA — initial schema
CREATE TABLE IF NOT EXISTS groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  data_limit_gb REAL,
  duration_days INTEGER,
  price         INTEGER,
  color         TEXT NOT NULL DEFAULT '#38bdf8',
  note          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  username               TEXT NOT NULL UNIQUE,
  uuid                   TEXT NOT NULL UNIQUE,
  trojan_hash            TEXT,
  limit_gb               REAL,
  used_gb                REAL NOT NULL DEFAULT 0,
  lifetime_gb            REAL NOT NULL DEFAULT 0,
  expiry_days            INTEGER,
  limit_req              INTEGER,
  used_req               INTEGER NOT NULL DEFAULT 0,
  ip_limit               INTEGER,
  active_ips             TEXT,
  connection_type        TEXT NOT NULL DEFAULT 'vless+trojan',
  tls                    TEXT NOT NULL DEFAULT 'on',
  port                   INTEGER NOT NULL DEFAULT 443,
  path                   TEXT NOT NULL DEFAULT '/',
  sni_host               TEXT,
  fingerprint            TEXT NOT NULL DEFAULT 'chrome',
  fragment               TEXT,
  cipher_suites          TEXT,
  alpn                   TEXT NOT NULL DEFAULT 'h2,http/1.1',
  allow_insecure         INTEGER NOT NULL DEFAULT 0,
  block_porn             INTEGER NOT NULL DEFAULT 0,
  block_ads              INTEGER NOT NULL DEFAULT 0,
  block_malware          INTEGER NOT NULL DEFAULT 0,
  doh_url                TEXT,
  route_direct           TEXT,
  route_block            TEXT,
  user_proxy_iata        TEXT,
  user_socks5            TEXT,
  user_proxy_ip          TEXT,
  auto_rotate_proxy      INTEGER NOT NULL DEFAULT 0,
  auto_rotate_ip         INTEGER NOT NULL DEFAULT 1,
  rotate_minutes         INTEGER NOT NULL DEFAULT 0,
  ip_operator            TEXT NOT NULL DEFAULT 'all',
  ip_count               INTEGER NOT NULL DEFAULT 15,
  ips                    TEXT,
  last_rotate_time       INTEGER NOT NULL DEFAULT 0,
  auto_reset_vol_days    INTEGER NOT NULL DEFAULT 0,
  auto_reset_req_days    INTEGER NOT NULL DEFAULT 0,
  last_reset_vol_time    INTEGER NOT NULL DEFAULT 0,
  last_reset_req_time    INTEGER NOT NULL DEFAULT 0,
  is_active              INTEGER NOT NULL DEFAULT 1,
  start_on_first_connect INTEGER NOT NULL DEFAULT 0,
  first_connection_time  INTEGER,
  last_active            INTEGER,
  note                   TEXT,
  group_id               INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at             INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_active  ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  totp_secret   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip         TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp   ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes     TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  last_used  INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS proxies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uri          TEXT NOT NULL,
  country      TEXT,
  source       TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  latency_ms   INTEGER,
  success_rate INTEGER NOT NULL DEFAULT 100,
  last_checked INTEGER NOT NULL DEFAULT 0,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_proxies_country ON proxies(country);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  meta       TEXT,
  ip         TEXT,
  ua         TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS traffic_hourly (
  hour_bucket INTEGER NOT NULL,
  username    TEXT NOT NULL,
  bytes_up    INTEGER NOT NULL DEFAULT 0,
  bytes_down  INTEGER NOT NULL DEFAULT 0,
  requests    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_bucket, username)
);
CREATE INDEX IF NOT EXISTS idx_traffic_user ON traffic_hourly(username);

CREATE TABLE IF NOT EXISTS coupons (
  code       TEXT PRIMARY KEY,
  extra_gb   REAL NOT NULL DEFAULT 0,
  extra_days INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

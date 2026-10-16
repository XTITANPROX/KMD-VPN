// Database schema shared by both dialects (SQLite + PostgreSQL).
//
// Conventions:
//   * every timestamp is an INTEGER unix-seconds value,
//   * booleans are INTEGER 0/1,
//   * structured data lives in TEXT columns holding JSON,
//   * `${pk}` is replaced by the dialect specific auto increment primary key.

export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  credit INTEGER NOT NULL DEFAULT 0,
  quota_bytes INTEGER NOT NULL DEFAULT 0,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  max_users INTEGER NOT NULL DEFAULT 0,
  can_manage_nodes INTEGER NOT NULL DEFAULT 1,
  can_manage_admins INTEGER NOT NULL DEFAULT 0,
  can_use_bot INTEGER NOT NULL DEFAULT 1,
  telegram_id TEXT,
  first_name TEXT,
  last_name TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER,
  last_login_ip TEXT
);

CREATE TABLE IF NOT EXISTS panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'x-ui',
  base_url TEXT NOT NULL,
  username TEXT,
  password TEXT,
  api_token TEXT,
  sub_base_url TEXT,
  proxy_url TEXT,
  extra TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'panel',
  panel_id INTEGER,
  inbound_id TEXT,
  protocol TEXT NOT NULL DEFAULT 'vless',
  transport TEXT NOT NULL DEFAULT 'ws',
  security TEXT NOT NULL DEFAULT 'tls',
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  sni TEXT,
  path TEXT,
  service_name TEXT,
  flow TEXT,
  fingerprint TEXT,
  alpn TEXT,
  reality_public_key TEXT,
  reality_private_key TEXT,
  reality_short_id TEXT,
  reality_dest TEXT,
  private_key TEXT,
  public_key TEXT,
  dns TEXT,
  mtu INTEGER,
  address_v4 TEXT,
  address_v6 TEXT,
  settings TEXT,
  capacity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  cpu_load REAL,
  mem_load REAL,
  uptime_seconds INTEGER,
  last_heartbeat_at INTEGER,
  last_error TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  uuid TEXT NOT NULL,
  password TEXT,
  email TEXT,
  telegram_id TEXT,
  provider TEXT NOT NULL DEFAULT 'local',
  panel_id INTEGER,
  admin_id INTEGER,
  plan_id INTEGER,
  data_limit_bytes INTEGER NOT NULL DEFAULT 0,
  data_used_bytes INTEGER NOT NULL DEFAULT 0,
  upload_bytes INTEGER NOT NULL DEFAULT 0,
  download_bytes INTEGER NOT NULL DEFAULT 0,
  request_limit INTEGER NOT NULL DEFAULT 0,
  request_used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  activated_at INTEGER,
  last_online_at INTEGER,
  sub_token TEXT NOT NULL,
  sub_updated_at INTEGER,
  online_ips TEXT,
  device_limit INTEGER NOT NULL DEFAULT 0,
  speed_limit_mbps INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  reset_strategy TEXT NOT NULL DEFAULT 'no_reset',
  last_reset_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sub_token ON users(sub_token);
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(admin_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

CREATE TABLE IF NOT EXISTS user_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_user_nodes_user ON user_nodes(user_id);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  reseller_price INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 30,
  data_gb REAL NOT NULL DEFAULT 0,
  device_limit INTEGER NOT NULL DEFAULT 1,
  speed_mbps INTEGER NOT NULL DEFAULT 0,
  protocol TEXT,
  node_ids TEXT,
  icon TEXT,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  admin_id INTEGER,
  plan_id INTEGER,
  telegram_id TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'manual',
  gateway TEXT,
  ref_id TEXT,
  receipt_file TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  reviewed_at INTEGER,
  reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  admin_id INTEGER,
  telegram_id TEXT,
  name TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  author TEXT NOT NULL DEFAULT 'user',
  admin_id INTEGER,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS traffic_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  node_id INTEGER,
  upload_bytes INTEGER NOT NULL DEFAULT 0,
  download_bytes INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_traffic_user_day ON traffic_log(user_id, day);
CREATE INDEX IF NOT EXISTS idx_traffic_day ON traffic_log(day);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER,
  type TEXT NOT NULL DEFAULT 'admin',
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  scopes TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS blocked_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  reason TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  node_id INTEGER,
  ip TEXT,
  hwid TEXT,
  user_agent TEXT,
  seen_at INTEGER NOT NULL DEFAULT 0,
  online INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_unique ON devices(user_id, ip, hwid);

CREATE TABLE IF NOT EXISTS stats_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL UNIQUE,
  upload_bytes INTEGER NOT NULL DEFAULT 0,
  download_bytes INTEGER NOT NULL DEFAULT 0,
  new_users INTEGER NOT NULL DEFAULT 0,
  income INTEGER NOT NULL DEFAULT 0
);
`;

/** PostgreSQL flavour of the same schema (replacements only). */
export const SCHEMA_POSTGRES = SCHEMA_SQLITE.replaceAll("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY");

/** Default settings merged into a fresh install. */
export const DEFAULT_SETTINGS: Record<string, string> = {
  panel_name: "KalFetela",
  brand_tagline: "پنل مدیریت کاربران و اکانت‌ها",
  language: "fa",
  theme: "dark",
  panel_path: "/panel",
  support_id: "@KalFetela",
  support_link: "",
  channel_link: "",
  server_location: "Railway",
  host_name: "Railway",
  announcement: "",
  announcement_active: "false",
  register_enabled: "false",
  trial_enabled: "true",
  trial_plan_id: "0",
  trial_days: "1",
  trial_gb: "1",
  subscription_note: "",
  sub_domain: "",
  card_number: "",
  card_holder: "",
  payment_instructions: "پس از واریز، عکس رسید را در ربات ارسال کنید.",
  bot_welcome: "به KalFetela خوش آمدید! از منوی زیر می‌توانید سرویس بخرید و وضعیت اکانت خود را ببینید.",
  bot_shop_enabled: "true",
  bot_token: "",
  bot_owner_ids: "",
  bot_auto_approve: "false",
  bot_discount_code: "",
  bot_discount_percent: "0",
  telegram_poll_enabled: "true",
  notify_expiry_days: "3,1",
  notify_low_quota_percent: "15",
  telegram_notify_expiry: "true",
  telegram_notify_quota: "true",
  telegram_notify_login: "false",
  telegram_report_daily: "true",
  usdt_enabled: "false",
  usdt_rate: "0",
  usdt_wallet: "",
  online_window_minutes: "5",
  traffic_reset_day: "1",
  traffic_reset_strategy_default: "no_reset",
  allow_multi_connection: "true",
  auto_create_on_sub: "true",
  sub_template: "raw",
  clash_proxy_groups: "auto",
  ip_limit_per_user: "0",
  login_captcha: "false",
  login_rate_limit: "6",
  blocked_domains: "",
  direct_domains: "",
  backup_keep_days: "14",
  xray_log_level: "warning",
  xray_dns: "1.1.1.1,8.8.8.8",
  xray_routing_rules: "",
  xray_fragment: "100-200,1-3,tlshello",
  xray_route_iran: "true",
  xray_block_ads: "true",
  direct_admin_created: "false",
  bot_custom_menu: "",
  bot_commands: "",
  realtime_sync: "true",
  security_2fa: "false",
  keepalive_seconds: "0",
  admin_quota_cutoff: "true",
  api_enabled: "true",
  api_tokens_allow_ip_weird: "false",
  install_completed: "false",
};

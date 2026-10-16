// Drizzle schema for KALFETELA (Cloudflare D1 / SQLite)
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/* ============================================================
 * users — proxy accounts
 * ============================================================ */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  uuid: text("uuid").notNull().unique(),
  // limits
  limitGb: real("limit_gb"),
  usedGb: real("used_gb").notNull().default(0),
  lifetimeGb: real("lifetime_gb").notNull().default(0),
  expiryDays: integer("expiry_days"),
  limitReq: integer("limit_req"),
  usedReq: integer("used_req").notNull().default(0),
  ipLimit: integer("ip_limit"),
  activeIps: text("active_ips", { mode: "json" }).$type<Record<string, number>>(),
  // tunnel / network
  connectionType: text("connection_type").notNull().default("vless+trojan"), // vless, trojan, vmess or combos
  tls: text("tls").notNull().default("on"),
  port: integer("port").notNull().default(443),
  path: text("path").notNull().default("/"),
  sniHost: text("sni_host"),
  fingerprint: text("fingerprint").notNull().default("chrome"),
  fragment: text("fragment"),
  cipherSuites: text("cipher_suites"),
  alpn: text("alpn").notNull().default("h2,http/1.1"),
  allowInsecure: integer("allow_insecure").notNull().default(0),
  // content
  blockPorn: integer("block_porn").notNull().default(0),
  blockAds: integer("block_ads").notNull().default(0),
  blockMalware: integer("block_malware").notNull().default(0),
  dohUrl: text("doh_url"),
  // routing
  routeDirect: text("route_direct", { mode: "json" }).$type<string[]>(),   // domain suffix list
  routeBlock:  text("route_block",  { mode: "json" }).$type<string[]>(),
  // upstream proxy (one of)
  userProxyIata: text("user_proxy_iata"),        // country code -> use pool
  userSocks5:    text("user_socks5"),             // explicit proxy URI or JSON list
  userProxyIp:   text("user_proxy_ip"),
  autoRotateProxy: integer("auto_rotate_proxy").notNull().default(0),
  // clean-ip rotation
  autoRotateIp: integer("auto_rotate_ip").notNull().default(1),
  rotateMinutes: integer("rotate_minutes").notNull().default(0),
  ipOperator: text("ip_operator").notNull().default("all"),
  ipCount: integer("ip_count").notNull().default(15),
  ips: text("ips", { mode: "json" }).$type<string[]>(),
  lastRotateTime: integer("last_rotate_time").notNull().default(0),
  // auto resets
  autoResetVolDays: integer("auto_reset_vol_days").notNull().default(0),
  autoResetReqDays: integer("auto_reset_req_days").notNull().default(0),
  lastResetVolTime: integer("last_reset_vol_time").notNull().default(0),
  lastResetReqTime: integer("last_reset_req_time").notNull().default(0),
  // misc
  isActive: integer("is_active").notNull().default(1),
  startOnFirstConnect: integer("start_on_first_connect").notNull().default(0),
  firstConnectionTime: integer("first_connection_time"),
  lastActive: integer("last_active"),
  note: text("note"),
  groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * groups / packages
 * ============================================================ */
export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  dataLimitGb: real("data_limit_gb"),
  durationDays: integer("duration_days"),
  price: integer("price"),
  color: text("color").notNull().default("#38bdf8"),
  note: text("note"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * settings (key / value)
 * ============================================================ */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * admins (multi-admin + roles)
 * ============================================================ */
export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),     // Argon2id encoded
  role: text("role").notNull().default("admin"),     // owner | admin | support | readonly
  totpSecret: text("totp_secret"),
  isActive: integer("is_active").notNull().default(1),
  lastLogin: integer("last_login"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * sessions (HTTP only secure cookies)
 * ============================================================ */
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * api_tokens (scoped)
 * ============================================================ */
export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  expiresAt: integer("expires_at"),
  lastUsed: integer("last_used"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * proxies — live proxy pool entries
 * ============================================================ */
export const proxies = sqliteTable("proxies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uri: text("uri").notNull(),                       // socks5://user:pass@host:port
  country: text("country"),
  source: text("source"),
  isActive: integer("is_active").notNull().default(1),
  latencyMs: integer("latency_ms"),
  successRate: integer("success_rate").notNull().default(100),
  lastChecked: integer("last_checked").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  note: text("note"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * audit_log
 * ============================================================ */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  ip: text("ip"),
  ua: text("ua"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/* ============================================================
 * traffic_hourly — time series for charts
 * ============================================================ */
export const trafficHourly = sqliteTable("traffic_hourly", {
  hourBucket: integer("hour_bucket").notNull(),
  username: text("username").notNull(),
  bytesUp: integer("bytes_up").notNull().default(0),
  bytesDown: integer("bytes_down").notNull().default(0),
  requests: integer("requests").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.hourBucket, t.username] }),
}));

/* ============================================================
 * coupons / gifts
 * ============================================================ */
export const coupons = sqliteTable("coupons", {
  code: text("code").primaryKey(),
  extraGb: real("extra_gb").notNull().default(0),
  extraDays: integer("extra_days").notNull().default(0),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

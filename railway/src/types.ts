// Shared row/domain types (mirrors the SQL schema 1:1).

export type Protocol = "vless" | "vmess" | "trojan" | "shadowsocks" | "wireguard";
export type Transport = "tcp" | "ws" | "grpc" | "httpupgrade" | "http" | "quic" | "xhttp" | "splithttp";
export type Security = "none" | "tls" | "reality";
export type NodeKind = "embedded" | "panel" | "agent" | "custom";
export type PanelType = "x-ui" | "marzban" | "sanaei" | "alireza" | "custom";

export type UserStatus = "active" | "disabled" | "limited" | "expired" | "on_hold";
export type AdminRole = "owner" | "admin" | "reseller";
export type PaymentStatus = "pending" | "approved" | "rejected" | "refunded";
export type PaymentMethod = "manual" | "card" | "gateway" | "wallet" | "crypto";

export interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  role: AdminRole;
  credit: number;
  quota_bytes: number;
  used_bytes: number;
  max_users: number;
  can_manage_nodes: number;
  can_manage_admins: number;
  can_use_bot: number;
  telegram_id: string | null;
  first_name: string | null;
  last_name: string | null;
  note: string | null;
  status: string;
  created_at: number;
  last_login_at: number | null;
  last_login_ip: string | null;
  last_seen_at?: number | null;
}

export interface PanelRow {
  id: number;
  name: string;
  type: PanelType | string;
  base_url: string;
  username: string | null;
  password: string | null;
  api_token: string | null;
  sub_base_url: string | null;
  proxy_url: string | null;
  extra: string | null;
  status: string;
  last_error: string | null;
  last_checked_at: number | null;
  created_at: number;
}

export interface NodeRow {
  id: number;
  name: string;
  kind: NodeKind | string;
  panel_id: number | null;
  inbound_id: string | null;
  protocol: Protocol | string;
  transport: Transport | string;
  security: Security | string;
  host: string;
  port: number;
  sni: string | null;
  path: string | null;
  service_name: string | null;
  flow: string | null;
  fingerprint: string | null;
  alpn: string | null;
  reality_public_key: string | null;
  reality_private_key: string | null;
  reality_short_id: string | null;
  reality_dest: string | null;
  private_key: string | null;
  public_key: string | null;
  dns: string | null;
  mtu: number | null;
  address_v4: string | null;
  address_v6: string | null;
  settings: string | null;
  capacity: number;
  status: string;
  cpu_load: number | null;
  mem_load: number | null;
  uptime_seconds: number | null;
  last_heartbeat_at: number | null;
  last_error: string | null;
  sort: number;
  active: number;
  created_at: number;
  updated_at: number;
  agent_secret?: string | null;
  xray_json?: string | null;
  core_version?: string | null;
  health?: string | null;
}

export interface UserRow {
  id: number;
  username: string;
  uuid: string;
  password: string | null;
  email: string | null;
  telegram_id: string | null;
  provider: string;
  panel_id: number | null;
  admin_id: number | null;
  plan_id: number | null;
  data_limit_bytes: number;
  data_used_bytes: number;
  upload_bytes: number;
  download_bytes: number;
  request_limit: number;
  request_used: number;
  expires_at: number | null;
  created_at: number;
  activated_at: number | null;
  last_online_at: number | null;
  sub_token: string;
  sub_updated_at: number | null;
  online_ips: string | null;
  device_limit: number;
  speed_limit_mbps: number;
  status: string;
  note: string | null;
  reset_strategy: string;
  last_reset_at: number | null;
  updated_at: number;
  hwid?: string | null;
  on_hold?: number;
  hold_reason?: string | null;
  ping_ms?: number | null;
}

export interface UserNodeRow {
  id: number;
  user_id: number;
  node_id: number;
  client_id: string;
  label: string | null;
  enabled: number;
  created_at: number;
}

export interface PlanRow {
  id: number;
  name: string;
  price: number;
  reseller_price: number;
  days: number;
  data_gb: number;
  device_limit: number;
  speed_mbps: number;
  protocol: string | null;
  node_ids: string | null;
  icon: string | null;
  description: string | null;
  sort: number;
  visible: number;
  created_at: number;
}

export interface PaymentRow {
  id: number;
  user_id: number | null;
  admin_id: number | null;
  plan_id: number | null;
  telegram_id: string | null;
  amount: number;
  discount: number;
  method: string;
  gateway: string | null;
  ref_id: string | null;
  receipt_file: string | null;
  status: PaymentStatus | string;
  note: string | null;
  created_at: number;
  reviewed_at: number | null;
  reviewed_by: number | null;
  coupon?: string | null;
}

export interface TicketRow {
  id: number;
  user_id: number | null;
  admin_id: number | null;
  telegram_id: string | null;
  name: string | null;
  subject: string;
  category: string;
  status: string;
  priority: string;
  created_at: number;
  updated_at: number;
}

export interface TicketMessageRow {
  id: number;
  ticket_id: number;
  author: string;
  admin_id: number | null;
  body: string;
  created_at: number;
}

export interface ApiTokenRow {
  id: number;
  name: string;
  token: string;
  scopes: string | null;
  created_by: number | null;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  active: number;
}

export interface TrafficPoint {
  day: string;
  upload_bytes: number;
  download_bytes: number;
}

export interface DashboardStats {
  users: { total: number; active: number; disabled: number; limited: number; expired: number; online: number; newToday: number };
  traffic: { used: number; upload: number; download: number; today: number };
  nodes: { total: number; online: number; offline: number };
  revenue: { today: number; month: number; total: number; pending: number };
  admins: { total: number };
  resellers: { total: number };
  tickets: { open: number };
  series: TrafficPoint[];
}

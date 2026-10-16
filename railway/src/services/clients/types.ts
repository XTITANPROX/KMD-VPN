// Node clients: a uniform interface implemented by the embedded Xray manager,
// 3x-ui / sanaei panels and Marzban panels.

import type { NodeRow, Protocol, UserRow } from "../../types.js";

export interface ClientSpec {
  userId: number;
  username: string;
  email: string;
  uuid: string;
  password: string;
  protocol: Protocol | string;
  limitBytes: number;
  usedBytes: number;
  expiresAt: number | null;
  deviceLimit: number;
  speedMbps: number;
  enabled: boolean;
  telegramId?: string | null;
  comment?: string;
}

export interface NodeClientInfo {
  email: string;
  uuid: string;
  enabled: boolean;
  up: number;
  down: number;
  total: number;
  expiry: number | null;
  online?: boolean;
}

export interface NodeHealth {
  ok: boolean;
  status: "online" | "offline" | "error";
  cpuLoad?: number | null;
  memLoad?: number | null;
  uptimeSeconds?: number | null;
  coreVersion?: string | null;
  error?: string | null;
}

export interface NodeClient {
  /** Push (create or update) a single client on the node. */
  pushClient(spec: ClientSpec): Promise<void>;
  /** Remove a client from the node. */
  removeClient(email: string): Promise<void>;
  /** Per-client traffic snapshot; keys are the client email. */
  listClients(): Promise<NodeClientInfo[]>;
  /** Health/telemetry probe. */
  health(): Promise<NodeHealth>;
  /** Optional: reset a client's counters on the node itself. */
  resetClient?(email: string): Promise<void>;
  /** Optional: inbound metadata (used by the panel UI). */
  describe?(): Promise<Record<string, unknown>>;
}

export function specFromUser(user: UserRow, node?: NodeRow | null): ClientSpec {
  return {
    userId: user.id,
    username: user.username,
    email: user.username,
    uuid: user.uuid,
    password: user.password || user.uuid,
    protocol: node?.protocol ?? "vless",
    limitBytes: user.data_limit_bytes,
    usedBytes: user.data_used_bytes,
    expiresAt: user.expires_at,
    deviceLimit: user.device_limit,
    speedMbps: user.speed_limit_mbps,
    enabled: ["active", "limited", "expired"].includes(user.status) === false ? false : user.status !== "disabled" && user.status !== "on_hold",
    telegramId: user.telegram_id,
    comment: user.note ?? undefined,
  };
}

/** Milliseconds → x-ui expects ms, our DB stores seconds. */
export function secondsToMillis(value: number | null | undefined): number {
  return value ? value * 1000 : 0;
}

export function millisToSeconds(value: number | null | undefined): number | null {
  if (!value || value <= 0) return null;
  if (value > 10_000_000_000) return Math.floor(value / 1000);
  return value;
}

// Remote KalFetela panel client — one manager panel can drive tens of other
// Railway deployments. Talks to the remote REST API with an `X-API-Key` token
// (تنظیمات → API) and reuses the very same node contract as 3x-ui / Marzban.

import type { NodeRow, PanelRow } from "../../types.js";
import type { ClientSpec, NodeClient, NodeClientInfo, NodeHealth } from "./types.js";

interface RemoteUser {
  id: number;
  username: string;
  uuid: string;
  status: string;
  data_limit_bytes: number;
  data_used_bytes: number;
  expires_at: number | null;
  device_limit?: number;
  telegram_id?: string | null;
  note?: string | null;
  sub_token?: string;
}

interface RemoteNode {
  id: number;
  name: string;
  kind: string;
  protocol: string;
  transport: string;
  security: string;
  host: string;
  port: number;
  sni: string | null;
  path: string | null;
  service_name: string | null;
  flow: string | null;
  fingerprint?: string | null;
  alpn?: string | null;
  reality_public_key: string | null;
  reality_short_id: string | null;
  reality_dest?: string | null;
  dns?: string | null;
  mtu?: number | null;
  address_v4?: string | null;
  active: boolean;
  user_count?: number;
}

interface RemoteInfo {
  app?: { version?: string; dialect?: string };
  stats?: {
    users?: { total?: number; active?: number; online?: number };
    traffic?: { total?: number; today?: number };
    nodes?: { total?: number; online?: number };
    revenue?: { total?: number; today?: number };
  };
  cpu?: { usage_percent?: number; cores?: number };
  memory?: { total?: number; used?: number };
  uptime?: number;
}

export class KalFetelaRemoteClient implements NodeClient {
  constructor(private readonly panel: PanelRow, private readonly node?: NodeRow | null) {}

  private get base(): string {
    return this.panel.base_url.replace(/\/+$/, "");
  }

  private get token(): string {
    return this.panel.api_token || "";
  }

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.token) throw new Error("توکن API پنل مقصد تنظیم نشده است");
    const response = await fetch(`${this.base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.token,
        authorization: `Bearer ${this.token}`,
        "user-agent": "KalFetela-Fleet/2.0",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 300) };
    }
    if (!response.ok) {
      const message = (payload as { error?: string } | null)?.error ?? `HTTP ${response.status}`;
      throw new Error(message);
    }
    return ((payload as { data?: T } | null)?.data ?? (payload as T)) as T;
  }

  /** Pages through the remote user list. */
  private async remoteUsers(): Promise<RemoteUser[]> {
    const out: RemoteUser[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.request<{ users: RemoteUser[]; total: number }>(`/api/users?per_page=200&page=${page}`);
      const users = result?.users ?? [];
      out.push(...users);
      if (users.length < 200 || out.length >= Number(result?.total ?? out.length)) break;
    }
    return out;
  }

  private async findByUsername(username: string): Promise<RemoteUser | null> {
    const result = await this.request<{ users: RemoteUser[] }>(`/api/users?search=${encodeURIComponent(username)}&per_page=50`);
    return (result?.users ?? []).find((user) => user.username === username) ?? null;
  }

  async pushClient(spec: ClientSpec): Promise<void> {
    const existing = await this.findByUsername(spec.username);
    const days = spec.expiresAt ? Math.max(1, Math.round((spec.expiresAt - Date.now() / 1000) / 86400)) : 0;
    const gb = spec.limitBytes > 0 ? Number((spec.limitBytes / 1024 ** 3).toFixed(2)) : 0;
    if (existing) {
      await this.request(`/api/users/${existing.id}`, {
        method: "PUT",
        body: {
          data_gb: gb,
          device_limit: spec.deviceLimit,
          speed_mbps: spec.speedMbps,
          telegram_id: spec.telegramId ?? undefined,
          note: spec.comment ?? undefined,
          status: spec.enabled ? "active" : "disabled",
        },
      });
      return;
    }
    // the remote node behind this local node (import keeps its id in inbound_id),
    // so the freshly created account is attached to exactly the right inbound
    const remoteNodeId = Number(this.node?.inbound_id) || null;
    await this.request("/api/users", {
      method: "POST",
      body: {
        // the local uuid travels to the remote panel so both sides build the
        // exact same client credentials
        uuid: spec.uuid,
        password: spec.password,
        username: spec.username,
        data_gb: gb,
        days: days || spec.expiresAt ? days : 30,
        device_limit: spec.deviceLimit,
        speed_mbps: spec.speedMbps,
        node_ids: remoteNodeId ? [remoteNodeId] : undefined,
        telegram_id: spec.telegramId ?? undefined,
        note: spec.comment ?? undefined,
      },
    });
  }

  async removeClient(email: string): Promise<void> {
    const existing = await this.findByUsername(email);
    if (!existing) return;
    await this.request(`/api/users/${existing.id}`, { method: "DELETE" });
  }

  async resetClient(email: string): Promise<void> {
    const existing = await this.findByUsername(email);
    if (!existing) return;
    await this.request(`/api/users/${existing.id}/reset`, { method: "POST" });
  }

  async listClients(): Promise<NodeClientInfo[]> {
    const users = await this.remoteUsers();
    return users.map((user) => ({
      email: user.username,
      uuid: user.uuid,
      enabled: !["disabled", "on_hold"].includes(user.status),
      up: 0,
      down: Number(user.data_used_bytes ?? 0),
      total: Number(user.data_limit_bytes ?? 0),
      expiry: user.expires_at ?? null,
    }));
  }

  async health(): Promise<NodeHealth> {
    try {
      const info = await this.request<RemoteInfo>("/api/system/info");
      return {
        ok: true,
        status: "online",
        cpuLoad: info?.cpu?.usage_percent ?? null,
        memLoad: info?.memory?.total ? Math.round(((info.memory.used ?? 0) / info.memory.total) * 100) : null,
        uptimeSeconds: info?.uptime ?? null,
        coreVersion: info?.app?.version ?? null,
        error: null,
      };
    } catch (error) {
      return { ok: false, status: "error", error: (error as Error).message };
    }
  }

  /** Remote nodes (used as the import source of a fleet panel). */
  async remoteNodes(): Promise<RemoteNode[]> {
    const result = await this.request<{ nodes: RemoteNode[] }>("/api/nodes");
    return result?.nodes ?? [];
  }

  async describe(): Promise<Record<string, unknown>> {
    const [info, nodes] = await Promise.all([
      this.request<RemoteInfo>("/api/system/info").catch(() => null),
      this.remoteNodes().catch(() => [] as RemoteNode[]),
    ]);
    return {
      kind: "kalfetela",
      version: info?.app?.version ?? null,
      dialect: info?.app?.dialect ?? null,
      users: info?.stats?.users ?? null,
      traffic: info?.stats?.traffic ?? null,
      nodes_online: info?.stats?.nodes ?? null,
      revenue: info?.stats?.revenue ?? null,
      cpu: info?.cpu?.usage_percent ?? null,
      memory: info?.memory ?? null,
      node_list: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        protocol: node.protocol,
        transport: node.transport,
        security: node.security,
        host: node.host,
        port: node.port,
        kind: node.kind,
        active: node.active,
        user_count: node.user_count ?? 0,
      })),
    };
  }

  /** Aggregated numbers for the fleet dashboard. */
  async summary(): Promise<Record<string, unknown>> {
    const started = Date.now();
    try {
      const info = await this.request<RemoteInfo>("/api/system/info");
      return {
        online: true,
        latency_ms: Date.now() - started,
        version: info?.app?.version ?? null,
        users: info?.stats?.users?.total ?? 0,
        online_users: info?.stats?.users?.online ?? 0,
        traffic_today: info?.stats?.traffic?.today ?? 0,
        revenue_total: info?.stats?.revenue?.total ?? 0,
        nodes: info?.stats?.nodes?.total ?? 0,
        nodes_online: info?.stats?.nodes?.online ?? 0,
        cpu: info?.cpu?.usage_percent ?? null,
        ram_percent: info?.memory?.total ? Math.round(((info.memory.used ?? 0) / info.memory.total) * 100) : null,
        error: null as string | null,
      };
    } catch (error) {
      return { online: false, latency_ms: null, error: (error as Error).message };
    }
  }
}

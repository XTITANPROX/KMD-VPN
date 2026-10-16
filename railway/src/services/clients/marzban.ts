// Marzban panel client (REST API with bearer tokens).

import { secondsToMillis, type ClientSpec, type NodeClient, type NodeClientInfo, type NodeHealth } from "./types.js";
import type { NodeRow, PanelRow } from "../../types.js";

interface MarzbanUser {
  username: string;
  status: string;
  expire?: number | null;
  data_limit?: number | null;
  used_traffic?: number | null;
  subscription_url?: string;
  proxies?: Record<string, unknown>;
  inbounds?: Record<string, string[]>;
  links?: string[];
  online_at?: string | null;
  note?: string | null;
}

const tokens = new Map<number, { token: string; expiresAt: number }>();

export class MarzbanClient implements NodeClient {
  private readonly base: string;
  private readonly panel: PanelRow;
  private readonly node: NodeRow;

  constructor(panel: PanelRow, node: NodeRow) {
    this.panel = panel;
    this.node = node;
    this.base = panel.base_url.replace(/\/+$/, "");
  }

  private async token(): Promise<string> {
    if (this.panel.api_token) return this.panel.api_token;
    const cached = tokens.get(this.panel.id);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const body = new URLSearchParams({ username: this.panel.username ?? "", password: this.panel.password ?? "" });
    const response = await fetch(`${this.base}/api/admin/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`ورود به مرزبان ناموفق بود (HTTP ${response.status})`);
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("توکن مرزبان دریافت نشد");
    tokens.set(this.panel.id, { token: data.access_token, expiresAt: Date.now() + 20 * 60_000 });
    return data.access_token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body) headers["content-type"] = headers["content-type"] ?? "application/json";
    const response = await fetch(`${this.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(25_000) });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (parsed.detail) detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
      } catch {
        /* keep raw text */
      }
      throw new Error(`مرزبان: ${detail.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async inboundMap(): Promise<Record<string, string[]>> {
    try {
      const inbounds = await this.request<Record<string, Array<{ tag: string }>>>("/api/inbounds");
      const map: Record<string, string[]> = {};
      const wanted = this.node.inbound_id ? String(this.node.inbound_id) : "";
      for (const [protocol, list] of Object.entries(inbounds)) {
        const tags = (list ?? []).map((item) => item.tag);
        map[protocol] = wanted && tags.includes(wanted) ? [wanted] : tags;
      }
      return map;
    } catch {
      const protocol = String(this.node.protocol || "vless");
      return { [protocol]: this.node.inbound_id ? [String(this.node.inbound_id)] : [] };
    }
  }

  private async buildPayload(spec: ClientSpec): Promise<Record<string, unknown>> {
    const protocol = String(this.node.protocol || "vless");
    const inbounds = await this.inboundMap();
    return {
      username: spec.email,
      proxies: { [protocol]: {} },
      inbounds: { [protocol]: inbounds[protocol]?.length ? inbounds[protocol] : [] },
      expire: spec.expiresAt ?? 0,
      data_limit: spec.limitBytes > 0 ? spec.limitBytes : 0,
      data_limit_reset_strategy: "no_reset",
      status: spec.enabled ? "active" : "disabled",
      note: spec.comment ?? `KalFetela:${spec.userId}`,
      on_hold_timeout: null,
    };
  }

  async pushClient(spec: ClientSpec): Promise<void> {
    const payload = await this.buildPayload(spec);
    try {
      await this.request(`/api/user/${encodeURIComponent(spec.email)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = (error as Error).message;
      if (!/not found|404|exist/i.test(message)) throw error;
      await this.request("/api/user", { method: "POST", body: JSON.stringify(payload) });
    }
  }

  async removeClient(email: string): Promise<void> {
    try {
      await this.request(`/api/user/${encodeURIComponent(email)}`, { method: "DELETE" });
    } catch (error) {
      if (!/not found|404/i.test((error as Error).message)) throw error;
    }
  }

  async resetClient(email: string): Promise<void> {
    await this.request(`/api/user/${encodeURIComponent(email)}/reset`, { method: "POST" });
  }

  async getUser(email: string): Promise<MarzbanUser | null> {
    try {
      return await this.request<MarzbanUser>(`/api/user/${encodeURIComponent(email)}`);
    } catch {
      return null;
    }
  }

  async listClients(): Promise<NodeClientInfo[]> {
    const users = await this.request<{ users?: MarzbanUser[] } | MarzbanUser[]>("/api/users?limit=1000");
    const list = Array.isArray(users) ? users : (users.users ?? []);
    return list.map((user) => ({
      email: user.username,
      uuid: user.username,
      enabled: user.status !== "disabled",
      up: 0,
      down: Number(user.used_traffic ?? 0),
      total: Number(user.data_limit ?? 0),
      expiry: user.expire ?? null,
      online: Boolean(user.online_at && new Date(user.online_at).getTime() > Date.now() - 300_000),
    }));
  }

  async health(): Promise<NodeHealth> {
    try {
      const system = await this.request<{ version?: string; mem_total?: number; mem_used?: number; cpu_usage?: number }>(
        "/api/system"
      );
      return {
        ok: true,
        status: "online",
        cpuLoad: system?.cpu_usage ?? null,
        memLoad: system?.mem_total ? Math.round(((system.mem_used ?? 0) / system.mem_total) * 100) : null,
        coreVersion: system?.version ?? null,
      };
    } catch (error) {
      return { ok: false, status: "error", error: (error as Error).message };
    }
  }

  async describe(): Promise<Record<string, unknown>> {
    const inbounds = await this.inboundMap();
    return { panel: this.panel.name, inbounds, millisHint: secondsToMillis(null) };
  }
}

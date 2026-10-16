// 3x-ui / sanaei / alireza panel client (the classic `/panel/api/*` REST API).

import { secondsToMillis, type ClientSpec, type NodeClient, type NodeClientInfo, type NodeHealth } from "./types.js";
import type { NodeRow, PanelRow, Protocol } from "../../types.js";

interface XuiSession {
  cookie: string | null;
  bearer: string | null;
  expiresAt: number;
}

interface XuiInbound {
  id: number;
  remark?: string;
  protocol: string;
  port: number;
  tag?: string;
  enable?: boolean;
  settings?: string;
  streamSettings?: string;
  clientStats?: XuiClientStat[];
}

interface XuiClientStat {
  id?: number;
  inboundId?: number;
  enable?: boolean;
  email: string;
  up: number;
  down: number;
  expiryTime?: number;
  total?: number;
  reset?: number;
}

const sessions = new Map<number, XuiSession>();

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Adds a path prefix when the panel lives under a custom base path. */
function withBase(base: string, path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${base}${path}`;
}

export class XuiClient implements NodeClient {
  private readonly base: string;
  private readonly panel: PanelRow;
  private readonly node: NodeRow;
  private inbounds: XuiInbound[] | null = null;
  private lastFetch = 0;

  constructor(panel: PanelRow, node: NodeRow) {
    this.panel = panel;
    this.node = node;
    // allow a per-node path override (some installs use /xui or /mypanel)
    const extraPath = (() => {
      try {
        const extra = panel.extra ? (JSON.parse(panel.extra) as { base_path?: string }) : {};
        return extra.base_path ? `/${extra.base_path.replace(/^\/+|\/+$/g, "")}` : "";
      } catch {
        return "";
      }
    })();
    this.base = `${normalizeBase(panel.base_url)}${extraPath}`;
  }

  private get isTokenAuth(): boolean {
    return Boolean(this.panel.api_token);
  }

  private async login(): Promise<XuiSession> {
    const cached = sessions.get(this.panel.id);
    if (cached && cached.expiresAt > Date.now() && (cached.cookie || cached.bearer)) return cached;

    if (this.panel.api_token) {
      const session: XuiSession = { cookie: null, bearer: this.panel.api_token, expiresAt: Date.now() + 6 * 3600_000 };
      sessions.set(this.panel.id, session);
      return session;
    }

    const response = await fetch(`${this.base}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ username: this.panel.username ?? "", password: this.panel.password ?? "" }),
      signal: AbortSignal.timeout(15_000),
    });
    const setCookie = response.headers.get("set-cookie");
    const text = await response.text();
    let ok = response.ok;
    try {
      const data = JSON.parse(text) as { success?: boolean };
      if (data && data.success === false) ok = false;
    } catch {
      /* the login page HTML means we failed */
      ok = ok && !text.includes("<html");
    }
    if (!ok) throw new Error(`ورود به پنل ${this.panel.name} ناموفق بود`);
    const cookie = setCookie?.split(";")[0] ?? null;
    const session: XuiSession = { cookie, bearer: null, expiresAt: Date.now() + 30 * 60_000 };
    sessions.set(this.panel.id, session);
    return session;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = await this.login();
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (session.bearer) headers.authorization = `Bearer ${session.bearer}`;
    if (session.cookie) headers.cookie = session.cookie;
    if (init.method && init.method !== "GET") headers["content-type"] = headers["content-type"] ?? "application/json";

    const response = await fetch(withBase(this.base, path), { ...init, headers, signal: AbortSignal.timeout(20_000) });
    if (response.status === 401 || response.status === 403) {
      sessions.delete(this.panel.id);
      throw new Error("احراز هویت پنل نامعتبر شد");
    }
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      if (text.includes("<html") || text.includes("<!DOCTYPE")) throw new Error("پاسخ پنل HTML بود (آدرس یا مسیر پنل را بررسی کنید)");
      throw new Error(`پاسخ نامعتبر از پنل: ${text.slice(0, 120)}`);
    }
    const data = payload as { success?: boolean; msg?: string; obj?: T } | null;
    if (data && data.success === false) throw new Error(data.msg || "درخواست پنل با خطا مواجه شد");
    if (!response.ok) throw new Error(data?.msg || `HTTP ${response.status}`);
    return (data?.obj ?? (payload as T)) as T;
  }

  private async listInbounds(force = false): Promise<XuiInbound[]> {
    if (!force && this.inbounds && Date.now() - this.lastFetch < 15_000) return this.inbounds;
    const result = await this.request<XuiInbound[]>("/panel/api/inbounds/list");
    this.inbounds = Array.isArray(result) ? result : [];
    this.lastFetch = Date.now();
    return this.inbounds;
  }

  private async inbound(): Promise<XuiInbound> {
    const list = await this.listInbounds(true);
    const byId = this.node.inbound_id ? list.find((item) => String(item.id) === String(this.node.inbound_id)) : undefined;
    if (byId) return byId;
    const byTag = this.node.settings ? (() => {
      try {
        return (JSON.parse(this.node.settings) as { tag?: string }).tag;
      } catch {
        return undefined;
      }
    })() : undefined;
    if (byTag) {
      const match = list.find((item) => item.tag === byTag);
      if (match) return match;
    }
    const byPort = list.find((item) => Number(item.port) === Number(this.node.port));
    if (byPort) return byPort;
    throw new Error("اینباند مورد نظر روی پنل پیدا نشد (inbound id را بررسی کنید)");
  }

  private buildClientPayload(spec: ClientSpec, protocol: string): Record<string, unknown> {
    const base: Record<string, unknown> = {
      email: spec.email,
      limitIp: spec.deviceLimit || 0,
      totalGB: spec.limitBytes > 0 ? Number((spec.limitBytes / 1024 ** 3).toFixed(4)) : 0,
      expiryTime: secondsToMillis(spec.expiresAt),
      enable: spec.enabled,
      tgId: spec.telegramId ? String(spec.telegramId) : "",
      subId: spec.username,
      comment: spec.comment ?? `KalFetela:${spec.userId}`,
      reset: 0,
    };
    switch (protocol) {
      case "vmess":
        return { ...base, id: spec.uuid, alterId: 0, security: "auto" };
      case "trojan":
        return { ...base, password: spec.password || spec.uuid, flow: "" };
      case "shadowsocks":
        return { ...base, method: "2022-blake3-aes-128-gcm", password: spec.password || spec.uuid };
      default:
        return { ...base, id: spec.uuid, flow: spec.speedMbps ? "" : "" };
    }
  }

  async pushClient(spec: ClientSpec): Promise<void> {
    const inbound = await this.inbound();
    const protocol = (this.node.protocol || inbound.protocol) as Protocol;
    const client = this.buildClientPayload(spec, protocol);
    const settings = JSON.stringify({ clients: [client] });
    const existing = await this.findClient(spec.email);

    if (existing) {
      const clientId = (existing.client.id as string) ?? spec.uuid;
      await this.request(`/panel/api/inbounds/updateClient/${clientId}`, {
        method: "POST",
        body: JSON.stringify({ id: inbound.id, settings }),
      });
      return;
    }
    await this.request("/panel/api/inbounds/addClient", {
      method: "POST",
      body: JSON.stringify({ id: inbound.id, settings }),
    });
    this.inbounds = null;
  }

  private async findClient(email: string): Promise<{ inbound: XuiInbound; client: Record<string, unknown> } | null> {
    const inbound = await this.inbound();
    try {
      const settings = inbound.settings ? (JSON.parse(inbound.settings) as { clients?: Record<string, unknown>[] }) : {};
      const client = (settings.clients ?? []).find((item) => String(item.email) === email);
      if (client) return { inbound, client };
    } catch {
      /* fall through to traffic lookup */
    }
    const stats = await this.listInbounds(true);
    const stat = stats.flatMap((item) => item.clientStats ?? []).find((item) => item.email === email);
    if (stat) {
      return { inbound, client: { id: stat.id, email: stat.email } };
    }
    return null;
  }

  async removeClient(email: string): Promise<void> {
    const inbound = await this.inbound();
    const found = await this.findClient(email);
    if (!found) return;
    const clientId = String(found.client.id ?? found.client.password ?? email);
    await this.request(`/panel/api/inbounds/${inbound.id}/delClient/${clientId}`, { method: "POST" });
    this.inbounds = null;
  }

  async resetClient(email: string): Promise<void> {
    const inbound = await this.inbound();
    try {
      await this.request(`/panel/api/inbounds/resetClientTraffic/${inbound.id}`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    } catch {
      const all = await this.listInbounds(true);
      const stat = all.flatMap((item) => item.clientStats ?? []).find((item) => item.email === email);
      if (stat?.id) {
        await this.request(`/panel/api/inbounds/resetClientTraffic/${inbound.id}/${stat.id}`, { method: "POST" });
      }
    }
  }

  async listClients(): Promise<NodeClientInfo[]> {
    const list = await this.listInbounds(true);
    const out: NodeClientInfo[] = [];
    for (const inbound of list) {
      if (this.node.inbound_id && String(inbound.id) !== String(this.node.inbound_id)) continue;
      const settings = inbound.settings ? (JSON.parse(inbound.settings) as { clients?: Record<string, unknown>[] }) : { clients: [] };
      const statsByEmail = new Map((inbound.clientStats ?? []).map((stat) => [stat.email, stat]));
      for (const client of settings.clients ?? []) {
        const email = String(client.email ?? "");
        const stat = statsByEmail.get(email);
        out.push({
          email,
          uuid: String(client.id ?? client.password ?? email),
          enabled: client.enable !== false && stat?.enable !== false,
          up: Number(stat?.up ?? 0),
          down: Number(stat?.down ?? 0),
          total: stat?.total ? Number(stat.total) * 1024 ** 3 : 0,
          expiry: stat?.expiryTime && stat.expiryTime > 0 ? Math.floor(stat.expiryTime / 1000) : null,
        });
      }
      for (const stat of inbound.clientStats ?? []) {
        if (!out.some((item) => item.email === stat.email)) {
          out.push({
            email: stat.email,
            uuid: stat.email,
            enabled: stat.enable !== false,
            up: Number(stat.up ?? 0),
            down: Number(stat.down ?? 0),
            total: stat.total ? Number(stat.total) * 1024 ** 3 : 0,
            expiry: stat.expiryTime && stat.expiryTime > 0 ? Math.floor(stat.expiryTime / 1000) : null,
          });
        }
      }
    }
    return out;
  }

  async onlineEmails(): Promise<string[]> {
    try {
      const result = await this.request<string[] | null>("/panel/api/inbounds/onlines", { method: "POST" });
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async health(): Promise<NodeHealth> {
    try {
      await this.listInbounds(true);
      let cpuLoad: number | null = null;
      let memLoad: number | null = null;
      let uptime: number | null = null;
      try {
        const status = await this.request<{ cpu?: number; mem?: { current?: number; total?: number }; uptime?: number }>(
          "/server/status"
        );
        cpuLoad = status?.cpu ?? null;
        memLoad = status?.mem?.total ? Math.round(((status.mem.current ?? 0) / status.mem.total) * 100) : null;
        uptime = status?.uptime ?? null;
      } catch {
        /* optional endpoint */
      }
      return { ok: true, status: "online", cpuLoad, memLoad, uptimeSeconds: uptime };
    } catch (error) {
      return { ok: false, status: "error", error: (error as Error).message };
    }
  }

  /** Full inbound list (used to import inbounds as panel nodes). */
  async allInbounds(): Promise<Array<Record<string, unknown>>> {
    const list = await this.listInbounds(true);
    return list.map((inbound) => {
      const stream = inbound.streamSettings ? (JSON.parse(inbound.streamSettings) as Record<string, unknown>) : {};
      const network = String(stream.network ?? "tcp");
      const security = String(stream.security ?? "none");
      const wsSettings = (stream.wsSettings ?? (stream as Record<string, unknown>).wsSettings) as Record<string, unknown> | undefined;
      const reality = (stream.realitySettings ?? {}) as Record<string, unknown>;
      return {
        id: inbound.id,
        tag: inbound.tag,
        remark: inbound.remark,
        protocol: inbound.protocol,
        port: inbound.port,
        network,
        security,
        path: wsSettings?.path ?? (stream.httpupgradeSettings as Record<string, unknown> | undefined)?.path,
        sni: (stream.tlsSettings as Record<string, unknown> | undefined)?.serverName ?? (reality.serverNames as string[] | undefined)?.[0],
        publicKey: reality.publicKey,
        shortId: (reality.shortIds as string[] | undefined)?.[0],
        serviceName: (stream.grpcSettings as Record<string, unknown> | undefined)?.serviceName,
        enable: inbound.enable,
        stream,
      };
    });
  }

  async describe(): Promise<Record<string, unknown>> {
    const list = await this.listInbounds(true);
    return {
      panel: this.panel.name,
      inbounds: list.map((inbound) => ({
        id: inbound.id,
        remark: inbound.remark,
        protocol: inbound.protocol,
        port: inbound.port,
      })),
    };
  }
}

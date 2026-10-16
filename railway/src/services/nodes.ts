// Node dispatcher: talks to every node kind through one interface and owns
// the user↔node synchronisation + traffic collection loop.

import { getSetting } from "../db/index.js";
import { nowSeconds } from "../lib/format.js";
import { randomHex } from "../lib/crypto.js";
import { applyUsage, getUser, getUserNodes, listNodes, getNode, listUsers, refreshUserStatus, updateNode, type UserStatusHandler } from "./store.js";
import { embeddedXray, ensureRealitySettings, type EmbeddedInboundSpec } from "./clients/local.js";
import { MarzbanClient } from "./clients/marzban.js";
import { XuiClient } from "./clients/xui.js";
import { specFromUser, type ClientSpec, type NodeClient, type NodeClientInfo } from "./clients/types.js";
import { getPanel } from "./store.js";
import { ensureWireguardClient as createWireguardClient } from "./wireguard.js";
import type { NodeRow, PanelRow, UserRow } from "../types.js";

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

const lastSnapshot = new Map<string, { up: number; down: number }>();

/* ------------------------------ agent client ---------------------------- */

class AgentClient implements NodeClient {
  constructor(private readonly node: NodeRow) {}

  private url(path: string): string {
    const scheme = this.node.security === "none" ? "http" : "https";
    const host = this.node.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `${scheme}://${host}${this.node.port && !/:\d+$/.test(host) ? `:${this.node.port}` : ""}${path}`;
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.url(path), {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-agent-secret": this.node.agent_secret ?? this.node.private_key ?? "",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`agent: HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  async pushClient(spec: ClientSpec): Promise<void> {
    await this.call("/agent/client", {
      inbound: this.node.inbound_id ?? `node-${this.node.id}`,
      protocol: this.node.protocol,
      client: {
        email: spec.email,
        uuid: spec.uuid,
        password: spec.password,
        limitBytes: spec.limitBytes,
        expiresAt: spec.expiresAt,
        deviceLimit: spec.deviceLimit,
        enabled: spec.enabled,
      },
    });
  }

  async removeClient(email: string): Promise<void> {
    await this.call("/agent/client/remove", { inbound: this.node.inbound_id ?? `node-${this.node.id}`, email });
  }

  async listClients(): Promise<NodeClientInfo[]> {
    const data = await this.call<{ clients?: NodeClientInfo[] }>("/agent/clients");
    return data.clients ?? [];
  }

  async health(): Promise<{ ok: boolean; status: "online" | "offline" | "error"; error?: string | null; cpuLoad?: number | null; memLoad?: number | null }> {
    try {
      const data = await this.call<{ cpu?: number; mem?: number; version?: string }>("/agent/status");
      await updateNode(this.node.id, { core_version: data.version ?? null });
      return { ok: true, status: "online", cpuLoad: data.cpu ?? null, memLoad: data.mem ?? null };
    } catch (error) {
      return { ok: false, status: "error", error: (error as Error).message };
    }
  }
}

/* ------------------------------- dispatcher ----------------------------- */

export async function clientForNode(node: NodeRow): Promise<NodeClient> {
  if (node.kind === "embedded") {
    return embeddedFacade(node);
  }
  if (node.kind === "agent") {
    return new AgentClient(node);
  }
  if (node.kind === "panel" && node.panel_id) {
    const panel = await getPanel(node.panel_id);
    if (!panel) throw new Error("پنل مرتبط با این نود پیدا نشد");
    return panelClient(panel, node);
  }
  // "custom" nodes are link-only: nothing to push server side.
  return {
    pushClient: async () => undefined,
    removeClient: async () => undefined,
    listClients: async () => [],
    health: async () => ({ ok: true, status: "online" as const, error: null }),
  };
}

function panelClient(panel: PanelRow, node: NodeRow): NodeClient {
  const type = (panel.type || "x-ui").toLowerCase();
  if (type === "marzban") return new MarzbanClient(panel, node);
  return new XuiClient(panel, node);
}

/** Embedded nodes are configured in bulk inside the core, see syncEmbeddedCore(). */
function embeddedFacade(node: NodeRow): NodeClient {
  return {
    pushClient: async () => undefined,
    removeClient: async () => undefined,
    listClients: async () =>
      embeddedXray.getInbounds().find((inbound) => inbound.nodeId === node.id)?.clients.map((client) => ({
        email: client.email,
        uuid: client.uuid,
        enabled: client.enabled,
        up: 0,
        down: 0,
        total: client.limitBytes,
        expiry: client.expiresAt,
      })) ?? [],
    health: async () => {
      const status = embeddedXray.status();
      return {
        ok: status.installed,
        status: status.installed ? ("online" as const) : ("error" as const),
        coreVersion: status.version,
        error: status.error,
      };
    },
  };
}

/* ---------------------------- user ⇄ node sync --------------------------- */

export async function pushUserToNode(user: UserRow, node: NodeRow): Promise<void> {
  if (node.protocol === "wireguard") {
    await ensureWireguardClient(user, node);
    return;
  }
  if (node.kind === "embedded") return; // handled by syncEmbeddedCore
  const client = await clientForNode(node);
  await client.pushClient(specFromUser(user, node));
}

export async function removeUserFromNode(user: UserRow, node: NodeRow): Promise<void> {
  if (node.kind === "embedded") return;
  try {
    const client = await clientForNode(node);
    await client.removeClient(user.username);
  } catch (error) {
    console.warn(`[nodes] remove ${user.username}@${node.name} failed:`, (error as Error).message);
  }
}

/** Creates (and stores) the WireGuard key pair for a user on a wg node. */
export async function ensureWireguardClient(user: UserRow, node: NodeRow): Promise<void> {
  // Full implementation lives in the wireguard service; kept here as a thin
  // re-export so existing callers (routes, agent endpoints) keep working.
  await createWireguardClient(user, node);
}

/** Synchronises every node the user is attached to. */
export async function syncUser(userId: number): Promise<SyncResult> {
  const user = await getUser(userId);
  const result: SyncResult = { synced: 0, failed: 0, errors: [] };
  if (!user) return result;
  const nodes = await getUserNodes(userId);
  for (const entry of nodes) {
    const node = entry.node ?? (await getNode(entry.node_id));
    if (!node || !node.active) continue;
    try {
      await pushUserToNode(user, node);
      result.synced += 1;
    } catch (error) {
      result.failed += 1;
      const message = `${node.name}: ${(error as Error).message}`;
      result.errors.push(message);
      await updateNode(node.id, { last_error: message });
    }
  }
  await syncEmbeddedCore();
  return result;
}

export async function syncNodeUsers(nodeId: number): Promise<SyncResult> {
  const node = await getNode(nodeId);
  const result: SyncResult = { synced: 0, failed: 0, errors: [] };
  if (!node) return result;
  const rows = await getDbUserNodePairs(nodeId);
  for (const user of rows) {
    try {
      await pushUserToNode(user, node);
      result.synced += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`${user.username}: ${(error as Error).message}`);
    }
  }
  await syncEmbeddedCore();
  return result;
}

async function getDbUserNodePairs(nodeId: number): Promise<UserRow[]> {
  const users = await listUsers({ perPage: 200, page: 1 });
  const all: UserRow[] = [...users.items];
  let page = 2;
  while (all.length < users.total) {
    const next = await listUsers({ perPage: 200, page });
    if (!next.items.length) break;
    all.push(...next.items);
    page += 1;
  }
  const out: UserRow[] = [];
  for (const user of all) {
    const links = await getUserNodes(user.id);
    if (links.some((link) => link.node_id === nodeId)) out.push(user);
  }
  return out;
}

/** Rebuilds the embedded core inbounds (all embedded nodes + their users). */
export async function syncEmbeddedCore(): Promise<void> {
  const embeddedNodes = (await listNodes({ kind: "embedded" })).filter((node) => node.active);
  if (!embeddedNodes.length) {
    embeddedXray.setInbounds([]);
    return;
  }
  const specs: EmbeddedInboundSpec[] = [];
  for (const node of embeddedNodes) {
    const users = await getDbUserNodePairs(node.id);
    const reality =
      node.security === "reality"
        ? ensureRealitySettings({
            privateKey: node.reality_private_key,
            publicKey: node.reality_public_key,
            shortId: node.reality_short_id,
            dest: node.reality_dest,
          })
        : null;
    if (reality && (!node.reality_private_key || !node.reality_public_key)) {
      await updateNode(node.id, {
        reality_private_key: reality.privateKey,
        reality_public_key: reality.publicKey,
        reality_short_id: reality.shortIds[0] ?? randomHex(4),
        reality_dest: reality.dest,
      });
      node.reality_private_key = reality.privateKey;
      node.reality_public_key = reality.publicKey;
      node.reality_short_id = reality.shortIds[0] ?? null;
      node.reality_dest = reality.dest;
    }
    let settings: Record<string, unknown> = {};
    try {
      settings = node.settings ? (JSON.parse(node.settings) as Record<string, unknown>) : {};
    } catch {
      settings = {};
    }
    specs.push({
      nodeId: node.id,
      name: node.name,
      port: node.port,
      protocol: node.protocol,
      transport: node.transport,
      security: node.security,
      host: node.host,
      sni: node.sni,
      path: node.path,
      serviceName: node.service_name,
      flow: node.flow,
      fingerprint: node.fingerprint,
      reality,
      settings,
      clients: users
        .filter((user) => !["disabled", "on_hold"].includes(user.status))
        .map((user) => specFromUser(user, node)),
    });
  }
  embeddedXray.setInbounds(specs);
}

/* --------------------------- traffic collection ------------------------- */

export async function collectTraffic(): Promise<{ applied: number }> {
  const nodes = await listNodes({ activeOnly: true });
  let applied = 0;
  for (const node of nodes) {
    if (node.kind === "embedded" || node.protocol === "wireguard") continue;
    try {
      const client = await clientForNode(node);
      const clients = await client.listClients();
      for (const info of clients) {
        const user = await getUserByEmail(info.email);
        if (!user) continue;
        const key = `${node.id}:${info.email}`;
        const previous = lastSnapshot.get(key) ?? { up: info.up, down: info.down };
        const up = Math.max(0, info.up - previous.up);
        const down = Math.max(0, info.down - previous.down);
        lastSnapshot.set(key, { up: info.up, down: info.down });
        if (up + down <= 0) continue;
        await applyUsage(user.id, up, down, { nodeId: node.id, adminId: user.admin_id });
        applied += 1;
      }
      await updateNode(node.id, {
        status: "online",
        last_heartbeat_at: nowSeconds(),
        last_error: null,
      });
    } catch (error) {
      await updateNode(node.id, {
        status: "error",
        last_error: (error as Error).message.slice(0, 300),
        last_heartbeat_at: nowSeconds(),
      });
    }
  }
  return { applied };
}

async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const { getUserByUsername } = await import("./store.js");
  const byName = await getUserByUsername(email);
  if (byName) return byName;
  const { getDb } = await import("../db/index.js");
  return getDb().get<UserRow>("SELECT * FROM users WHERE email = ? OR uuid = ?", [email, email]);
}

/** Applies the deltas reported by the embedded core. */
export async function applyEmbeddedUsage(deltas: Array<{ email: string; upload: number; download: number }>): Promise<void> {
  for (const delta of deltas) {
    const user = await getUserByEmail(delta.email);
    if (!user) continue;
    await applyUsage(user.id, delta.upload, delta.download, { adminId: user.admin_id });
  }
}

/* ------------------------------- health --------------------------------- */

export async function healthCheckAll(): Promise<void> {
  const nodes = await listNodes({ activeOnly: true });
  for (const node of nodes) {
    try {
      const client = await clientForNode(node);
      const health = await client.health();
      await updateNode(node.id, {
        status: health.status,
        cpu_load: health.cpuLoad ?? null,
        mem_load: health.memLoad ?? null,
        uptime_seconds: health.uptimeSeconds ?? null,
        core_version: health.coreVersion ?? node.core_version ?? null,
        last_heartbeat_at: nowSeconds(),
        last_error: health.error ?? null,
      });
    } catch (error) {
      await updateNode(node.id, {
        status: "error",
        last_error: (error as Error).message.slice(0, 300),
        last_heartbeat_at: nowSeconds(),
      });
    }
  }
}

/* --------------------------- enforcement hook -------------------------- */

/**
 * Enforces quota/expiry/device limits: containers that are no longer allowed
 * are removed from the nodes, restored ones are pushed back.
 */
export const statusEnforcement: UserStatusHandler = async (user, previous, next) => {
  if (next === "disabled" || next === "limited" || next === "expired" || next === "on_hold") {
    const nodes = await getUserNodes(user.id);
    for (const entry of nodes) {
      const node = entry.node ?? (await getNode(entry.node_id));
      if (!node || node.kind === "embedded") continue;
      await removeUserFromNode(user, node);
    }
    await syncEmbeddedCore();
    return;
  }
  if (next === "active") {
    await syncUser(user.id);
  }
  void previous;
};

/** Runs device/IP limit enforcement for the embedded core. */
export async function enforceDeviceLimits(): Promise<Array<{ user: UserRow; ips: string[] }>> {
  const windowSeconds = Number(await getSetting("online_window_minutes", "5")) * 60;
  const snapshot = embeddedXray.onlineSnapshot(windowSeconds || 300);
  const violations: Array<{ user: UserRow; ips: string[] }> = [];
  const blockEnabled = (await getSetting("device_limit_block", "false")) === "true";
  for (const entry of snapshot) {
    const user = await getUserByEmail(entry.email);
    if (!user) continue;
    user.online_ips = JSON.stringify(entry.ips);
    const { getDb } = await import("../db/index.js");
    await getDb().run("UPDATE users SET online_ips = ?, last_online_at = ? WHERE id = ?", [
      JSON.stringify(entry.ips),
      nowSeconds(),
      user.id,
    ]);
    if (user.device_limit > 0 && entry.ips.length > user.device_limit) {
      violations.push({ user, ips: entry.ips });
      if (blockEnabled) {
        await getDb().run("UPDATE users SET status = 'on_hold', on_hold = 1 WHERE id = ?", [user.id]);
        await refreshUserStatus(user.id);
      }
    }
  }
  return violations;
}

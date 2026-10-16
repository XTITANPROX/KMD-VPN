// Upstream panel management (3x-ui / sanaei / marzban / custom) + inbound import.

import { Hono } from "hono";
import { audit } from "../db/index.js";
import { validate } from "../lib/validate.js";
import { clientIp, ok, readJson, requireAdmin, requireApiAuth, requirePermission, safe, type AppVariables } from "../middleware.js";
import { createNode, createPanel, deletePanel, getPanel, listPanels, updatePanel } from "../services/store.js";
import { KalFetelaRemoteClient } from "../services/clients/kalfetela.js";

import { MarzbanClient } from "../services/clients/marzban.js";
import { XuiClient } from "../services/clients/xui.js";
import { listNodes, nodeUserCounts } from "../services/store.js";
import { parseTags, serializeTags } from "../lib/tags.js";
import type { NodeRow, PanelRow } from "../types.js";

export const panelRoutes = new Hono<{ Variables: AppVariables }>();

panelRoutes.use("*", requireApiAuth);

const PANEL_TYPES = ["x-ui", "sanaei", "alireza", "marzban", "kalfetela", "custom"];

/** One node row per panel, used for admin-level operations. */
async function probeNodeFor(panel: PanelRow): Promise<NodeRow> {
  const nodes = await listNodes();
  const linked = nodes.find((node) => node.panel_id === panel.id);
  if (linked) return linked;
  return {
    id: 0,
    name: panel.name,
    kind: "panel",
    panel_id: panel.id,
    inbound_id: "0",
    protocol: "vless",
    transport: "tcp",
    security: "tls",
    host: panel.base_url.replace(/^https?:\/\//, "").split(":")[0]!,
    port: 443,
    sni: null,
    path: null,
    service_name: null,
    flow: null,
    fingerprint: null,
    alpn: null,
    reality_dest: null,
    reality_private_key: null,
    reality_public_key: null,
    reality_short_id: null,
    dns: null,
    mtu: null,
    address_v4: null,
    address_v6: null,
    agent_secret: null,
    xray_json: null,
    core_version: null,
    health: null,
    private_key: null,
    public_key: null,
    capacity: 0,
    sort: 0,
    active: 1,
    status: "unknown",
    last_error: null,
    last_heartbeat_at: null,
    cpu_load: null,
    mem_load: null,
    uptime_seconds: null,
    settings: null,
    created_at: 0,
  } as NodeRow;
}

export async function panelSummary(panel: PanelRow): Promise<Record<string, unknown>> {
  const type = (panel.type || "").toLowerCase();
  if (type === "kalfetela" || type === "kalfetela-panel") {
    return new KalFetelaRemoteClient(panel).summary();
  }
  const node = await probeNodeFor(panel);
  const client = type === "marzban" ? new MarzbanClient(panel, node) : new XuiClient(panel, node);
  try {
    const health = await client.health();
    return {
      online: health.ok,
      latency_ms: null,
      version: health.coreVersion ?? null,
      cpu: health.cpuLoad ?? null,
      ram_percent: health.memLoad ?? null,
      error: health.error ?? null,
    };
  } catch (error) {
    return { online: false, error: (error as Error).message };
  }
}

panelRoutes.get(
  "/",
  safe(async (c) => {
    const [panels, nodes] = await Promise.all([listPanels(), listNodes()]);
    const counts = await nodeUserCounts();
    return ok(c, {
      panels: panels.map((panel) => {
        const panelNodes = nodes.filter((node) => node.panel_id === panel.id);
        return {
          ...panel,
          tags: parseTags(panel.tags),
          node_count: panelNodes.length,
          local_users: panelNodes.reduce((sum, node) => sum + (counts[node.id] ?? 0), 0),
        };
      }),
    });
  })
);

/**
 * Fleet dashboard: every connected panel with its live numbers plus how many
 * local users/nodes point at it. Designed for dozens of Railway deployments.
 */
panelRoutes.get(
  "/fleet",
  safe(async (c) => {
    const [panels, nodes, counts] = await Promise.all([listPanels(), listNodes(), nodeUserCounts()]);
    const perPanelUsers = new Map<number, number>();
    for (const node of nodes) {
      if (!node.panel_id) continue;
      perPanelUsers.set(node.panel_id, (perPanelUsers.get(node.panel_id) ?? 0) + (counts[node.id] ?? 0));
    }
    const rows = await Promise.all(
      panels.map(async (panel) => {
        const summary = await panelSummary(panel);
        const panelNodes = nodes.filter((node) => node.panel_id === panel.id);
        return {
          id: panel.id,
          name: panel.name,
          type: panel.type,
          base_url: panel.base_url,
          status: panel.status,
          tags: parseTags(panel.tags),
          node_count: panelNodes.length,
          local_users: perPanelUsers.get(panel.id) ?? 0,
          last_checked_at: panel.last_checked_at,
          last_error: panel.last_error,
          ...summary,
        } as Record<string, unknown> & { online?: boolean };
      })
    );
    const totals = rows.reduce(
      (acc, row) => {
        acc.panels += 1;
        if (row.online) acc.online += 1;
        acc.nodes += Number(row.node_count ?? 0);
        acc.local_users += Number(row.local_users ?? 0);
        acc.remote_users += Number(row.users ?? 0);
        acc.traffic_today += Number(row.traffic_today ?? 0);
        acc.revenue_total += Number(row.revenue_total ?? 0);
        return acc;
      },
      { panels: 0, online: 0, nodes: 0, local_users: 0, remote_users: 0, traffic_today: 0, revenue_total: 0 }
    );
    return ok(c, { panels: rows, totals });
  })
);

/** Live numbers for a single panel (used by the panels page). */
panelRoutes.get(
  "/:id/summary",
  safe(async (c) => {
    const panel = await getPanel(Number(c.req.param("id")));
    if (!panel) return c.json({ error: "پنل پیدا نشد", code: "not_found" }, 404);
    return ok(c, { summary: await panelSummary(panel) });
  })
);

panelRoutes.post(
  "/",
  requirePermission("nodes"),
  safe(async (c) => {
    const body = await readJson(c);
    const input = validate<{
      name: string;
      type: string;
      base_url: string;
      username?: string;
      password?: string;
      api_token?: string;
      sub_base_url?: string;
      notes?: string;
    }>(body, (v) => {
      v.string("name", { required: true, max: 64, label: "نام پنل" });
      v.enum("type", PANEL_TYPES, { def: "x-ui", label: "نوع پنل" });
      v.string("base_url", { required: true, max: 255, label: "آدرس پنل" });
      v.string("username", { max: 64 });
      v.string("password", { max: 128 });
      v.string("api_token", { max: 512 });
      v.string("sub_base_url", { max: 255 });
      v.string("notes", { max: 500 });
      v.array("tags", { label: "برچسب‌ها" });
    });
    if ((input.type === "kalfetela" || input.type === "kalfetela-panel") && !input.api_token) {
      return c.json({ error: "برای پنل KalFetela توکن API لازم است (تنظیمات → API در پنل مقصد)", code: "validation" }, 400);
    }
    const url = input.base_url.match(/^https?:\/\//) ? input.base_url : `https://${input.base_url}`;
    const panel = await createPanel({
      name: input.name,
      type: input.type,
      base_url: url,
      username: input.username ?? null,
      password: input.password ?? null,
      api_token: input.api_token ?? null,
      sub_base_url: input.sub_base_url ?? null,
      tags: serializeTags(body.tags),
      notes: input.notes ?? null,
      extra: body.extra ? JSON.stringify(body.extra) : null,
    });
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "panel_create", target: panel.name, ip: clientIp(c) });
    return ok(c, { panel }, 201);
  })
);

panelRoutes.put(
  "/:id",
  requirePermission("nodes"),
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const panel = await getPanel(id);
    if (!panel) return c.json({ error: "پنل پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "type", "base_url", "username", "password", "api_token", "sub_base_url", "proxy_url", "status", "last_error", "notes"]) {
      if (body[key] !== undefined) patch[key] = body[key] === "" ? null : body[key];
    }
    if (body.extra !== undefined) patch.extra = body.extra ? JSON.stringify(body.extra) : null;
    if (body.tags !== undefined) patch.tags = serializeTags(body.tags);
    await updatePanel(id, patch);
    return ok(c, { panel: await getPanel(id) });
  })
);

panelRoutes.delete(
  "/:id",
  requirePermission("nodes"),
  safe(async (c) => {
    const id = Number(c.req.param("id"));
    const panel = await getPanel(id);
    if (!panel) return c.json({ error: "پنل پیدا نشد", code: "not_found" }, 404);
    await deletePanel(id);
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "panel_delete", target: panel.name, ip: clientIp(c) });
    return ok(c, { message: "پنل حذف شد" });
  })
);

panelRoutes.post(
  "/:id/test",
  safe(async (c) => {
    const panel = await getPanel(Number(c.req.param("id")));
    if (!panel) return c.json({ error: "پنل پیدا نشد", code: "not_found" }, 404);
    try {
      const inbounds = await listInbounds(panel);
      await updatePanel(panel.id, { status: "online", last_error: null, last_checked_at: Math.floor(Date.now() / 1000) });
      return ok(c, { status: "online", inbounds });
    } catch (error) {
      await updatePanel(panel.id, { status: "error", last_error: (error as Error).message, last_checked_at: Math.floor(Date.now() / 1000) });
      return c.json({ error: (error as Error).message, code: "panel_error" }, 502);
    }
  })
);

/** Lists remote inbounds so they can be imported as nodes. */
panelRoutes.get(
  "/:id/inbounds",
  safe(async (c) => {
    const panel = await getPanel(Number(c.req.param("id")));
    if (!panel) return c.json({ error: "پنل پیدا نشد", code: "not_found" }, 404);
    try {
      const type = (panel.type || "").toLowerCase();
      if (type === "kalfetela" || type === "kalfetela-panel") {
        const remote = await new KalFetelaRemoteClient(panel).remoteNodes();
        return ok(c, {
          kind: "kalfetela",
          inbounds: remote.map((node) => ({
            id: node.id,
            remark: node.name,
            protocol: node.protocol,
            port: node.port,
            transport: node.transport,
            security: node.security,
            sni: node.sni,
            path: node.path,
            serviceName: node.service_name,
            flow: node.flow,
            publicKey: node.reality_public_key,
            shortId: node.reality_short_id,
            host: node.host,
            active: node.active,
            user_count: node.user_count ?? 0,
          })),
        });
      }
      return ok(c, { inbounds: await listInbounds(panel) });
    } catch (error) {
      return c.json({ error: (error as Error).message, code: "panel_error" }, 502);
    }
  })
);

/** Imports one or more inbounds of a remote panel as nodes. */
panelRoutes.post(
  "/:id/import",
  requirePermission("nodes"),
  safe(async (c) => {
    const panel = await getPanel(Number(c.req.param("id")));
    if (!panel) return c.json({ error: "پنل پیدا نشد", code: "not_found" }, 404);
    const body = await readJson(c);
    const selected = Array.isArray(body.inbounds) ? (body.inbounds as Record<string, unknown>[]) : [];
    const host = String(body.host ?? "").trim() || panel.base_url.replace(/^https?:\/\//, "").split(":")[0]!;
    const created: string[] = [];
    const type = (panel.type || "").toLowerCase();
    const isFleet = type === "kalfetela" || type === "kalfetela-panel";
    for (const item of selected) {
      const inboundId = String(item.id ?? "");
      const protocol = String(item.protocol ?? "vless");
      const port = Number(item.port ?? 443);
      const remark = String(item.remark ?? item.tag ?? `${panel.name}-${inboundId}`);
      const node = await createNode({
        name: remark,
        kind: "panel",
        panel_id: panel.id,
        inbound_id: inboundId,
        protocol: protocol === "shadowsocks" ? "shadowsocks" : protocol,
        transport: String(item.network ?? item.transport ?? "ws"),
        security: String(item.security ?? "tls"),
        host,
        port,
        sni: item.sni ? String(item.sni) : isFleet && item.host ? String(item.host) : null,
        path: item.path ? String(item.path) : null,
        service_name: item.serviceName ? String(item.serviceName) : null,
        reality_public_key: item.publicKey ? String(item.publicKey) : null,
        reality_short_id: item.shortId ? String(item.shortId) : null,
        flow: isFleet && item.flow ? String(item.flow) : null,
        dns: isFleet && item.dns ? String(item.dns) : null,
        mtu: isFleet && item.mtu ? Number(item.mtu) : null,
        status: "unknown",
        active: item.active === false ? 0 : 1,
      });
      created.push(node.name);
    }
    await audit({ adminId: c.get("admin").id, actor: c.get("admin").username, action: "panel_import", target: panel.name, meta: { created }, ip: clientIp(c) });
    return ok(c, { created });
  })
);

async function listInbounds(panel: PanelRow): Promise<Array<Record<string, unknown>>> {
  const type = (panel.type || "x-ui").toLowerCase();
  if (type === "marzban") {
    const client = new MarzbanClient(panel, {} as NodeRow);
    const map = await client.inboundMap();
    const out: Array<Record<string, unknown>> = [];
    for (const [protocol, tags] of Object.entries(map)) {
      for (const tag of tags) {
        out.push({ id: tag, tag, protocol, remark: tag, port: Number(panel.base_url.match(/:(\d+)/)?.[1] ?? 443) });
      }
    }
    return out;
  }
  const stub = { id: 0, port: 0, inbound_id: null, settings: null, protocol: "vless" } as unknown as NodeRow;
  const client = new XuiClient(panel, stub);
  return client.allInbounds();
}

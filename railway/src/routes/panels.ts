// Upstream panel management (3x-ui / sanaei / marzban / custom) + inbound import.

import { Hono } from "hono";
import { audit } from "../db/index.js";
import { validate } from "../lib/validate.js";
import { clientIp, ok, readJson, requireAdmin, requirePermission, safe, type AppVariables } from "../middleware.js";
import { createNode, createPanel, deletePanel, getPanel, listPanels, updatePanel } from "../services/store.js";
import { MarzbanClient } from "../services/clients/marzban.js";
import { XuiClient } from "../services/clients/xui.js";
import type { NodeRow, PanelRow } from "../types.js";

export const panelRoutes = new Hono<{ Variables: AppVariables }>();

panelRoutes.use("*", requireAdmin);

const PANEL_TYPES = ["x-ui", "sanaei", "alireza", "marzban", "custom"];

panelRoutes.get(
  "/",
  safe(async (c) => {
    const panels = await listPanels();
    return ok(c, { panels });
  })
);

panelRoutes.post(
  "/",
  requirePermission("nodes"),
  safe(async (c) => {
    const body = await readJson(c);
    const input = validate<{ name: string; type: string; base_url: string; username?: string; password?: string; api_token?: string; sub_base_url?: string }>(
      body,
      (v) => {
        v.string("name", { required: true, max: 64, label: "نام پنل" });
        v.enum("type", PANEL_TYPES, { def: "x-ui", label: "نوع پنل" });
        v.string("base_url", { required: true, max: 255, label: "آدرس پنل" });
        v.string("username", { max: 64 });
        v.string("password", { max: 128 });
        v.string("api_token", { max: 512 });
        v.string("sub_base_url", { max: 255 });
      }
    );
    const url = input.base_url.match(/^https?:\/\//) ? input.base_url : `https://${input.base_url}`;
    const panel = await createPanel({
      name: input.name,
      type: input.type,
      base_url: url,
      username: input.username ?? null,
      password: input.password ?? null,
      api_token: input.api_token ?? null,
      sub_base_url: input.sub_base_url ?? null,
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
    for (const key of ["name", "type", "base_url", "username", "password", "api_token", "sub_base_url", "proxy_url", "status", "last_error"]) {
      if (body[key] !== undefined) patch[key] = body[key] === "" ? null : body[key];
    }
    if (body.extra !== undefined) patch.extra = body.extra ? JSON.stringify(body.extra) : null;
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
        sni: item.sni ? String(item.sni) : null,
        path: item.path ? String(item.path) : null,
        service_name: item.serviceName ? String(item.serviceName) : null,
        reality_public_key: item.publicKey ? String(item.publicKey) : null,
        reality_short_id: item.shortId ? String(item.shortId) : null,
        status: "unknown",
        active: 1,
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

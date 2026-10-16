// End-to-end API test: install → login → nodes/plans/users → subscription → agent API.

import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

let app: Hono;
let cookie = "";
let userId = 0;
let nodeId = 0;
let subToken = "";
let apiKey = "";

async function call(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

beforeAll(async () => {
  fs.rmSync("./test-data", { recursive: true, force: true });
  const { initDb } = await import("../src/db/index.js");
  await initDb();
  const { createApp } = await import("../src/app.js");
  app = createApp() as unknown as Hono;
});

describe("panel API", () => {
  it("reports the install state and creates the owner account", async () => {
    const status = await call("/api/auth/status");
    expect(status.status).toBe(200);
    expect(status.json.data.installed).toBe(false);

    const install = await call("/api/auth/install", { method: "POST", body: { username: "owner", password: "secret123" } });
    expect(install.status).toBe(201);
    expect(install.json.data.admin.role).toBe("owner");
    const setCookie = install.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kalfetela_session");
    cookie = setCookie.split(";")[0]!;

    const me = await call("/api/auth/me");
    expect(me.json.data.admin.username).toBe("owner");
    expect(me.json.data.permissions.owner).toBe(true);
  });

  it("protects the API without a session", async () => {
    const saved = cookie;
    cookie = "";
    const response = await call("/api/users");
    expect(response.status).toBe(401);
    cookie = saved;
  });

  it("creates a custom node and a plan", async () => {
    const node = await call("/api/nodes", {
      method: "POST",
      body: { name: "تست نود", kind: "custom", protocol: "vless", transport: "ws", security: "tls", host: "test.example.com", port: 443, sni: "test.example.com", path: "/ws" },
    });
    expect(node.status).toBe(201);
    nodeId = node.json.data.node.id;

    const plan = await call("/api/plans", { method: "POST", body: { name: "پایه", price: 99000, data_gb: 30, days: 30, device_limit: 2, node_ids: [nodeId] } });
    expect(plan.status).toBe(201);
    expect(plan.json.data.plan.name).toBe("پایه");
  });

  it("creates a user with quota and returns a working subscription", async () => {
    const created = await call("/api/users", {
      method: "POST",
      body: { username: "ali_test", data_gb: 1, days: 30, device_limit: 2, node_ids: [nodeId] },
    });
    expect(created.status).toBe(201);
    userId = created.json.data.user.id;
    subToken = created.json.data.subscription.token;
    expect(subToken).toHaveLength(24);

    const list = await call("/api/users?search=ali_test");
    expect(list.json.data.total).toBe(1);
    expect(list.json.data.users[0].username).toBe("ali_test");

    // v2rayNG receives plain links…
    const raw = await call(`/sub/${subToken}`, { headers: { "user-agent": "v2rayNG/1.8" } });
    expect(raw.status).toBe(200);
    expect(raw.text).toContain("vless://");

    // …while unknown clients get a Base64 document.
    const base64 = await call(`/sub/${subToken}`);
    expect(base64.status).toBe(200);
    const decoded = Buffer.from(base64.text, "base64").toString("utf8");
    expect(decoded).toContain("vless://");
    expect(base64.headers.get("subscription-userinfo")).toContain("upload=");

    const clash = await call(`/sub/${subToken}?format=clash`);
    expect(clash.text).toContain("proxies:");

    const xray = await call(`/sub/${subToken}?format=xray`);
    const parsed = JSON.parse(xray.text);
    expect(parsed.outbounds.length).toBeGreaterThan(0);

    const info = await call(`/sub/${subToken}/info`);
    expect(info.json.data.username).toBe("ali_test");

    const page = await call(`/sub/${subToken}?format=page`);
    expect(page.text).toContain("ali_test");
  });

  it("counts usage, marks the user limited and blocks the subscription", async () => {
    const usage = await call(`/api/users/${userId}/usage`, { method: "POST", body: { upload_bytes: 600 * 1024 * 1024, download_bytes: 600 * 1024 * 1024 } });
    expect(usage.status).toBe(200);
    expect(usage.json.data.status_changed).toBe(true);
    expect(usage.json.data.user.status).toBe("limited");

    const blocked = await call(`/sub/${subToken}`);
    expect(blocked.status).toBe(403);

    const reset = await call(`/api/users/${userId}/reset`, { method: "POST" });
    expect(reset.status).toBe(200);
    const after = await call(`/api/users/${userId}`);
    expect(after.json.data.user.status).toBe("active");
    expect(after.json.data.user.data_used_bytes).toBe(0);
  });

  it("supports extend, bulk actions and export", async () => {
    const extend = await call(`/api/users/${userId}/extend`, { method: "POST", body: { days: 10, data_gb: 5 } });
    expect(extend.status).toBe(200);

    const bulk = await call("/api/users/bulk", { method: "POST", body: { ids: [userId], action: "disable" } });
    expect(bulk.json.data.affected).toBe(1);
    const afterDisable = await call(`/api/users/${userId}`);
    expect(afterDisable.json.data.user.status).toBe("disabled");

    const csv = await call("/api/users/export?format=csv");
    expect(csv.text.split("\n")[0]).toContain("username,uuid");

    await call("/api/users/bulk", { method: "POST", body: { ids: [userId], action: "enable" } });
  });

  it("creates API tokens that can read the API", async () => {
    const token = await call("/api/settings/tokens", { method: "POST", body: { name: "test", scopes: "*" } });
    expect(token.status).toBe(201);
    apiKey = token.json.data.token;

    // the session must NOT be needed: a bare API key has to authenticate on its own
    const saved = cookie;
    cookie = "";
    const response = await call("/api/users", { headers: { "x-api-key": apiKey } });
    expect(response.status).toBe(200);
    expect(response.json.data.total).toBeGreaterThan(0);
    expect((await call("/api/nodes", { headers: { "x-api-key": apiKey } })).status).toBe(200);
    expect((await call("/api/users", { headers: { "x-api-key": "kf_wrong" } })).status).toBe(401);
    cookie = saved;

    // read-only tokens can read but not write
    const readToken = await call("/api/settings/tokens", { method: "POST", body: { name: "readonly", scopes: "read" } });
    expect(readToken.status).toBe(201);
    const readKey = readToken.json.data.token;
    cookie = "";
    expect((await call("/api/plans", { headers: { "x-api-key": readKey } })).status).toBe(200);
    expect((await call("/api/plans", { method: "POST", headers: { "x-api-key": readKey }, body: { name: "nope", price: 1 } })).status).toBe(403);
    cookie = saved;
  });

  it("exposes the agent API behind the shared secret", async () => {
    const unauthorized = await call("/api/agent/config?node_id=1");
    expect(unauthorized.status).toBe(401);

    const agentNode = await call("/api/nodes", {
      method: "POST",
      body: { name: "agent-1", kind: "agent", protocol: "vless", transport: "ws", security: "tls", host: "vps.example.com", port: 443 },
    });
    const agentNodeId = agentNode.json.data.node.id;
    await call(`/api/users/${userId}/nodes`, { method: "POST", body: { node_ids: [nodeId, agentNodeId] } });

    const config = await call(`/api/agent/config?node_id=${agentNodeId}&secret=test-agent-secret`);
    expect(config.status).toBe(200);
    expect(config.json.data.clients.length).toBe(1);
    expect(config.json.data.clients[0].email).toBe("ali_test");

    const report = await call("/api/agent/report", {
      method: "POST",
      headers: { "x-agent-secret": "test-agent-secret" },
      body: { node_id: agentNodeId, usages: [{ email: "ali_test", upload: 1024, download: 2048 }] },
    });
    expect(report.json.data.applied).toBe(1);
    const user = await call(`/api/users/${userId}`);
    expect(user.json.data.user.data_used_bytes).toBe(3072);
  });

  it("serves dashboards, system info and the public pages", async () => {
    const info = await call("/api/system/info");
    expect(info.status).toBe(200);
    expect(["sqlite", "postgres"]).toContain(info.json.data.app.dialect);

    const status = await call("/api/nodes/core/status");
    expect(status.status).toBe(200);
    expect(status.json.data.installed).toBe(false);

    const landing = await call("/");
    expect(landing.status).toBe(200);
    expect(landing.text).toContain("KalFetela");

    const panel = await call("/panel");
    expect(panel.text).toContain("app.js");

    const publicInfo = await call("/api/public/info");
    expect(publicInfo.json.data.plans.length).toBeGreaterThan(0);

    const ticket = await call("/api/public/ticket", { method: "POST", body: { subject: "سلام", message: "تست پیام", name: "کاربر" } });
    expect(ticket.status).toBe(201);

    const health = await call("/healthz");
    expect(health.json.ok).toBe(true);
  });

  it("handles settings, backup and restore round trips", async () => {
    const update = await call("/api/settings", { method: "PUT", body: { panel_name: "KalFetela Test", trial_enabled: "false" } });
    expect(update.json.data.updated).toBe(2);

    const backup = await call("/api/settings/backup/download");
    expect(backup.status).toBe(200);
    const payload = JSON.parse(backup.text);
    expect(Array.isArray(payload.tables.users)).toBe(true);

    const restore = await call("/api/settings/restore", { method: "POST", body: { payload, wipe: true } });
    expect(restore.status).toBe(200);
    const users = await call("/api/users");
    expect(users.json.data.total).toBe(1);
  });

  it("provisions WireGuard nodes end to end", async () => {
    const created = await call("/api/nodes", {
      method: "POST",
      body: {
        name: "wg-de",
        kind: "custom",
        protocol: "wireguard",
        transport: "tcp",
        security: "none",
        host: "wg.example.com",
        port: 51820,
        address_v4: "10.77.0.1/24",
      },
    });
    expect(created.status).toBe(201);
    const wgNode = created.json.data.node;
    expect(wgNode.public_key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(wgNode.wireguard_public_key).toBe(wgNode.public_key);

    const server = await call(`/api/nodes/${wgNode.id}/wireguard`);
    expect(server.status).toBe(200);
    expect(server.json.data.server_address).toBe("10.77.0.1/24");
    expect(server.json.data.port).toBe(51820);
    expect(server.json.data.config).toContain("[Interface]");
    expect(server.json.data.config).toContain("ListenPort = 51820");

    const attach = await call(`/api/users/${userId}/nodes`, { method: "POST", body: { node_ids: [nodeId, wgNode.id] } });
    expect(attach.status).toBe(200);

    const client = await call(`/api/users/${userId}/wireguard`);
    expect(client.status).toBe(200);
    expect(client.json.data.configs.length).toBe(1);
    const conf = client.json.data.configs[0];
    expect(conf.node_id).toBe(wgNode.id);
    expect(conf.config).toMatch(/PrivateKey = [A-Za-z0-9+/]{43}=/);
    expect(conf.config).toContain("Endpoint = wg.example.com:51820");
    expect(conf.config).toContain("Address = 10.77.0.");
    expect(conf.address).toMatch(/^10\.77\.0\.\d+\/32$/);
    expect(conf.public_key).toMatch(/^[A-Za-z0-9+/]{43}=$/);

    // peers show up in the server config and in the agent payload
    const detail = await call(`/api/users/${userId}`);
    const username = detail.json.data.user.username as string;
    const serverAgain = await call(`/api/nodes/${wgNode.id}/wireguard`);
    expect(serverAgain.json.data.peers.map((peer: any) => peer.email)).toContain(username);
    expect(serverAgain.json.data.config).toContain(conf.public_key);

    const unauthorized = await call(`/api/agent/wireguard/${wgNode.id}`);
    expect(unauthorized.status).toBe(401);
    const agent = await call(`/api/agent/wireguard/${wgNode.id}`, { headers: { "x-agent-secret": "test-agent-secret" } });
    expect(agent.status).toBe(200);
    expect(agent.json.data.peers.length).toBeGreaterThan(0);
    expect(agent.json.data.server_public_key).toBe(wgNode.public_key);

    // keys are stable and the subscription feed carries the real config
    const again = await call(`/api/users/${userId}/wireguard`);
    expect(again.json.data.configs[0].config).toBe(conf.config);

    const sub = await call(`/sub/${subToken}?format=raw`);
    expect(sub.status).toBe(200);
    const decoded = decodeURIComponent(sub.text);
    expect(decoded).toContain("[Interface]");
    expect(decoded).toContain(`PrivateKey = ${conf.config.match(/PrivateKey = (\S+)/)![1]}`);

    const page = await call(`/sub/${subToken}?format=page`);
    expect(page.text).toContain("دانلود فایل");

    // a non-wg node must be rejected
    const wrong = await call(`/api/nodes/${nodeId}/wireguard`);
    expect(wrong.status).toBe(400);
  });

  it("serves the QR endpoint, the client-app catalogue and the panel path", async () => {
    const apps = await call("/api/public/apps");
    expect(apps.status).toBe(200);
    expect(apps.json.data.apps.length).toBeGreaterThanOrEqual(8);
    expect(apps.json.data.steps.length).toBeGreaterThanOrEqual(3);
    expect(apps.json.data.apps.every((app: any) => app.url.startsWith("http"))).toBe(true);

    const qr = await call(`/api/qr?data=${encodeURIComponent("https://example.com/sub/abc")}&scale=4`);
    expect(qr.status).toBe(200);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");
    expect(qr.text.startsWith("<svg")).toBe(true);

    expect((await call("/api/qr")).status).toBe(400);
    expect((await call(`/api/qr?data=${"x".repeat(260)}`)).status).toBe(400);

    const panelPath = (await call("/api/auth/status")).json.data.panel_path;
    expect(panelPath).toBe("/KalFetela");
    expect((await call("/KalFetela")).status).toBe(200);
  });

  it("keeps, filters and applies tags on users and nodes", async () => {
    const node = await call("/api/nodes", {
      method: "POST",
      body: { name: "tagged-node", kind: "custom", protocol: "vless", transport: "ws", security: "tls", host: "tag.example.com", port: 443, tags: ["آلمان", "پرسرعت"] },
    });
    expect(node.status).toBe(201);
    expect(node.json.data.node.tags).toEqual(["آلمان", "پرسرعت"]);

    const updated = await call(`/api/users/${userId}`, { method: "PUT", body: { tags: ["vip", "تست"] } });
    expect(updated.status).toBe(200);
    expect(updated.json.data.user.tags).toEqual(["vip", "تست"]);

    const filtered = await call("/api/users?tag=vip");
    expect(filtered.json.data.users.some((user: any) => user.id === userId)).toBe(true);
    const missing = await call("/api/users?tag=does-not-exist");
    expect(missing.json.data.users.length).toBe(0);
  });

  it("provisions a batch of accounts across the nodes", async () => {
    const batch = await call("/api/users/bulk-create", {
      method: "POST",
      body: { prefix: "bulk", count: 5, start: 1, padding: 2, data_gb: 2, days: 30, node_ids: [nodeId], distribution: "round_robin", tags: ["batch"] },
    });
    expect(batch.status).toBe(201);
    expect(batch.json.data.count).toBe(5);
    expect(batch.json.data.created.map((item: any) => item.username)).toEqual(["bulk01", "bulk02", "bulk03", "bulk04", "bulk05"]);
    expect(batch.json.data.created.every((item: any) => item.node_ids[0] === nodeId)).toBe(true);

    // a second run must not collide with the first one
    const again = await call("/api/users/bulk-create", { method: "POST", body: { prefix: "bulk", count: 2, start: 1, padding: 2, node_ids: [nodeId] } });
    expect(again.json.data.created.map((item: any) => item.username)).toEqual(["bulk06", "bulk07"]);

    const withTokens = await call("/api/users?search=bulk&with_tokens=1&per_page=50");
    expect(withTokens.json.data.users.every((user: any) => (user.sub_token ?? "").length === 24)).toBe(true);
    const withoutTokens = await call("/api/users?search=bulk&per_page=50");
    expect(withoutTokens.json.data.users.every((user: any) => user.sub_token === undefined)).toBe(true);
  });

  it("manages a fleet of remote KalFetela panels", async () => {
    const rejected = await call("/api/panels", {
      method: "POST",
      body: { name: "remote-1", type: "kalfetela", base_url: "https://127.0.0.1:9" },
    });
    expect(rejected.status).toBe(400);

    const created = await call("/api/panels", {
      method: "POST",
      body: { name: "remote-1", type: "kalfetela", base_url: "https://127.0.0.1:9", api_token: "remote-token", tags: ["railway", "eu"] },
    });
    expect(created.status).toBe(201);
    const panelId = created.json.data.panel.id;

    const list = await call("/api/panels");
    const listed = list.json.data.panels.find((panel: any) => panel.id === panelId);
    expect(listed.tags).toEqual(["railway", "eu"]);
    expect(listed).toHaveProperty("node_count");

    const fleet = await call("/api/panels/fleet");
    expect(fleet.status).toBe(200);
    expect(fleet.json.data.panels.some((panel: any) => panel.id === panelId)).toBe(true);
    expect(fleet.json.data.totals.panels).toBeGreaterThanOrEqual(1);

    const summary = await call(`/api/panels/${panelId}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.json.data.summary.online).toBe(false);
    expect(String(summary.json.data.summary.error)).toBeTruthy();
  });

  it("cuts a reseller off when their traffic quota is exhausted", async () => {
    const { applyUsage, createAdmin, createUser, enforceAdminQuotas, getUser, updateAdmin } = await import("../src/services/store.js");
    const reseller = await createAdmin({
      username: `reseller_${Date.now()}`,
      password: "secret123",
      role: "reseller",
      quotaBytes: 1000,
    });
    const created = await createUser({
      username: `reseller_user_${Date.now()}`,
      adminId: reseller.id,
      dataLimitBytes: 10 ** 9,
      days: 30,
    });
    expect(created.admin_id).toBe(reseller.id);

    await applyUsage(created.id, 2000, 0);
    const cut = await enforceAdminQuotas();
    expect(cut.some((item) => item.admin.id === reseller.id)).toBe(true);
    const held = await getUser(created.id);
    expect(held?.status).toBe("on_hold");
    expect(held?.hold_reason).toBeTruthy();

    // the cutoff stops once the reseller is given a bigger quota
    await updateAdmin(reseller.id, { quota_bytes: 10 ** 6 });
    const again = await enforceAdminQuotas();
    expect(again.some((item) => item.admin.id === reseller.id)).toBe(false);

    // topping the quota up must hand the accounts back
    const released = await getUser(created.id);
    expect(released?.status).toBe("active");
    expect(released?.on_hold).toBe(0);
    expect(released?.hold_reason).toBeNull();
  });

  it("keeps admin, plan and payment endpoints consistent", async () => {
    const admin = await call("/api/admins", { method: "POST", body: { username: "reseller1", password: "secret123", role: "reseller", quota_bytes: 10 * 1024 ** 3, credit: 50000 } });
    expect(admin.status).toBe(201);
    const admins = await call("/api/admins");
    expect(admins.json.data.admins.length).toBeGreaterThanOrEqual(2);

    const credit = await call(`/api/admins/${admin.json.data.admin.id}/credit`, { method: "POST", body: { amount: 25000, mode: "add" } });
    expect(credit.json.data.credit).toBe(75000);

    const payment = await call("/api/payments", { method: "POST", body: { user_id: userId, amount: 120000, method: "card", status: "pending" } });
    const paymentId = payment.json.data.payment.id;
    const approved = await call(`/api/payments/${paymentId}/approve`, { method: "POST" });
    expect(approved.status).toBe(200);

    const revenue = await call("/api/payments/report");
    expect(revenue.json.data.revenue.total).toBeGreaterThanOrEqual(120000);
  });
});

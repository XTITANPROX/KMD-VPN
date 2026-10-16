import { describe, expect, it } from "vitest";
import { buildClashConfig, buildLink, buildLinks, buildSingboxConfig, buildWireguardConf, buildXrayConfig, subscriptionPayload } from "../src/services/links.js";
import type { NodeRow, UserRow } from "../src/types.js";

function node(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 1,
    name: "آلمان ۱",
    kind: "custom",
    panel_id: null,
    inbound_id: null,
    protocol: "vless",
    transport: "ws",
    security: "tls",
    host: "example.com",
    port: 443,
    sni: "example.com",
    path: "/ws",
    service_name: null,
    flow: null,
    fingerprint: "chrome",
    alpn: "h2,http/1.1",
    reality_public_key: null,
    reality_private_key: null,
    reality_short_id: null,
    reality_dest: null,
    private_key: null,
    public_key: null,
    dns: null,
    mtu: null,
    address_v4: null,
    address_v6: null,
    settings: null,
    capacity: 0,
    status: "online",
    cpu_load: null,
    mem_load: null,
    uptime_seconds: null,
    last_heartbeat_at: null,
    last_error: null,
    sort: 0,
    active: 1,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 7,
    username: "ali",
    uuid: "11111111-2222-3333-4444-555555555555",
    password: "trojan-pass",
    email: null,
    telegram_id: null,
    provider: "local",
    panel_id: null,
    admin_id: null,
    plan_id: null,
    data_limit_bytes: 0,
    data_used_bytes: 0,
    upload_bytes: 0,
    download_bytes: 0,
    request_limit: 0,
    request_used: 0,
    expires_at: null,
    created_at: 0,
    activated_at: null,
    last_online_at: null,
    sub_token: "token123",
    sub_updated_at: null,
    online_ips: null,
    device_limit: 2,
    speed_limit_mbps: 0,
    status: "active",
    note: null,
    reset_strategy: "no_reset",
    last_reset_at: null,
    updated_at: 0,
    ...overrides,
  };
}

describe("link builders", () => {
  it("builds a vless link with the expected parameters", () => {
    const entry = buildLink(node(), user());
    expect(entry).not.toBeNull();
    expect(entry!.link).toMatch(/^vless:\/\/11111111-2222-3333-4444-555555555555@example\.com:443\?/);
    expect(entry!.link).toContain("type=ws");
    expect(entry!.link).toContain("security=tls");
    expect(entry!.link).toContain("path=%2Fws");
  });

  it("builds REALITY parameters when configured", () => {
    const entry = buildLink(
      node({ security: "reality", reality_public_key: "PUBKEY", reality_short_id: "abcd", reality_dest: "www.cloudflare.com:443" }),
      user()
    );
    expect(entry!.link).toContain("pbk=PUBKEY");
    expect(entry!.link).toContain("sid=abcd");
  });

  it("builds vmess, trojan and shadowsocks links", () => {
    const vmess = buildLink(node({ protocol: "vmess" }), user());
    expect(vmess!.link.startsWith("vmess://")).toBe(true);
    const decoded = JSON.parse(Buffer.from(vmess!.link.slice(8), "base64").toString("utf8"));
    expect(decoded.id).toBe("11111111-2222-3333-4444-555555555555");

    const trojan = buildLink(node({ protocol: "trojan" }), user());
    expect(trojan!.link).toContain("trojan://trojan-pass@");

    const ss = buildLink(node({ protocol: "shadowsocks" }), user());
    expect(ss!.link.startsWith("ss://")).toBe(true);
  });

  it("builds a wireguard config", () => {
    const config = buildWireguardConf(node({ protocol: "wireguard", public_key: "SERVERPUB" }), user());
    expect(config).toContain("[Interface]");
    expect(config).toContain("PublicKey = SERVERPUB");
    expect(config).toContain("Endpoint = example.com:443");
  });

  it("produces valid clash / singbox / xray documents", () => {
    const nodes = [node(), node({ id: 2, name: "node-2", protocol: "trojan", transport: "grpc", service_name: "grpc" })];
    const clash = buildClashConfig(user(), nodes);
    expect(clash).toContain("proxies:");
    expect(clash).toContain("proxy-groups:");
    expect(clash).toContain("GEOIP,IR,DIRECT");

    const singbox = JSON.parse(buildSingboxConfig(user(), nodes));
    expect(Array.isArray(singbox.outbounds)).toBe(true);
    expect(singbox.route.final).toContain("آلمان ۱");
    expect(new Set(singbox.outbounds.map((item: { tag: string }) => item.tag)).size).toBe(singbox.outbounds.length);

    const xray = JSON.parse(buildXrayConfig(user(), nodes));
    expect(xray.inbounds[0].protocol).toBe("socks");
    expect(xray.routing.balancers[0].strategy.type).toBe("leastPing");
    const proxyOutbounds = xray.outbounds.filter((item: { tag: string }) => item.tag !== "direct" && item.tag !== "block");
    expect(proxyOutbounds).toHaveLength(2);
    expect(JSON.stringify(xray)).toContain("fragment");
    expect(new Set(xray.outbounds.map((item: { tag: string }) => item.tag)).size).toBe(xray.outbounds.length);
    expect(xray.routing.balancers[0].selector).toContain(proxyOutbounds[0].tag);
  });

  it("encodes base64 subscriptions", () => {
    const entries = buildLinks(user(), [node()]);
    const payload = Buffer.from(subscriptionPayload(entries), "base64").toString("utf8");
    expect(payload.startsWith("vless://")).toBe(true);
  });
});

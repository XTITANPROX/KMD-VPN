import { describe, expect, it } from "vitest";
import { buildLinks, generateSubscription } from "../src/services/subscription";
import type { UserRow } from "../src/db/types";

const user: UserRow = {
  id: 1,
  username: "ali",
  uuid: "11111111-2222-3333-4444-555555555555",
  trojan_hash: "a".repeat(56),
  limit_gb: 20,
  used_gb: 0,
  lifetime_gb: 0,
  expiry_days: 30,
  limit_req: null,
  used_req: 0,
  ip_limit: 2,
  active_ips: null,
  connection_type: "vless+trojan",
  tls: "on",
  port: 443,
  path: "/ws",
  sni_host: "edge.example.com",
  fingerprint: "chrome",
  fragment: "100-200,1-3,tlshello",
  cipher_suites: null,
  alpn: "h2,http/1.1",
  allow_insecure: 0,
  block_porn: 0,
  block_ads: 1,
  block_malware: 1,
  doh_url: null,
  route_direct: JSON.stringify(["example.ir"]),
  route_block: JSON.stringify(["tracker.example"]),
  user_proxy_iata: null,
  user_socks5: null,
  user_proxy_ip: null,
  auto_rotate_proxy: 0,
  auto_rotate_ip: 0,
  rotate_minutes: 0,
  ip_operator: "all",
  ip_count: 2,
  ips: JSON.stringify(["1.1.1.1", "1.0.0.1"]),
  last_rotate_time: 0,
  auto_reset_vol_days: 0,
  auto_reset_req_days: 0,
  last_reset_vol_time: 0,
  last_reset_req_time: 0,
  is_active: 1,
  start_on_first_connect: 0,
  first_connection_time: null,
  last_active: null,
  note: null,
  group_id: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
};

const ctx = { host: "panel.example.com", port: 443, tls: true };

describe("subscription generation", () => {
  it("builds both VLESS and Trojan links using clean IPs", () => {
    const links = buildLinks(user, ctx);
    expect(links).toHaveLength(4);
    expect(links.some((x) => x.startsWith("vless://") && x.includes("1.1.1.1"))).toBe(true);
    expect(links.some((x) => x.startsWith("trojan://") && x.includes("fragment="))).toBe(true);
  });

  it("builds a BPB-style Xray fragment profile with Iran routing", async () => {
    const result = await generateSubscription(user, ctx, "xray");
    const profile = JSON.parse(result.body);
    expect(profile.remarks).toContain("KALFETELA");
    expect(profile.outbounds[0].streamSettings.finalmask.tcp[0].settings).toEqual({
      packets: "tlshello",
      length: "100-200",
      delay: "1-3",
    });
    expect(profile.routing.balancers[0].strategy.type).toBe("leastPing");
    expect(JSON.stringify(profile.routing.rules)).toContain("geosite:category-ir");
    expect(profile.dns.servers[0].address).toBe("https://panel.example.com/dns-query");
  });
});

// Subscription link generator. Mirrors Zeus's link structure so the
// same clients (v2rayNG, Streisand, Hiddify, Clash, sing-box, etc.)
// parse it identically:
//
//   vless://<uuid>@<clean-ip>:<port>?path=<encoded>&security=tls
//          &encryption=none&insecure=0&host=<worker-host>&fp=chrome
//          &type=ws&allowInsecure=0&sni=<worker-host>#<remark>
//
// One link per (clean IP × port × protocol) is produced, plus a short
// "noise" header so the subscription isn't trivially identifiable.

import type { UserRow } from "../db/types.js";
import { DEFAULT_CLEAN_IPS, parseIpsField } from "./cleanIps.js";

export interface SubContext {
  host: string;          // Worker hostname (used as SNI / Host header)
  port: number;          // default public TLS port
  tls: boolean;
  cleanIps?: string[];   // override default clean IP pool (from settings)
}

const TLS_PORTS = new Set(["443", "2053", "2083", "2087", "2096", "8443"]);

export async function generateSubscription(
  user: UserRow,
  ctx: SubContext,
  format: "base64" | "clash" | "singbox" | "xray" | "raw" = "base64"
): Promise<{ body: string; contentType: string }> {
  const links = buildLinks(user, ctx);

  if (format === "raw") {
    return { body: links.join("\n"), contentType: "text/plain; charset=utf-8" };
  }
  if (format === "clash") {
    return { body: buildClash(user, ctx, links), contentType: "text/yaml; charset=utf-8" };
  }
  if (format === "singbox") {
    return {
      body: JSON.stringify(buildSingBox(user, ctx, links), null, 2),
      contentType: "application/json; charset=utf-8",
    };
  }
  if (format === "xray") {
    return {
      body: JSON.stringify(buildXray(user, ctx), null, 2),
      contentType: "application/json; charset=utf-8",
    };
  }

  // A small randomized header avoids returning an identical payload on every fetch.
  const noise = [
    "# Sub Update: OK",
    "# Random Code: " + Math.random().toString(36).slice(2, 10),
    "# KALFETELA",
    "",
  ].join("\n");
  const plain = noise + links.join("\n");
  return {
    body: b64url(plain),
    contentType: "text/plain; charset=utf-8",
  };
}

export function buildLinks(user: UserRow, ctx: SubContext): string[] {
  const out: string[] = [];
  const host = ctx.host;
  const sni = user.sni_host || host;
  const fp = user.fingerprint || "chrome";
  const alpn = (user.alpn || "h2,http/1.1").replace(/\s/g, "");
  const path = "/" + Math.random().toString(36).slice(2, 12);
  const pathEnc = encodeURIComponent(path);
  const userIps = parseIpsField(user.ips);
  const pool = userIps.length
    ? userIps
    : (ctx.cleanIps && ctx.cleanIps.length ? ctx.cleanIps : DEFAULT_CLEAN_IPS);
  const ips = pool.slice(0, 30);
  const ports = String(user.port || "443").split(",").map((p) => p.trim()).filter(Boolean);
  const connType = String(user.connection_type || "vless").toLowerCase();
  const enableVless = connType.includes("vless") || !connType.includes("trojan");
  const enableTrojan = connType.includes("trojan");
  const enableVmess = connType.includes("vmess");
  const isAll = connType.includes("all");

  let frag = "";
  if (user.fragment) frag += "&fragment=" + encodeURIComponent(user.fragment);

  function pushOne(ip: string, portStr: string, pathVal: string, sec: "tls" | "none", remarkSuffix?: string) {
    const pEnc = encodeURIComponent(pathVal);
    const baseRemark = "KALFETELA|" + user.username + "|" + ip + (remarkSuffix ? "|" + remarkSuffix : "");
    const encRemark = encodeURIComponent(baseRemark);
    if (enableVless) {
      out.push(
        "vless://" + user.uuid + "@" + ip + ":" + portStr +
        "?path=" + pEnc +
        "&security=" + sec +
        "&encryption=none" +
        "&insecure=0" +
        "&host=" + encodeURIComponent(sni) +
        "&fp=" + fp +
        "&type=ws" +
        "&allowInsecure=0" +
        "&sni=" + encodeURIComponent(sni) +
        (alpn ? "&alpn=" + encodeURIComponent(alpn) : "") +
        frag +
        "#" + encRemark
      );
    }
    if (enableTrojan) {
      out.push(
        "trojan://" + (user.trojan_hash || user.uuid) + "@" + ip + ":" + portStr +
        "?path=" + pEnc +
        "&security=" + sec +
        "&insecure=0" +
        "&host=" + encodeURIComponent(sni) +
        "&fp=" + fp +
        "&type=ws" +
        "&allowInsecure=0" +
        "&sni=" + encodeURIComponent(sni) +
        (alpn ? "&alpn=" + encodeURIComponent(alpn) : "") +
        frag +
        "#" + encRemark
      );
    }
    if (enableVmess) {
      const json = {
        v: "2", ps: baseRemark, add: ip, port: portStr, id: user.uuid,
        aid: "0", net: "ws", type: "none", host: sni, path: pathVal,
        tls: sec === "tls" ? "tls" : "", sni, alpn: alpn.replace(/,/g, ""),
        fp: fp,
      };
      out.push("vmess://" + b64url(JSON.stringify(json)));
    }
  }

  // 1) Primary entries — one link per (IP × port) on the random path.
  for (const ip of ips) {
    for (const portStr of ports) {
      const isTls = TLS_PORTS.has(portStr);
      pushOne(ip, portStr, path, isTls ? "tls" : "none");
    }
  }

  // 2) "all" bundle: extra fallback variants on CDN-friendly paths
  // ("/api", "/ws", "/ray") + port-80 plain-HTTP entries so clients
  // whose DPI blocks the random path or TLS can still connect.
  if (isAll) {
    const fallbackPaths = ["/api/ws", "/ws", "/ray", "/?ed=2048"];
    const topIps = ips.slice(0, 10);
    for (const ip of topIps) {
      // Port 443 with alternative paths
      for (const fp2 of fallbackPaths.slice(0, 3)) {
        pushOne(ip, "443", fp2, "tls", fp2.replace(/[\/?=]/g, "").slice(0, 10) || "p");
      }
      // Port 80 plain HTTP (bypasses TLS DPI entirely)
      if (enableVless) {
        pushOne(ip, "80", path, "none", "80");
      }
    }
  }

  return out;
}

function cleanIpFor(ctx: SubContext, user: UserRow): string {
  const userIps = parseIpsField(user.ips);
  if (userIps.length) return userIps[0]!;
  const pool = ctx.cleanIps && ctx.cleanIps.length ? ctx.cleanIps : DEFAULT_CLEAN_IPS;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function buildClash(user: UserRow, ctx: SubContext, _links: string[]): string {
  const host = ctx.host;
  const sni = user.sni_host || host;
  const ip = cleanIpFor(ctx, user);
  const directDomains = parseList(user.route_direct);
  const blockDomains = parseList(user.route_block);
  const directRules = directDomains.map((d) => "  - DOMAIN-SUFFIX," + d + ",DIRECT").join("\n");
  const blockRules = blockDomains.map((d) => "  - DOMAIN-SUFFIX," + d + ",REJECT").join("\n");
  const useVless = (user.connection_type || "vless").toLowerCase().includes("vless");
  const credentials = useVless
    ? "    type: vless\n    uuid: " + user.uuid + "\n"
    : "    type: trojan\n    password: " + (user.trojan_hash || user.uuid) + "\n";
  return "# KALFETELA Clash configuration\n" +
    "mixed-port: 7890\nallow-lan: false\nmode: rule\nlog-level: info\nipv6: true\n" +
    "dns:\n  enable: true\n  listen: 0.0.0.0:53\n" +
    "  default-nameserver: [1.1.1.1, 8.8.8.8]\n" +
    "  nameserver: [https://" + ctx.host + "/dns-query, https://cloudflare-dns.com/dns-query]\n" +
    "proxies:\n" +
    "  - name: \"kalfetela-" + user.username + "\"\n" +
    credentials +
    "    server: " + ip + "\n    port: " + (user.port || 443) + "\n" +
    "    network: ws\n    tls: true\n    servername: " + sni + "\n" +
    "    ws-opts:\n      path: \"" + (user.path || "/") + "\"\n      headers:\n        Host: " + sni + "\n" +
    "    client-fingerprint: " + (user.fingerprint || "chrome") + "\n" +
    "proxy-groups:\n  - name: PROXY\n    type: select\n    proxies: [\"kalfetela-" + user.username + "\"]\n" +
    "rules:\n" +
    (directRules ? directRules + "\n" : "") +
    (blockRules ? blockRules + "\n" : "") +
    "  - GEOIP,IR,DIRECT\n  - MATCH,PROXY\n";
}

function buildSingBox(user: UserRow, ctx: SubContext, _links: string[]): unknown {
  const sni = user.sni_host || ctx.host;
  const ip = cleanIpFor(ctx, user);
  const useVless = (user.connection_type || "vless").toLowerCase().includes("vless");
  const proxy = useVless ? {
    type: "vless", tag: "proxy", server: ip, server_port: user.port || 443, uuid: user.uuid,
    tls: { enabled: true, server_name: sni, utls: { enabled: true, fingerprint: user.fingerprint || "chrome" } },
    transport: { type: "ws", path: user.path || "/", headers: { Host: sni } },
  } : {
    type: "trojan", tag: "proxy", server: ip, server_port: user.port || 443,
    password: user.trojan_hash || user.uuid,
    tls: { enabled: true, server_name: sni, utls: { enabled: true, fingerprint: user.fingerprint || "chrome" } },
    transport: { type: "ws", path: user.path || "/", headers: { Host: sni } },
  };
  return {
    log: { level: "info" },
    dns: {
      servers: [
        { tag: "cf", address: "https://cloudflare-dns.com/dns-query" },
        { tag: "local", address: "local", detour: "direct" },
      ],
      rules: [{ domain_suffix: [".ir"], server: "local" }],
    },
    outbounds: [
      proxy,
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
    ],
    route: { final: "proxy" },
  };
}

function buildXray(user: UserRow, ctx: SubContext): unknown {
  const sni = user.sni_host || ctx.host;
  const userIps = parseIpsField(user.ips);
  const pool = (userIps.length ? userIps : (ctx.cleanIps?.length ? ctx.cleanIps : DEFAULT_CLEAN_IPS)).slice(0, 8);
  const port = Number(user.port || ctx.port || 443);
  const tls = TLS_PORTS.has(String(port)) && user.tls !== "off";
  const directDomains = parseList(user.route_direct).map(normalizeRuleDomain);
  const blockedDomains = parseList(user.route_block).map(normalizeRuleDomain);
  const [length = "100-200", delay = "1-3", packets = "tlshello"] =
    (user.fragment || "100-200,1-3,tlshello").split(",").map((x) => x.trim());
  const useVless = (user.connection_type || "vless").toLowerCase().includes("vless");

  const proxyOutbounds = pool.map((ip, index) => ({
    tag: `proxy-${index + 1}`,
    protocol: useVless ? "vless" : "trojan",
    settings: useVless
      ? { vnext: [{ address: ip, port, users: [{ id: user.uuid, encryption: "none" }] }] }
      : { servers: [{ address: ip, port, password: user.trojan_hash || user.uuid }] },
    streamSettings: {
      network: "ws",
      security: tls ? "tls" : "none",
      wsSettings: { path: user.path || "/", headers: { Host: sni } },
      tlsSettings: tls ? {
        serverName: sni,
        alpn: (user.alpn || "h2,http/1.1").split(",").map((x) => x.trim()),
        fingerprint: user.fingerprint || "chrome",
        allowInsecure: user.allow_insecure === 1,
      } : undefined,
      sockopt: { tcpFastOpen: true },
      finalmask: {
        tcp: [{ type: "fragment", settings: { packets, length, delay } }],
      },
    },
  }));

  const rules: unknown[] = [
    { type: "field", protocol: ["bittorrent"], outboundTag: "block" },
    { type: "field", ip: ["geoip:private"], outboundTag: "direct" },
    { type: "field", domain: ["geosite:category-ir", ...directDomains], outboundTag: "direct" },
  ];
  const block = [...blockedDomains];
  if (user.block_ads) block.push("geosite:category-ads-all");
  if (user.block_porn) block.push("geosite:category-porn");
  if (user.block_malware) block.push("geosite:category-malware");
  if (block.length) rules.push({ type: "field", domain: block, outboundTag: "block" });
  rules.push({ type: "field", network: "tcp,udp", balancerTag: "best" });

  return {
    remarks: `KALFETELA | ${user.username} | Fragment`,
    log: { loglevel: "warning" },
    dns: {
      servers: [
        { address: `https://${ctx.host}/dns-query`, domains: ["geosite:geolocation-!cn"] },
        "1.1.1.1",
      ],
      queryStrategy: "UseIP",
    },
    inbounds: [{
      tag: "mixed-in",
      port: 10808,
      listen: "127.0.0.1",
      protocol: "socks",
      settings: { auth: "noauth", udp: true },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
    }],
    outbounds: [
      ...proxyOutbounds,
      { tag: "direct", protocol: "freedom", settings: { domainStrategy: "UseIP" } },
      { tag: "block", protocol: "blackhole", settings: { response: { type: "http" } } },
      { tag: "dns-out", protocol: "dns" },
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules,
      balancers: [{ tag: "best", selector: ["proxy-"], strategy: { type: "leastPing" } }],
    },
    observatory: {
      subjectSelector: ["proxy-"],
      probeUrl: "https://www.gstatic.com/generate_204",
      probeInterval: "30s",
      enableConcurrency: true,
    },
    policy: { levels: { 0: { handshake: 4, connIdle: 300 } } },
  };
}

function normalizeRuleDomain(domain: string): string {
  const v = domain.trim();
  if (!v || v.startsWith("geosite:") || v.startsWith("regexp:") || v.startsWith("full:")) return v;
  return "domain:" + v.replace(/^\.+/, "");
}

function parseList(json: string | null): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; }
  catch { return []; }
}

function b64url(s: string): string {
  const u8 = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]!);
  // Standard btoa gives +/= which every sub client accepts.
  return btoa(bin);
}

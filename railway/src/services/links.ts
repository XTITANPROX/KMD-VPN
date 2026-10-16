// Link & subscription builders: raw links, Base64, Clash Meta, sing-box,
// Xray (with Iran routing + Fragment) and WireGuard configs.

import { fmtBytes } from "../lib/format.js";
import { buildWireguardConf } from "./wireguard.js";
import type { NodeRow, UserRow } from "../types.js";

export { buildWireguardConf };

export interface LinkEntry {
  link: string;
  remark: string;
  protocol: string;
  nodeId: number;
  nodeName: string;
  host: string;
  port: number;
  /** Raw `wg-quick` config (WireGuard nodes only). */
  raw?: string;
}

export interface LinkOptions {
  fragment?: string;
  alpn?: string;
  fingerprint?: string;
  proxyGroupName?: string;
  subscriptionUrl?: string;
  title?: string;
  extraDirectDomains?: string[];
  blockAds?: boolean;
  routeIran?: boolean;
  /** `nodeId → client private key` for WireGuard nodes (`wireguardKeysForUser`). */
  wireguardKeys?: Record<number, string>;
}

function encodeRemark(value: string): string {
  return encodeURIComponent(value.replace(/\s+/g, " ").trim());
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/* ------------------------------- per node ------------------------------- */

export function buildLink(node: NodeRow, user: UserRow, options: LinkOptions = {}): LinkEntry | null {
  const remark = `${options.title ? `${options.title} | ` : ""}${node.name}`;
  const fingerprint = options.fingerprint || node.fingerprint || "chrome";
  const alpn = options.alpn || node.alpn || undefined;
  const host = node.host;
  const port = node.port;
  const name = encodeRemark(`${remark} 🌐 KalFetela`);

  switch (node.protocol) {
    case "vless": {
      const params: Record<string, string | undefined> = {
        type: node.transport === "http" ? "tcp" : node.transport,
        security: node.security === "none" ? "none" : node.security,
        encryption: "none",
        fp: node.security === "none" ? undefined : fingerprint,
        sni: node.security === "none" ? undefined : node.sni || host,
        alpn: node.security === "tls" ? alpn : undefined,
        host: ["ws", "httpupgrade", "http"].includes(node.transport) ? node.sni || host : undefined,
        path: ["ws", "httpupgrade", "http"].includes(node.transport) ? node.path || "/" : undefined,
        serviceName: node.transport === "grpc" ? node.service_name || "grpc" : undefined,
        mode: node.transport === "grpc" ? "gun" : undefined,
        flow: node.flow || undefined,
        pbk: node.security === "reality" ? node.reality_public_key || undefined : undefined,
        sid: node.security === "reality" ? node.reality_short_id || undefined : undefined,
        spx: node.security === "reality" ? "/" : undefined,
      };
      const link = `vless://${user.uuid}@${host}:${port}${query(params)}#${name}`;
      return { link, remark, protocol: "vless", nodeId: node.id, nodeName: node.name, host, port };
    }
    case "vmess": {
      const payload: Record<string, unknown> = {
        v: "2",
        ps: remark,
        add: host,
        port: String(port),
        id: user.uuid,
        aid: "0",
        scy: "auto",
        net: node.transport === "http" ? "tcp" : node.transport,
        type: "none",
        host: ["ws", "httpupgrade"].includes(node.transport) ? node.sni || host : "",
        path: ["ws", "httpupgrade"].includes(node.transport) ? node.path || "/" : "",
        tls: node.security === "tls" ? "tls" : "",
        sni: node.sni || "",
        alpn: alpn || "",
        fp: node.security === "tls" ? fingerprint : "",
      };
      const link = `vmess://${b64(JSON.stringify(payload))}`;
      return { link, remark, protocol: "vmess", nodeId: node.id, nodeName: node.name, host, port };
    }
    case "trojan": {
      const params: Record<string, string | undefined> = {
        type: node.transport === "http" ? "tcp" : node.transport,
        security: node.security === "none" ? "none" : node.security === "reality" ? "reality" : "tls",
        sni: node.sni || host,
        fp: node.security === "none" ? undefined : fingerprint,
        alpn: alpn,
        host: ["ws", "httpupgrade"].includes(node.transport) ? node.sni || host : undefined,
        path: ["ws", "httpupgrade"].includes(node.transport) ? node.path || "/" : undefined,
        serviceName: node.transport === "grpc" ? node.service_name || "grpc" : undefined,
        pbk: node.security === "reality" ? node.reality_public_key || undefined : undefined,
        sid: node.security === "reality" ? node.reality_short_id || undefined : undefined,
      };
      const link = `trojan://${encodeURIComponent(user.password || user.uuid)}@${host}:${port}${query(params)}#${name}`;
      return { link, remark, protocol: "trojan", nodeId: node.id, nodeName: node.name, host, port };
    }
    case "shadowsocks": {
      const method = "aes-256-gcm";
      const password = (user.password || user.uuid).slice(0, 32);
      const credentials = b64(`${method}:${password}`).replace(/=+$/, "");
      const link = `ss://${credentials}@${host}:${port}#${name}`;
      return { link, remark, protocol: "shadowsocks", nodeId: node.id, nodeName: node.name, host, port };
    }
    case "wireguard": {
      const conf = buildWireguardConf(node, user, options.wireguardKeys?.[node.id]);
      const link = `wireguard://${encodeURIComponent(conf)}#${name}`;
      return { link, remark, protocol: "wireguard", nodeId: node.id, nodeName: node.name, host, port, raw: conf };
    }
    default:
      return null;
  }
}

export function buildLinks(user: UserRow, nodes: NodeRow[], options: LinkOptions = {}): LinkEntry[] {
  const out: LinkEntry[] = [];
  for (const node of nodes) {
    if (!node.active) continue;
    const entry = buildLink(node, user, options);
    if (entry) out.push(entry);
  }
  return out;
}

/* ----------------------------- subscription ---------------------------- */

export function subscriptionPayload(entries: LinkEntry[]): string {
  return b64(entries.map((entry) => entry.link).join("\n"));
}

export interface SubscriptionInfo {
  used: string;
  total: string;
  percent: number;
  expiresAt: number | null;
  status: string;
  deviceLimit: number;
}

export function subscriptionInfo(user: UserRow): SubscriptionInfo {
  const total = user.data_limit_bytes > 0 ? user.data_limit_bytes : 0;
  return {
    used: fmtBytes(user.data_used_bytes),
    total: total > 0 ? fmtBytes(total) : "نامحدود",
    percent: total > 0 ? Math.min(100, Math.round((user.data_used_bytes / total) * 100)) : 0,
    expiresAt: user.expires_at,
    status: user.status,
    deviceLimit: user.device_limit,
  };
}

/* -------------------------------- Clash -------------------------------- */

function clashProxy(entry: LinkEntry, node: NodeRow, user: UserRow): string[] {
  const lines: string[] = [`  - name: "${entry.nodeName}"`];
  const fingerprint = node.fingerprint || "chrome";
  const common = (type: string) => {
    lines.push(`    type: ${type}`);
    lines.push(`    server: ${node.host}`);
    lines.push(`    port: ${node.port}`);
  };
  switch (node.protocol) {
    case "vless": {
      common("vless");
      lines.push(`    uuid: ${user.uuid}`);
      lines.push("    udp: true");
      if (node.flow) lines.push(`    flow: ${node.flow}`);
      if (node.transport === "ws" || node.transport === "httpupgrade") {
        lines.push("    network: ws");
        lines.push("    ws-opts:");
        lines.push(`      path: "${node.path || "/"}"`);
        lines.push("      headers:");
        lines.push(`        Host: "${node.sni || node.host}"`);
      } else if (node.transport === "grpc") {
        lines.push("    network: grpc");
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: "${node.service_name || "grpc"}"`);
      } else {
        lines.push("    network: tcp");
      }
      if (node.security === "tls") {
        lines.push("    tls: true");
        lines.push(`    servername: ${node.sni || node.host}`);
        lines.push(`    client-fingerprint: ${fingerprint}`);
        if (node.alpn) lines.push(`    alpn: [${node.alpn.split(",").map((item) => item.trim()).join(", ")}]`);
      } else if (node.security === "reality") {
        lines.push("    tls: true");
        lines.push(`    servername: ${node.sni || node.reality_dest?.split(":")[0] || node.host}`);
        lines.push(`    client-fingerprint: ${fingerprint}`);
        lines.push("    reality-opts:");
        lines.push(`      public-key: ${node.reality_public_key}`);
        lines.push(`      short-id: ${node.reality_short_id ?? ""}`);
      }
      break;
    }
    case "vmess": {
      common("vmess");
      lines.push(`    uuid: ${user.uuid}`);
      lines.push("    alterId: 0");
      lines.push("    cipher: auto");
      lines.push("    udp: true");
      lines.push(`    network: ${node.transport === "http" ? "tcp" : node.transport}`);
      if (node.transport === "ws") {
        lines.push("    ws-opts:");
        lines.push(`      path: "${node.path || "/"}"`);
        lines.push("      headers:");
        lines.push(`        Host: "${node.sni || node.host}"`);
      }
      if (node.security === "tls") {
        lines.push("    tls: true");
        lines.push(`    servername: ${node.sni || node.host}`);
      }
      break;
    }
    case "trojan": {
      common("trojan");
      lines.push(`    password: ${user.password || user.uuid}`);
      lines.push("    udp: true");
      lines.push("    sni: " + (node.sni || node.host));
      if (node.transport === "ws") {
        lines.push("    network: ws");
        lines.push("    ws-opts:");
        lines.push(`      path: "${node.path || "/"}"`);
      }
      if (node.security === "reality") {
        lines.push("    client-fingerprint: " + fingerprint);
        lines.push("    reality-opts:");
        lines.push(`      public-key: ${node.reality_public_key}`);
        lines.push(`      short-id: ${node.reality_short_id ?? ""}`);
      }
      break;
    }
    case "shadowsocks": {
      common("ss");
      lines.push("    cipher: aes-256-gcm");
      lines.push(`    password: "${(user.password || user.uuid).slice(0, 32)}"`);
      lines.push("    udp: true");
      break;
    }
    default:
      return [];
  }
  return lines;
}

export function buildClashConfig(user: UserRow, nodes: NodeRow[], options: LinkOptions = {}): string {
  const usable = nodes.filter((node) => node.active && node.protocol !== "wireguard");
  const names = usable.map((node) => node.name);
  const lines: string[] = [
    `# KalFetela subscription — ${user.username}`,
    "mixed-port: 7890",
    "allow-lan: false",
    "mode: rule",
    "log-level: info",
    "external-controller: 127.0.0.1:9090",
    "dns:",
    "  enable: true",
    "  listen: 127.0.0.1:1053",
    "  nameserver:",
    "    - https://1.1.1.1/dns-query",
    "    - https://8.8.8.8/dns-query",
    "  fallback-filter:",
    "    geoip: true",
    "    geoip-code: IR",
    "proxies:",
  ];
  for (const node of usable) {
    lines.push(...clashProxy({ nodeName: node.name } as LinkEntry, node, user));
    lines.push("");
  }
  lines.push("proxy-groups:");
  lines.push('  - name: "PROXY"');
  lines.push("    type: select");
  lines.push("    proxies:");
  lines.push('      - "AUTO"');
  lines.push(...names.map((name) => `      - "${name}"`));
  lines.push('  - name: "AUTO"');
  lines.push("    type: url-test");
  lines.push("    url: http://cp.cloudflare.com/generate_204");
  lines.push("    interval: 300");
  lines.push("    tolerance: 50");
  lines.push("    proxies:");
  lines.push(...names.map((name) => `      - "${name}"`));
  lines.push("rules:");
  if (options.blockAds) {
    lines.push("  - GEOSITE,category-ads-all,REJECT");
  }
  if (options.routeIran !== false) {
    lines.push("  - GEOIP,IR,DIRECT");
    lines.push("  - GEOSITE,category-ir,DIRECT");
    lines.push("  - DOMAIN-SUFFIX,ir,DIRECT");
  }
  for (const domain of options.extraDirectDomains ?? []) lines.push(`  - DOMAIN-SUFFIX,${domain},DIRECT`);
  lines.push("  - MATCH,PROXY");
  return lines.join("\n");
}

/* ------------------------------- sing-box ------------------------------ */

export function buildSingboxConfig(user: UserRow, nodes: NodeRow[], options: LinkOptions = {}): string {
  const outbounds: Record<string, unknown>[] = [];
  for (const node of nodes.filter((item) => item.active && item.protocol !== "wireguard")) {
    const tag = `${node.name} [${node.id}]`;
    const outbound: Record<string, unknown> = {
      type: node.protocol === "shadowsocks" ? "shadowsocks" : node.protocol,
      tag,
      server: node.host,
      server_port: node.port,
    };
    if (node.protocol === "vless") {
      outbound.uuid = user.uuid;
      if (node.flow) outbound.flow = node.flow;
    } else if (node.protocol === "vmess") {
      outbound.uuid = user.uuid;
      outbound.security = "auto";
      outbound.alter_id = 0;
    } else if (node.protocol === "trojan") {
      outbound.password = user.password || user.uuid;
    } else if (node.protocol === "shadowsocks") {
      outbound.method = "aes-256-gcm";
      outbound.password = (user.password || user.uuid).slice(0, 32);
    }
    const transport: Record<string, unknown> = {};
    if (node.transport === "ws") {
      transport.type = "ws";
      transport.path = node.path || "/";
      transport.headers = { Host: node.sni || node.host };
    } else if (node.transport === "grpc") {
      transport.type = "grpc";
      transport.service_name = node.service_name || "grpc";
    } else if (node.transport === "httpupgrade") {
      transport.type = "httpupgrade";
      transport.path = node.path || "/";
      transport.host = node.sni || node.host;
    }
    if (Object.keys(transport).length) outbound.transport = transport;
    if (node.security === "tls" || node.security === "reality") {
      const tls: Record<string, unknown> = { enabled: true, server_name: node.sni || node.host, insecure: false };
      if (node.security === "tls") {
        tls.utls = { enabled: true, fingerprint: node.fingerprint || "chrome" };
        if (node.alpn) tls.alpn = node.alpn.split(",").map((item) => item.trim());
      } else {
        tls.reality = {
          enabled: true,
          public_key: node.reality_public_key,
          short_id: node.reality_short_id ?? "",
        };
        tls.utls = { enabled: true, fingerprint: node.fingerprint || "chrome" };
      }
      outbound.tls = tls;
    }
    outbounds.push(outbound);
  }
  outbounds.push({ type: "direct", tag: "direct" });
  outbounds.push({ type: "block", tag: "block" });

  const config = {
    log: { level: "warn", timestamp: true },
    dns: {
      servers: [
        { tag: "cloudflare", address: "https://1.1.1.1/dns-query", detour: "direct" },
        { tag: "local", address: "local", detour: "direct" },
      ],
      rules: options.routeIran === false ? [] : [{ domain_suffix: [".ir"], server: "local" }],
    },
    inbounds: [
      { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080, sniff: true },
    ],
    outbounds,
    route: {
      rules: [
        ...(options.routeIran === false ? [] : [{ domain_suffix: [".ir"], outbound: "direct" }]),
        ...(options.blockAds ? [{ geosite: ["category-ads-all"], outbound: "block" }] : []),
      ],
      final: (outbounds[0] as { tag?: string } | undefined)?.tag ?? "direct",
      auto_detect_interface: true,
    },
  };
  return JSON.stringify(config, null, 2);
}

/* --------------------------------- Xray -------------------------------- */

export function buildXrayConfig(user: UserRow, nodes: NodeRow[], options: LinkOptions = {}): string {
  const fragment = options.fragment ?? "100-200,1-3,tlshello";
  const [length, interval, packets] = fragment.split(",");
  const outbounds: Record<string, unknown>[] = [];
  const proxyTags: string[] = [];
  for (const node of nodes.filter((item) => item.active && item.protocol !== "wireguard")) {
    const tag = `${node.name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+$/, "node") || "node"}_${node.id}`;
    proxyTags.push(tag);
    const streamSettings: Record<string, unknown> = {
      network: node.transport === "http" ? "tcp" : node.transport,
      security: node.security === "none" ? "none" : node.security,
    };
    if (length && interval && packets) {
      streamSettings.fragment = { packets: packets || "tlshello", length: length || "100-200", interval: interval || "1-3" };
    }
    if (node.transport === "ws" || node.transport === "httpupgrade") {
      streamSettings[`${node.transport}Settings`] = {
        path: node.path || "/",
        headers: { Host: node.sni || node.host },
      };
    } else if (node.transport === "grpc") {
      streamSettings.grpcSettings = { serviceName: node.service_name || "grpc" };
    }
    if (node.security === "tls") {
      streamSettings.tlsSettings = {
        serverName: node.sni || node.host,
        fingerprint: node.fingerprint || "chrome",
        allowInsecure: false,
      };
    } else if (node.security === "reality") {
      streamSettings.realitySettings = {
        serverName: node.sni || node.reality_dest?.split(":")[0] || node.host,
        fingerprint: node.fingerprint || "chrome",
        publicKey: node.reality_public_key,
        shortId: node.reality_short_id ?? "",
        spiderX: "/",
      };
    }
    const protocolSettings =
      node.protocol === "vless"
        ? { vnext: [{ address: node.host, port: node.port, users: [{ id: user.uuid, encryption: "none", flow: node.flow || "" }] }] }
        : node.protocol === "vmess"
          ? { vnext: [{ address: node.host, port: node.port, users: [{ id: user.uuid, alterId: 0, security: "auto" }] }] }
          : node.protocol === "trojan"
            ? { servers: [{ address: node.host, port: node.port, password: user.password || user.uuid }] }
            : {
                servers: [
                  {
                    address: node.host,
                    port: node.port,
                    method: "aes-256-gcm",
                    password: (user.password || user.uuid).slice(0, 32),
                  },
                ],
              };
    outbounds.push({ tag, protocol: node.protocol, settings: protocolSettings, streamSettings });
  }
  outbounds.push({ tag: "direct", protocol: "freedom", settings: { domainStrategy: "UseIP" } });
  outbounds.push({ tag: "block", protocol: "blackhole" });

  const rules: Record<string, unknown>[] = [
    { type: "field", outboundTag: "block", domain: ["geosite:category-ads-all"] },
    { type: "field", outboundTag: "direct", domain: ["geosite:category-ir", "domain:.ir", "regexp:.*\\.ir$"] },
    { type: "field", outboundTag: "direct", ip: ["geoip:ir"] },
    { type: "field", outboundTag: "direct", protocol: ["bittorrent"] },
  ];

  const config = {
    log: { loglevel: "warning" },
    dns: {
      servers: [
        { address: "https://1.1.1.1/dns-query", domains: ["geosite:geolocation-!cn"] },
        { address: "1.1.1.1", domains: ["geosite:category-ir"] },
      ],
      queryStrategy: "UseIPv4",
    },
    inbounds: [
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: 10808,
        protocol: "socks",
        settings: { auth: "noauth", udp: true },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
      },
      {
        tag: "http-in",
        listen: "127.0.0.1",
        port: 10809,
        protocol: "http",
        sniffing: { enabled: true, destOverride: ["http", "tls"] },
      },
    ],
    observatory: {
      subjectSelector: proxyTags.length ? proxyTags : ["direct"],
      probeUrl: "https://www.cloudflare.com/generate_204",
      probeInterval: "5m",
      enableConcurrency: true,
    },
    burstObservatory: proxyTags.length
      ? {
          subjectSelector: proxyTags,
          pingConfig: {
            destination: "https://www.cloudflare.com/generate_204",
            interval: "1m",
            sampling: 3,
            timeout: "5s",
          },
        }
      : undefined,
    routing: {
      domainStrategy: "IPIfNonMatch",
      balancers: proxyTags.length
        ? [{ tag: "auto-balancer", selector: proxyTags, strategy: { type: "leastPing" } }]
        : [],
      rules: proxyTags.length
        ? [...rules, { type: "field", network: "tcp,udp", balancerTag: "auto-balancer" }]
        : rules,
    },
    outbounds,
  };
  return JSON.stringify(config, null, 2);
}

/* ------------------------------- sub page ------------------------------ */

export function subscriptionHtml(
  user: UserRow,
  entries: LinkEntry[],
  options: { panelName: string; supportId: string; subscriptionUrl: string; announce?: string }
): string {
  const escapeAttr = (value: string) => value.replace(/'/g, "\\'").replace(/\n/g, "\\n");
  const rows = entries
    .map((entry) => {
      const payload = entry.raw ?? entry.link;
      const safe = escapeAttr(payload);
      return `<div class="row">
        <div class="row-head"><b>${entry.nodeName}</b><span class="pill">${entry.protocol.toUpperCase()}</span></div>
        <div class="link">${(entry.raw ?? entry.link).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>
        <div class="actions">
          <button onclick="navigator.clipboard.writeText('${safe}').then(()=>this.textContent='✓ کپی شد')">${entry.raw ? "کپی کانفیگ" : "کپی لینک"}</button>
          ${entry.raw ? '<button onclick="downloadConf(this)">دانلود فایل</button>' : `<button onclick="window.location.href='${safe}'">اتصال</button>`}
        </div>
      </div>`;
    })
    .join("\n");

  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${options.panelName} — ${user.username}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"/>
<script>
 function downloadConf(btn){
   const text = btn.closest('.row').querySelector('.link').textContent;
   const blob = new Blob([text], { type: 'text/plain' });
   const a = document.createElement('a');
   a.href = URL.createObjectURL(blob);
   a.download = 'kalfetela-wireguard.conf';
   a.click();
   URL.revokeObjectURL(a.href);
 }
</script>
<style>
 body{font-family:Vazirmatn,system-ui;background:#05070d;color:#e6edf7;margin:0;padding:16px}
 .card{background:#0b1220;border:1px solid #1f2a44;border-radius:18px;padding:18px;margin-bottom:14px}
 .title{font-size:22px;font-weight:800;background:linear-gradient(90deg,#38bdf8,#a78bfa);-webkit-background-clip:text;color:transparent}
 .muted{color:#93a4c3;font-size:13px}
 .bar{height:10px;background:#111a2e;border-radius:99px;overflow:hidden;margin:10px 0}
 .bar>i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#818cf8)}
 .row{border:1px solid #1e293b;border-radius:14px;padding:12px;margin:10px 0;background:#0e1626}
 .row-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
 .pill{background:#132038;border:1px solid #23314f;border-radius:99px;padding:2px 10px;font-size:11px;color:#7dd3fc}
 .link{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;color:#9fb3d1;background:#080d18;padding:8px;border-radius:10px;direction:ltr}
 .actions{display:flex;gap:8px;margin-top:8px}
 button{background:#13233d;color:#cfe4ff;border:1px solid #23395e;border-radius:10px;padding:8px 12px;cursor:pointer;font-family:inherit}
 button:hover{background:#1a2c4d}
 a.btn{display:inline-block;background:#0ea5e9;color:#04121f;text-decoration:none;border-radius:10px;padding:10px 14px;font-weight:700}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
 .k{font-size:12px;color:#93a4c3}.v{font-weight:700;margin-top:2px}
</style></head><body>
<div class="card">
  <div class="title">${options.panelName}</div>
  <div class="muted">کاربر: <b>${user.username}</b> · وضعیت: ${user.status}</div>
  ${options.announce ? `<div class="muted" style="margin-top:8px;color:#fbbf24">${options.announce}</div>` : ""}
  <div class="bar"><i style="width:${user.data_limit_bytes > 0 ? Math.min(100, Math.round((user.data_used_bytes / user.data_limit_bytes) * 100)) : 4}%"></i></div>
  <div class="grid">
    <div><div class="k">مصرف</div><div class="v">${fmtBytes(user.data_used_bytes)}</div></div>
    <div><div class="k">حجم کل</div><div class="v">${user.data_limit_bytes > 0 ? fmtBytes(user.data_limit_bytes) : "نامحدود"}</div></div>
    <div><div class="k">انقضا</div><div class="v">${user.expires_at ? new Date(user.expires_at * 1000).toLocaleDateString("fa-IR") : "بدون انقضا"}</div></div>
    <div><div class="k">دستگاه مجاز</div><div class="v">${user.device_limit || "نامحدود"}</div></div>
  </div>
  <div style="margin-top:12px"><a class="btn" href="${options.subscriptionUrl}">لینک ساب (Base64)</a></div>
</div>
<div class="card">
  <div class="row-head"><b>کانفیگ‌ها</b><span class="muted">${entries.length} نود</span></div>
  ${rows || '<div class="muted">هنوز نودی برای این کاربر تنظیم نشده است.</div>'}
</div>
<div class="card muted">پشتیبانی: ${options.supportId || "—"}</div>
</body></html>`;
}

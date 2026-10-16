#!/usr/bin/env node
/**
 * KalFetela Node Agent
 * ────────────────────
 * Runs on any VPS and turns it into a node of a KalFetela panel.
 *
 * Modes
 *   pull (default): the agent asks the panel for its configuration every
 *                   POLL seconds and reports traffic back (works behind NAT).
 *   push          : the panel calls the agent over HTTP (set AGENT_SECRET and
 *                   expose AGENT_PORT). Both modes can run at the same time.
 *
 * Usage
 *   AGENT_SECRET=xxxx PANEL_URL=https://panel.example.com NODE_ID=3 node agent.mjs
 *
 * Requires: Node.js 20+, an `xray` binary (`XRAY_BIN`, defaults to
 * `./xray` next to this file, downloaded automatically when missing).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import zlib from "node:zlib";

const env = process.env;
const PANEL_URL = (env.PANEL_URL || "").replace(/\/+$/, "");
const AGENT_SECRET = env.AGENT_SECRET || "";
const NODE_ID = Number(env.NODE_ID || 0);
const POLL_SECONDS = Number(env.POLL || 30);
const AGENT_PORT = Number(env.AGENT_PORT || 62050);
const DATA_DIR = env.DATA_DIR || path.join(process.cwd(), "kalfetela-agent");
const XRAY_DIR = path.join(DATA_DIR, "xray");
const XRAY_BIN = env.XRAY_BIN || path.join(XRAY_DIR, "xray");
const API_PORT = Number(env.XRAY_API_PORT || 10085);
const CONFIG_PATH = path.join(XRAY_DIR, "config.json");
const SERVICE_MODE = env.SERVICE_MODE === "true";
/* WireGuard mode (nodes with protocol=wireguard): the panel sends the whole
 * server config, the agent applies it with wg-quick and reports peer traffic. */
const WG_ENABLED = env.WG_ENABLED !== "false";
const WG_IFACE = env.WG_IFACE || "kalfetela";
const WG_CONF = env.WG_CONF || `/etc/wireguard/${WG_IFACE}.conf`;

let configHash = "";
let child = null;
let lastSnapshot = new Map();
let latestClients = [];

fs.mkdirSync(XRAY_DIR, { recursive: true });
log("agent starting", { PANEL_URL, NODE_ID, XRAY_BIN, AGENT_PORT });

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/* ------------------------------ xray core ------------------------------ */

function unzipFind(buffer, name) {
  const eocd = (() => {
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
      if (buffer.readUInt32LE(i) === 0x06054b50) return i;
    }
    throw new Error("bad zip");
  })();
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.toString("utf8", offset + 46, offset + 46 + nameLength).split("/").pop();
    if (entryName === name) {
      const nameLen = buffer.readUInt16LE(localOffset + 26);
      const extraLen = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + nameLen + extraLen;
      const raw = buffer.subarray(start, start + compressedSize);
      return method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

async function ensureCore() {
  if (fs.existsSync(XRAY_BIN)) return true;
  try {
    log("downloading xray core…");
    const release = await fetchJson("https://api.github.com/repos/XTLS/Xray-core/releases/latest");
    const version = String(release.tag_name || "").replace(/^v/, "");
    const url = `https://github.com/XTLS/Xray-core/releases/download/v${version}/Xray-linux-${process.arch === "arm64" ? "arm64-v8a" : "64"}.zip`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const binary = unzipFind(buffer, "xray");
    if (!binary) throw new Error("binary not found in archive");
    fs.writeFileSync(XRAY_BIN, binary, { mode: 0o755 });
    log(`core ${version} installed`);
    return true;
  } catch (error) {
    log("core download failed:", error.message);
    return false;
  }
}

function startXray() {
  if (SERVICE_MODE) {
    log("service mode: config written, restarting systemd unit");
    spawn("systemctl", ["restart", "xray"], { stdio: "inherit" });
    return;
  }
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
  const process_ = spawn(XRAY_BIN, ["run", "-c", CONFIG_PATH], { cwd: XRAY_DIR, stdio: ["ignore", "pipe", "pipe"] });
  child = process_;
  process_.stdout.on("data", (chunk) => log("xray:", chunk.toString().trim()));
  process_.stderr.on("data", (chunk) => log("xray!", chunk.toString().trim()));
  process_.on("exit", (code) => {
    child = null;
    if (!SERVICE_MODE) setTimeout(() => startXray(), 3000);
    log("xray exited", code);
  });
}

/* ------------------------------- config -------------------------------- */

function buildConfig(node, clients, settings) {
  const clientsConfig = clients.map((client) => {
    if (node.protocol === "trojan") return { password: client.password || client.uuid, email: client.email, level: 0 };
    if (node.protocol === "shadowsocks") return { password: (client.password || client.uuid).slice(0, 32), email: client.email, level: 0 };
    if (node.protocol === "vmess") return { id: client.uuid, email: client.email, alterId: 0, level: 0 };
    return { id: client.uuid, email: client.email, level: 0, flow: node.flow || "" };
  });

  const network = node.transport === "http" ? "tcp" : node.transport;
  const stream = { network, security: node.security };
  if (network === "ws") stream.wsSettings = { path: node.path || "/ws" };
  if (network === "httpupgrade") stream.httpupgradeSettings = { path: node.path || "/up", host: node.sni || "" };
  if (network === "grpc") stream.grpcSettings = { serviceName: node.service_name || "grpc" };
  if (node.security === "tls") stream.tlsSettings = { certificates: [], serverName: node.sni || "" };
  if (node.security === "reality" && node.reality) {
    stream.realitySettings = {
      show: false,
      dest: node.reality.dest,
      serverNames: [String(node.reality.dest || "").split(":")[0]],
      privateKey: node.reality.privateKey,
      shortIds: node.reality.shortIds || [],
    };
  }

  const settingsBlock =
    node.protocol === "trojan"
      ? { clients: clientsConfig, fallbacks: [] }
      : node.protocol === "shadowsocks"
        ? { method: "aes-256-gcm", password: "kalfetela-agent-ss", network: "tcp,udp", clients: clientsConfig }
        : node.protocol === "vmess"
          ? { clients: clientsConfig, disableInsecureEncryption: false }
          : { clients: clientsConfig, decryption: "none", fallbacks: [] };

  return {
    log: { loglevel: settings.log_level || "warning", access: path.join(XRAY_DIR, "access.log"), error: path.join(XRAY_DIR, "error.log") },
    dns: { servers: String(settings.dns || "1.1.1.1,8.8.8.8").split(",").map((item) => item.trim()) },
    stats: {},
    api: { tag: "api", services: ["HandlerService", "StatsService"] },
    policy: {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: false, statsInboundDownlink: false },
    },
    inbounds: [
      { tag: "api", listen: "127.0.0.1", port: API_PORT, protocol: "dokodemo-door", settings: { address: "127.0.0.1" } },
      {
        tag: `node-${node.id}`,
        listen: "0.0.0.0",
        port: node.port,
        protocol: node.protocol,
        settings: settingsBlock,
        streamSettings: stream,
        sniffing: { enabled: true, destOverride: ["http", "tls"] },
      },
    ],
    outbounds: [
      { tag: "direct", protocol: "freedom", settings: { domainStrategy: "UseIP" } },
      { tag: "block", protocol: "blackhole" },
    ],
    routing: {
      rules: [
        { type: "field", inboundTag: ["api"], outboundTag: "api" },
        ...(settings.route_iran ? [{ type: "field", domain: ["geosite:category-ir", "domain:.ir"], outboundTag: "direct" }] : []),
        ...(settings.block_ads ? [{ type: "field", domain: ["geosite:category-ads-all"], outboundTag: "block" }] : []),
      ],
    },
  };
}

function applyConfig(config) {
  const json = JSON.stringify(config, null, 2);
  const hash = Buffer.from(json).toString("base64").slice(0, 60);
  if (hash === configHash) return false;
  configHash = hash;
  fs.writeFileSync(CONFIG_PATH, json);
  log("config updated — restarting core");
  startXray();
  return true;
}

/* ------------------------------ wireguard ------------------------------ */

let wgConfHash = "";
let wgPayload = null;
let wgLastTransfer = new Map();

function sh(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.stderr.on("data", (chunk) => (err += chunk.toString()));
    child.on("error", (error) => resolve({ code: -1, out, err: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 0, out, err, ...options }));
  });
}

/** Writes the server config and (re)loads the interface. */
async function applyWireguardConfig(config) {
  const target = fs.existsSync("/etc/wireguard") && env.WG_CONF ? WG_CONF : path.join(DATA_DIR, "wireguard", `${WG_IFACE}.conf`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, config, { mode: 0o600 });
    log("wireguard config written:", target);
  } catch (error) {
    log("wireguard config not writable:", error.message);
    return false;
  }
  if (env.WG_APPLY === "false") return true;
  const up = await sh("wg", ["show", WG_IFACE]);
  if (up.code === 0) {
    const stripped = await sh("wg-quick", ["strip", target]);
    if (stripped.code === 0) {
      const synced = await sh("wg", ["syncconf", WG_IFACE, "/dev/stdin"]);
      if (synced.code === 0) {
        log("wireguard interface reloaded via syncconf");
        return true;
      }
      // fall through to a full bounce
      await sh("wg-quick", ["down", WG_IFACE]);
    }
  }
  const started = await sh("wg-quick", ["up", target]);
  if (started.code !== 0) {
    log("wg-quick up failed (is wireguard installed?):", started.err.trim().split("\n").slice(-1)[0] || started.code);
    return false;
  }
  log("wireguard interface started:", WG_IFACE);
  return true;
}

/** Pulls the server config + peer table and applies it when it changed. */
async function syncWireguard() {
  if (!PANEL_URL || !AGENT_SECRET) return;
  try {
    const response = await fetchJson(`${PANEL_URL}/api/agent/wireguard/${NODE_ID}`, { headers: authHeaders });
    const data = response.data ?? response;
    wgPayload = data;
    const hash = String(data.config || "").length + ":" + cryptoHash(String(data.config || ""));
    if (hash !== wgConfHash) {
      wgConfHash = hash;
      await applyWireguardConfig(String(data.config || ""));
    }
    const usages = await wireguardUsages(data.peers ?? []);
    if (usages.length) await reportUsages(usages);
  } catch (error) {
    log("wireguard sync failed:", error.message);
  }
}

function cryptoHash(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return String(hash);
}

/** `wg show <iface> dump` → per-peer transfer deltas mapped back to user emails. */
async function wireguardUsages(peers) {
  const byKey = new Map(peers.filter((peer) => peer.public_key).map((peer) => [peer.public_key, peer.email]));
  const dump = await sh("wg", ["show", WG_IFACE, "dump"]);
  if (dump.code !== 0) return [];
  const usages = [];
  for (const line of dump.out.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 8) continue; // interface line (5 fields) or empty
    const [, publicKey, , , , , rx, tx] = fields;
    const email = byKey.get(publicKey);
    if (!email) continue;
    const previous = wgLastTransfer.get(publicKey) ?? { rx: 0, tx: 0 };
    const deltaRx = Math.max(0, Number(rx) - previous.rx);
    const deltaTx = Math.max(0, Number(tx) - previous.tx);
    wgLastTransfer.set(publicKey, { rx: Number(rx), tx: Number(tx) });
    if (deltaRx || deltaTx) usages.push({ email, upload: deltaRx, download: deltaTx });
  }
  return usages;
}

/* ------------------------------ utilities ------------------------------ */

async function fetchJson(url, options = {}) {
  const isHttps = url.startsWith("https:");
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
}

const authHeaders = { "x-agent-secret": AGENT_SECRET, "content-type": "application/json" };

async function reportUsages(usages) {
  if (!PANEL_URL) return;
  try {
    await fetchJson(`${PANEL_URL}/api/agent/report`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        node_id: NODE_ID,
        usages,
        cpu: os.loadavg()[0] * 100 / Math.max(1, os.cpus().length),
        mem: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        uptime: Math.floor(os.uptime()),
      }),
    });
  } catch (error) {
    log("report failed:", error.message);
  }
}

function statsQuery() {
  return new Promise((resolve) => {
    if (!fs.existsSync(XRAY_BIN)) return resolve([]);
    const process_ = spawn(XRAY_BIN, ["api", "statsquery", `--server=127.0.0.1:${API_PORT}`, "-pattern", "user>>>", "-reset"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    process_.stdout.on("data", (chunk) => (out += chunk.toString()));
    process_.on("exit", () => {
      const deltas = new Map();
      const pattern = /name:\s*"user>>>([^>]+)>>>traffic>>>(up|down)link"\s*\n\s*value:\s*(\d+)/g;
      let match;
      while ((match = pattern.exec(out))) {
        const entry = deltas.get(match[1]) || { email: match[1], upload: 0, download: 0 };
        if (match[2] === "up") entry.upload += Number(match[3]);
        else entry.download += Number(match[3]);
        deltas.set(match[1], entry);
      }
      resolve([...deltas.values()]);
    });
    process_.on("error", () => resolve([]));
  });
}

async function pullLoop() {
  if (!PANEL_URL || !AGENT_SECRET) {
    log("PANEL_URL / AGENT_SECRET not set — pull mode disabled");
    return;
  }
  for (;;) {
    try {
      const response = await fetchJson(`${PANEL_URL}/api/agent/config?node_id=${NODE_ID}&secret=${encodeURIComponent(AGENT_SECRET)}`);
      const data = response.data ?? response;
      if (WG_ENABLED && data.node?.protocol === "wireguard") {
        await syncWireguard();
        await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
        continue;
      }
      latestClients = data.clients ?? [];
      const changed = applyConfig(buildConfig(data.node, latestClients, data.settings ?? {}));
      if (!changed && !child) startXray();
      const usages = await statsQuery();
      if (usages.length) await reportUsages(usages);
    } catch (error) {
      log("pull failed:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

/* --------------------------- push mode server --------------------------- */

function startServer() {
  const server = http.createServer((request, response) => {
    const send = (code, payload) => {
      response.writeHead(code, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (request.headers["x-agent-secret"] !== AGENT_SECRET) return send(401, { error: "unauthorized" });
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        if (request.url.startsWith("/agent/wireguard")) {
          return send(200, { config: wgPayload?.config ?? null, peers: wgPayload?.peers ?? [], server_public_key: wgPayload?.server_public_key ?? null });
        }
        if (request.url.startsWith("/agent/status")) {
          return send(200, {
            cpu: Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100),
            mem: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
            version: null,
            uptime: Math.floor(os.uptime()),
          });
        }
        if (request.url.startsWith("/agent/clients")) {
          return send(200, { clients: latestClients.map((client) => ({ email: client.email, uuid: client.uuid, enabled: true, up: 0, down: 0, total: client.limitBytes ?? 0, expiry: client.expiresAt ?? null })) });
        }
        if (request.url.startsWith("/agent/client/remove")) {
          latestClients = latestClients.filter((client) => client.email !== payload.email);
          if (latestClients.length !== undefined && configCache) applyConfig(buildConfig(configCache.node, latestClients, configCache.settings ?? {}));
          return send(200, { ok: true });
        }
        if (request.url.startsWith("/agent/client")) {
          const incoming = payload.client ?? {};
          const next = latestClients.filter((client) => client.email !== incoming.email);
          next.push({ email: incoming.email, uuid: incoming.uuid, password: incoming.password, limitBytes: incoming.limitBytes, expiresAt: incoming.expiresAt });
          latestClients = next;
          if (configCache) applyConfig(buildConfig(configCache.node, latestClients, configCache.settings ?? {}));
          return send(200, { ok: true });
        }
        send(404, { error: "unknown endpoint" });
      } catch (error) {
        send(500, { error: error.message });
      }
    });
  });
  server.listen(AGENT_PORT, "0.0.0.0", () => log(`push mode listening on 0.0.0.0:${AGENT_PORT}`));
}

let configCache = null;

/* --------------------------------- boot -------------------------------- */
await ensureCore();
if (PANEL_URL) {
  // cache the first config for push mode operations
  try {
    const initial = await fetchJson(`${PANEL_URL}/api/agent/config?node_id=${NODE_ID}&secret=${encodeURIComponent(AGENT_SECRET)}`);
    configCache = initial.data ?? initial;
    latestClients = configCache.clients ?? [];
    applyConfig(buildConfig(configCache.node, latestClients, configCache.settings ?? {}));
  } catch (error) {
    log("initial config failed:", error.message);
  }
  pullLoop();
}
if (env.PUSH_MODE !== "false") startServer();
log("agent ready", { wireguard: WG_ENABLED, iface: WG_ENABLED ? WG_IFACE : null, xray: XRAY_BIN });
void https;

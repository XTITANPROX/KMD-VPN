// Embedded Xray-core manager — runs the core inside the panel container
// (Railway) so the panel itself can be a full VPN node.
//
//  * config is generated from the `nodes` rows whose kind = 'embedded'
//  * client list is (re)built from the database by the node dispatcher
//  * per-user traffic is read back from the core stats API
//  * online users / unique IPs come from the access log tailer (device limits)
//
// When the core binary is unavailable the manager degrades to "config only"
// mode: it still generates the config JSON + client links, but does not spawn
// a process. Everything else keeps working.

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { XRAY_API_PORT, XRAY_BINARY, XRAY_DIR, XRAY_START_PORT, PUBLIC_URL, LOCAL_NODE_HOST } from "../../env.js";
import { randomHex, realityKeyPair } from "../../lib/crypto.js";
import { unzipFile } from "../../lib/zip.js";
import type { ClientSpec } from "./types.js";

export interface EmbeddedInboundSpec {
  nodeId: number;
  name: string;
  port: number;
  protocol: string;
  transport: string;
  security: string;
  host: string;
  sni: string | null;
  path: string | null;
  serviceName: string | null;
  flow: string | null;
  fingerprint: string | null;
  reality: {
    privateKey: string;
    publicKey: string;
    shortIds: string[];
    dest: string;
    serverNames: string[];
  } | null;
  clients: ClientSpec[];
  settings: Record<string, unknown>;
}

export interface EmbeddedStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  configPath: string;
  ports: number[];
  error: string | null;
  configOnly: boolean;
  pid: number | null;
}

interface UsageDelta {
  email: string;
  upload: number;
  download: number;
}

const ACCESS_MAX_BYTES = 8 * 1024 * 1024;

export class EmbeddedXray {
  private process: ChildProcess | null = null;
  private inbounds = new Map<number, EmbeddedInboundSpec>();
  private applyTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;
  private restartDelay = 2000;
  private stopping = false;
  private lastError: string | null = null;
  private version: string | null = null;
  private logOffset = 0;
  private logPartial = "";
  private readonly accessLog = path.join(XRAY_DIR, "access.log");
  private readonly errorLog = path.join(XRAY_DIR, "error.log");
  private readonly configPath = path.join(XRAY_DIR, "config.json");
  private readonly online = new Map<string, Map<string, number>>();
  private usageHandler: ((deltas: UsageDelta[]) => void) | null = null;
  private lastApplyAt = 0;

  constructor(private readonly downloadEnabled = true) {}

  /* ------------------------------- public ------------------------------- */

  onUsage(handler: (deltas: UsageDelta[]) => void): void {
    this.usageHandler = handler;
  }

  status(): EmbeddedStatus {
    return {
      installed: fs.existsSync(XRAY_BINARY),
      running: Boolean(this.process && this.process.exitCode === null),
      version: this.version,
      configPath: this.configPath,
      ports: [...this.inbounds.values()].map((inbound) => inbound.port).sort((a, b) => a - b),
      error: this.lastError,
      configOnly: !fs.existsSync(XRAY_BINARY),
      pid: this.process?.pid ?? null,
    };
  }

  /** Replaces the whole embedded node registry (called by the node dispatcher). */
  setInbounds(specs: EmbeddedInboundSpec[]): void {
    const changed = this.signature(specs) !== this.signature([...this.inbounds.values()]);
    this.inbounds = new Map(specs.map((spec) => [spec.nodeId, spec]));
    if (changed) this.scheduleApply();
  }

  getInbounds(): EmbeddedInboundSpec[] {
    return [...this.inbounds.values()];
  }

  /** Unique client IPs seen recently per user email. */
  onlineSnapshot(windowSeconds = 300): Array<{ email: string; ips: string[]; lastSeen: number }> {
    const cutoff = Date.now() - windowSeconds * 1000;
    const out: Array<{ email: string; ips: string[]; lastSeen: number }> = [];
    for (const [email, ips] of this.online) {
      const fresh = [...ips.entries()].filter(([, seen]) => seen >= cutoff);
      for (const [ip] of ips) if (!fresh.some(([entryIp]) => entryIp === ip)) ips.delete(ip);
      if (fresh.length) out.push({ email, ips: fresh.map(([ip]) => ip), lastSeen: Math.max(...fresh.map(([, seen]) => seen)) });
    }
    return out;
  }

  buildConfigJson(): string {
    return JSON.stringify(this.config(), null, 2);
  }

  async start(): Promise<void> {
    fs.mkdirSync(XRAY_DIR, { recursive: true });
    if (!fs.existsSync(XRAY_BINARY)) {
      if (this.downloadEnabled) {
        try {
          await this.downloadCore();
        } catch (error) {
          this.lastError = `دانلود هسته Xray ناموفق بود: ${(error as Error).message}`;
          console.warn("[xray]", this.lastError);
        }
      } else {
        this.lastError = "باینری Xray نصب نیست (حالت فقط‌کانفیگ فعال است)";
      }
    }
    if (fs.existsSync(XRAY_BINARY)) {
      try {
        this.version = await this.probeVersion();
      } catch {
        /* ignore */
      }
      this.writeConfig();
      this.spawnCore();
      this.startStatsLoop();
      this.startLogTail();
    }
  }

  stop(): void {
    this.stopping = true;
    for (const timer of [this.applyTimer, this.restartTimer, this.statsTimer, this.logTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.applyTimer = null;
    this.restartTimer = null;
    this.statsTimer = null;
    this.logTimer = null;
    this.process?.kill("SIGTERM");
    this.process = null;
  }

  async restart(): Promise<void> {
    this.stopping = false;
    this.writeConfig();
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (fs.existsSync(XRAY_BINARY)) this.spawnCore();
  }

  async downloadCore(version = process.env.XRAY_VERSION || ""): Promise<string> {
    let resolved = version.replace(/^v/, "");
    if (!resolved) {
      const response = await fetch("https://api.github.com/repos/XTLS/Xray-core/releases/latest", {
        headers: { "user-agent": "KalFetela", accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
      const data = (await response.json()) as { tag_name?: string };
      resolved = (data.tag_name ?? "").replace(/^v/, "");
    }
    if (!resolved) throw new Error("نسخه Xray مشخص نشد");
    const arch = process.arch === "arm64" ? "arm64-v8a" : "64";
    const url =
      process.env.XRAY_DOWNLOAD_URL ||
      `https://github.com/XTLS/Xray-core/releases/download/v${resolved}/Xray-linux-${arch}.zip`;
    console.log(`[xray] downloading ${url}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`دانلود: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const binary = unzipFile(buffer, "xray");
    if (!binary) throw new Error("فایل اجرایی xray داخل آرشیو پیدا نشد");
    fs.mkdirSync(XRAY_DIR, { recursive: true });
    fs.writeFileSync(XRAY_BINARY, binary, { mode: 0o755 });
    fs.chmodSync(XRAY_BINARY, 0o755);
    this.version = resolved;
    this.lastError = null;
    console.log(`[xray] core ${resolved} installed`);
    return resolved;
  }

  /* ------------------------------ internals ----------------------------- */

  private signature(specs: EmbeddedInboundSpec[]): string {
    return JSON.stringify(
      specs
        .map((spec) => ({
          id: spec.nodeId,
          port: spec.port,
          protocol: spec.protocol,
          transport: spec.transport,
          security: spec.security,
          path: spec.path,
          sni: spec.sni,
          reality: spec.reality?.publicKey ?? null,
          clients: spec.clients
            .map((client) => `${client.email}:${client.uuid}:${client.limitBytes}:${client.expiresAt ?? 0}:${client.deviceLimit}:${client.enabled}`)
            .sort(),
        }))
        .sort((a, b) => a.id - b.id)
    );
  }

  private scheduleApply(): void {
    if (this.applyTimer) return;
    const elapsed = Date.now() - this.lastApplyAt;
    const delay = Math.max(elapsed > 4000 ? 400 : 1500, 200);
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      this.lastApplyAt = Date.now();
      this.writeConfig();
      if (fs.existsSync(XRAY_BINARY) && !this.isServiceMode()) void this.restart();
      else if (fs.existsSync(XRAY_BINARY)) void this.reloadViaApi();
    }, delay);
  }

  private isServiceMode(): boolean {
    return process.env.XRAY_SERVICE_MODE === "true";
  }

  /** When a supervisor (agent/Docker) owns the process we only rewrite config. */
  private async reloadViaApi(): Promise<void> {
    // Xray has no per-client hot reload API; restarting is the reliable path.
    await this.restart();
  }

  private spawnCore(): void {
    if (this.stopping || !fs.existsSync(XRAY_BINARY)) return;
    try {
      const child = spawn(XRAY_BINARY, ["run", "-c", this.configPath], {
        cwd: XRAY_DIR,
        env: { ...process.env, XRAY_LOCATION_ASSET: XRAY_DIR },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.process = child;
      this.lastError = null;
      this.restartDelay = 2000;
      child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[xray] ${chunk.toString()}`));
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        this.lastError = text.trim().slice(0, 400);
        process.stderr.write(`[xray] ${text}`);
      });
      child.on("exit", (code, signal) => {
        this.process = null;
        if (this.stopping) return;
        const message = `هسته Xray متوقف شد (code=${code ?? "?"} signal=${signal ?? "-"})`;
        console.warn("[xray]", message);
        this.lastError = message;
        this.restartTimer = setTimeout(() => {
          this.restartDelay = Math.min(this.restartDelay * 2, 60_000);
          this.spawnCore();
        }, this.restartDelay);
      });
    } catch (error) {
      this.lastError = (error as Error).message;
      console.error("[xray] spawn failed:", this.lastError);
    }
  }

  private async probeVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(XRAY_BINARY, ["version"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", () => {
        const match = /Xray\s+([\d.]+)/.exec(out);
        resolve(match?.[1] ?? out.trim().split("\n")[0] ?? "unknown");
      });
    });
  }

  /* ----------------------------- config build ---------------------------- */

  private config(): Record<string, unknown> {
    const inbounds: Record<string, unknown>[] = [
      {
        tag: "api",
        listen: "127.0.0.1",
        port: XRAY_API_PORT,
        protocol: "dokodemo-door",
        settings: { address: "127.0.0.1" },
      },
    ];

    // Optional panel relay: a SOCKS/HTTP inbound is handy for testing.
    if (process.env.XRAY_ENABLE_LOCAL_SOCKS === "true") {
      inbounds.push({
        tag: "panel-socks",
        listen: "127.0.0.1",
        port: XRAY_START_PORT - 1,
        protocol: "socks",
        settings: { auth: "noauth", udp: false },
      });
    }

    for (const spec of this.inbounds.values()) {
      inbounds.push(this.inboundConfig(spec));
    }

    const directDomains = (process.env.XRAY_DIRECT_DOMAINS || "geosite:category-ir,domain:.ir,regexp:.*\\.ir$").split(",");
    const routingRules: Record<string, unknown>[] = [
      { type: "field", inboundTag: ["api"], outboundTag: "api" },
      ...(process.env.XRAY_ROUTE_IRAN === "false"
        ? []
        : [{ type: "field", domain: directDomains, outboundTag: "direct" }]),
    ];

    return {
      log: {
        loglevel: process.env.XRAY_LOG_LEVEL || "warning",
        access: this.accessLog,
        error: this.errorLog,
        dnsLog: false,
      },
      dns: {
        servers: (process.env.XRAY_DNS || "1.1.1.1,8.8.8.8").split(",").map((address) => String(address).trim()),
        queryStrategy: "UseIPv4",
      },
      stats: {},
      api: { tag: "api", services: ["HandlerService", "StatsService", "LoggerService"] },
      policy: {
        levels: {
          "0": {
            statsUserUplink: true,
            statsUserDownlink: true,
            handshake: 4,
            connIdle: 300,
            uplinkOnly: 0,
            downlinkOnly: 0,
            bufferSize: 64,
          },
        },
        system: {
          statsInboundUplink: true,
          statsInboundDownlink: true,
          statsOutboundUplink: false,
          statsOutboundDownlink: false,
        },
      },
      inbounds,
      outbounds: [
        { tag: "direct", protocol: "freedom", settings: { domainStrategy: "UseIP" } },
        { tag: "block", protocol: "blackhole", settings: {} },
      ],
      routing: { domainStrategy: "AsIs", rules: routingRules },
    };
  }

  private inboundConfig(spec: EmbeddedInboundSpec): Record<string, unknown> {
    const settings = this.inboundSettings(spec);
    const streamSettings = this.streamSettings(spec);
    return {
      tag: `node-${spec.nodeId}`,
      listen: "0.0.0.0",
      port: spec.port,
      protocol: spec.protocol,
      settings,
      streamSettings,
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
    };
  }

  private inboundSettings(spec: EmbeddedInboundSpec): Record<string, unknown> {
    const clients = spec.clients;
    switch (spec.protocol) {
      case "vmess":
        return {
          clients: clients.map((client) => ({
            id: client.uuid,
            email: client.email,
            alterId: 0,
            level: 0,
          })),
          disableInsecureEncryption: false,
        };
      case "trojan":
        return {
          clients: clients.map((client) => ({
            password: client.password || client.uuid,
            email: client.email,
            level: 0,
          })),
          fallbacks: [],
        };
      case "shadowsocks":
        return {
          method: "aes-256-gcm",
          password: randomHex(16),
          network: "tcp,udp",
          clients: clients.map((client) => ({
            password: (client.password || client.uuid).slice(0, 32) || randomHex(16),
            email: client.email,
            level: 0,
          })),
        };
      default:
        return {
          clients: clients.map((client) => ({
            id: client.uuid,
            email: client.email,
            flow: (client.speedMbps ?? 0) > 0 ? "" : (spec.flow ?? ""),
            level: 0,
          })),
          decryption: "none",
          fallbacks: [],
        };
    }
  }

  private streamSettings(spec: EmbeddedInboundSpec): Record<string, unknown> {
    const network = spec.transport === "http" ? "tcp" : spec.transport === "xhttp" ? "httpupgrade" : spec.transport;
    const security = spec.security;
    const stream: Record<string, unknown> = { network, security };
    if (network === "ws") {
      stream.wsSettings = { path: spec.path || "/ws", headers: { Host: spec.sni || spec.host } };
    } else if (network === "httpupgrade") {
      stream.httpupgradeSettings = { path: spec.path || "/upgrade", host: spec.sni || spec.host };
    } else if (network === "grpc") {
      stream.grpcSettings = { serviceName: spec.serviceName || "grpc", multiMode: false };
    } else if (network === "tcp" && spec.protocol === "vmess") {
      stream.tcpSettings = { header: { type: "none" } };
    }
    if (security === "tls") {
      stream.tlsSettings = {
        serverName: spec.sni || spec.host,
        minVersion: "1.2",
        alpn: ["h2", "http/1.1"],
        certificates: [],
        settings: { allowInsecure: false, fingerprint: spec.fingerprint || "chrome" },
      };
    } else if (security === "reality" && spec.reality) {
      stream.realitySettings = {
        show: false,
        dest: spec.reality.dest,
        xver: 0,
        serverNames: spec.reality.serverNames,
        privateKey: spec.reality.privateKey,
        shortIds: spec.reality.shortIds,
        spx: "/" + randomHex(6),
      };
    }
    return stream;
  }

  private writeConfig(): void {
    try {
      fs.mkdirSync(XRAY_DIR, { recursive: true });
      fs.writeFileSync(this.configPath, this.buildConfigJson());
    } catch (error) {
      this.lastError = `نوشتن کانفیگ ناموفق بود: ${(error as Error).message}`;
    }
  }

  /* ------------------------------ stats loop ---------------------------- */

  private startStatsLoop(): void {
    const interval = Number(process.env.XRAY_STATS_INTERVAL_MS || 20_000);
    const tick = async () => {
      try {
        if (this.process && this.usageHandler) {
          const deltas = await this.queryStats();
          if (deltas.length) this.usageHandler(deltas);
        }
      } catch (error) {
        console.warn("[xray] stats query failed:", (error as Error).message);
      } finally {
        this.statsTimer = setTimeout(tick, interval);
      }
    };
    this.statsTimer = setTimeout(tick, 8000);
  }

  private async queryStats(): Promise<UsageDelta[]> {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        XRAY_BINARY,
        ["api", "statsquery", `--server=127.0.0.1:${XRAY_API_PORT}`, "-pattern", "user>>>", "-reset"],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let out = "";
      let err = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        err += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))));
    });

    const deltas = new Map<string, UsageDelta>();
    const pattern = /name:\s*"user>>>([^>]+)>>>traffic>>>(up|down)link"\s*\n\s*value:\s*(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output))) {
      const email = match[1]!;
      const direction = match[2]!;
      const value = Number(match[3]!);
      const entry = deltas.get(email) ?? { email, upload: 0, download: 0 };
      if (direction === "up") entry.upload += value;
      else entry.download += value;
      deltas.set(email, entry);
    }
    return [...deltas.values()];
  }

  /* --------------------------- access log tailer ------------------------ */

  private startLogTail(): void {
    try {
      if (fs.existsSync(this.accessLog)) this.logOffset = fs.statSync(this.accessLog).size;
    } catch {
      this.logOffset = 0;
    }
    const tick = () => {
      try {
        this.readAccessLog();
      } catch (error) {
        console.warn("[xray] access log read failed:", (error as Error).message);
      } finally {
        this.logTimer = setTimeout(tick, Number(process.env.XRAY_LOG_INTERVAL_MS || 5000));
      }
    };
    this.logTimer = setTimeout(tick, 5000);
  }

  private readAccessLog(): void {
    if (!fs.existsSync(this.accessLog)) return;
    const size = fs.statSync(this.accessLog).size;
    if (size < this.logOffset) this.logOffset = 0;
    if (size === this.logOffset) return;
    if (size > ACCESS_MAX_BYTES) {
      // rotate to keep the volume small
      fs.truncateSync(this.accessLog, 0);
      this.logOffset = 0;
      return;
    }
    const fd = fs.openSync(this.accessLog, "r");
    const length = size - this.logOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, this.logOffset);
    fs.closeSync(fd);
    this.logOffset = size;
    const text = this.logPartial + buffer.toString("utf8");
    const lines = text.split("\n");
    this.logPartial = lines.pop() ?? "";
    for (const line of lines) this.ingestAccessLogLine(line);
  }

  /** Exposed for tests and for agents that forward log lines. */
  ingestAccessLogLine(line: string): void {
    if (!line.includes("accepted")) return;
    const emailMatch = /email:\s*([^\s]+)/.exec(line);
    const ip = extractSourceIp(line);
    if (!emailMatch || !ip) return;
    const email = emailMatch[1]!;
    const entry = this.online.get(email) ?? new Map<string, number>();
    entry.set(ip, Date.now());
    this.online.set(email, entry);
  }

  /** Public port helper used when generating links for embedded nodes. */
  publicHost(): string {
    return LOCAL_NODE_HOST || PUBLIC_URL.split(":")[0] || "localhost";
  }
}

/**
 * Pulls the client source address out of an Xray access-log line.
 * Handles both `from 1.2.3.4:port` / `from [2001:db8::1]:port` and the older
 * `1.2.3.4:port accepted ...` layout without mistaking the timestamp for an IP.
 */
export function extractSourceIp(line: string): string | null {
  const bracketedV6 = /from\s+\[([0-9a-fA-F:.]{2,45})\]:\d{1,5}/.exec(line);
  if (bracketedV6) return bracketedV6[1] ?? null;
  const fromV4 = /from\s+(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}/.exec(line);
  if (fromV4) return fromV4[1] ?? null;
  const fromV6 = /from\s+([0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}):\d{1,5}/.exec(line);
  if (fromV6) return fromV6[1] ?? null;
  const bare = /(?:^|\s)(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}\s+accepted/.exec(line);
  return bare?.[1] ?? null;
}

export const embeddedXray = new EmbeddedXray(process.env.XRAY_AUTO_DOWNLOAD !== "false");

/** Generates (or returns existing) REALITY settings for an embedded node. */
export function ensureRealitySettings(existing?: {
  privateKey?: string | null;
  publicKey?: string | null;
  shortId?: string | null;
  dest?: string | null;
}): { privateKey: string; publicKey: string; shortIds: string[]; dest: string; serverNames: string[] } {
  const pair =
    existing?.privateKey && existing?.publicKey
      ? { privateKey: existing.privateKey, publicKey: existing.publicKey }
      : realityKeyPair();
  const dest = existing?.dest || "www.cloudflare.com:443";
  const serverName = dest.split(":")[0] || "www.cloudflare.com";
  const shortIds = existing?.shortId ? [existing.shortId] : [randomHex(4)];
  return { ...pair, shortIds, dest, serverNames: [serverName] };
}

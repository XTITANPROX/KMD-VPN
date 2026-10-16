// Scanner service — measures reachability + latency for Cloudflare edge
// IPs and for SOCKS4/5/HTTP proxies.
//
// IP scanner: Workers blocks raw TCP connect() to Cloudflare anycast IPs
// (loop prevention), so we measure the TLS+HTTP round-trip with fetch()
// to https://<ip>/cdn-cgi/trace — the same TCP+TLS handshake a VLESS
// client performs, which is what determines perceived latency. The HTTP
// status (200/403) doesn't matter; only that TLS terminated.
//
// Proxy scanner: for SOCKS4/5/HTTP we still use connect() because fetch()
// doesn't support upstream proxies. The Workers port-allowlist applies
// (only 443/2053/2083/2087/2096/8443 and a handful of HTTP ports).

import { connect } from "cloudflare:sockets";

export interface ScanResult {
  target: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface IpScanOptions {
  ips: string[];
  port?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface ProxyScanOptions {
  proxies: string[];
  testHost?: string;
  testPort?: number;
  concurrency?: number;
  timeoutMs?: number;
}

const TLS_PORTS = new Set([443, 2053, 2083, 2087, 2096, 8443]);

/**
 * Probe an edge IP by issuing an HTTPS request directly to it. The TLS
 * handshake + first response byte is what a real VLESS client pays; we
 * measure that. The HTTP status is irrelevant — Cloudflare returns 403
 * for direct-IP requests but the TLS still completes successfully.
 */
export async function pingIp(ip: string, port: number, timeoutMs: number): Promise<number> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // On non-TLS ports we can't really probe the edge (there is no
    // plain HTTP on CF anycast for most ports); fall back to a TCP
    // socket for those. On TLS ports, fetch() gives us the real
    // handshake latency and isn't blocked by the loop-prevention rule
    // that connect() hits for Cloudflare-owned ranges.
    if (TLS_PORTS.has(port)) {
      // Cache-bust with a random query so we never hit an edge cache —
      // every probe does a fresh TLS handshake.
      await fetch("https://" + ip + ":" + port + "/cdn-cgi/trace?_=" + Math.random(), {
        method: "GET",
        signal: ctrl.signal,
        headers: { "user-agent": "KALFETELA-Scanner/1.0", host: "www.cloudflare.com", "cache-control": "no-cache" },
        redirect: "manual",
      } as RequestInit);
    } else {
      const socket = connect({ hostname: ip, port }, { secureTransport: "off", allowHalfOpen: false });
      await Promise.race([
        socket.opened,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      socket.close().catch(() => {});
    }
    return Date.now() - start;
  } finally {
    clearTimeout(timer);
  }
}

export async function scanIps(opts: IpScanOptions): Promise<ScanResult[]> {
  const port = opts.port ?? 443;
  const concurrency = Math.min(20, Math.max(1, opts.concurrency ?? 10));
  const timeoutMs = Math.min(8000, Math.max(1500, opts.timeoutMs ?? 4000));
  const out: ScanResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < opts.ips.length) {
      const idx = cursor++;
      const ip = opts.ips[idx]!;
      try {
        const ms = await pingIp(ip, port, timeoutMs);
        out[idx] = { target: ip, ok: true, latencyMs: ms };
      } catch (e) {
        out[idx] = { target: ip, ok: false, latencyMs: -1, error: (e as Error).message.slice(0, 80) };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

/**
 * Parse a proxy URI of the form:
 *   socks5://[user:pass@]host:port
 *   socks4://host:port
 *   http://[user:pass@]host:port
 *   host:port                            (treated as SOCKS5)
 * Returns null on malformed input.
 */
export interface ParsedProxy {
  type: "socks5" | "socks4" | "http";
  host: string;
  port: number;
  user?: string;
  pass?: string;
}
export function parseProxyUri(raw: string): ParsedProxy | null {
  let s = raw.trim();
  if (!s) return null;
  let type: ParsedProxy["type"] = "socks5";
  if (s.startsWith("socks5://")) { type = "socks5"; s = s.slice(9); }
  else if (s.startsWith("socks4://")) { type = "socks4"; s = s.slice(9); }
  else if (s.startsWith("http://")) { type = "http"; s = s.slice(7); }
  else if (s.startsWith("https://")) { type = "http"; s = s.slice(8); }
  let user: string | undefined, pass: string | undefined;
  const at = s.lastIndexOf("@");
  if (at >= 0) {
    const cred = s.slice(0, at);
    s = s.slice(at + 1);
    const ci = cred.indexOf(":");
    if (ci >= 0) { user = cred.slice(0, ci); pass = cred.slice(ci + 1); }
    else user = cred;
  }
  // strip path/query if present
  s = s.split("/")[0]!.split("?")[0]!;
  const ci = s.lastIndexOf(":");
  if (ci < 0) return null;
  const host = s.slice(0, ci);
  const port = parseInt(s.slice(ci + 1), 10);
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { type, host, port, user, pass };
}

/**
 * Test a proxy by asking it to CONNECT to testHost:testPort and measuring
 * how long until the upstream acknowledges. We then close immediately.
 */
export async function testProxy(p: ParsedProxy, testHost: string, testPort: number, timeoutMs: number): Promise<number> {
  const start = Date.now();
  const socket = connect({ hostname: p.host, port: p.port }, { secureTransport: "off", allowHalfOpen: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
      }),
    ]);
    if (timer) { clearTimeout(timer); timer = undefined; }

    if (p.type === "socks5") {
      // greeting (no-auth)
      await writer.write(new Uint8Array([0x05, 0x01, 0x00]));
      const hdr = await readExact(reader, 2, timeoutMs);
      if (hdr[0] !== 0x05) throw new Error("bad SOCKS5 handshake");
      if (hdr[1] === 0x02 && p.user) {
        // user/pass auth
        const u = new TextEncoder().encode(p.user);
        const pw = new TextEncoder().encode(p.pass || "");
        const buf = new Uint8Array(3 + u.length + pw.length);
        buf.set([0x01, u.length], 0); buf.set(u, 2);
        buf[2 + u.length] = pw.length; buf.set(pw, 3 + u.length);
        await writer.write(buf);
        const ar = await readExact(reader, 2, timeoutMs);
        if (ar[1] !== 0x00) throw new Error("SOCKS5 auth failed");
      } else if (hdr[1] !== 0x00) {
        throw new Error("SOCKS5 requires auth");
      }
      // CONNECT to testHost
      const host = new TextEncoder().encode(testHost);
      const req = new Uint8Array(7 + host.length);
      req.set([0x05, 0x01, 0x00, 0x03, host.length], 0);
      req.set(host, 5);
      req[5 + host.length] = (testPort >> 8) & 0xff;
      req[6 + host.length] = testPort & 0xff;
      await writer.write(req);
      const rep = await readExact(reader, 4, timeoutMs);
      if (rep[1] !== 0x00) throw new Error("SOCKS5 connect failed (" + rep[1] + ")");
      // consume the rest of the reply (bound addr)
      const atyp = rep[3];
      if (atyp === 1) await readExact(reader, 4, timeoutMs);
      else if (atyp === 4) await readExact(reader, 16, timeoutMs);
      else if (atyp === 3) { const l = await readExact(reader, 1, timeoutMs); await readExact(reader, l[0]!, timeoutMs); }
      await readExact(reader, 2, timeoutMs);
    } else if (p.type === "socks4") {
      // SOCKS4a: if testHost isn't a dotted-quad IP, set DSTIP = 0.0.0.x (x>0)
      // and append the hostname as a NUL-terminated string after the USERID.
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(testHost);
      let dstBytes: number[];
      let extra = "";
      if (isIp) {
        dstBytes = testHost.split(".").map((x) => parseInt(x, 10));
      } else {
        dstBytes = [0, 0, 0, 1];
        extra = testHost;
      }
      const u8 = new TextEncoder().encode(extra);
      const buf = new Uint8Array(9 + u8.length + 1);
      buf.set([0x04, 0x01, (testPort >> 8) & 0xff, testPort & 0xff,
        dstBytes[0]!, dstBytes[1]!, dstBytes[2]!, dstBytes[3]!, 0x00], 0);
      buf.set(u8, 9);
      buf[9 + u8.length] = 0x00;
      await writer.write(buf);
      const r = await readExact(reader, 8, timeoutMs);
      if (r[1] !== 0x5a) throw new Error("SOCKS4 connect failed (" + r[1] + ")");
    } else {
      // HTTP CONNECT
      const auth = p.user ? "Basic " + btoa(p.user + ":" + (p.pass || "")) : "";
      const req = "CONNECT " + testHost + ":" + testPort + " HTTP/1.1\r\nHost: " + testHost + ":" + testPort + "\r\n" +
        (auth ? "Proxy-Authorization: " + auth + "\r\n" : "") + "Proxy-Connection: close\r\n\r\n";
      await writer.write(new TextEncoder().encode(req));
      // read until \r\n\r\n
      let buf = "";
      while (buf.indexOf("\r\n\r\n") < 0) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new Error("http timeout")), timeoutMs);
            timer = t as unknown as ReturnType<typeof setTimeout>;
          }),
        ]);
        if (timer) { clearTimeout(timer); timer = undefined; }
        if (done) throw new Error("proxy closed");
        buf += new TextDecoder().decode(value);
        if (buf.length > 4096) break;
      }
      const line = buf.split("\r\n")[0] || "";
      if (!/ 200\b/.test(line)) throw new Error("HTTP proxy: " + line);
    }
    return Date.now() - start;
  } finally {
    if (timer) clearTimeout(timer);
    try { await writer.close(); } catch {}
    try { await reader.cancel(); } catch {}
    socket.close().catch(() => {});
  }
}

async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, n: number, timeoutMs: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    while (total < n) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("read timeout")), timeoutMs);
        }),
      ]);
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (done || !value) throw new Error("socket closed");
      chunks.push(value);
      total += value.length;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  const out = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, n - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= n) break;
  }
  return out;
}

export async function scanProxies(opts: ProxyScanOptions): Promise<ScanResult[]> {
  const testHost = opts.testHost || "1.1.1.1";
  const testPort = opts.testPort ?? 443;
  const concurrency = Math.min(15, Math.max(1, opts.concurrency ?? 8));
  const timeoutMs = Math.min(10000, Math.max(2000, opts.timeoutMs ?? 6000));
  const out: ScanResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < opts.proxies.length) {
      const idx = cursor++;
      const raw = opts.proxies[idx]!;
      const parsed = parseProxyUri(raw);
      if (!parsed) {
        out[idx] = { target: raw, ok: false, latencyMs: -1, error: "bad URI" };
        continue;
      }
      try {
        const ms = await testProxy(parsed, testHost, testPort, timeoutMs);
        out[idx] = { target: raw, ok: true, latencyMs: ms };
      } catch (e) {
        out[idx] = { target: raw, ok: false, latencyMs: -1, error: (e as Error).message };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

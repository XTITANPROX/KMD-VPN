// Upstream connectors for KALFETELA.
// - connectDirect: plain TCP via Cloudflare connect()
// - connectProxy : dispatch SOCKS4 / SOCKS5 / HTTP CONNECT
// Multi-hop chains are expressed as an array of proxy URIs and
// established sequentially.

import { connect } from "cloudflare:sockets";
import type { Upstream } from "../types.js";
import { isIPv4 } from "../../util/bytes.js";

type Socket = ReturnType<typeof connect>;

const CONNECT_TIMEOUT = 8000;
const READ_TIMEOUT = 8000;

export type ProxyUri = string; // socks5://user:pass@host:port | http://... | socks4://...

/* ---------------------------------------------------------------
 * Direct
 * ------------------------------------------------------------- */
export async function connectDirect(
  host: string,
  port: number,
  initialData?: Uint8Array
): Promise<Upstream> {
  const sock: Socket = connect({ hostname: host, port: port });
  await Promise.race([
    sock.opened,
    new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), CONNECT_TIMEOUT)),
  ]);
  if (initialData && initialData.byteLength > 0) {
    const w = sock.writable.getWriter();
    await w.write(initialData);
    w.releaseLock();
  }
  return socketToUpstream(sock);
}

/* ---------------------------------------------------------------
 * Proxy dispatch
 * ------------------------------------------------------------- */
export async function connectProxy(
  proxy: ProxyUri,
  host: string,
  port: number,
  initialData?: Uint8Array
): Promise<Upstream> {
  const norm = normalizeProxy(proxy);
  if (norm.startsWith("http://") || norm.startsWith("https://")) {
    return connectHttp(norm, host, port, initialData);
  }
  if (norm.startsWith("socks4://")) return connectSocks4(norm, host, port, initialData);
  return connectSocks5(norm, host, port, initialData);
}

/* Build a multi-hop chain: connect to first proxy asking it to
 * connect to second proxy etc., final proxy connects to target. */
export async function connectChain(
  chain: ProxyUri[],
  host: string,
  port: number,
  initialData?: Uint8Array
): Promise<Upstream> {
  if (chain.length === 0) return connectDirect(host, port, initialData);
  if (chain.length === 1) return connectProxy(chain[0], host, port, initialData);
  // For multi-hop we ask each proxy in turn to CONNECT to the next.
  let upstream = await connectProxy(chain[0], parseHost(chain[1]).host, parseHost(chain[1]).port);
  for (let i = 1; i < chain.length - 1; i++) {
    const nxt = parseHost(chain[i + 1]);
    await proxyHandshakeOnStream(upstream, nxt.host, nxt.port, chain[i + 1]);
  }
  const last = chain[chain.length - 1];
  await proxyHandshakeOnStream(upstream, host, port, last, initialData);
  return upstream;
}

/* ---------------------------------------------------------------
 * SOCKS5 (RFC 1928)
 * ------------------------------------------------------------- */
async function connectSocks5(uri: string, host: string, port: number, initialData?: Uint8Array): Promise<Upstream> {
  const { user, pass, host: ph, port: pp } = parseAuth(uri);
  const sock = connect({ hostname: ph, port: pp });
  await Promise.race([sock.opened, timeout("socks5 connect")]);
  const writer = sock.writable.getWriter();
  const reader = sock.readable.getReader();
  try {
    // Greeting
    const methods = user ? new Uint8Array([0x05, 0x02, 0x00, 0x02]) : new Uint8Array([0x05, 0x01, 0x00]);
    await writer.write(methods);
    const g = await readWithTimeout(reader, 2);
    if (g[0] !== 0x05) throw new Error("bad socks5 greeting");
    if (g[1] === 0x02) {
      if (!user) throw new Error("socks5 requires auth");
      const u8 = new TextEncoder().encode(user);
      const p8 = new TextEncoder().encode(pass);
      const req = new Uint8Array(3 + u8.byteLength + p8.byteLength);
      req[0] = 0x01; req[1] = u8.byteLength; req.set(u8, 2);
      req[2 + u8.byteLength] = p8.byteLength;
      req.set(p8, 3 + u8.byteLength);
      await writer.write(req);
      const a = await readWithTimeout(reader, 2);
      if (a[1] !== 0x00) throw new Error("socks5 auth failed");
    }
    // CONNECT
    const addr = buildSocksAddress(host, port);
    const req = new Uint8Array(3 + addr.byteLength);
    req[0] = 0x05; req[1] = 0x01; req[2] = 0x00;
    req.set(addr, 3);
    await writer.write(req);
    const rep = await readSocksReply(reader);
    if (rep !== 0x00) throw new Error(`socks5 reply 0x${rep.toString(16)}`);
    if (initialData && initialData.byteLength > 0) await writer.write(initialData);
  } finally {
    writer.releaseLock();
    reader.releaseLock();
  }
  return socketToUpstream(sock);
}

/* ---------------------------------------------------------------
 * SOCKS4 / SOCKS4a
 * ------------------------------------------------------------- */
async function connectSocks4(uri: string, host: string, port: number, initialData?: Uint8Array): Promise<Upstream> {
  const { user, host: ph, port: pp } = parseAuth(uri);
  const sock = connect({ hostname: ph, port: pp });
  await Promise.race([sock.opened, timeout("socks4 connect")]);
  const w = sock.writable.getWriter();
  const r = sock.readable.getReader();
  try {
    const useA = !isIPv4(host);
    let req: Uint8Array;
    if (!useA) {
      const ip = host.split(".").map(Number);
      req = new Uint8Array(9);
      req[0] = 0x04; req[1] = 0x01;
      req[2] = (port >> 8) & 0xff; req[3] = port & 0xff;
      req[4] = ip[0]; req[5] = ip[1]; req[6] = ip[2]; req[7] = ip[3];
      req[8] = 0x00;
    } else {
      const hostB = new TextEncoder().encode(host);
      req = new Uint8Array(9 + hostB.byteLength + 1);
      req[0] = 0x04; req[1] = 0x01;
      req[2] = (port >> 8) & 0xff; req[3] = port & 0xff;
      req[4] = 0; req[5] = 0; req[6] = 0; req[7] = 1;
      req[8] = 0;
      req.set(hostB, 9);
      req[9 + hostB.byteLength] = 0;
    }
    if (user) {
      const ub = new TextEncoder().encode(user);
      const out = new Uint8Array(req.byteLength + ub.byteLength);
      out.set(ub, 0); out.set(req, ub.byteLength);
      req = out;
    }
    await w.write(req);
    const res = await readWithTimeout(r, 8);
    if (res[0] !== 0x00 || res[1] !== 0x5a) throw new Error("socks4 rejected");
    if (initialData && initialData.byteLength > 0) await w.write(initialData);
  } finally {
    w.releaseLock(); r.releaseLock();
  }
  return socketToUpstream(sock);
}

/* ---------------------------------------------------------------
 * HTTP CONNECT
 * ------------------------------------------------------------- */
async function connectHttp(uri: string, host: string, port: number, initialData?: Uint8Array): Promise<Upstream> {
  const { user, pass, host: ph, port: pp } = parseAuth(uri);
  const sock = connect({ hostname: ph, port: pp });
  await Promise.race([sock.opened, timeout("http proxy connect")]);
  const w = sock.writable.getWriter();
  const r = sock.readable.getReader();
  try {
    const head = [`CONNECT ${host}:${port} HTTP/1.1`, `Host: ${host}:${port}`, "Proxy-Connection: keep-alive"];
    if (user) {
      const tok = btoa(`${user}:${pass ?? ""}`);
      head.push(`Proxy-Authorization: Basic ${tok}`);
    }
    head.push("", "");
    const headerBytes = new TextEncoder().encode(head.join("\r\n"));
    const headerCopy = new Uint8Array(headerBytes.byteLength);
    headerCopy.set(headerBytes);
    await w.write(headerCopy);
    // Read until \r\n\r\n
    let buf = new Uint8Array(new ArrayBuffer(0));
    while (true) {
      const { value, done } = await Promise.race([r.read(), timeout("http proxy read") as never]);
      if (done) throw new Error("http proxy closed");
      const copy = new Uint8Array(value!.byteLength);
      copy.set(value!);
      buf = concatBuf(buf, copy) as Uint8Array<ArrayBuffer>;
      const idx = indexOfSeq(buf, new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]));
      if (idx >= 0) {
        const line = new TextDecoder().decode(buf.subarray(0, idx));
        const m = line.match(/HTTP\/\d\.\d (\d{3})/);
        if (!m || parseInt(m[1], 10) !== 200) throw new Error(`http proxy: ${line}`);
        // The bytes after the header are initial data from upstream.
        const leftover = buf.subarray(idx + 4);
        if (initialData && initialData.byteLength > 0) {
          const cp = new Uint8Array(initialData.byteLength);
          cp.set(initialData);
          await w.write(cp);
        }
        if (leftover.byteLength > 0) {
          // Push leftover back — easiest is to wrap the socket and
          // prepend on first read.
          return socketToUpstream(sock, leftover);
        }
        break;
      }
    }
  } finally {
    w.releaseLock(); r.releaseLock();
  }
  return socketToUpstream(sock);
}

/* ---------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------- */
function socketToUpstream(sock: Socket, prefix?: Uint8Array): Upstream {
  let consumed = !prefix || prefix.byteLength === 0;
  const passthrough = sock.readable;
  const readable = consumed
    ? passthrough
    : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(prefix!);
          passthrough.pipeTo(new WritableStream({
            write(chunk) { controller.enqueue(chunk); },
            close() { controller.close(); },
            abort(err) { controller.error(err); },
          })).catch(() => controller.close());
        },
      });
  return {
    writable: sock.writable,
    readable,
    closed: sock.closed,
    close: () => { try { (sock as Socket & { close?: () => void }).close?.(); } catch {} },
  };
}

function buildSocksAddress(host: string, port: number): Uint8Array {
  if (isIPv4(host)) {
    const o = host.split(".").map(Number);
    const b = new Uint8Array(1 + 4 + 2);
    b[0] = 0x01; b[1] = o[0]; b[2] = o[1]; b[3] = o[2]; b[4] = o[3];
    b[5] = (port >> 8) & 0xff; b[6] = port & 0xff;
    return b;
  }
  if (host.includes(":")) {
    // IPv6
    const groups = host.split(":");
    const b = new Uint8Array(1 + 16 + 2);
    b[0] = 0x04;
    for (let i = 0; i < 8; i++) {
      const v = parseInt(groups[i] || "0", 16);
      b[1 + i * 2] = (v >> 8) & 0xff;
      b[2 + i * 2] = v & 0xff;
    }
    b[17] = (port >> 8) & 0xff; b[18] = port & 0xff;
    return b;
  }
  const h = new TextEncoder().encode(host);
  const b = new Uint8Array(1 + 1 + h.byteLength + 2);
  b[0] = 0x03; b[1] = h.byteLength;
  b.set(h, 2);
  b[2 + h.byteLength] = (port >> 8) & 0xff;
  b[3 + h.byteLength] = port & 0xff;
  return b;
}

async function readSocksReply(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<number> {
  const head = await readWithTimeout(reader, 4);
  if (head[0] !== 0x05) throw new Error("bad socks5 reply");
  let remaining = 0;
  if (head[3] === 0x01) remaining = 4;
  else if (head[3] === 0x03) {
    const l = await readWithTimeout(reader, 1);
    remaining = l[0];
  } else if (head[3] === 0x04) remaining = 16;
  remaining += 2; // port
  while (remaining > 0) {
    const chunk = await readWithTimeout(reader, Math.min(remaining, 1024));
    remaining -= chunk.byteLength;
  }
  return head[1];
}

async function readWithTimeout(r: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  let total = 0;
  while (total < n) {
    const { value, done } = await Promise.race([
      r.read(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("proxy read timeout")), READ_TIMEOUT)),
    ]);
    if (done) throw new Error("proxy closed early");
    out.push(value!);
    total += value!.byteLength;
  }
  const merged = concatBuf(...out);
  return merged.subarray(0, n);
}

async function proxyHandshakeOnStream(
  _u: Upstream,
  _host: string,
  _port: number,
  _nextProxy: string,
  _initial?: Uint8Array
): Promise<void> {
  // Full multi-hop is complex with a raw stream; for now we
  // implement the common case (single hop) which covers 99% of
  // real-world use. A complete implementation would negotiate
  // SOCKS/HTTP over the existing Upstream's readable/writable.
  throw new Error("multi-hop chains of >1 hop are not yet implemented");
}

function normalizeProxy(p: string): string {
  if (p.includes("t.me/socks") || p.includes("tg://socks")) {
    const server = p.match(/server=([^&]+)/)?.[1];
    const port = p.match(/port=([^&]+)/)?.[1];
    const user = p.match(/user=([^&]+)/)?.[1];
    const pass = p.match(/pass=([^&]+)/)?.[1];
    if (server && port) return user && pass ? `socks5://${user}:${pass}@${server}:${port}` : `socks5://${server}:${port}`;
  }
  return p;
}

function parseHost(p: string): { host: string; port: number } {
  const m = p.match(/^(?:socks[45]|https?):\/\/(?:[^@/]+@)?([^:/?#]+)(?::(\d+))?/i);
  if (!m) throw new Error("bad proxy uri");
  return { host: m[1], port: parseInt(m[2] || "1080", 10) };
}

function parseAuth(p: string): { user?: string; pass?: string; host: string; port: number } {
  const norm = normalizeProxy(p);
  const m = norm.match(/^(?:socks[45]|https?):\/\/(?:([^@/?#]+)@)?([^:/?#]+)(?::(\d+))?/i);
  if (!m) throw new Error("bad proxy uri");
  let user: string | undefined, pass: string | undefined;
  if (m[1]) {
    const [u, pw] = m[1].split(":");
    user = u ? decodeURIComponent(u) : undefined;
    pass = pw ? decodeURIComponent(pw) : undefined;
  }
  return { user, pass, host: m[2], port: parseInt(m[3] || "1080", 10) };
}

function concatBuf(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

function indexOfSeq(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.byteLength <= hay.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function timeout(msg: string): Promise<never> {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), CONNECT_TIMEOUT));
}

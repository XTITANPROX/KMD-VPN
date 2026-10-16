// Minimal DNS-over-HTTPS client that builds/parses wire-format
// messages. Used by the content filter (returns "blocked" when a
// known family/ads resolver maps a domain to 0.0.0.0).

import type { Env } from "../../env.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const cache = new Map<string, { expires: number; answers: DnsAnswer[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 2048;

export interface DnsAnswer {
  type: "A" | "AAAA" | "CNAME" | string;
  data: string;
  ttl: number;
}

export async function dohQuery(
  domain: string,
  recordType: "A" | "AAAA" = "A",
  dohBase = "https://cloudflare-dns.com/dns-query"
): Promise<DnsAnswer[]> {
  const key = `${domain}:${recordType}:${dohBase}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.answers;
  try {
    const typeMap: Record<string, number> = { A: 1, AAAA: 28, CNAME: 5 };
    const qtype = typeMap[recordType] ?? 1;
    const qname = encodeName(domain.endsWith(".") ? domain.slice(0, -1) : domain);
    const query = new Uint8Array(12 + qname.byteLength + 4);
    const dv = new DataView(query.buffer);
    dv.setUint16(0, (crypto.getRandomValues(new Uint16Array(1))[0]));
    dv.setUint16(2, 0x0100); // RD
    dv.setUint16(4, 1);
    query.set(qname, 12);
    dv.setUint16(12 + qname.byteLength, qtype);
    dv.setUint16(12 + qname.byteLength + 2, 1); // IN

    const res = await fetch(dohBase, {
      method: "POST",
      headers: { "content-type": "application/dns-message", accept: "application/dns-message" },
      body: query,
    });
    if (!res.ok) return [];
    const buf = new Uint8Array(await res.arrayBuffer());
    const answers = parseAnswer(buf);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, answers });
    return answers;
  } catch {
    return [];
  }
}

function encodeName(name: string): Uint8Array {
  const parts = name.split(".");
  const out: Uint8Array[] = [];
  for (const p of parts) {
    const b = enc.encode(p);
    out.push(new Uint8Array([b.byteLength]), b);
  }
  out.push(new Uint8Array([0]));
  const total = out.reduce((s, p) => s + p.byteLength, 0);
  const r = new Uint8Array(total);
  let off = 0;
  for (const p of out) { r.set(p, off); off += p.byteLength; }
  return r;
}

function parseName(buf: Uint8Array, pos: number): { name: string; end: number } {
  const labels: string[] = [];
  let p = pos, jumped = false, end = -1, guard = 128;
  while (p < buf.byteLength && guard-- > 0) {
    const len = buf[p];
    if (len === 0) {
      if (!jumped) end = p + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) end = p + 2;
      p = ((len & 0x3f) << 8) | buf[p + 1];
      jumped = true;
      continue;
    }
    labels.push(dec.decode(buf.subarray(p + 1, p + 1 + len)));
    p += len + 1;
  }
  if (end === -1) end = p + 1;
  return { name: labels.join("."), end };
}

function parseAnswer(buf: Uint8Array): DnsAnswer[] {
  const dv = new DataView(buf.buffer);
  const qdcount = dv.getUint16(4);
  const ancount = dv.getUint16(6);
  let off = 12;
  for (let i = 0; i < qdcount; i++) {
    const { end } = parseName(buf, off);
    off = end + 4;
  }
  const out: DnsAnswer[] = [];
  for (let i = 0; i < ancount && off < buf.byteLength; i++) {
    const { end } = parseName(buf, off);
    off = end;
    const type = dv.getUint16(off); off += 2;
    off += 2; // class
    const ttl = dv.getUint32(off); off += 4;
    const rdlength = dv.getUint16(off); off += 2;
    const dataStart = off;
    let data = "";
    if (type === 1 && rdlength === 4) {
      data = `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`;
      out.push({ type: "A", data, ttl });
    } else if (type === 28 && rdlength === 16) {
      const parts: string[] = [];
      for (let j = 0; j < 16; j += 2) parts.push(((buf[off + j] << 8) | buf[off + j + 1]).toString(16));
      data = parts.join(":");
      out.push({ type: "AAAA", data, ttl });
    } else if (type === 5) {
      const { name } = parseName(buf, off);
      data = name;
      out.push({ type: "CNAME", data, ttl });
    }
    off = dataStart + rdlength;
  }
  return out;
}

/* ------------ content filter ------------ */

const BLOCK_IPS = new Set(["0.0.0.0", "::", "176.103.130.130", "176.103.130.131"]);

export async function isDomainBlocked(
  domain: string,
  cfg: { porn: boolean; ads: boolean; malware: boolean; doh?: string }
): Promise<boolean> {
  if (!domain) return false;
  const base = cfg.doh || "https://family.cloudflare-dns.com/dns-query";
  // For ads we use AdGuard family; for malware Cloudflare malware.
  let url = base;
  if (cfg.ads && !cfg.porn) url = "https://dns.adguard-dns.com/dns-query";
  if (cfg.malware) url = "https://security.cloudflare-dns.com/dns-query";
  const a = await dohQuery(domain, "A", url);
  if (a.some((r) => BLOCK_IPS.has(r.data))) return true;
  if (cfg.porn || cfg.ads || cfg.malware) {
    const aaaa = await dohQuery(domain, "AAAA", url);
    if (aaaa.some((r) => BLOCK_IPS.has(r.data))) return true;
  }
  return false;
}

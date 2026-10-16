// Small byte / buffer helpers shared across protocol parsers.
export type Bytes = Uint8Array | ArrayBuffer;

export function toU8(b: Bytes): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

export function concat(...parts: Bytes[]): Uint8Array {
  const u8s = parts.map(toU8);
  const total = u8s.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of u8s) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export function equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function isIPv4(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

export function isIPv6(host: string): boolean {
  return host.includes(":") && /^[0-9a-fA-F:]+$/.test(host.replace(/^\[|\]$/g, ""));
}

export function randomHex(len: number): string {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function randomUUID(): string {
  // RFC 4122 v4 from crypto (works in Workers)
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function cgnatSubnet(ip: string): string {
  // Group CGNAT/mobile users so one user can have multiple device IPs within the /24 or /64.
  if (!ip || ip === "unknown") return ip;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length >= 4) return parts.slice(0, 4).join(":") + "::/64";
    return ip;
  }
  const parts = ip.split(".");
  if (parts.length === 4) return parts.slice(0, 3).join(".") + ".0/24";
  return ip;
}

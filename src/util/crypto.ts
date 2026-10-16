// Crypto helpers: password hashing (PBKDF2-SHA256 with high iter as
// a Workers-friendly Argon2 stand-in), HMAC, random tokens, SHA224
// for Trojan, constant-time compare.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------- generic hashes ---------------- */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = (typeof data === "string" ? encoder.encode(data) : data) as BufferSource;
  const h = await crypto.subtle.digest("SHA-256", buf);
  return toHex(new Uint8Array(h));
}

// Cloudflare Workers does not support SHA-224 in WebCrypto, so we use
// a pure-JS implementation. SHA-224 is required by the Trojan
// protocol (the password field is hex(SHA224(password))).
export async function sha224Hex(data: string | Uint8Array): Promise<string> {
  const msg = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(sha224Sync(msg));
}

function sha224Sync(message: Uint8Array): Uint8Array {
  // Initial hash values for SHA-224 (FIPS 180-4).
  const H = new Uint32Array([
    0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
    0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
  ]);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  // Padding
  const bitLen = message.length * 8;
  const withOne = new Uint8Array(message.length + 1);
  withOne.set(message);
  withOne[message.length] = 0x80;
  const padLen = (56 - (withOne.length % 64) + 64) % 64;
  const padded = new Uint8Array(withOne.length + padLen + 8);
  padded.set(withOne);
  // Length in bits as 64-bit big-endian
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  for (let off = 0; off < padded.length; off += 64) {
    const W = new Uint32Array(64);
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15]!, 7) ^ rotr(W[i - 15]!, 18) ^ (W[i - 15]! >>> 3);
      const s1 = rotr(W[i - 2]!, 17) ^ rotr(W[i - 2]!, 19) ^ (W[i - 2]! >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + W[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0]! + a) | 0; H[1] = (H[1]! + b) | 0;
    H[2] = (H[2]! + c) | 0; H[3] = (H[3]! + d) | 0;
    H[4] = (H[4]! + e) | 0; H[5] = (H[5]! + f) | 0;
    H[6] = (H[6]! + g) | 0; H[7] = (H[7]! + h) | 0;
  }
  // SHA-224 = leftmost 28 bytes of the 8-word state.
  const out = new Uint8Array(28);
  for (let i = 0; i < 7; i++) {
    out[i * 4]     = (H[i]! >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i]! >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i]! >>> 8) & 0xff;
    out[i * 4 + 3] = H[i]! & 0xff;
  }
  return out;
}

export async function hmacSha256Hex(key: string | Uint8Array, data: string | Uint8Array): Promise<string> {
  const k = (typeof key === "string" ? encoder.encode(key) : key) as BufferSource;
  const d = (typeof data === "string" ? encoder.encode(data) : data) as BufferSource;
  const ck = await crypto.subtle.importKey("raw", k as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", ck, d as BufferSource);
  return toHex(new Uint8Array(sig));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("bad hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---------------- password hashing (PBKDF2) ---------------- */
// PBKDF2-SHA256 with 210k iterations. Not Argon2 but available
// natively in WebCrypto and far stronger than the single SHA-256
// used by ZEUS.
// Cloudflare Workers limits PBKDF2-SHA256 to 100,000 iterations.
// That's still well above OWASP's current minimum guidance; Argon2id
// would be better but requires a WASM bundle.
const PBKDF2_ITERS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_SALTLEN = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(PBKDF2_SALTLEN);
  crypto.getRandomValues(salt);
  const key = await pbkdf2(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${toHex(salt)}$${toHex(new Uint8Array(key))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    const [, itersStr, saltHex, hashHex] = stored.split("$");
    const iters = parseInt(itersStr, 10);
    const salt = fromHex(saltHex);
    const expected = fromHex(hashHex);
    const key = new Uint8Array(await pbkdf2(password, salt, iters));
    return timingSafeEqual(key, expected);
  }
  // Legacy: bare sha256 (ZEUS import compatibility). Re-hash on login.
  if (/^[0-9a-f]{64}$/i.test(stored)) {
    return (await sha256Hex(password)) === stored.toLowerCase();
  }
  return false;
}

async function pbkdf2(password: string, salt: Uint8Array, iters: number): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    { name: "PBKDF2", hash: "SHA-256" },
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iters },
    base,
    PBKDF2_KEYLEN * 8
  );
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let r = 0;
  for (let i = 0; i < a.byteLength; i++) r |= a[i] ^ b[i];
  return r === 0;
}

/* ---------------- random tokens ---------------- */
export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

/* ---------------- base64 helpers ---------------- */
export function b64encode(s: string | Uint8Array): string {
  const u8 = typeof s === "string" ? encoder.encode(s) : s;
  let bin = "";
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64decodeUrl(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- TOTP (RFC 6238) ---------------- */
export function generateTotpSecret(): string {
  return b64encode(randomToken(20)).slice(0, 32);
}

export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const key = b32decode(secret.replace(/\s+/g, "").toUpperCase());
  const epoch = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    const candidate = await totpAt(key, epoch + i);
    if (candidate === code.padStart(6, "0")) return true;
  }
  return false;
}

export function totpUri(secret: string, issuer: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

async function totpAt(key: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 0x100000000));
  dv.setUint32(4, counter >>> 0);
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", ck, new Uint8Array(buf) as BufferSource));
  const off = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[off] & 0x7f) << 24) |
    ((sig[off + 1] & 0xff) << 16) |
    ((sig[off + 2] & 0xff) << 8) |
    (sig[off + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

function b32decode(s: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export { encoder, decoder };

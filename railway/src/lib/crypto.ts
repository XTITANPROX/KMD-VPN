// Password hashing, random ids, HMAC signing and key generation helpers.

import crypto from "node:crypto";
import { PANEL_SECRET } from "../env.js";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Legacy/global hash used by the Cloudflare worker flavour (PBKDF2-SHA256). */
function pbkdf2(password: string, salt: Buffer, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, 64, "sha256");
}

export function hashPasswordPbkdf2(password: string, iterations = 210_000): string {
  const salt = crypto.randomBytes(16);
  const key = pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  try {
    if (parts[0] === "scrypt" && parts.length === 6) {
      const N = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);
      const salt = Buffer.from(parts[4], "base64");
      const expected = Buffer.from(parts[5], "base64");
      const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
      return crypto.timingSafeEqual(actual, expected);
    }
    if (parts[0] === "pbkdf2" && parts.length === 4) {
      const iterations = Number(parts[1]);
      const salt = Buffer.from(parts[2], "base64");
      const expected = Buffer.from(parts[3], "base64");
      const actual = pbkdf2(password, salt, iterations);
      return crypto.timingSafeEqual(actual, expected);
    }
    // plain sha256 fallback (very old installs)
    if (parts.length === 1 && parts[0].length === 64) {
      const digest = crypto.createHash("sha256").update(password).digest("hex");
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(parts[0]));
    }
  } catch {
    return false;
  }
  return false;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function randomUuid(): string {
  return crypto.randomUUID();
}

export function hmac(value: string, secret = PANEL_SECRET): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function signSession(sessionId: string): string {
  return `${sessionId}.${hmac(sessionId)}`;
}

export function verifySessionToken(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = hmac(id);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/* ------------------------- X25519 / WireGuard keys ------------------------- */

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

/** WireGuard (X25519) key pair in base64, as used by wg/awg. */
export function x25519KeyPair(): KeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  const priv = privateKey.export({ type: "pkcs8", format: "der" });
  const pub = publicKey.export({ type: "spki", format: "der" });
  // PKCS8 x25519 private key: last 32 bytes are the raw scalar.
  // SPKI x25519 public key: last 32 bytes are the raw point.
  return {
    privateKey: priv.subarray(priv.length - 32).toString("base64"),
    publicKey: pub.subarray(pub.length - 32).toString("base64"),
  };
}

/** Convert a base64 WireGuard private key back into its public key. */
export function x25519PublicFromPrivate(privateB64: string): string {
  const raw = Buffer.from(privateB64, "base64");
  if (raw.length !== 32) throw new Error("invalid x25519 private key");
  const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), raw]);
  const keyObject = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(keyObject).export({ type: "spki", format: "der" });
  return Buffer.from(pub.subarray(pub.length - 32)).toString("base64");
}

/** Xray REALITY key pair (x25519 too, but printed as url-safe base64). */
export function realityKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  const priv = privateKey.export({ type: "pkcs8", format: "der" });
  const pub = publicKey.export({ type: "spki", format: "der" });
  return {
    // Xray prints REALITY keys as standard base64 of the raw 32 byte scalars.
    privateKey: Buffer.from(priv.subarray(priv.length - 32)).toString("base64"),
    publicKey: Buffer.from(pub.subarray(pub.length - 32)).toString("base64"),
  };
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

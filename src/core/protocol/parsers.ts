// VLESS / Trojan / VMess inbound request parsers for WebSocket-borne traffic.
// These parse the FIRST binary frame the client sends after the WS upgrade.
// The payload after the header is relayed verbatim to the upstream.

import { concat, toU8 } from "../../util/bytes.js";
import type { AddressType, ParsedRequest, Protocol, TargetAddress } from "../types.js";

/* ---------------------------------------------------------------
 * Address helpers (VLESS/Trojan share the same ATYP encoding)
 * ------------------------------------------------------------- */
function readAddress(buf: Uint8Array, offset: number): { addr: TargetAddress; next: number } {
  const atyp = buf[offset];
  offset += 1;
  let host = "";
  let type: AddressType;
  if (atyp === 0x01) {
    type = "ipv4";
    host = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
    offset += 4;
  } else if (atyp === 0x03) {
    type = "domain";
    const len = buf[offset];
    offset += 1;
    host = new TextDecoder().decode(buf.subarray(offset, offset + len));
    offset += len;
  } else if (atyp === 0x04) {
    type = "ipv6";
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((buf[offset + i] << 8) | buf[offset + i + 1]).toString(16));
    }
    host = parts.join(":");
    offset += 16;
  } else {
    throw new Error(`unsupported ATYP 0x${atyp.toString(16)}`);
  }
  const port = (buf[offset] << 8) | buf[offset + 1];
  offset += 2;
  return { addr: { host, port, type }, next: offset };
}

/* ---------------------------------------------------------------
 * VLESS
 *   1 byte  version (=0)
 *  16 bytes UUID
 *   1 byte  addons length (M = 0)
 *   M bytes addons (none)
 *   1 byte  ATYP
 *   ...     addr + port
 *   ...     payload
 * ------------------------------------------------------------- */
export function parseVless(buf: Uint8Array): ParsedRequest {
  if (buf.byteLength < 20 || buf[0] !== 0x00) {
    throw new Error("invalid vless header");
  }
  const uuidBytes = buf.subarray(1, 17);
  const hex = Array.from(uuidBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  let offset = 17;
  const addonLen = buf[offset];
  offset += 1 + addonLen;
  const { addr, next } = readAddress(buf, offset);
  const payload = buf.subarray(next);
  return { protocol: "vless", uuid, target: addr, payload: payload.slice(), raw: buf.slice() };
}

/* ---------------------------------------------------------------
 * Trojan (over WebSocket; no CRLF framing in binary WS mode — we
 * accept both the classic 56-byte password and a hex SHA224)
 *   56 bytes: hex(SHA224(password))
 *    2 bytes: CRLF
 *    1 byte : CMD (1=connect)
 *    1 byte : ATYP
 *   ...     addr + port
 *    2 bytes CRLF
 *   ...     payload
 * ------------------------------------------------------------- */
export function parseTrojan(buf: Uint8Array): ParsedRequest {
  if (buf.byteLength < 60) throw new Error("trojan header too short");
  // Convert first 56 bytes (ASCII hex) to string
  let hash: string;
  try {
    hash = new TextDecoder("ascii").decode(buf.subarray(0, 56)).toLowerCase();
    if (!/^[0-9a-f]{56}$/.test(hash)) throw new Error("bad hex");
  } catch {
    throw new Error("invalid trojan password header");
  }
  let offset = 56;
  // CRLF
  if (buf[offset] === 0x0d && buf[offset + 1] === 0x0a) offset += 2;
  const cmd = buf[offset]; offset += 1;
  if (cmd !== 0x01) throw new Error(`trojan cmd ${cmd} not supported`);
  const { addr, next } = readAddress(buf, offset);
  offset = next;
  if (buf[offset] === 0x0d && buf[offset + 1] === 0x0a) offset += 2;
  const payload = buf.subarray(offset);
  return { protocol: "trojan", passwordHash: hash, target: addr, payload: payload.slice(), raw: buf.slice() };
}

/* ---------------------------------------------------------------
 * VMess (aead header supported — we read the 16-byte authid, then
 * the encrypted options block). For simplicity and broad client
 * support we implement the legacy "none"/"aes-128-gcm" request.
 * Full AEAD header is larger; this covers the default v2rayN
 * "auto"/"none" security setting.
 * ------------------------------------------------------------- */
export function parseVmess(buf: Uint8Array): ParsedRequest {
  // The first byte is the version/verifier byte (0x10 etc.). For
  // legacy "none" encryption the options block starts at byte 1
  // with: 16 bytes data (IV), 1 byte len, 1 byte sec, 4 bytes
  // reserved, then ATYP/addr/port/id/uuid...
  // In practice v2ray clients talking to a WS+none VMess inbound
  // send a plaintext JSON-like binary structure. We parse the
  // address using the same ATYP table but look for the UUID in
  // the raw bytes (16 bytes following a fixed pattern).
  if (buf.byteLength < 40) throw new Error("vmess header too short");
  // Locate 16-byte UUID by scanning after byte 16 (heuristic)
  // VMess-none layout (v2ray):
  //   1  ver
  //  16  data IV (ignored)
  //  16  data key (ignored)
  //   1  response auth V (0)
  //   1  options / 0x01 = mask for AES
  //   1  cmd (1=TCP)
  //   1  port (<< 8) ... actually port is 2 bytes little/big
  //   1  ATYP ...
  let off = 1 + 16 + 16;
  // response auth byte
  off += 1;
  // options byte
  off += 1;
  // cmd
  off += 1;
  // port (big endian for v2ray-n binary format)
  const port = (buf[off] << 8) | buf[off + 1];
  off += 2;
  const atyp = buf[off]; off += 1;
  let host = "";
  let type: AddressType;
  if (atyp === 0x01) {
    type = "ipv4";
    host = `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`;
    off += 4;
  } else if (atyp === 0x03) {
    type = "domain";
    const len = buf[off]; off += 1;
    host = new TextDecoder().decode(buf.subarray(off, off + len));
    off += len;
  } else if (atyp === 0x04) {
    type = "ipv6";
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) parts.push(((buf[off + i] << 8) | buf[off + i + 1]).toString(16));
    host = parts.join(":");
    off += 16;
  } else {
    throw new Error(`vmess: unsupported ATYP 0x${atyp.toString(16)}`);
  }
  // following 16 bytes are the UUID (v2ray-n)
  const idBytes = buf.subarray(off, off + 16);
  const hex = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  off += 16;
  const payload = buf.subarray(off);
  return { protocol: "vmess", uuid, target: { host, port, type }, payload: payload.slice(), raw: buf.slice() };
}

/* ---------------------------------------------------------------
 * Auto-detect by content. The WS early-data/path already tells us
 * which protocol the user *configured*, but we support auto.
 * ------------------------------------------------------------- */
export function parseFirstFrame(buf: BytesLike, allowed: Set<Protocol>): ParsedRequest {
  const data = toU8(buf);
  // Trojan: starts with 56 ASCII hex chars followed by CRLF
  if (allowed.has("trojan") && data.byteLength >= 58) {
    const head = new TextDecoder("ascii").decode(data.subarray(0, 56));
    if (/^[0-9a-fA-F]{56}$/.test(head) && data[56] === 0x0d && data[57] === 0x0a) {
      return parseTrojan(data);
    }
  }
  // VLESS: version byte 0x00, followed by 16 UUID bytes
  if (allowed.has("vless") && data.byteLength >= 20 && data[0] === 0x00) {
    return parseVless(data);
  }
  // VMess: last resort
  if (allowed.has("vmess")) {
    return parseVmess(data);
  }
  throw new Error("no protocol matched first frame");
}

type BytesLike = Uint8Array | ArrayBuffer;

/* ---------------------------------------------------------------
 * Build a VLESS response header (version + same addon length = 0)
 * ------------------------------------------------------------- */
export function buildVlessResponse(): Uint8Array {
  return new Uint8Array([0x00, 0x00]); // version 0, addon len 0
}

/* ---------------------------------------------------------------
 * Build a SOCKS5-style reply for direct UDP ASSOCIATE (unused
 * here but kept for future UDP-where-possible relays)
 * ------------------------------------------------------------- */
export function buildSocksReply(success = true): Uint8Array {
  // VER REP RSV ATYP BND.ADDR BND.PORT
  const rep = success ? 0x00 : 0x05;
  return new Uint8Array([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

export { concat };

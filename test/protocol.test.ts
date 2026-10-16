// Unit tests for the VLESS / Trojan request parsers.
import { describe, it, expect } from "vitest";
import { parseVless, parseTrojan, buildVlessResponse } from "../src/core/protocol/parsers";

function vlessFrame(uuid: string, host: string, port: number, payload = new Uint8Array(0)): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const uuidBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) uuidBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const hostBytes = new TextEncoder().encode(host);
  // version 0, uuid, addon len 0, ATYP domain (0x03), len, host, port
  const out = new Uint8Array(1 + 16 + 1 + 1 + 1 + hostBytes.length + 2 + payload.length);
  let off = 0;
  out[off++] = 0x00;
  out.set(uuidBytes, off); off += 16;
  out[off++] = 0x00;
  out[off++] = 0x03;
  out[off++] = hostBytes.length;
  out.set(hostBytes, off); off += hostBytes.length;
  out[off++] = (port >> 8) & 0xff;
  out[off++] = port & 0xff;
  out.set(payload, off);
  return out;
}

function trojanFrame(hash: string, host: string, port: number): Uint8Array {
  const ascii = new TextEncoder().encode(hash);
  const hostBytes = new TextEncoder().encode(host);
  const out = new Uint8Array(56 + 2 + 1 + 1 + 1 + hostBytes.length + 2 + 2);
  let off = 0;
  out.set(ascii, off); off += 56;
  out[off++] = 0x0d; out[off++] = 0x0a;
  out[off++] = 0x01; // CMD connect
  out[off++] = 0x03; // ATYP domain
  out[off++] = hostBytes.length;
  out.set(hostBytes, off); off += hostBytes.length;
  out[off++] = (port >> 8) & 0xff;
  out[off++] = port & 0xff;
  out[off++] = 0x0d; out[off++] = 0x0a;
  return out;
}

describe("VLESS parser", () => {
  it("parses a domain-targeted request", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const frame = vlessFrame(uuid, "example.com", 443, new TextEncoder().encode("HELLO"));
    const r = parseVless(frame);
    expect(r.protocol).toBe("vless");
    expect(r.uuid).toBe(uuid);
    expect(r.target.host).toBe("example.com");
    expect(r.target.port).toBe(443);
    expect(r.target.type).toBe("domain");
    expect(new TextDecoder().decode(r.payload)).toBe("HELLO");
  });

  it("builds a valid empty vless response", () => {
    expect(Array.from(buildVlessResponse())).toEqual([0x00, 0x00]);
  });
});

describe("Trojan parser", () => {
  it("parses a trojan request", () => {
    const hash = "a".repeat(56);
    const frame = trojanFrame(hash, "test.example", 8443);
    const r = parseTrojan(frame);
    expect(r.protocol).toBe("trojan");
    expect(r.passwordHash).toBe(hash);
    expect(r.target.host).toBe("test.example");
    expect(r.target.port).toBe(8443);
  });
});

// Common types used by protocol parsers and the tunnel.

export type Protocol = "vless" | "trojan" | "vmess";

export type AddressType = "ipv4" | "domain" | "ipv6";

export interface TargetAddress {
  host: string;
  port: number;
  type: AddressType;
}

export interface ParsedRequest {
  protocol: Protocol;
  uuid?: string;          // vless / vmess
  passwordHash?: string; // trojan sha224(hex)
  target: TargetAddress;
  payload: Uint8Array;    // first frame after header (may be empty)
  raw: Uint8Array;        // full first message
}

export interface Upstream {
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  closed: Promise<void>;
  close?: () => Promise<void> | void;
}

export interface TunnelStats {
  bytesUp: number;
  bytesDown: number;
}

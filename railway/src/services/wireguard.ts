// WireGuard support: X25519 key material, per-user peers, client & server
// configs. The client private key of a user on a wg node is persisted in
// `user_nodes.client_id` (one key per user per node); the server key pair of a
// node lives in `nodes.private_key` / `nodes.public_key`.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { x25519KeyPair, x25519PublicFromPrivate } from "../lib/crypto.js";
import { fmtBytes, nowSeconds } from "../lib/format.js";
import { DATA_DIR } from "../env.js";
import { getUserNodes, listNodeUsers, setUserNodeClientId, updateNode } from "./store.js";
import type { NodeRow, UserRow } from "../types.js";

export const WG_DEFAULT_PORT = 51820;
export const WG_DEFAULT_MTU = 1420;
export const WG_DEFAULT_DNS = "1.1.1.1, 8.8.8.8";
export const WG_PEER_KEEPALIVE = 25;

/** A ready-to-use peer of one user on one wg node. */
export interface WireguardPeer {
  user_id: number;
  email: string;
  address: string;
  public_key: string;
  enabled: boolean;
  data_used_bytes: number;
  data_limit_bytes: number;
  expires_at: number | null;
}

/** Where generated server configs are kept (also served to agents). */
export function wireguardDir(): string {
  return path.join(DATA_DIR, "wireguard");
}

export function wireguardConfPath(nodeId: number): string {
  return path.join(wireguardDir(), `node-${nodeId}.conf`);
}

/** WireGuard keys are 32 random bytes in standard base64 (44 chars). */
export function isWireguardKey(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value);
}

/* ------------------------------- addresses ------------------------------- */

/** IPv4 /24 base of a node, e.g. `10.66.66.` — honours a custom `address_v4`. */
export function wireguardSubnet(node: NodeRow): string {
  const raw = (node.address_v4 || "").trim();
  const match = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\./);
  if (match) return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}.`;
  return "10.66.66.";
}

/** Deterministic host address (`10.66.66.x/32`) for a user inside the subnet. */
export function wireguardAddress(node: NodeRow, user: UserRow | number): string {
  const id = typeof user === "number" ? user : user.id;
  return `${wireguardSubnet(node)}${(Math.abs(id) % 250) + 2}/32`;
}

/** Address of the server side of the tunnel. */
export function wireguardServerAddress(node: NodeRow): string {
  return `${wireguardSubnet(node)}1/24`;
}

export function wireguardPort(node: NodeRow): number {
  return node.port && node.port > 0 ? node.port : WG_DEFAULT_PORT;
}

export function wireguardDns(node: NodeRow): string {
  return (node.dns || "").trim() || WG_DEFAULT_DNS;
}

export function wireguardMtu(node: NodeRow): number {
  return node.mtu && node.mtu >= 576 ? node.mtu : WG_DEFAULT_MTU;
}

/* ------------------------------ server keys ------------------------------ */

/** Makes sure the node owns a server key pair; returns the (possibly updated) pair. */
export async function ensureWireguardServerKeys(node: NodeRow): Promise<{ privateKey: string; publicKey: string }> {
  if (node.private_key && node.public_key) return { privateKey: node.private_key, publicKey: node.public_key };
  const pair = node.private_key
    ? { privateKey: node.private_key, publicKey: x25519PublicFromPrivate(node.private_key) }
    : x25519KeyPair();
  await updateNode(node.id, { private_key: pair.privateKey, public_key: pair.publicKey });
  return pair;
}

/* ------------------------------ client keys ------------------------------ */

/** Stored client private key of a user on a node, or null when none exists yet. */
export async function wireguardKeyFor(userId: number, nodeId: number): Promise<string | null> {
  const entry = (await getUserNodes(userId)).find((row) => row.node_id === nodeId);
  return entry && isWireguardKey(entry.client_id) ? entry.client_id : null;
}

/**
 * Map of `nodeId → client private key` for every wg node of a user. Passed to
 * the link builders so subscription output contains real configs.
 */
export async function wireguardKeysForUser(userId: number): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const entry of await getUserNodes(userId)) {
    if (entry.node?.protocol === "wireguard" && isWireguardKey(entry.client_id)) out[entry.node_id] = entry.client_id;
  }
  return out;
}

/**
 * Ensures a peer exists for `user` on `node`: creates + persists the X25519 key
 * pair together with the server keys, and returns the peer descriptor.
 */
export async function ensureWireguardClient(user: UserRow, node: NodeRow): Promise<WireguardPeer> {
  await ensureWireguardServerKeys(node);
  const existing = (await getUserNodes(user.id)).find((row) => row.node_id === node.id);
  let privateKey = existing && isWireguardKey(existing.client_id) ? existing.client_id : "";
  if (!privateKey) {
    privateKey = x25519KeyPair().privateKey;
    if (existing) await setUserNodeClientId(user.id, node.id, privateKey);
  }
  return {
    user_id: user.id,
    email: user.username,
    address: wireguardAddress(node, user),
    public_key: x25519PublicFromPrivate(privateKey),
    enabled: !existing || existing.enabled !== 0,
    data_used_bytes: user.data_used_bytes,
    data_limit_bytes: user.data_limit_bytes,
    expires_at: user.expires_at,
  };
}

/** Peer descriptor without touching the database (returns null without a key). */
export async function wireguardPeerFor(user: UserRow, node: NodeRow): Promise<WireguardPeer | null> {
  const privateKey = await wireguardKeyFor(user.id, node.id);
  if (!privateKey) return null;
  return {
    user_id: user.id,
    email: user.username,
    address: wireguardAddress(node, user),
    public_key: x25519PublicFromPrivate(privateKey),
    enabled: true,
    data_used_bytes: user.data_used_bytes,
    data_limit_bytes: user.data_limit_bytes,
    expires_at: user.expires_at,
  };
}

/**
 * Peers of every user attached to the node (users not linked to it are
 * ignored). `create: false` skips key generation and only reports existing peers.
 */
export async function wireguardPeersForNode(
  node: NodeRow,
  users: UserRow[],
  options: { create?: boolean } = {}
): Promise<WireguardPeer[]> {
  const rows = await listNodeUsers(node.id);
  const attached = new Map(rows.map((row) => [row.user_id, row]));
  const out: WireguardPeer[] = [];
  for (const user of users) {
    const row = attached.get(user.id);
    if (!row) continue;
    if (options.create === false) {
      const peer = await wireguardPeerFor(user, node);
      if (peer) out.push({ ...peer, enabled: row.enabled !== 0 });
      continue;
    }
    out.push({ ...(await ensureWireguardClient(user, node)), enabled: row.enabled !== 0 });
  }
  return out;
}

/* ------------------------------- configs --------------------------------- */

const PLACEHOLDER_KEY = "<کلید خصوصی این کاربر از پنل قابل دریافت است>";

/** Persian summary printed as a comment inside every config. */
function describeUser(user: Pick<UserRow, "data_used_bytes" | "data_limit_bytes" | "expires_at">): string {
  const used = fmtBytes(user.data_used_bytes);
  const limit = user.data_limit_bytes > 0 ? fmtBytes(user.data_limit_bytes) : "نامحدود";
  const now = nowSeconds();
  const expiry = user.expires_at
    ? user.expires_at <= now
      ? "منقضی شده"
      : `${Math.ceil((user.expires_at - now) / 86400)} روز باقی‌مانده`
    : "بدون انقضا";
  return `${used} از ${limit} · ${expiry}`;
}

/**
 * Client `wg-quick` config. `clientPrivateKey` comes from
 * `user_nodes.client_id`; when omitted a placeholder is used instead.
 */
export function buildWireguardConf(node: NodeRow, user: UserRow, clientPrivateKey?: string): string {
  const serverPublic = node.public_key || (node.private_key ? x25519PublicFromPrivate(node.private_key) : "");
  const privateKey = isWireguardKey(clientPrivateKey) ? (clientPrivateKey as string) : PLACEHOLDER_KEY;
  const address = wireguardAddress(node, user);
  return [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${address}`,
    `DNS = ${wireguardDns(node)}`,
    `MTU = ${wireguardMtu(node)}`,
    "",
    "[Peer]",
    `PublicKey = ${serverPublic}`,
    "AllowedIPs = 0.0.0.0/0, ::/0",
    `Endpoint = ${node.host}:${wireguardPort(node)}`,
    `PersistentKeepalive = ${WG_PEER_KEEPALIVE}`,
    "",
    `# KalFetela | ${node.name} | ${user.username} | ${address}`,
    `# ${describeUser(user)}`,
    "",
  ].join("\n");
}

/** Same as `buildWireguardConf` but resolves the stored key first. */
export async function buildWireguardConfFor(user: UserRow, node: NodeRow): Promise<string> {
  let privateKey = await wireguardKeyFor(user.id, node.id);
  if (!privateKey) {
    await ensureWireguardClient(user, node);
    privateKey = await wireguardKeyFor(user.id, node.id);
  }
  return buildWireguardConf(node, user, privateKey ?? undefined);
}

/** Server side config for `wg-quick`, one `[Peer]` per user. */
export function buildWireguardServerConf(node: NodeRow, peers: WireguardPeer[]): string {
  const privateKey = node.private_key || "<کلید خصوصی سرور>";
  const lines: string[] = [
    "[Interface]",
    `Address = ${wireguardServerAddress(node)}`,
    `ListenPort = ${wireguardPort(node)}`,
    `PrivateKey = ${privateKey}`,
    "PostUp = iptables -I FORWARD -i %i -j ACCEPT; iptables -I FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE",
    "PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE",
    `MTU = ${wireguardMtu(node)}`,
  ];
  for (const peer of peers) {
    lines.push(
      "",
      `# ${peer.email}${peer.enabled ? "" : " (disabled)"}`,
      "[Peer]",
      `PublicKey = ${peer.public_key}`,
      `AllowedIPs = ${peer.address}`,
      `# ${describeUser({ data_used_bytes: peer.data_used_bytes, data_limit_bytes: peer.data_limit_bytes, expires_at: peer.expires_at })}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Agent payload for a wg node: server config + peer table. */
export async function wireguardNodePayload(
  node: NodeRow,
  users: UserRow[],
  options: { create?: boolean } = {}
): Promise<{ config: string; peers: WireguardPeer[]; server_public_key: string | null; server_address: string; port: number }> {
  const serverKeys = await ensureWireguardServerKeys(node);
  const fresh = { ...node, private_key: serverKeys.privateKey, public_key: serverKeys.publicKey } as NodeRow;
  const peers = await wireguardPeersForNode(fresh, users, options);
  return {
    config: buildWireguardServerConf(fresh, peers),
    peers,
    server_public_key: serverKeys.publicKey,
    server_address: wireguardServerAddress(fresh),
    port: wireguardPort(fresh),
  };
}

/** Writes (and returns) the server config inside DATA_DIR for wg-quick / external use. */
export async function writeWireguardServerConf(
  node: NodeRow,
  users: UserRow[],
  options: { create?: boolean } = {}
): Promise<{ path: string; config: string; peers: WireguardPeer[] }> {
  const payload = await wireguardNodePayload(node, users, options);
  await mkdir(wireguardDir(), { recursive: true });
  const target = wireguardConfPath(node.id);
  await writeFile(target, payload.config, "utf8");
  return { path: target, config: payload.config, peers: payload.peers };
}

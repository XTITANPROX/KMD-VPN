// Auto proxy finder — pulls public SOCKS4/5 and HTTP proxy lists from
// well-known free-proxy sources, dedupes them, and returns them. We do
// NOT test them server-side because Workers blocks raw connect() to
// arbitrary hosts (it only allows connect() to Cloudflare-owned ranges,
// which is exactly what the IP scanner uses). Health is instead checked
// by the PoolState machinery when the proxy is actually used, and the
// UI can run a client-side test from the user's browser (which has no
// such restriction).

import { parseProxyUri, type ParsedProxy } from "./scanner.js";

const SOURCES: { url: string; scheme: "socks5" | "http"; label: string }[] = [
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", scheme: "socks5", label: "TheSpeedX/socks5" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", scheme: "socks5", label: "TheSpeedX/socks4" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",   scheme: "http",   label: "TheSpeedX/http" },
  { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", scheme: "socks5", label: "monosans/socks5" },
  { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt", scheme: "socks5", label: "monosans/socks4" },
  { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",   scheme: "http",   label: "monosans/http" },
  { url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt", scheme: "socks5", label: "hookzof" },
  { url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt", scheme: "socks5", label: "ShiftyTR/socks5" },
  { url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",   scheme: "http",   label: "ShiftyTR/http" },
];

export interface AutoFindOptions {
  maxPerSource?: number;   // cap entries from each source (default 80)
  maxTotal?: number;       // cap total unique proxies to test (default 250)
  schemes?: ("socks5" | "http")[];  // which schemes (default both)
  testHost?: string;
  testPort?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface AutoFindResult {
  ok: boolean;
  sourcesFetched: number;
  sourcesFailed: { label: string; error: string }[];
  totalCandidates: number;
  candidates: { uri: string; source: string; scheme: string }[];
}

/**
 * Pull lists from public sources, dedupe, parse, and return them.
 * Browser-side probe (or the proxy-pool health loop) verifies reachability.
 */
export async function findProxies(opts: AutoFindOptions = {}): Promise<AutoFindResult> {
  const maxPerSource = Math.min(200, opts.maxPerSource ?? 80);
  const maxTotal = Math.min(400, opts.maxTotal ?? 250);
  const schemes = new Set(opts.schemes || ["socks5", "http"]);

  const sourcesFailed: { label: string; error: string }[] = [];
  const seen = new Map<string, { uri: string; source: string; scheme: string }>();
  let sourcesFetched = 0;

  const fetched = await Promise.all(
    SOURCES.filter((s) => schemes.has(s.scheme)).map(async (src) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(src.url, { signal: ctrl.signal, headers: { "user-agent": "KALFETELA-Finder/1.0" } });
        clearTimeout(t);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const text = await r.text();
        return { src, text };
      } catch (e) {
        sourcesFailed.push({ label: src.label, error: (e as Error).message });
        return null;
      }
    })
  );

  for (const f of fetched) {
    if (!f) continue;
    sourcesFetched++;
    const lines = f.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const line of lines) {
      if (count >= maxPerSource) break;
      const raw = line.includes("://") ? line : f.src.scheme + "://" + line;
      const parsed = parseProxyUri(raw);
      if (!parsed) continue;
      const key = parsed.host + ":" + parsed.port + "|" + parsed.type;
      if (seen.has(key)) continue;
      seen.set(key, { uri: canonicalUri(parsed), source: f.src.label, scheme: parsed.type });
      count++;
      if (seen.size >= maxTotal) break;
    }
    if (seen.size >= maxTotal) break;
  }

  const candidates = Array.from(seen.values());
  return {
    ok: true,
    sourcesFetched,
    sourcesFailed,
    totalCandidates: candidates.length,
    candidates,
  };
}

function canonicalUri(p: ParsedProxy): string {
  const auth = p.user ? p.user + ":" + (p.pass || "") + "@" : "";
  return p.type + "://" + auth + p.host + ":" + p.port;
}

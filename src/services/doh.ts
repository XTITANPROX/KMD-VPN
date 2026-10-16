import type { Env } from "../env.js";

const DNS_MESSAGE = "application/dns-message";
const MAX_DNS_BODY = 4096;

/** A small RFC 8484 reverse proxy with a fixed, operator-controlled upstream. */
export async function handleDoh(request: Request, env: Env): Promise<Response> {
  const incoming = new URL(request.url);
  const upstream = new URL(env.DEFAULT_DOH || "https://cloudflare-dns.com/dns-query");
  if (upstream.protocol !== "https:") return new Response("invalid DoH upstream", { status: 500 });

  const headers = new Headers({ Accept: DNS_MESSAGE });
  let init: RequestInit;

  if (request.method === "GET") {
    const dns = incoming.searchParams.get("dns");
    if (!dns || dns.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(dns)) {
      return new Response("invalid dns query", { status: 400 });
    }
    upstream.searchParams.set("dns", dns);
    init = { method: "GET", headers };
  } else if (request.method === "POST") {
    const type = (request.headers.get("content-type") || "").split(";", 1)[0]!.trim();
    if (type !== DNS_MESSAGE) return new Response("unsupported content type", { status: 415 });
    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_DNS_BODY) {
      return new Response("invalid dns message", { status: 400 });
    }
    headers.set("Content-Type", DNS_MESSAGE);
    init = { method: "POST", headers, body };
  } else {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }

  try {
    const response = await fetch(upstream.toString(), init);
    if (!response.ok) return new Response("DoH upstream error", { status: 502 });
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": DNS_MESSAGE,
        "Cache-Control": response.headers.get("cache-control") || "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("DoH upstream unavailable", { status: 502 });
  }
}

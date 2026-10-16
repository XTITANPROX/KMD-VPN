// Bidirectional pipe with backpressure-aware chunk coalescing.
// Replaces the "smart buffering engine" ZEUS hard-coded, but is
// cleanly configurable and avoids unbounded queue growth.

import type { Upstream } from "./types.js";

export interface PumpOptions {
  // Coalesce downstream (server->client) writes until this many
  // bytes have been queued or the silent window has elapsed. This
  // dramatically cuts WS frame overhead on high-throughput links.
  grainBytes?: number;
  grainSilentMs?: number;
  // Maximum bytes queued before we abort (backpressure guard).
  maxQueueBytes?: number;
  onUp?: (bytes: number) => void;     // client -> server
  onDown?: (bytes: number) => void;   // server -> client
  onClose?: () => void;
  onError?: (err: unknown) => void;
}

export function pump(
  client: Pick<WebSocket, "send" | "binaryType"> & { addEventListener: WebSocket["addEventListener"]; close: WebSocket["close"]; readyState: number },
  upstream: Upstream,
  opts: PumpOptions = {}
): { closed: Promise<void> } {
  const GRAIN = opts.grainBytes ?? 128 * 1024;
  const SILENT = opts.grainSilentMs ?? 2;
  const MAX_Q = opts.maxQueueBytes ?? 32 * 1024 * 1024;

  let closed = false;
  let clientClosed = false;
  let upClosed = false;
  let queueBytes = 0;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let writerLock: Promise<void> | null = null;

  const finishers: Array<() => void> = [];
  const closedPromise = new Promise<void>((res) => finishers.push(res));

  const reportUp = (n: number) => { try { opts.onUp?.(n); } catch {} };
  const reportDown = (n: number) => { try { opts.onDown?.(n); } catch {} };

  const shutdown = (err?: unknown) => {
    if (closed) return;
    closed = true;
    if (flushTimer) clearTimeout(flushTimer);
    try { upstream.close?.(); } catch {}
    try { if (client.readyState === 1) client.close(); } catch {}
    if (err) try { opts.onError?.(err); } catch {}
    try { opts.onClose?.(); } catch {}
    finishers.forEach((f) => f());
  };

  const flushNow = async () => {
    if (pendingBytes === 0) return;
    if (writerLock) {
      await writerLock;
      return;
    }
    const chunk = pending.length === 1 ? pending[0]! : concatChunks(pending);
    pending = [];
    pendingBytes = 0;
    queueBytes -= chunk.byteLength;
    const w = upstream.writable.getWriter();
    writerLock = (async () => {
      try {
        await w.write(chunk);
        reportUp(chunk.byteLength);
      } catch (e) {
        shutdown(e);
      } finally {
        try { w.releaseLock(); } catch {}
        writerLock = null;
        if (pendingBytes > 0) scheduleFlush();
      }
    })();
    await writerLock;
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      try { await flushNow(); } catch (e) { shutdown(e); }
    }, SILENT);
  };

  // client -> upstream
  const onMessage = async (ev: MessageEvent) => {
    if (closed) return;
    if (typeof ev.data === "string") return;
    const data = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
    queueBytes += data.byteLength;
    if (queueBytes > MAX_Q) return shutdown(new Error("upstream queue overflow"));
    pending.push(data);
    pendingBytes += data.byteLength;
    if (pendingBytes >= GRAIN) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushNow().catch(shutdown);
    } else {
      scheduleFlush();
    }
  };
  client.addEventListener("message", onMessage as unknown as EventListener);

  client.addEventListener("close", () => {
    clientClosed = true;
    if (upClosed) shutdown();
    else shutdown();
  });
  client.addEventListener("error", (e) => shutdown(e));

  // upstream -> client
  (async () => {
    const reader = upstream.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value.byteLength === 0) continue;
        if (client.readyState !== 1) break;
        client.send(value);
        reportDown(value.byteLength);
      }
    } catch (e) {
      shutdown(e);
    } finally {
      upClosed = true;
      try { reader.releaseLock(); } catch {}
      if (clientClosed) shutdown();
      else shutdown();
    }
  })();

  upstream.closed.catch(shutdown).finally(() => {
    upClosed = true;
    if (clientClosed) shutdown();
  });

  return { closed: closedPromise };
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

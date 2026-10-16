// Quick VLESS-over-WSS smoke test against the deployed worker.
// Opens a WS, sends a VLESS request to cp.cloudflare.com:80 with
// a GET /cdn-cgi/trace payload, prints the first response chunk.

const HOST = process.env.KALFETELA_HOST || "kalfetela.example.workers.dev";
const UUID = process.env.AETHER_UUID || "d82f9881-a4f4-4823-8f7c-bce428adb789";
const TARGET_HOST = "cp.cloudflare.com";
const TARGET_PORT = 80;

function uuidBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function buildFrame() {
  const host = new TextEncoder().encode(TARGET_HOST);
  const payload = new TextEncoder().encode(
    "GET /cdn-cgi/trace HTTP/1.0\r\nHost: " + TARGET_HOST + "\r\nUser-Agent: kalfetela-smoke\r\nAccept: */*\r\n\r\n"
  );
  const frame = new Uint8Array(1 + 16 + 1 + 1 + 1 + host.length + 2 + payload.length);
  let o = 0;
  frame[o++] = 0x00;
  frame.set(uuidBytes(UUID), o); o += 16;
  frame[o++] = 0x00;
  frame[o++] = 0x03;
  frame[o++] = host.length;
  frame.set(host, o); o += host.length;
  frame[o++] = (TARGET_PORT >> 8) & 0xff;
  frame[o++] = TARGET_PORT & 0xff;
  frame.set(payload, o);
  return frame;
}

const url = "wss://" + HOST + "/vless/" + UUID;
console.log("connecting", url);
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
let got = 0;
const timeout = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 12000);
ws.onopen = () => {
  console.log("ws open, sending VLESS frame...");
  ws.send(buildFrame());
};
ws.onmessage = (ev) => {
  const data = new Uint8Array(ev.data);
  got += data.length;
  console.log("recv", data.length, "bytes; first 200:");
  console.log(new TextDecoder().decode(data.subarray(0, Math.min(200, data.length))));
  if (got > 0) {
    clearTimeout(timeout);
    setTimeout(() => { ws.close(); process.exit(0); }, 500);
  }
};
ws.onerror = (e) => { console.error("ws error", e.message || e); process.exit(1); };
ws.onclose = (e) => { console.log("ws closed", e.code, e.reason); };

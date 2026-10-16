// Embedded Xray manager: verified against a mock `xray` binary so config
// generation, process supervision, stats parsing and the access-log tailer are
// all exercised without downloading the real core.

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATA = "./test-data-xray";
const XRAY_DIR = path.join(DATA, "xray");
const BIN = path.join(XRAY_DIR, "xray");

let embedded: typeof import("../src/services/clients/local.js").embeddedXray;
let ensureReality: typeof import("../src/services/clients/local.js").ensureRealitySettings;

beforeAll(async () => {
  process.env.DATA_DIR = DATA;
  process.env.XRAY_DIR = XRAY_DIR;
  process.env.XRAY_BINARY = path.resolve(BIN);
  process.env.XRAY_ENABLED = "true";
  process.env.XRAY_API_PORT = "10099";
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(XRAY_DIR, { recursive: true });

  // ---- mock core -------------------------------------------------------
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "version") { console.log("Xray 26.3.27 (Xray, Penetration Testing)"); process.exit(0); }
if (args[0] === "api" && args[1] === "statsquery") {
  console.log('stat: <\\n  name: "user>>>tester>>>traffic>>>uplink"\\n  value: 1536\\n>');
  console.log('stat: <\\n  name: "user>>>tester>>>traffic>>>downlink"\\n  value: 8192\\n>');
  process.exit(0);
}
// run mode: keep the process alive so the manager sees "running"
console.log("[mock-xray] started with " + process.argv.slice(2).join(" "));
setInterval(() => {}, 1000);
`;
  fs.writeFileSync(BIN, script, { mode: 0o755 });

  const module_ = await import("../src/services/clients/local.js");
  embedded = module_.embeddedXray;
  ensureReality = module_.ensureRealitySettings;
});

afterAll(() => {
  embedded?.stop();
  fs.rmSync(DATA, { recursive: true, force: true });
});

describe("embedded xray manager", () => {
  it("generates a valid config for an embedded inbound", async () => {
    embedded.setInbounds([
      {
        nodeId: 1,
        name: "railway-1",
        port: 10001,
        protocol: "vless",
        transport: "ws",
        security: "reality",
        host: "example.up.railway.app",
        sni: "www.cloudflare.com",
        path: "/ws",
        serviceName: null,
        flow: null,
        fingerprint: "chrome",
        reality: ensureReality({}),
        settings: {},
        clients: [
          {
            userId: 1,
            username: "tester",
            email: "tester",
            uuid: "11111111-1111-1111-1111-111111111111",
            password: "pw",
            protocol: "vless",
            limitBytes: 0,
            usedBytes: 0,
            expiresAt: null,
            deviceLimit: 2,
            speedMbps: 0,
            enabled: true,
          },
        ],
      },
    ]);
    const config = JSON.parse(embedded.buildConfigJson());
    expect(config.api.tag).toBe("api");
    expect(config.inbounds).toHaveLength(2);
    const inbound = config.inbounds[1];
    expect(inbound.tag).toBe("node-1");
    expect(inbound.port).toBe(10001);
    expect(inbound.settings.clients[0].email).toBe("tester");
    expect(inbound.streamSettings.network).toBe("ws");
    expect(inbound.streamSettings.realitySettings.privateKey).toBeTruthy();
    expect(config.policy.levels["0"].statsUserUplink).toBe(true);
    expect(config.routing.rules[0].inboundTag).toEqual(["api"]);
  });

  it("starts the core, reports version and supervises the process", async () => {
    await embedded.start();
    expect(embedded.status().installed).toBe(true);
    expect(embedded.status().version).toContain("26.3.27");
    // the debounced config-apply may restart the core once, so wait for it
    const deadline = Date.now() + 6000;
    while (!embedded.status().running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(embedded.status().running).toBe(true);
    expect(embedded.status().pid).toBeGreaterThan(0);
  });

  it("extracts source addresses from access log lines", async () => {
    const { extractSourceIp } = await import("../src/services/clients/local.js");
    expect(extractSourceIp("2026/10/16 12:00:00 from 1.2.3.4:51234 accepted tcp:example.com:443 [n >> direct] email: tester")).toBe("1.2.3.4");
    expect(extractSourceIp("2026/10/16 12:00:00 from [2001:db8::1]:51234 accepted tcp:example.com:443 email: tester")).toBe("2001:db8::1");
    expect(extractSourceIp("2026/10/16 12:00:00 9.9.9.9:1234 accepted udp:1.1.1.1:53")).toBe("9.9.9.9");
    expect(extractSourceIp("2026/10/16 12:00:00 from 1.2.3.4:1 tcp:example.com:443 rejected")).toBe("1.2.3.4");
  });

  it("parses per-user traffic deltas from the stats API", async () => {
    const deltas: Array<{ email: string; upload: number; download: number }> = [];
    embedded.onUsage((value) => deltas.push(...value));
    // the stats loop runs on its own timer — trigger it directly
    await (embedded as unknown as { queryStats: () => Promise<Array<{ email: string; upload: number; download: number }>> }).queryStats().then((value) => deltas.push(...value));
    expect(deltas).toContainEqual({ email: "tester", upload: 1536, download: 8192 });
  });

  it("tracks unique client IPs from the access log", async () => {
    const line = '2026/10/16 12:00:00 from 1.2.3.4:51234 accepted tcp:example.com:443 [node-1 >> direct] email: tester';
    embedded.ingestAccessLogLine(line);
    embedded.ingestAccessLogLine(line.replace("1.2.3.4", "5.6.7.8"));
    embedded.ingestAccessLogLine(line.replace("1.2.3.4", "5.6.7.8"));
    const snapshot = embedded.onlineSnapshot(300);
    const entry = snapshot.find((item) => item.email === "tester");
    expect(entry).toBeTruthy();
    expect(entry!.ips.sort()).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("reality keys are generated once and are stable", () => {
    const first = ensureReality({});
    expect(first.privateKey).toBeTruthy();
    expect(first.publicKey).toBeTruthy();
    const second = ensureReality({ privateKey: first.privateKey, publicKey: first.publicKey, shortId: first.shortIds[0], dest: first.dest });
    expect(second.privateKey).toBe(first.privateKey);
    expect(second.shortIds[0]).toBe(first.shortIds[0]);
  });
});

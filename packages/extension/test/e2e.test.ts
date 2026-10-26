import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "../src/protocol.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");

async function launchExt(): Promise<BrowserContext> {
  const userData = mkdtempSync(join(tmpdir(), "bl-ext-"));
  const args = [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`];
  // Headless Chromium does not start MV3 service workers. Use the full Chromium binary headed.
  return chromium.launchPersistentContext(userData, { headless: false, args });
}

describe("unpacked extension", () => {
  let fixture: FixtureServer;
  let ingestPort: number;
  let received: ClientMessage[];
  let context: BrowserContext;
  let closeIngest: () => Promise<void>;

  beforeAll(async () => {
    fixture = await startFixtureServer();
    received = [];
    const http = createServer();
    const wss = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) => {
          const m = JSON.parse(data.toString()) as ClientMessage;
          received.push(m);
          if (m.type === "hello") ws.send(JSON.stringify({ type: "ready", protocol: 1 }));
          if (m.type === "recording.start") ws.send(JSON.stringify({ type: "recording.started", recordingId: m.recording.id }));
          if (m.type === "step") ws.send(JSON.stringify({ type: "step.ack", recordingId: m.recordingId, seq: m.step.seq, status: "stored" }));
          if (m.type === "recording.stop") ws.send(JSON.stringify({ type: "recording.stopped", recordingId: m.recordingId, workflowId: "w" }));
        });
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    ingestPort = (http.address() as AddressInfo).port;
    closeIngest = () =>
      new Promise((resolve) => {
        wss.close();
        http.close(() => resolve());
      });
    context = await launchExt();
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    await closeIngest?.();
    await fixture?.close();
  });

  it("records a form and stops", async () => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extId = new URL(sw.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.fill("#token", "e2e-token");
    await popup.fill("#port", String(ingestPort));
    await popup.click("#save");
    await popup.fill("#name", "Create invoice");

    const page = await context.newPage();
    await page.goto(`${fixture.url}/form`);
    await popup.click("#record");
    await page.getByLabel("Customer").fill("Globex Inc");
    await page.getByLabel("Plan").selectOption("pro");
    await page.getByRole("button", { name: "Save" }).click();
    await popup.click("#stop");

    const deadline = Date.now() + 10_000;
    while (!received.some((m) => m.type === "recording.stop") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const types = received.map((m) => m.type);
    expect(types[0]).toBe("hello");
    expect(types).toContain("recording.start");
    expect(types).toContain("recording.stop");
    expect(received.some((m) => m.type === "step")).toBe(true);
    const blob = JSON.stringify(received);
    expect(blob).not.toContain("screenshotBefore");
    expect(blob).not.toContain("hunter2");
  });
});

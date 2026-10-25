import { EventEmitter } from "node:events";
import { request } from "node:http";
import type { ServerMessage } from "@browserlearn/core/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { App } from "../src/app.js";
import { IngestHub } from "../src/ingest.js";
import { type RunningServer, startServer } from "../src/server.js";
import { formRecording, formSteps, testApp } from "./helpers.js";

interface Client {
  ws: WebSocket;
  send(m: unknown): void;
  next(): Promise<ServerMessage>;
  closed: Promise<number>;
}

async function connect(server: RunningServer, origin = "chrome-extension://abc"): Promise<Client> {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/ingest`, { origin });
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(m);
    else queue.push(m);
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return {
    ws,
    closed,
    send: (m) => ws.send(JSON.stringify(m)),
    next: () => new Promise((resolve) => (queue.length ? resolve(queue.shift()!) : waiters.push(resolve))),
  };
}

async function paired(server: RunningServer, app: App): Promise<Client> {
  const c = await connect(server);
  c.send({ type: "hello", token: app.config.pairToken, protocol: 1 });
  expect(await c.next()).toEqual({ type: "ready", protocol: 1 });
  return c;
}

describe("ingest", () => {
  let app: App;
  let server: RunningServer;
  afterEach(async () => {
    await server?.close();
    app?.close();
  });

  async function setup(helloTimeoutMs?: number) {
    app = testApp();
    server = await startServer(app, { port: 0, ...(helloTimeoutMs ? { helloTimeoutMs } : {}) });
  }

  it("records, acknowledges, and compiles on stop", async () => {
    await setup();
    const c = await paired(server, app);
    const base = "https://app.test";
    c.send({ type: "recording.start", recording: formRecording(base) });
    expect(await c.next()).toEqual({ type: "recording.started", recordingId: "rec-form" });
    for (const step of formSteps(base)) {
      c.send({ type: "step", recordingId: "rec-form", step });
      expect(await c.next()).toEqual({ type: "step.ack", recordingId: "rec-form", seq: step.seq, status: "stored" });
    }
    c.send({ type: "step", recordingId: "rec-form", step: formSteps(base)[0] });
    expect(await c.next()).toMatchObject({ type: "step.ack", seq: 1, status: "duplicate" });
    c.send({ type: "step", recordingId: "rec-form", step: { seq: 99, action: "hover" } });
    expect(await c.next()).toMatchObject({ type: "step.ack", seq: 99, status: "dropped" });

    c.send({ type: "recording.stop", recordingId: "rec-form", endedAt: 5 });
    const stopped = await c.next();
    expect(stopped).toMatchObject({ type: "recording.stopped", recordingId: "rec-form" });
    const w = app.store.getWorkflow((stopped as { workflowId: string }).workflowId)!;
    expect(w.name).toBe("Create invoice");
    expect(app.store.getRecording("rec-form")!.status).toBe("complete");

    c.send({ type: "recording.stop", recordingId: "rec-form", endedAt: 6 });
    expect(await c.next()).toEqual({ type: "recording.stopped", recordingId: "rec-form", workflowId: w.id });
    expect(app.store.listWorkflows()).toHaveLength(1);
  });

  it("names a second workflow with the same name uniquely and treats a re-sent start as a no-op", async () => {
    await setup();
    const c = await paired(server, app);
    for (const id of ["r1", "r2"]) {
      c.send({ type: "recording.start", recording: formRecording("https://app.test", id) });
      await c.next();
      c.send({ type: "recording.start", recording: formRecording("https://app.test", id) });
      expect(await c.next()).toEqual({ type: "recording.started", recordingId: id });
      c.send({ type: "step", recordingId: id, step: formSteps("https://app.test")[0] });
      await c.next();
      c.send({ type: "recording.stop", recordingId: id, endedAt: 2 });
      await c.next();
    }
    expect(app.store.listWorkflows().map((w) => w.name).sort()).toEqual(["Create invoice", "Create invoice (2)"]);
  });

  it("applies field rules before storing", async () => {
    await setup();
    app.saveConfig({ ...app.config, fieldRules: [{ domain: "app.test", field: "customer" }] });
    const c = await paired(server, app);
    c.send({ type: "recording.start", recording: formRecording("https://app.test") });
    await c.next();
    c.send({ type: "step", recordingId: "rec-form", step: formSteps("https://app.test")[0] });
    await c.next();
    expect(app.store.listSteps("rec-form")[0]!.value).toBe("[REDACTED:field]");
  });

  it("reports unknown recordings and malformed messages without closing", async () => {
    await setup();
    const c = await paired(server, app);
    c.send({ type: "step", recordingId: "nope", step: formSteps("https://app.test")[0] });
    expect(await c.next()).toMatchObject({ type: "error", code: "not_found" });
    c.ws.send("not json");
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_message" });
    c.send({ type: "recording.start", recording: { id: "x" } });
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_message" });
  });

  it("closes connections with a wrong pairing code, a wrong protocol, or no hello", async () => {
    await setup(100);
    const wrong = await connect(server);
    wrong.send({ type: "hello", token: "wrong", protocol: 1 });
    expect(await wrong.next()).toMatchObject({ type: "error", code: "unauthorized" });
    expect(await wrong.closed).toBe(4001);

    const old = await connect(server);
    old.send({ type: "hello", token: app.config.pairToken, protocol: 99 });
    expect(await old.next()).toMatchObject({ type: "error", code: "unsupported_protocol" });
    expect(await old.closed).toBe(4002);

    const early = await connect(server);
    early.send({ type: "recording.start", recording: formRecording("https://app.test") });
    expect(await early.next()).toMatchObject({ type: "error", code: "unauthorized" });

    const silent = await connect(server);
    expect(await silent.closed).toBe(4001);
    expect(app.store.listRecordings()).toEqual([]);
    expect(server.ingest.connected).toBe(0);
  });

  it("rejects web origins and foreign Host headers", async () => {
    await setup();
    await expect(connect(server, "https://evil.test")).rejects.toThrow(/403/);
    const status = await new Promise<number>((resolve, reject) => {
      request({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: "evil.test" } }, (res) => resolve(res.statusCode!))
        .on("error", reject)
        .end();
    });
    expect(status).toBe(403);
  });
});

describe("IngestHub socket errors", () => {
  it("does not throw when a paired socket errors, then drops it on close", () => {
    const app = testApp();
    const hub = new IngestHub(app);
    const ws = new EventEmitter() as EventEmitter & { send(data: string): void; close(): void };
    ws.send = () => undefined;
    ws.close = () => undefined;
    hub.accept(ws as unknown as WebSocket);
    ws.emit("message", JSON.stringify({ type: "hello", token: app.config.pairToken, protocol: 1 }), false);
    expect(hub.connected).toBe(1);
    expect(() => {
      ws.emit("error", new Error("bad frame"));
      ws.emit("close");
    }).not.toThrow();
    expect(hub.connected).toBe(0);
    app.close();
  });
});

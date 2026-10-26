import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { IngestClient } from "../src/client.js";
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "../src/protocol.js";
import { emptyQueue, enqueue, type Queue } from "../src/queue.js";

interface FakeServer {
  port: number;
  messages: ClientMessage[];
  close(): Promise<void>;
}

async function startFake(handler?: (ws: WebSocket, msg: ClientMessage) => void): Promise<FakeServer> {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const messages: ClientMessage[] = [];
  http.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ingest") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString()) as ClientMessage;
        messages.push(m);
        handler?.(ws, m);
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const port = (http.address() as AddressInfo).port;
  return {
    port,
    messages,
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.close();
        wss.close();
        http.close(() => resolve());
      }),
  };
}

async function viWait(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const startMsg = {
  type: "recording.start" as const,
  recording: { id: "r1", name: "T", startUrl: "https://app.test/", startedAt: 1, status: "recording" as const },
};
const stepMsg = {
  type: "step" as const,
  recordingId: "r1",
  step: { seq: 1, action: "click" as const, selectors: { css: "#a" }, axSnippet: "", url: "https://app.test/", framePath: [], ts: 1 },
};

describe("IngestClient", () => {
  it("hellos, waits for ready, then drains the queue", async () => {
    const fake = await startFake((ws, msg) => {
      if (msg.type === "hello") ws.send(JSON.stringify({ type: "ready", protocol: PROTOCOL_VERSION }));
      if (msg.type === "recording.start") ws.send(JSON.stringify({ type: "recording.started", recordingId: msg.recording.id }));
      if (msg.type === "step") ws.send(JSON.stringify({ type: "step.ack", recordingId: msg.recordingId, seq: msg.step.seq, status: "stored" }));
    });
    let queue: Queue = enqueue(emptyQueue(), startMsg);
    queue = enqueue(queue, stepMsg);
    const statuses: string[] = [];
    const client = new IngestClient({
      port: () => fake.port,
      token: () => "pair-token",
      getQueue: () => queue,
      setQueue: (q) => {
        queue = q;
      },
      webSocket: WebSocket as never,
      onStatus: (s) => statuses.push(s),
    });
    client.connect();
    await viWait(() => queue.items.length === 0);
    expect(fake.messages[0]).toEqual({ type: "hello", token: "pair-token", protocol: 1 });
    expect(fake.messages.map((m) => m.type)).toEqual(["hello", "recording.start", "step"]);
    expect(statuses).toContain("ready");
    client.disconnect();
    await fake.close();
  });

  it("reconnects after a drop and resends unacked steps", async () => {
    let connections = 0;
    const fake = await startFake((ws, msg) => {
      if (msg.type === "hello") {
        connections++;
        ws.send(JSON.stringify({ type: "ready", protocol: 1 }));
      }
      if (msg.type === "step") {
        if (connections === 1) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: "step.ack", recordingId: msg.recordingId, seq: msg.step.seq, status: "duplicate" }));
      }
      if (msg.type === "recording.start") ws.send(JSON.stringify({ type: "recording.started", recordingId: msg.recording.id }));
    });
    let queue: Queue = enqueue(emptyQueue(), startMsg);
    queue = enqueue(queue, stepMsg);
    const client = new IngestClient({
      port: () => fake.port,
      token: () => "t",
      getQueue: () => queue,
      setQueue: (q) => {
        queue = q;
      },
      webSocket: WebSocket as never,
      onStatus: () => undefined,
      sleep: () => Promise.resolve(),
    });
    client.connect();
    await viWait(() => queue.items.length === 0, 4000);
    expect(connections).toBeGreaterThanOrEqual(2);
    client.disconnect();
    await fake.close();
  });
});

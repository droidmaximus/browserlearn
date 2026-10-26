import { HELLO_TIMEOUT_MS, PROTOCOL_VERSION, RECONNECT_MS, ingestUrl, parseServerMessage, type ServerMessage } from "./protocol.js";
import { ackStart, ackStep, ackStop, type Queue } from "./queue.js";

export type Status = "connecting" | "ready" | "disconnected";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: Event) => void) | null;
}

export type WebSocketCtor = new (url: string) => SocketLike;

export interface ClientOpts {
  port: () => number;
  token: () => string;
  getQueue: () => Queue;
  setQueue: (q: Queue) => void;
  webSocket?: WebSocketCtor;
  onStatus: (status: Status, detail?: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const OPEN = typeof WebSocket !== "undefined" && "OPEN" in WebSocket ? WebSocket.OPEN : 1;

export class IngestClient {
  private ws: SocketLike | undefined;
  private ready = false;
  private closed = false;
  private attempt = 0;
  private sent = 0;
  private helloTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: ClientOpts) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  disconnect(): void {
    this.closed = true;
    this.clearHello();
    this.ws?.close();
    this.ws = undefined;
    this.ready = false;
    this.opts.onStatus("disconnected");
  }

  notify(): void {
    if (this.ready) this.flush();
    else if (!this.ws && !this.closed) this.open();
  }

  private open(): void {
    if (this.closed || this.ws) return;
    const WS = (this.opts.webSocket ?? WebSocket) as WebSocketCtor;
    const token = this.opts.token();
    if (!token) {
      this.opts.onStatus("disconnected", "npx browserlearn");
      return;
    }
    this.opts.onStatus("connecting");
    const ws = new WS(ingestUrl(this.opts.port()));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
      this.helloTimer = setTimeout(() => {
        if (!this.ready) ws.close();
      }, HELLO_TIMEOUT_MS);
    };
    ws.onmessage = (ev: MessageEvent) => {
      const msg = parseServerMessage(String(ev.data));
      if (!msg) return;
      this.handle(msg);
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      this.clearHello();
      this.ws = undefined;
      this.ready = false;
      this.sent = 0;
      this.opts.onStatus("disconnected", "npx browserlearn");
      if (!this.closed) void this.reconnect();
    };
  }

  private handle(msg: ServerMessage): void {
    if (msg.type === "ready") {
      this.ready = true;
      this.clearHello();
      this.opts.onStatus("ready");
      this.flush();
      return;
    }
    if (msg.type === "error" && (msg.code === "unauthorized" || msg.code === "unsupported_protocol")) {
      this.closed = true;
      this.opts.onStatus("disconnected", msg.message);
      this.ws?.close();
      return;
    }
    const q = this.opts.getQueue();
    let next = q;
    if (msg.type === "recording.started") next = ackStart(q, msg.recordingId);
    else if (msg.type === "step.ack") next = ackStep(q, msg.recordingId, msg.seq);
    else if (msg.type === "recording.stopped") next = ackStop(q, msg.recordingId);
    if (next !== q) {
      this.sent = Math.max(0, this.sent - (q.items.length - next.items.length));
      this.opts.setQueue(next);
    }
    this.flush();
  }

  private flush(): void {
    if (!this.ready || !this.ws || this.ws.readyState !== OPEN) return;
    const items = this.opts.getQueue().items;
    if (this.sent > items.length) this.sent = 0;
    for (const m of items.slice(this.sent)) this.ws.send(JSON.stringify(m));
    this.sent = items.length;
  }

  private async reconnect(): Promise<void> {
    const delay = RECONNECT_MS[Math.min(this.attempt, RECONNECT_MS.length - 1)]!;
    this.attempt++;
    await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(delay);
    if (!this.closed && !this.ws) this.open();
  }

  private clearHello(): void {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = undefined;
  }
}

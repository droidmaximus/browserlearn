import { createHash, timingSafeEqual } from "node:crypto";
import { type ParsedClientMessage, PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from "@browserlearn/core/protocol";
import type { WebSocket } from "ws";
import type { App } from "./app.js";
import { errorMessage, NotFoundError } from "./errors.js";
import { compileAndSave } from "./workflows.js";

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

export const tokensEqual = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

export interface IngestOptions {
  helloTimeoutMs?: number;
}

export class IngestHub {
  private readonly paired = new Set<WebSocket>();

  constructor(
    private readonly app: App,
    private readonly opts: IngestOptions = {},
  ) {}

  get connected(): number {
    return this.paired.size;
  }

  accept(ws: WebSocket): void {
    let authed = false;
    const send = (m: ServerMessage): void => ws.send(JSON.stringify(m));
    const timer = setTimeout(() => {
      if (!authed) ws.close(4001, "unauthorized");
    }, this.opts.helloTimeoutMs ?? 5000);
    ws.on("close", () => {
      clearTimeout(timer);
      this.paired.delete(ws);
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        send({ type: "error", code: "bad_message", message: "binary messages are not supported" });
        return;
      }
      let msg: ParsedClientMessage;
      try {
        msg = parseClientMessage(data.toString());
      } catch (err) {
        send({ type: "error", code: "bad_message", message: errorMessage(err) });
        return;
      }
      if (!authed) {
        if (msg.type !== "hello" || !tokensEqual(msg.token, this.app.config.pairToken)) {
          send({ type: "error", code: "unauthorized", message: "Pairing code does not match. Copy it again from the dashboard." });
          ws.close(4001, "unauthorized");
          return;
        }
        if (msg.protocol !== PROTOCOL_VERSION) {
          send({ type: "error", code: "unsupported_protocol", message: `Update BrowserLearn: this app speaks protocol ${PROTOCOL_VERSION}` });
          ws.close(4002, "unsupported protocol");
          return;
        }
        authed = true;
        clearTimeout(timer);
        this.paired.add(ws);
        send({ type: "ready", protocol: PROTOCOL_VERSION });
        return;
      }
      try {
        send(this.handle(msg));
      } catch (err) {
        send({ type: "error", code: err instanceof NotFoundError ? "not_found" : "bad_message", message: errorMessage(err) });
      }
    });
  }

  handle(msg: ParsedClientMessage): ServerMessage {
    const { store } = this.app;
    switch (msg.type) {
      case "hello":
        return { type: "ready", protocol: PROTOCOL_VERSION };
      case "recording.start": {
        const id = (msg.recording as { id?: unknown }).id;
        const existing = typeof id === "string" ? store.getRecording(id) : undefined;
        const rec = existing ?? store.createRecording(msg.recording);
        return { type: "recording.started", recordingId: rec.id };
      }
      case "step": {
        if (!store.getRecording(msg.recordingId)) throw new NotFoundError(`Recording not found: ${msg.recordingId}`);
        const { status } = store.ingestStep(msg.recordingId, msg.step, this.app.config.fieldRules);
        const seq = (msg.step as { seq?: unknown }).seq;
        return { type: "step.ack", recordingId: msg.recordingId, seq: Number.isInteger(seq) ? (seq as number) : -1, status };
      }
      case "recording.stop": {
        const rec = store.getRecording(msg.recordingId);
        if (!rec) throw new NotFoundError(`Recording not found: ${msg.recordingId}`);
        if (rec.status === "complete") {
          const w = store.findWorkflowBySource(rec.id);
          return { type: "recording.stopped", recordingId: rec.id, ...(w ? { workflowId: w.id } : {}) };
        }
        store.finishRecording(rec.id, msg.endedAt);
        try {
          return { type: "recording.stopped", recordingId: rec.id, workflowId: compileAndSave(this.app, rec.id).id };
        } catch (err) {
          return { type: "recording.stopped", recordingId: rec.id, error: errorMessage(err) };
        }
      }
    }
  }
}

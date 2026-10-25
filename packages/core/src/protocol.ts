import type { RawStep, Recording } from "./types.js";

export const PROTOCOL_VERSION = 1;

export type IngestStatus = "stored" | "duplicate" | "dropped";

export type ClientMessage =
  | { type: "hello"; token: string; protocol: number }
  | { type: "recording.start"; recording: Recording }
  | { type: "step"; recordingId: string; step: RawStep }
  | { type: "recording.stop"; recordingId: string; endedAt: number };

/** A client message whose recording and step bodies have not been validated yet; the store validates them. */
export type ParsedClientMessage =
  | Extract<ClientMessage, { type: "hello" | "recording.stop" }>
  | { type: "recording.start"; recording: unknown }
  | { type: "step"; recordingId: string; step: unknown };

export type ErrorCode = "unauthorized" | "unsupported_protocol" | "bad_message" | "not_found" | "internal";

export type ServerMessage =
  | { type: "ready"; protocol: number }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "recording.started"; recordingId: string }
  | { type: "step.ack"; recordingId: string; seq: number; status: IngestStatus }
  | { type: "recording.stopped"; recordingId: string; workflowId?: string; error?: string };

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseClientMessage(text: string): ParsedClientMessage {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new ProtocolError("message is not JSON");
  }
  if (!isRecord(v) || typeof v.type !== "string") throw new ProtocolError("message has no type");
  switch (v.type) {
    case "hello":
      if (typeof v.token !== "string" || !Number.isInteger(v.protocol)) throw new ProtocolError("invalid hello");
      return { type: "hello", token: v.token, protocol: v.protocol as number };
    case "recording.start":
      if (!isRecord(v.recording)) throw new ProtocolError("invalid recording.start");
      return { type: "recording.start", recording: v.recording };
    case "step":
      if (typeof v.recordingId !== "string" || !isRecord(v.step)) throw new ProtocolError("invalid step");
      return { type: "step", recordingId: v.recordingId, step: v.step };
    case "recording.stop":
      if (typeof v.recordingId !== "string" || typeof v.endedAt !== "number" || !Number.isFinite(v.endedAt)) {
        throw new ProtocolError("invalid recording.stop");
      }
      return { type: "recording.stop", recordingId: v.recordingId, endedAt: v.endedAt };
    default:
      throw new ProtocolError(`unknown message type: ${v.type}`);
  }
}

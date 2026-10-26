export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 7420;
export const QUEUE_CAP = 500;
export const HELLO_TIMEOUT_MS = 5000;
export const RECONNECT_MS = [200, 400, 800, 1600, 5000];

export const ingestUrl = (port: number): string => `ws://127.0.0.1:${port}/ingest`;

export type ActionType = "click" | "type" | "select" | "navigate" | "submit";

export interface SelectorCandidates {
  testId?: string;
  role?: string;
  name?: string;
  css?: string;
  xpath?: string;
}

export interface RawStep {
  seq: number;
  action: ActionType;
  selectors: SelectorCandidates;
  axSnippet: string;
  url: string;
  framePath: number[];
  value?: string;
  isPassword?: boolean;
  ts: number;
}

export interface Recording {
  id: string;
  name: string;
  startUrl: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "complete";
}

export type ClientMessage =
  | { type: "hello"; token: string; protocol: number }
  | { type: "recording.start"; recording: Recording }
  | { type: "step"; recordingId: string; step: RawStep }
  | { type: "recording.stop"; recordingId: string; endedAt: number };

export type IngestStatus = "stored" | "duplicate" | "dropped";

export type ServerMessage =
  | { type: "ready"; protocol: number }
  | { type: "error"; code: string; message: string }
  | { type: "recording.started"; recordingId: string }
  | { type: "step.ack"; recordingId: string; seq: number; status: IngestStatus }
  | { type: "recording.stopped"; recordingId: string; workflowId?: string; error?: string };

export function parseServerMessage(text: string): ServerMessage | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null || !("type" in v) || typeof (v as { type: unknown }).type !== "string") return undefined;
    return v as ServerMessage;
  } catch {
    return undefined;
  }
}

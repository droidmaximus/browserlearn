import { describe, expect, it } from "vitest";
import { parseClientMessage, ProtocolError } from "../src/protocol.js";

describe("parseClientMessage", () => {
  it("parses each client message, dropping unknown envelope fields", () => {
    expect(parseClientMessage(JSON.stringify({ type: "hello", token: "t", protocol: 1, client: "x" }))).toEqual({ type: "hello", token: "t", protocol: 1 });
    const recording = { id: "r", anything: true };
    expect(parseClientMessage(JSON.stringify({ type: "recording.start", recording }))).toEqual({ type: "recording.start", recording });
    const step = { seq: 1 };
    expect(parseClientMessage(JSON.stringify({ type: "step", recordingId: "r", step }))).toEqual({ type: "step", recordingId: "r", step });
    expect(parseClientMessage(JSON.stringify({ type: "recording.stop", recordingId: "r", endedAt: 5 }))).toEqual({
      type: "recording.stop",
      recordingId: "r",
      endedAt: 5,
    });
  });

  it("rejects malformed envelopes", () => {
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify({ type: "hello", token: 1, protocol: 1 }),
      JSON.stringify({ type: "hello", token: "t", protocol: 1.5 }),
      JSON.stringify({ type: "recording.start", recording: [] }),
      JSON.stringify({ type: "step", recordingId: "r", step: "x" }),
      JSON.stringify({ type: "recording.stop", recordingId: "r", endedAt: "soon" }),
      JSON.stringify({ type: "nope" }),
    ]) {
      expect(() => parseClientMessage(bad), bad).toThrow(ProtocolError);
    }
  });
});

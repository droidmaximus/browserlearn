import { describe, expect, it } from "vitest";
import type { ClientMessage } from "../src/protocol.js";
import { QUEUE_CAP } from "../src/protocol.js";
import { ackStart, ackStep, ackStop, emptyQueue, enqueue } from "../src/queue.js";

const start = (id: string): ClientMessage => ({
  type: "recording.start",
  recording: { id, name: "T", startUrl: "https://app.test/", startedAt: 1, status: "recording" },
});
const step = (id: string, seq: number): ClientMessage => ({
  type: "step",
  recordingId: id,
  step: { seq, action: "click", selectors: {}, axSnippet: "", url: "https://app.test/", framePath: [], ts: seq },
});
const stop = (id: string): ClientMessage => ({ type: "recording.stop", recordingId: id, endedAt: 9 });

describe("outbound queue", () => {
  it("acks remove the matching start, step, and stop", () => {
    let q = emptyQueue();
    q = enqueue(q, start("r1"));
    q = enqueue(q, step("r1", 1));
    q = enqueue(q, step("r1", 2));
    q = enqueue(q, stop("r1"));
    q = ackStart(q, "r1");
    expect(q.items.map((m) => m.type)).toEqual(["step", "step", "recording.stop"]);
    q = ackStep(q, "r1", 1);
    q = ackStep(q, "r1", 2);
    expect(q.items.map((m) => m.type)).toEqual(["recording.stop"]);
    q = ackStop(q, "r1");
    expect(q.items).toEqual([]);
  });

  it("drops the oldest step when full and never drops start or stop", () => {
    let q = emptyQueue();
    q = enqueue(q, start("r1"));
    for (let seq = 1; seq <= QUEUE_CAP + 3; seq++) q = enqueue(q, step("r1", seq));
    q = enqueue(q, stop("r1"));
    expect(q.items[0]).toMatchObject({ type: "recording.start" });
    expect(q.items.at(-1)).toMatchObject({ type: "recording.stop" });
    const seqs = q.items.filter((m) => m.type === "step").map((m) => (m.type === "step" ? m.step.seq : 0));
    expect(seqs[0]).toBe(4);
    expect(seqs.at(-1)).toBe(QUEUE_CAP + 3);
    expect(q.dropped).toBe(3);
  });
});

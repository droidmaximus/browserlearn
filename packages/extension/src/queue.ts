import { QUEUE_CAP, type ClientMessage } from "./protocol.js";

export interface Queue {
  items: ClientMessage[];
  dropped: number;
}

export const emptyQueue = (): Queue => ({ items: [], dropped: 0 });

const isStart = (m: ClientMessage, id: string): boolean => m.type === "recording.start" && m.recording.id === id;
const isStop = (m: ClientMessage, id: string): boolean => m.type === "recording.stop" && m.recordingId === id;
const isStep = (m: ClientMessage, id: string, seq: number): boolean =>
  m.type === "step" && m.recordingId === id && m.step.seq === seq;

export function enqueue(q: Queue, msg: ClientMessage): Queue {
  const items = [...q.items, msg];
  let dropped = q.dropped;
  while (items.filter((m) => m.type === "step").length > QUEUE_CAP) {
    const i = items.findIndex((m) => m.type === "step");
    if (i < 0) break;
    items.splice(i, 1);
    dropped++;
  }
  return { items, dropped };
}

export const ackStart = (q: Queue, id: string): Queue => ({ ...q, items: q.items.filter((m) => !isStart(m, id)) });
export const ackStep = (q: Queue, id: string, seq: number): Queue => ({ ...q, items: q.items.filter((m) => !isStep(m, id, seq)) });
export const ackStop = (q: Queue, id: string): Queue => ({ ...q, items: q.items.filter((m) => !isStop(m, id)) });

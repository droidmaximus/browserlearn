import type { Store } from "@browserlearn/core/store";
import type { RawStep } from "@browserlearn/core/types";

export interface StepHit {
  seq: number;
  action: string;
  url: string;
  target?: string;
}

export interface RecordingHit {
  id: string;
  name: string;
  startUrl: string;
  startedAt: number;
  matchingSteps: StepHit[];
}

const MARKER = /\[REDACTED:[a-z]+\]/g;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patterns for the plaintext pieces of recorded input values, in raw and URL-encoded forms, longest first. */
function valuePatterns(steps: RawStep[]): RegExp[] {
  const terms = new Set<string>();
  for (const s of steps) {
    for (const piece of s.value?.split(MARKER) ?? []) {
      const t = piece.trim();
      if (t.length < 3) continue;
      const encoded = encodeURIComponent(t);
      for (const form of [t, encoded, encoded.replace(/%20/g, "+")]) terms.add(form);
    }
  }
  return [...terms].sort((a, b) => b.length - a.length).map((t) => new RegExp(escapeRegExp(t), "gi"));
}

/** Search never matches on, or returns, what the user typed. */
export function searchRecordings(store: Store, query: string, limit = 20): RecordingHit[] {
  const q = query.toLowerCase();
  const hits: RecordingHit[] = [];
  for (const rec of store.listRecordings()) {
    const steps = store.listSteps(rec.id);
    const patterns = valuePatterns(steps);
    const hide = (text: string): string => patterns.reduce((out, p) => out.replace(p, "{value}"), text);
    const matchingSteps = steps.flatMap((s) => {
      const target = s.selectors.name ?? s.selectors.testId;
      const hit: StepHit = { seq: s.seq, action: s.action, url: hide(s.url), ...(target ? { target: hide(target) } : {}) };
      return [hit.url, hit.target ?? ""].some((t) => t.toLowerCase().includes(q)) ? [hit] : [];
    });
    const name = hide(rec.name);
    const startUrl = hide(rec.startUrl);
    if (matchingSteps.length || name.toLowerCase().includes(q) || startUrl.toLowerCase().includes(q)) {
      hits.push({ id: rec.id, name, startUrl, startedAt: rec.startedAt, matchingSteps: matchingSteps.slice(0, 5) });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

import type {
  ExpectedState,
  Locator,
  ParamDef,
  RawStep,
  Recording,
  SelectorCandidates,
  Workflow,
  WorkflowAction,
  WorkflowStep,
} from "./types.js";
import { redactRecording } from "./redact.js";

export function chooseLocators(s: SelectorCandidates): Locator[] {
  const out: Locator[] = [];
  if (s.testId) out.push({ kind: "testId", testId: s.testId });
  if (s.role && s.name) out.push({ kind: "role", role: s.role, name: s.name });
  if (s.css) out.push({ kind: "css", css: s.css });
  if (s.xpath) out.push({ kind: "xpath", xpath: s.xpath });
  return out;
}

export function describeLocator(l: Locator): string {
  switch (l.kind) {
    case "testId":
      return `[data-testid="${l.testId}"]`;
    case "role":
      return `${l.role} "${l.name}"`;
    case "css":
      return l.css;
    case "xpath":
      return l.xpath;
  }
}

export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Steps without a locator have no key and never share a target. */
function targetKey(s: RawStep): string | null {
  const locator = chooseLocators(s.selectors)[0];
  return locator ? JSON.stringify([locator, s.framePath]) : null;
}

function sameTarget(a: RawStep, b: RawStep): boolean {
  const key = targetKey(a);
  return key !== null && key === targetKey(b);
}

const isInput = (s: RawStep): boolean => s.action === "type" || s.action === "select";

const isToggle = (s: RawStep): boolean =>
  s.action === "click" && (s.selectors.role === "checkbox" || s.selectors.role === "switch");

/** Clicks and submits may act on the typed value, so a later retype must not fold across them. */
const isFoldBarrier = (s: RawStep): boolean => s.action === "submit" || (s.action === "click" && !isToggle(s));

interface Segmented {
  step: RawStep;
  segment: number;
}

/** A page segment is a run of steps on one URL path; every navigate starts a new one. */
function withSegments(steps: RawStep[]): Segmented[] {
  let segment = 0;
  return steps.map((step, i) => {
    const prev = steps[i - 1];
    if (prev && (step.action === "navigate" || urlPath(step.url) !== urlPath(prev.url))) segment++;
    return { step, segment };
  });
}

function collapseAdjacent(steps: RawStep[]): RawStep[] {
  const out: RawStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && isInput(s) && sameTarget(prev, s) && (prev.action === s.action || prev.action === "click")) {
      out[out.length - 1] = s;
      continue;
    }
    if (prev && s.action === "navigate" && prev.action === "navigate" && prev.url === s.url) continue;
    out.push(s);
  }
  return out;
}

function findFoldTarget(out: Segmented[], item: Segmented): Segmented | undefined {
  for (let i = out.length - 1; i >= 0; i--) {
    const o = out[i]!;
    if (o.segment !== item.segment || isFoldBarrier(o.step)) return undefined;
    if (o.step.action === item.step.action && sameTarget(o.step, item.step)) return o;
  }
  return undefined;
}

/**
 * A later input into the same field on the same page overwrites the earlier step's value in place,
 * unless a click or submit lies between them.
 */
function mergeRepeatedInputs(items: Segmented[]): Segmented[] {
  const out: Segmented[] = [];
  for (const item of items) {
    const s = item.step;
    const earlier = isInput(s) ? findFoldTarget(out, item) : undefined;
    if (!earlier) {
      out.push(item);
      continue;
    }
    const { value: _v, isPassword: _p, ...rest } = earlier.step;
    earlier.step = {
      ...rest,
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.isPassword !== undefined ? { isPassword: s.isPassword } : {}),
    };
  }
  return out;
}

/**
 * Clicks on one checkbox/switch on one page with no click or submit between them: an even count
 * cancels out, an odd count is one click.
 */
function dropCancelledToggles(items: Segmented[]): Segmented[] {
  const groups = new Map<string, Segmented[]>();
  let barriers = 0;
  for (const item of items) {
    if (isFoldBarrier(item.step)) barriers++;
    const target = isToggle(item.step) ? targetKey(item.step) : null;
    if (target === null) continue;
    const key = `${item.segment}|${barriers}|${target}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const dropped = new Set<Segmented>();
  for (const group of groups.values()) {
    for (const item of group.length % 2 === 0 ? group : group.slice(1)) dropped.add(item);
  }
  return items.filter((item) => !dropped.has(item));
}

export function collapseSteps(steps: RawStep[]): RawStep[] {
  const sorted = [...steps].sort((a, b) => a.seq - b.seq).filter((s) => s.action !== "scroll");
  const segmented = withSegments(collapseAdjacent(sorted));
  return dropCancelledToggles(mergeRepeatedInputs(segmented)).map((item) => item.step);
}

/** Non-navigate steps that have no locator and so cannot be replayed. */
export function unrunnableSteps(w: Workflow): WorkflowStep[] {
  return w.steps.filter((s) => s.action !== "navigate" && !s.locator);
}

const VERB: Record<Exclude<WorkflowAction, "navigate">, string> = {
  click: "Click",
  type: "Type into",
  select: "Select in",
  submit: "Submit",
};

const REDACTION_MARKER = /\[REDACTED:[a-z]+\]/;
/** Markers that replace a whole value (password fields and field rules) rather than a pattern match inside it. */
const WHOLE_VALUE_MASKS: ReadonlySet<string> = new Set(["[REDACTED:password]", "[REDACTED:field]"]);

/** The text between redaction markers, trimmed; pieces under 3 characters are too short to scrub safely. */
const plaintextFragments = (value: string): string[] =>
  value
    .split(new RegExp(REDACTION_MARKER.source, "g"))
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 3);

export interface CompileOptions {
  now: number;
  newId?: () => string;
}

export function compileRecording(input: Recording, rawSteps: RawStep[], opts: CompileOptions): Workflow {
  const rec = redactRecording(input);
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const workflowId = newId();
  const steps = collapseSteps(rawSteps);
  const out: WorkflowStep[] = [];
  const params: ParamDef[] = [];

  if (steps[0]?.action !== "navigate") {
    out.push({
      id: newId(),
      name: `Open ${rec.startUrl}`,
      action: "navigate",
      url: rec.startUrl,
      fallbacks: [],
      framePath: [],
      expected: steps[0] ? { urlPath: urlPath(steps[0].url) } : {},
    });
  }

  steps.forEach((s, i) => {
    const next = steps[i + 1];
    const action = s.action as WorkflowAction;
    let expected: ExpectedState = {};
    if (next && (action === "navigate" || urlPath(next.url) !== urlPath(s.url))) expected = { urlPath: urlPath(next.url) };
    else if (!next && action === "navigate") expected = { urlPath: urlPath(s.url) };

    if (action === "navigate") {
      out.push({ id: newId(), name: `Open ${s.url}`, action, url: s.url, fallbacks: [], framePath: s.framePath, expected });
      return;
    }

    const [locator, ...fallbacks] = chooseLocators(s.selectors);
    const target = locator ? describeLocator(locator) : "unknown element";
    let param: string | undefined;
    if (action === "type" || action === "select") {
      param = `param_${params.length + 1}`;
      const value = s.value;
      const hidden = value === undefined || REDACTION_MARKER.test(value);
      const scrubTerms = value === undefined ? [] : plaintextFragments(value);
      params.push({
        name: param,
        description: `Value for ${target}`,
        required: true,
        secret: Boolean(s.isPassword) || (value !== undefined && WHOLE_VALUE_MASKS.has(value)),
        ...(hidden ? {} : { example: value }),
        ...(scrubTerms.length ? { scrubTerms } : {}),
      });
    }
    out.push({
      id: newId(),
      name: `${VERB[action]} ${target}`,
      action,
      ...(locator ? { locator } : {}),
      fallbacks,
      ...(param ? { param } : {}),
      framePath: s.framePath,
      expected,
    });
  });

  return {
    id: workflowId,
    name: rec.name,
    description: "",
    version: 1,
    params,
    steps: out,
    sourceRecordingId: rec.id,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

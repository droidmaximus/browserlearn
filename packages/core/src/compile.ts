import { randomUUID } from "node:crypto";
import type {
  Locator,
  ParamDef,
  RawStep,
  Recording,
  SelectorCandidates,
  Workflow,
  WorkflowAction,
  WorkflowStep,
} from "./types.js";

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

const locatorKey = (s: SelectorCandidates): string => JSON.stringify(chooseLocators(s)[0] ?? null);

export function collapseSteps(steps: RawStep[]): RawStep[] {
  const sorted = [...steps].sort((a, b) => a.seq - b.seq).filter((s) => s.action !== "scroll");
  const out: RawStep[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    const sameTarget = prev !== undefined && locatorKey(prev.selectors) === locatorKey(s.selectors);
    const isInput = s.action === "type" || s.action === "select";
    if (prev && sameTarget && isInput && (prev.action === s.action || prev.action === "click")) {
      out[out.length - 1] = s;
      continue;
    }
    if (prev && s.action === "navigate" && prev.action === "navigate" && prev.url === s.url) continue;
    out.push(s);
  }
  return out;
}

const VERB: Record<Exclude<WorkflowAction, "navigate">, string> = {
  click: "Click",
  type: "Type into",
  select: "Select in",
  submit: "Submit",
};

export interface CompileOptions {
  now: number;
  newId?: () => string;
}

export function compileRecording(rec: Recording, rawSteps: RawStep[], opts: CompileOptions): Workflow {
  const newId = opts.newId ?? randomUUID;
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
    const expected =
      next && (action === "navigate" || urlPath(next.url) !== urlPath(s.url)) ? { urlPath: urlPath(next.url) } : {};

    if (action === "navigate") {
      out.push({ id: newId(), name: `Open ${s.url}`, action, url: s.url, fallbacks: [], framePath: s.framePath, expected });
      return;
    }

    const [locator, ...fallbacks] = chooseLocators(s.selectors);
    const target = locator ? describeLocator(locator) : "unknown element";
    let param: string | undefined;
    if (action === "type" || action === "select") {
      param = `param_${params.length + 1}`;
      const hidden = s.value === undefined || s.value.includes("[REDACTED");
      params.push({
        name: param,
        description: `Value for ${target}`,
        required: true,
        secret: Boolean(s.isPassword),
        ...(hidden ? {} : { example: s.value }),
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

import { type Chunk, chooseLocator, locatorChunks, urlChunks } from "./export/shared.js";
import type { Locator, ParamDef, Workflow, WorkflowAction, WorkflowStep } from "./types.js";

export class MissingParamError extends Error {
  constructor(readonly param: string) {
    super(`Missing parameter: ${param}`);
    this.name = "MissingParamError";
  }
}

export type ParamValues = Record<string, string>;

export function checkParamValues(w: Workflow, input: unknown): ParamValues {
  const raw = input ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Parameters must be a JSON object");
  const declared = new Set(w.params.map((p) => p.name));
  const values: ParamValues = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!declared.has(name)) throw new Error(`Unknown parameter: ${name}`);
    if (typeof value !== "string") throw new Error(`Parameter ${name} must be a string`);
    values[name] = value;
  }
  for (const p of w.params) {
    if (p.required && !Object.hasOwn(values, p.name)) throw new MissingParamError(p.name);
  }
  return values;
}

function fill(chunks: Chunk[], values: ParamValues, encode: boolean): string {
  return chunks
    .map((c) => {
      if ("text" in c) return c.text;
      if (!Object.hasOwn(values, c.param)) throw new MissingParamError(c.param);
      return encode ? encodeURIComponent(values[c.param]!) : values[c.param]!;
    })
    .join("");
}

export interface ResolvedAction {
  skip: false;
  action: WorkflowAction;
  /** Primary first. Role names hold the run-time values. Empty for navigate steps. */
  locators: Locator[];
  framePath: number[];
  url?: string;
  value?: string;
  expectedUrl?: string;
}

export type ResolvedStep = { skip: true; reason: string } | ResolvedAction;

const isInput = (s: WorkflowStep): boolean => s.action === "type" || s.action === "select";

/** Same rules as the exporters: params only fill role names and URLs; a fallback that needs a missing param is dropped. */
export function resolveStep(s: WorkflowStep, params: ParamDef[], values: ParamValues): ResolvedStep {
  if (isInput(s)) {
    const def = params.find((p) => p.name === s.param);
    if (!def) throw new Error(`Step "${s.name}" needs a parameter`);
    if (!Object.hasOwn(values, def.name)) {
      if (def.required) throw new MissingParamError(def.name);
      return { skip: true, reason: `optional parameter ${def.name} not given` };
    }
  }
  const primary = chooseLocator(s, params);
  const others = [s.locator, ...s.fallbacks].filter((l): l is Locator => l !== undefined && l !== primary);
  const locators: Locator[] = [];
  for (const [i, l] of (primary ? [primary, ...others] : []).entries()) {
    try {
      locators.push(l.kind === "role" ? { ...l, name: fill(locatorChunks(l, params), values, false) } : l);
    } catch (err) {
      if (i === 0 || !(err instanceof MissingParamError)) throw err;
    }
  }
  return {
    skip: false,
    action: s.action,
    locators,
    framePath: s.framePath,
    ...(s.action === "navigate" && s.url ? { url: fill(urlChunks(s.url, params), values, true) } : {}),
    ...(isInput(s) ? { value: values[s.param!] } : {}),
    ...(s.expected.urlPath ? { expectedUrl: fill(urlChunks(s.expected.urlPath, params), values, true) } : {}),
  };
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Same origin and same decoded path segments; query and fragment are ignored. */
export function urlPathMatches(actual: string, expected: string): boolean {
  let a: URL;
  let e: URL;
  try {
    a = new URL(actual);
    e = new URL(expected);
  } catch {
    return actual === expected;
  }
  const x = a.pathname.split("/").map(decode);
  const y = e.pathname.split("/").map(decode);
  return a.origin === e.origin && x.length === y.length && x.every((seg, i) => seg === y[i]);
}

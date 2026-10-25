import { describeLocator, urlPath } from "./compile.js";
import { downstreamParams } from "./export/shared.js";
import type { LlmClient } from "./llm.js";
import { redactText } from "./redact.js";
import type { Workflow } from "./types.js";

export interface SkeletonStep {
  index: number;
  action: string;
  target?: string;
  url?: string;
  param?: string;
}

export interface Skeleton {
  workflowName: string;
  params: string[];
  steps: SkeletonStep[];
}

type Scrubber = (text: string) => string;

function exampleScrubber(w: Workflow): Scrubber {
  const pairs: [RegExp, string][] = [];
  for (const p of w.params) {
    const terms = new Set([...(p.secret || p.example === undefined ? [] : [p.example]), ...(p.scrubTerms ?? [])]);
    for (const term of terms) {
      if (term.length < 3) continue;
      const encoded = encodeURIComponent(term);
      for (const form of new Set([term, encoded, encoded.replace(/%20/g, "+")])) {
        pairs.push([new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), `{${p.name}}`]);
      }
    }
  }
  pairs.sort((a, b) => b[0].source.length - a[0].source.length);
  return (text) => pairs.reduce((out, [pattern, placeholder]) => out.replace(pattern, () => placeholder), text);
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{16,})$/i;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " "));
  } catch {
    return segment;
  }
}

/**
 * Scheme and port are kept verbatim; the host is scrubbed and redacted. The whole decoded path is
 * scrubbed before it is split, so values containing "/" are caught; segments are then ID-generalized and redacted.
 */
function skeletonUrl(url: string, scrub: Scrubber): string {
  const base = urlPath(url).split(/[?#]/, 1)[0]!;
  const [origin = "", scheme = "", host = "", port = ""] =
    /^([a-z][a-z0-9+.-]*:\/\/)(\[[^\]]*\]|[^/:]*)(:\d*)?/i.exec(base) ?? [];
  const hostname = host.startsWith("[") ? host : redactText(scrub(host));
  const decodedPath = base.slice(origin.length).split("/").map(decodeSegment).join("/");
  const path = scrub(decodedPath)
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : encodeURIComponent(redactText(segment))))
    .join("/");
  return scheme + hostname + port + path;
}

export function buildSkeleton(w: Workflow): Skeleton {
  const scrub = exampleScrubber(w);
  return {
    workflowName: redactText(scrub(w.name)),
    params: w.params.map((p) => p.name),
    steps: w.steps.map((s, index) => ({
      index,
      action: s.action,
      ...(s.locator ? { target: redactText(scrub(describeLocator(s.locator))) } : {}),
      ...(s.url ? { url: skeletonUrl(s.url, scrub) } : {}),
      ...(s.param ? { param: s.param } : {}),
    })),
  };
}

const SYSTEM_PROMPT = `You name browser automation workflows.
You receive a JSON skeleton of a recorded workflow: step actions, target elements, page URLs, and placeholder parameter names (param_1, param_2, ...). You never see the values.
Reply with only a JSON object of this shape:
{"name": string, "description": string, "steps": [{"index": number, "name": string}], "params": [{"from": string, "name": string, "description": string, "required": boolean}]}
Rules:
- "name": short imperative title, max 60 characters.
- "description": one sentence describing what the workflow accomplishes.
- "steps": a short human-readable name for each step index.
- "params": one entry per placeholder; "from" is the placeholder, "name" is snake_case matching ^[a-z][a-z0-9_]{0,39}$, all names unique.`;

export function buildEnrichmentPayload(w: Workflow): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: JSON.stringify(buildSkeleton(w), null, 2) };
}

export interface Enrichment {
  name: string;
  description: string;
  steps: { index: number; name: string }[];
  params: { from: string; name: string; description: string; required: boolean }[];
}

const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const STEP_NAME_MAX = 120;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first `{` paired with the last `}` that yields valid JSON, so trailing prose with braces is tolerated. */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start >= 0) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }
  throw new Error("no JSON object in LLM response");
}

export function parseEnrichment(text: string): Enrichment {
  const v = parseJsonObject(text);
  if (!isRecord(v) || typeof v.name !== "string" || typeof v.description !== "string" || !Array.isArray(v.steps) || !Array.isArray(v.params)) {
    throw new Error("enrichment has wrong shape");
  }
  const steps = v.steps.map((s: unknown) => {
    if (!isRecord(s) || typeof s.index !== "number" || typeof s.name !== "string") throw new Error(`invalid step ${JSON.stringify(s)}`);
    return { index: s.index, name: s.name.trim().slice(0, STEP_NAME_MAX) };
  });
  const params = v.params.map((p: unknown) => {
    if (
      !isRecord(p) ||
      typeof p.from !== "string" ||
      typeof p.name !== "string" ||
      !PARAM_NAME.test(p.name) ||
      typeof p.description !== "string" ||
      typeof p.required !== "boolean"
    ) {
      throw new Error(`invalid param ${JSON.stringify(p)}`);
    }
    return { from: p.from, name: p.name, description: p.description.trim().slice(0, DESCRIPTION_MAX), required: p.required };
  });
  const names = params.map((p) => p.name);
  if (new Set(names).size !== names.length) throw new Error("duplicate param names");
  const froms = params.map((p) => p.from);
  if (new Set(froms).size !== froms.length) throw new Error("duplicate placeholders");
  return { name: v.name.trim().slice(0, NAME_MAX), description: v.description.trim().slice(0, DESCRIPTION_MAX), steps, params };
}

/** Params that must stay required: secrets, and params whose value is needed outside their own input step. */
export function lockedRequiredParams(w: Workflow): Set<string> {
  const locked = downstreamParams(w);
  for (const p of w.params) if (p.secret) locked.add(p.name);
  return locked;
}

export function applyEnrichment(w: Workflow, e: Enrichment): Workflow {
  const locked = lockedRequiredParams(w);
  const rename = new Map(e.params.map((p) => [p.from, p]));
  const params = w.params.map((p) => {
    const r = rename.get(p.name);
    return r ? { ...p, name: r.name, description: r.description, required: locked.has(p.name) ? true : r.required } : p;
  });
  if (new Set(params.map((p) => p.name)).size !== params.length) {
    throw new Error("enrichment produced duplicate param names");
  }
  const steps = w.steps.map((s, i) => {
    const newName = e.steps.find((x) => x.index === i)?.name.trim();
    const r = s.param ? rename.get(s.param) : undefined;
    return { ...s, name: newName || s.name, ...(r ? { param: r.name } : {}) };
  });
  return { ...w, name: e.name.trim() || w.name, description: e.description.trim() || w.description, params, steps };
}

export async function enrichWorkflow(
  w: Workflow,
  client: LlmClient,
): Promise<{ workflow: Workflow; enriched: boolean; error?: string }> {
  try {
    const { system, user } = buildEnrichmentPayload(w);
    const reply = await client.complete(system, user);
    return { workflow: applyEnrichment(w, parseEnrichment(reply)), enriched: true };
  } catch (err) {
    return { workflow: w, enriched: false, error: String(err) };
  }
}

import { describeLocator, urlPath } from "./compile.js";
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
  const pairs: [string, string][] = [];
  for (const p of w.params) {
    if (p.secret || p.example === undefined || p.example.length < 3) continue;
    const placeholder = `{${p.name}}`;
    const encoded = encodeURIComponent(p.example);
    for (const form of new Set([p.example, encoded, encoded.replace(/%20/g, "+")])) pairs.push([form, placeholder]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (text) => pairs.reduce((out, [form, placeholder]) => out.split(form).join(placeholder), text);
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{16,})$/i;

function generalizeIds(url: string): string {
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(url)?.[0] ?? "";
  const path = url
    .slice(origin.length)
    .split("/")
    .map((seg) => (ID_SEGMENT.test(seg) ? ":id" : seg))
    .join("/");
  return origin + path;
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
      ...(s.url ? { url: redactText(generalizeIds(scrub(urlPath(s.url).split(/[?#]/, 1)[0]!))) } : {}),
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

export function parseEnrichment(text: string): Enrichment {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in LLM response");
  const v = JSON.parse(text.slice(start, end + 1)) as Enrichment;
  if (typeof v.name !== "string" || typeof v.description !== "string" || !Array.isArray(v.steps) || !Array.isArray(v.params)) {
    throw new Error("enrichment has wrong shape");
  }
  for (const s of v.steps) {
    if (typeof s.index !== "number" || typeof s.name !== "string") throw new Error(`invalid step ${JSON.stringify(s)}`);
  }
  for (const p of v.params) {
    if (
      typeof p.from !== "string" ||
      typeof p.name !== "string" ||
      !PARAM_NAME.test(p.name) ||
      typeof p.description !== "string" ||
      typeof p.required !== "boolean"
    ) {
      throw new Error(`invalid param ${JSON.stringify(p)}`);
    }
  }
  const names = v.params.map((p) => p.name);
  if (new Set(names).size !== names.length) throw new Error("duplicate param names");
  return v;
}

export function applyEnrichment(w: Workflow, e: Enrichment): Workflow {
  const rename = new Map(e.params.map((p) => [p.from, p]));
  const params = w.params.map((p) => {
    const r = rename.get(p.name);
    return r ? { ...p, name: r.name, description: r.description, required: p.secret ? true : r.required } : p;
  });
  if (new Set(params.map((p) => p.name)).size !== params.length) {
    throw new Error("enrichment produced duplicate param names");
  }
  const steps = w.steps.map((s, i) => {
    const newName = e.steps.find((x) => x.index === i)?.name.trim();
    const r = s.param ? rename.get(s.param) : undefined;
    return { ...s, name: newName || s.name, ...(r ? { param: r.name } : {}) };
  });
  return { ...w, name: e.name.trim() || w.name, description: e.description.trim(), params, steps };
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

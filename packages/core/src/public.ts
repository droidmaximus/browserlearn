import { chunksText, textChunks } from "./export/shared.js";
import { type JsonSchemaObject, paramsToJsonSchema } from "./schema.js";
import type { Locator, ParamDef, Workflow, WorkflowStep } from "./types.js";

export interface PublicParam {
  name: string;
  description: string;
  required: boolean;
  secret: boolean;
  example?: string;
}

export interface PublicWorkflow extends Omit<Workflow, "params" | "exposeExamples"> {
  params: PublicParam[];
}

export interface WorkflowSummary {
  name: string;
  description: string;
  version: number;
  inputSchema: JsonSchemaObject;
}

const placeholder = (name: string): string => `{${name}}`;

/** Every text to hide, as pseudo-params: scrub terms always, examples unless exposed, each also URL-encoded. */
function hiddenTexts(w: Workflow): ParamDef[] {
  return w.params.flatMap((p) => {
    const terms = [...(w.exposeExamples || p.secret || p.example === undefined ? [] : [p.example]), ...(p.scrubTerms ?? [])];
    return terms.flatMap((term) => {
      const encoded = encodeURIComponent(term);
      return [...new Set([term, encoded, encoded.replace(/%20/g, "+")])].map((form) => ({ ...p, example: form, secret: false }));
    });
  });
}

const hideText = (text: string, hidden: ParamDef[]): string => chunksText(textChunks(text, hidden), placeholder);

function hideLocator(l: Locator, hidden: ParamDef[]): Locator {
  switch (l.kind) {
    case "testId":
      return { ...l, testId: hideText(l.testId, hidden) };
    case "role":
      return { ...l, name: hideText(l.name, hidden) };
    case "css":
      return { ...l, css: hideText(l.css, hidden) };
    case "xpath":
      return { ...l, xpath: hideText(l.xpath, hidden) };
  }
}

function hideStep(s: WorkflowStep, hidden: ParamDef[]): WorkflowStep {
  return {
    ...s,
    name: hideText(s.name, hidden),
    ...(s.locator ? { locator: hideLocator(s.locator, hidden) } : {}),
    fallbacks: s.fallbacks.map((l) => hideLocator(l, hidden)),
    ...(s.url ? { url: hideText(s.url, hidden) } : {}),
    expected: s.expected.urlPath ? { ...s.expected, urlPath: hideText(s.expected.urlPath, hidden) } : s.expected,
  };
}

/**
 * The workflow as MCP clients may see it: no scrub terms, and no recorded examples unless the workflow
 * exposes them. Typed values are substring-replaced in names, descriptions, every locator string, and URLs.
 */
export function toPublicWorkflow(w: Workflow): PublicWorkflow {
  const hidden = hiddenTexts(w);
  const { exposeExamples: _expose, params, ...rest } = w;
  return {
    ...rest,
    name: hideText(w.name, hidden),
    description: hideText(w.description, hidden),
    params: params.map((p) => ({
      name: p.name,
      description: hideText(p.description, hidden),
      required: p.required,
      secret: p.secret,
      ...(w.exposeExamples && !p.secret && p.example !== undefined ? { example: p.example } : {}),
    })),
    steps: w.steps.map((s) => hideStep(s, hidden)),
  };
}

export function workflowSummary(w: Workflow): WorkflowSummary {
  const p = toPublicWorkflow(w);
  return {
    name: p.name,
    description: p.description,
    version: w.version,
    inputSchema: paramsToJsonSchema(p.params, { includeExamples: true }),
  };
}

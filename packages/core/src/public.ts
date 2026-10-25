import { chunksText, textChunks, urlChunks } from "./export/shared.js";
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
const hideUrl = (url: string, hidden: ParamDef[]): string => chunksText(urlChunks(url, hidden), placeholder);
const hideLocator = (l: Locator, hidden: ParamDef[]): Locator =>
  l.kind === "role" ? { ...l, name: hideText(l.name, hidden) } : l;

function hideStep(s: WorkflowStep, hidden: ParamDef[]): WorkflowStep {
  return {
    ...s,
    name: hideText(s.name, hidden),
    ...(s.locator ? { locator: hideLocator(s.locator, hidden) } : {}),
    fallbacks: s.fallbacks.map((l) => hideLocator(l, hidden)),
    ...(s.url ? { url: hideUrl(s.url, hidden) } : {}),
    expected: s.expected.urlPath ? { ...s.expected, urlPath: hideUrl(s.expected.urlPath, hidden) } : s.expected,
  };
}

/**
 * The workflow as MCP clients may see it: no scrub terms, and no recorded examples unless the workflow
 * exposes them. Test ids, CSS and XPath locators are left as recorded.
 */
export function toPublicWorkflow(w: Workflow): PublicWorkflow {
  const hidden = hiddenTexts(w);
  const { exposeExamples: _expose, params, ...rest } = w;
  return {
    ...rest,
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
  return {
    name: w.name,
    description: w.description,
    version: w.version,
    inputSchema: paramsToJsonSchema(toPublicWorkflow(w).params, { includeExamples: true }),
  };
}

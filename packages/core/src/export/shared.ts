import type { Locator, ParamDef, Workflow, WorkflowStep } from "../types.js";

export const q = (s: string): string => JSON.stringify(s);
export const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

export const paramRef = (name: string): string => `params[${q(name)}]`;

/** A literal piece of text, or a position that holds a param's runtime value. */
export type Chunk = { text: string } | { param: string };

const substitutable = (params: ParamDef[]): { name: string; example: string }[] =>
  params.flatMap((p) => (!p.secret && p.example !== undefined && p.example.length >= 3 ? [{ name: p.name, example: p.example }] : []));

function wholeMatch(value: string, params: ParamDef[]): string | undefined {
  return substitutable(params).find((p) => p.example === value)?.name;
}

function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}

/** Splits a URL so that whole path segments and whole query values equal to an example become params. */
export function urlChunks(url: string, params: ParamDef[]): Chunk[] {
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0];
  try {
    new URL(url);
  } catch {
    return [{ text: url }];
  }
  if (origin === undefined) return [{ text: url }];
  const chunks: Chunk[] = [{ text: origin }];
  const rest = url.slice(origin.length);
  const hashAt = rest.indexOf("#");
  const beforeHash = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : rest.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? undefined : beforeHash.slice(queryAt + 1);

  path.split("/").forEach((segment, i) => {
    if (i > 0) chunks.push({ text: "/" });
    const decoded = safeDecode(segment);
    const param = decoded === undefined ? undefined : wholeMatch(decoded, params);
    chunks.push(param ? { param } : { text: segment });
  });
  if (query !== undefined) {
    chunks.push({ text: "?" });
    query.split("&").forEach((pair, i) => {
      if (i > 0) chunks.push({ text: "&" });
      const eq = pair.indexOf("=");
      if (eq === -1) {
        chunks.push({ text: pair });
        return;
      }
      const decoded = safeDecode(pair.slice(eq + 1).replace(/\+/g, " "));
      const param = decoded === undefined ? undefined : wholeMatch(decoded, params);
      chunks.push({ text: pair.slice(0, eq + 1) }, param ? { param } : { text: pair.slice(eq + 1) });
    });
  }
  chunks.push({ text: hash });
  return chunks;
}

/** Splits text at exact, case-sensitive occurrences of examples (longest first). */
export function textChunks(text: string, params: ParamDef[]): Chunk[] {
  const subs = substitutable(params).sort((a, b) => b.example.length - a.example.length);
  const chunks: Chunk[] = [];
  let literal = "";
  for (let i = 0; i < text.length; ) {
    const hit = subs.find((p) => text.startsWith(p.example, i));
    if (!hit) {
      literal += text[i];
      i++;
      continue;
    }
    if (literal) chunks.push({ text: literal });
    literal = "";
    chunks.push({ param: hit.name });
    i += hit.example.length;
  }
  if (literal || chunks.length === 0) chunks.push({ text: literal });
  return chunks;
}

function merge(chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = [];
  for (const c of chunks) {
    const prev = out[out.length - 1];
    if ("text" in c && prev && "text" in prev) out[out.length - 1] = { text: prev.text + c.text };
    else if (!("text" in c) || c.text) out.push(c);
  }
  return out.length ? out : [{ text: "" }];
}

/** A JS expression concatenating literal chunks with param references. */
export function chunksExpr(chunks: Chunk[], ref: (name: string) => string = paramRef): string {
  return merge(chunks)
    .map((c) => ("text" in c ? q(c.text) : ref(c.param)))
    .join(" + ");
}

export function chunksText(chunks: Chunk[], placeholder: (name: string) => string): string {
  return merge(chunks)
    .map((c) => ("text" in c ? c.text : placeholder(c.param)))
    .join("");
}

export const chunkParams = (chunks: Chunk[]): string[] => chunks.flatMap((c) => ("param" in c ? [c.param] : []));

export const urlExpr = (url: string, params: ParamDef[]): string =>
  chunksExpr(urlChunks(url, params), (name) => `encodeURIComponent(${paramRef(name)})`);

export function locatorText(l: Locator): string {
  switch (l.kind) {
    case "testId":
      return l.testId;
    case "role":
      return l.name;
    case "css":
      return l.css;
    case "xpath":
      return l.xpath;
  }
}

/** Step comment: navigate URLs show `{name}` in substituted positions; names also hide examples substituted in the step's locator. */
export function stepComment(s: WorkflowStep, params: ParamDef[]): string {
  if (s.action === "navigate") return oneLine(`Open ${chunksText(urlChunks(s.url ?? "", params), (n) => `{${n}}`)}`);
  if (!s.locator) return oneLine(s.name);
  const used = new Set(chunkParams(textChunks(locatorText(s.locator), params)));
  const locatorSubs = params.filter((p) => used.has(p.name));
  return oneLine(chunksText(textChunks(s.name, locatorSubs), (n) => `{${n}}`));
}

export const noLocatorLine = (s: WorkflowStep): string =>
  `  throw new Error(${q(`Step "${oneLine(s.name)}" has no locator`)});`;

/** Throws if a type/select step does not reference a declared param. */
export function checkStepParams(w: Workflow): void {
  const declared = new Set(w.params.map((p) => p.name));
  for (const s of w.steps) {
    if ((s.action === "type" || s.action === "select") && !(s.param && declared.has(s.param))) {
      throw new Error(`Step "${s.name}" needs a parameter`);
    }
  }
}

export function scriptHeader(w: Workflow, importLine: string): string {
  return [
    importLine,
    ``,
    `// Generated by BrowserLearn from workflow ${q(oneLine(w.name))} v${w.version}`,
    `// Usage: node workflow.mjs '{"param": "value"}'`,
    paramsPreamble(w),
  ].join("\n");
}

export function paramsPreamble(w: Workflow): string {
  const required = JSON.stringify(w.params.filter((p) => p.required).map((p) => p.name));
  return [
    `const params = JSON.parse(process.argv[2] ?? "{}");`,
    `if (typeof params !== "object" || params === null || Array.isArray(params)) {`,
    `  throw new Error("Parameters must be a JSON object");`,
    `}`,
    `for (const name of ${required}) {`,
    "  if (!Object.hasOwn(params, name)) throw new Error(`Missing parameter: ${name}`);",
    `}`,
    `for (const [name, value] of Object.entries(params)) {`,
    "  if (typeof value !== \"string\") throw new Error(`Parameter ${name} must be a string`);",
    `}`,
  ].join("\n");
}

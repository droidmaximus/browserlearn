import type { Locator, ParamDef, Workflow, WorkflowStep } from "../types.js";
import {
  checkStepParams,
  chunkParams,
  chunksText,
  locatorText,
  noLocatorLine,
  paramRef,
  q,
  scriptHeader,
  stepComment,
  textChunks,
  urlExpr,
} from "./shared.js";

function describeTarget(l: Locator, text: string): string {
  switch (l.kind) {
    case "testId":
      return `element with test id "${text}"`;
    case "role":
      return `"${text}" ${l.role}`;
    case "css":
      return `element matching "${text}"`;
    case "xpath":
      return `element at xpath "${text}"`;
  }
}

/** The act() target, with examples in the locator text replaced by `%name%` variables. */
function actTarget(l: Locator, params: ParamDef[]): { target: string; vars: string[] } {
  const chunks = textChunks(locatorText(l), params);
  return { target: describeTarget(l, chunksText(chunks, (name) => `%${name}%`)), vars: chunkParams(chunks) };
}

const EXPECT_URL = [
  `async function expectUrl(expected) {`,
  `  const deadline = Date.now() + 10_000;`,
  `  for (;;) {`,
  `    const current = await page.url();`,
  `    const u = new URL(current);`,
  `    if (u.origin + u.pathname === expected) return;`,
  "    if (Date.now() >= deadline) throw new Error(`Expected URL ${expected}, got ${current}`);",
  `    await new Promise((resolve) => setTimeout(resolve, 100));`,
  `  }`,
  `}`,
];

function actionLine(s: WorkflowStep, params: ParamDef[]): string {
  if (s.action === "navigate") return `  await page.goto(${urlExpr(s.url ?? "", params)});`;
  if (!s.locator) return noLocatorLine(s);
  const { target, vars } = actTarget(s.locator, params);
  const names = [...new Set([...(s.param ? [s.param] : []), ...vars])];
  const variables = names.length
    ? `, { variables: { ${names.map((n) => `${q(n)}: ${paramRef(n)}`).join(", ")} } }`
    : "";
  const instruction = {
    click: `click the ${target}`,
    type: `type %${s.param}% into the ${target}`,
    select: `select %${s.param}% in the ${target}`,
    submit: `submit the ${target}`,
  }[s.action];
  return `  await stagehand.act(${q(instruction)}${variables});`;
}

function stepLines(s: WorkflowStep, params: ParamDef[]): string[] {
  const out = [`  // ${stepComment(s, params)}`, actionLine(s, params)];
  if (s.expected.urlPath) out.push(`  await expectUrl(${urlExpr(s.expected.urlPath, params)});`);
  return out;
}

export function exportStagehand(w: Workflow): string {
  checkStepParams(w);
  return [
    scriptHeader(w, `import { Stagehand } from "@browserbasehq/stagehand";`),
    ``,
    ...EXPECT_URL,
    ``,
    `const stagehand = new Stagehand({ env: "LOCAL" });`,
    `await stagehand.init();`,
    `const page = stagehand.context.pages()[0];`,
    `try {`,
    ...w.steps.flatMap((s) => stepLines(s, w.params)),
    `} finally {`,
    `  await stagehand.close();`,
    `}`,
    ``,
  ].join("\n");
}

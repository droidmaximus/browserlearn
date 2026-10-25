import type { Locator, ParamDef, Workflow, WorkflowStep } from "../types.js";
import {
  checkStepParams,
  chooseLocator,
  type Chunk,
  chunkParams,
  chunksExpr,
  locatorChunks,
  neededRef,
  noLocatorLine,
  oneLine,
  paramRef,
  q,
  scriptHeader,
  skipUnlessGiven,
  stepComment,
  urlExpr,
} from "./shared.js";

/** The act() target; role names may hold params, which are filled in from `params` at run time. */
function actTarget(l: Locator, params: ParamDef[]): Chunk[] {
  const text = locatorChunks(l, params);
  switch (l.kind) {
    case "testId":
      return [{ text: `element with test id "` }, ...text, { text: `"` }];
    case "role":
      return [{ text: `"` }, ...text, { text: `" ${l.role}` }];
    case "css":
      return [{ text: `element matching "` }, ...text, { text: `"` }];
    case "xpath":
      return [{ text: `element at xpath "` }, ...text, { text: `"` }];
  }
}

const EXPECT_URL = [
  `async function expectUrl(expected) {`,
  `  const deadline = Date.now() + 10_000;`,
  `  for (;;) {`,
  `    const current = await page.url();`,
  `    if (urlPathMatches(current, expected)) return;`,
  "    if (Date.now() >= deadline) throw new Error(`Expected URL ${expected}, got ${current}`);",
  `    await new Promise((resolve) => setTimeout(resolve, 100));`,
  `  }`,
  `}`,
];

const ACT_TEXT = [`function actText(value) {`, `  return String(value).replace(/["%]/g, "");`, `}`];

function actionLines(s: WorkflowStep, params: ParamDef[]): string[] {
  if (s.action === "navigate") return [`  await page.goto(${urlExpr(s.url ?? "", params)});`];
  const locator = chooseLocator(s, params);
  if (!locator) return [noLocatorLine(s)];
  const target = actTarget(locator, params);
  const verb = {
    click: `click the `,
    type: `type %${s.param}% into the `,
    select: `select %${s.param}% in the `,
    submit: `submit the `,
  }[s.action];
  const variables = s.param ? `, { variables: { ${q(s.param)}: ${paramRef(s.param)} } }` : "";
  const notices = [...new Set(chunkParams(target))].map(
    (name) => `  // Sends the value of ${oneLine(name)} to your LLM provider at run time`,
  );
  const ref = (name: string): string => `actText(${neededRef(params)(name)})`;
  return [...notices, `  await stagehand.act(${chunksExpr([{ text: verb }, ...target], ref)}${variables});`];
}

function stepLines(s: WorkflowStep, params: ParamDef[]): string[] {
  const body = actionLines(s, params);
  if (s.expected.urlPath) body.push(`  await expectUrl(${urlExpr(s.expected.urlPath, params)});`);
  return [`  // ${stepComment(s, params)}`, ...skipUnlessGiven(s, params, body)];
}

export function exportStagehand(w: Workflow): string {
  checkStepParams(w);
  return [
    scriptHeader(w, `import { Stagehand } from "@browserbasehq/stagehand";`),
    `// Stagehand calls an LLM for every act(): set your provider's API key (for example OPENAI_API_KEY) before running.`,
    ``,
    ...EXPECT_URL,
    ``,
    ...ACT_TEXT,
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

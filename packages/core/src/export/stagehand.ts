import type { Locator, ParamDef, Workflow, WorkflowStep } from "../types.js";
import { checkStepParams, commentText, noLocatorLine, paramRef, q, scriptHeader, urlExpr } from "./shared.js";

function actTarget(l: Locator): string {
  switch (l.kind) {
    case "testId":
      return `element with test id "${l.testId}"`;
    case "role":
      return `"${l.name}" ${l.role}`;
    case "css":
      return `element matching "${l.css}"`;
    case "xpath":
      return `element at xpath "${l.xpath}"`;
  }
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
  if (!s.locator) return noLocatorLine(s, params);
  const target = actTarget(s.locator);
  const vars = s.param ? `, { variables: { ${q(s.param)}: ${paramRef(s.param)} } }` : "";
  const instruction = {
    click: `click the ${target}`,
    type: `type %${s.param}% into the ${target}`,
    select: `select %${s.param}% in the ${target}`,
    submit: `submit the ${target}`,
  }[s.action];
  return `  await stagehand.act(${q(instruction)}${vars});`;
}

function stepLines(s: WorkflowStep, params: ParamDef[]): string[] {
  const out = [`  // ${commentText(s.name, params)}`, actionLine(s, params)];
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

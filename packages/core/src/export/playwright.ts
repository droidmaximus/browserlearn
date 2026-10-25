import type { Locator, ParamDef, Workflow, WorkflowStep } from "../types.js";
import {
  checkStepParams,
  chooseLocator,
  chunksExpr,
  neededRef,
  noLocatorLine,
  paramRef,
  q,
  scriptHeader,
  skipUnlessGiven,
  stepComment,
  textChunks,
  urlExpr,
} from "./shared.js";

/** Params are substituted only inside role names; other locator text stays literal. */
export function locatorExpr(l: Locator, framePath: number[], params: ParamDef[] = []): string {
  const base = framePath.reduce((acc, i) => `${acc}.frameLocator(${q(`iframe >> nth=${i}`)})`, "page");
  switch (l.kind) {
    case "testId":
      return `${base}.getByTestId(${q(l.testId)})`;
    case "role":
      return `${base}.getByRole(${q(l.role)}, { name: ${chunksExpr(textChunks(l.name, params), neededRef(params))}, exact: true })`;
    case "css":
      return `${base}.locator(${q(l.css)})`;
    case "xpath":
      return `${base}.locator(${q(`xpath=${l.xpath}`)})`;
  }
}

function actionLines(s: WorkflowStep, params: ParamDef[]): string[] {
  const out: string[] = [];
  const value = paramRef(s.param ?? "");
  const locator = chooseLocator(s, params);
  if (s.action === "navigate") {
    out.push(`  await page.goto(${urlExpr(s.url ?? "", params)});`);
  } else if (!locator) {
    out.push(noLocatorLine(s));
  } else {
    const loc = locatorExpr(locator, s.framePath, params);
    if (s.action === "click") out.push(`  await ${loc}.click();`);
    if (s.action === "type") out.push(`  await ${loc}.fill(${value});`);
    if (s.action === "select") out.push(`  await ${loc}.selectOption(${value});`);
    if (s.action === "submit") out.push(`  await ${loc}.evaluate((el) => (el instanceof HTMLFormElement ? el : el.closest("form"))?.requestSubmit());`);
  }
  if (s.expected.urlPath) {
    out.push(`  await page.waitForURL((u) => urlPathMatches(u.href, ${urlExpr(s.expected.urlPath, params)}));`);
  }
  return out;
}

function stepLines(s: WorkflowStep, params: ParamDef[]): string[] {
  return [`  // ${stepComment(s, params)}`, ...skipUnlessGiven(s, params, actionLines(s, params))];
}

export function exportPlaywright(w: Workflow): string {
  checkStepParams(w);
  return [
    scriptHeader(w, `import { chromium } from "playwright";`),
    ``,
    `// Set HEADLESS=1 to run without a visible browser window.`,
    `const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" });`,
    `const page = await browser.newPage();`,
    `try {`,
    ...w.steps.flatMap((s) => stepLines(s, w.params)),
    `} finally {`,
    `  await browser.close();`,
    `}`,
    ``,
  ].join("\n");
}

import type { Locator, ParamDef, Workflow, WorkflowStep } from "../types.js";
import { checkStepParams, commentText, noLocatorLine, paramRef, q, scriptHeader, urlExpr } from "./shared.js";

export function locatorExpr(l: Locator, framePath: number[]): string {
  const base = framePath.reduce((acc, i) => `${acc}.frameLocator(${q(`iframe >> nth=${i}`)})`, "page");
  switch (l.kind) {
    case "testId":
      return `${base}.getByTestId(${q(l.testId)})`;
    case "role":
      return `${base}.getByRole(${q(l.role)}, { name: ${q(l.name)}, exact: true })`;
    case "css":
      return `${base}.locator(${q(l.css)})`;
    case "xpath":
      return `${base}.locator(${q(`xpath=${l.xpath}`)})`;
  }
}

function stepLines(s: WorkflowStep, params: ParamDef[]): string[] {
  const out = [`  // ${commentText(s.name, params)}`];
  const value = paramRef(s.param ?? "");
  if (s.action === "navigate") {
    out.push(`  await page.goto(${urlExpr(s.url ?? "", params)});`);
  } else if (!s.locator) {
    out.push(noLocatorLine(s, params));
  } else {
    const loc = locatorExpr(s.locator, s.framePath);
    if (s.action === "click") out.push(`  await ${loc}.click();`);
    if (s.action === "type") out.push(`  await ${loc}.fill(${value});`);
    if (s.action === "select") out.push(`  await ${loc}.selectOption(${value});`);
    if (s.action === "submit") out.push(`  await ${loc}.evaluate((form) => form.requestSubmit());`);
  }
  if (s.expected.urlPath) {
    out.push(`  await page.waitForURL((u) => u.origin + u.pathname === ${urlExpr(s.expected.urlPath, params)});`);
  }
  return out;
}

export function exportPlaywright(w: Workflow): string {
  checkStepParams(w);
  return [
    scriptHeader(w, `import { chromium } from "playwright";`),
    ``,
    `const browser = await chromium.launch({ headless: false });`,
    `const page = await browser.newPage();`,
    `try {`,
    ...w.steps.flatMap((s) => stepLines(s, w.params)),
    `} finally {`,
    `  await browser.close();`,
    `}`,
    ``,
  ].join("\n");
}

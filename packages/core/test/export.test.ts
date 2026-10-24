import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlaywright, locatorExpr } from "../src/export/playwright.js";
import { exportStagehand } from "../src/export/stagehand.js";
import { compiledFixture } from "./fixtures.js";

function assertValidModule(source: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "bl-export-")), "workflow.mjs");
  writeFileSync(file, source);
  execFileSync(process.execPath, ["--check", file]);
}

describe("locatorExpr", () => {
  it("builds Playwright locators, including nested frames", () => {
    expect(locatorExpr({ kind: "testId", testId: "go" }, [])).toBe('page.getByTestId("go")');
    expect(locatorExpr({ kind: "role", role: "button", name: "Save" }, [])).toBe(
      'page.getByRole("button", { name: "Save", exact: true })',
    );
    expect(locatorExpr({ kind: "css", css: "#a" }, [1, 0])).toBe(
      'page.frameLocator("iframe >> nth=1").frameLocator("iframe >> nth=0").locator("#a")',
    );
    expect(locatorExpr({ kind: "xpath", xpath: "//b" }, [])).toBe('page.locator("xpath=//b")');
  });
});

describe("exportPlaywright", () => {
  it("emits a runnable script with params, steps, and URL checks", () => {
    const src = exportPlaywright(compiledFixture());
    expect(src).toContain('import { chromium } from "playwright";');
    expect(src).toContain('for (const name of ["param_1","param_2"])');
    expect(src).toContain('await page.goto("https://app.test/invoices");');
    expect(src).toContain('await page.getByTestId("new-invoice").click();');
    expect(src).toContain('await page.getByRole("textbox", { name: "Customer", exact: true }).fill(params["param_1"]);');
    expect(src).toContain('await page.waitForURL((u) => u.origin + u.pathname === "https://app.test/invoices/new");');
    assertValidModule(src);
  });
});

describe("exportStagehand", () => {
  it("emits act() instructions with variables, never raw values", () => {
    const src = exportStagehand(compiledFixture());
    expect(src).toContain('import { Stagehand } from "@browserbasehq/stagehand";');
    expect(src).toContain('await page.goto("https://app.test/invoices");');
    expect(src).toContain('await stagehand.act("click the element with test id \\"new-invoice\\"");');
    expect(src).toContain(
      'await stagehand.act("type %param_1% into the \\"Customer\\" textbox", { variables: { "param_1": params["param_1"] } });',
    );
    expect(src).not.toContain("Acme");
    assertValidModule(src);
  });
});

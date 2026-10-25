import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlaywright, locatorExpr } from "../src/export/playwright.js";
import { paramsPreamble } from "../src/export/shared.js";
import { exportStagehand } from "../src/export/stagehand.js";
import type { Workflow } from "../src/types.js";
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

  it("checks the expected URL after steps that change it", () => {
    const src = exportStagehand(compiledFixture());
    expect(src).toContain("async function expectUrl(expected)");
    expect(src).toContain('await expectUrl("https://app.test/invoices/new");');
    assertValidModule(src);
  });
});

function navWorkflow(example: string, url: string, urlPath?: string): Workflow {
  const w = compiledFixture();
  w.params = [{ name: "param_1", description: "", required: true, secret: false, example }];
  w.steps = [
    {
      id: "nav",
      name: `Open ${url}`,
      action: "navigate",
      url,
      fallbacks: [],
      framePath: [],
      expected: urlPath ? { urlPath } : {},
    },
  ];
  return w;
}

function optionWorkflow(): Workflow {
  const w = compiledFixture();
  w.steps.push(
    {
      id: "opt",
      name: 'Click option "Acme Corp"',
      action: "click",
      locator: { kind: "role", role: "option", name: "Acme Corp" },
      fallbacks: [],
      framePath: [],
      expected: {},
    },
    {
      id: "row",
      name: 'Click [data-testid="row-Acme Corp"]',
      action: "click",
      locator: { kind: "testId", testId: "row-Acme Corp" },
      fallbacks: [],
      framePath: [],
      expected: {},
    },
  );
  return w;
}

const enc = 'encodeURIComponent(params["param_1"])';

describe.each([
  ["playwright", exportPlaywright],
  ["stagehand", exportStagehand],
])("%s export of param-bearing URLs", (_name, exporter) => {
  it("substitutes exact whole path segments and query values only", () => {
    const src = exporter(navWorkflow("Acme Corp", "https://app.test/c/Acme%20Corp?q=Acme+Corp", "https://app.test/c/Acme%20Corp"));
    expect(src).not.toContain("Acme");
    expect(src).toContain(`await page.goto("https://app.test/c/" + ${enc} + "?q=" + ${enc});`);
    expect(src).toContain(`"https://app.test/c/" + ${enc})`);
    expect(src).toContain("// Open https://app.test/c/{param_1}?q={param_1}");
    assertValidModule(src);
  });

  it("never touches the host or case-mismatched segments", () => {
    expect(exporter(navWorkflow("test", "https://app.test/invoices/new"))).toContain(
      'await page.goto("https://app.test/invoices/new");',
    );
    const mismatch = exporter(navWorkflow("Acme Corp", "https://app.test/c/ACME+corp"));
    expect(mismatch).toContain('await page.goto("https://app.test/c/ACME+corp");');
    expect(mismatch).not.toContain("encodeURIComponent");
  });

  it("substitutes every whole-value query match but not partial values", () => {
    expect(exporter(navWorkflow("new", "https://app.test/s?q=new&sort=new"))).toContain(
      `await page.goto("https://app.test/s?q=" + ${enc} + "&sort=" + ${enc});`,
    );
    expect(exporter(navWorkflow("new", "https://app.test/invoices/new?q=newest"))).toContain(
      `await page.goto("https://app.test/invoices/" + ${enc} + "?q=newest");`,
    );
  });

  it("leaves unparseable URLs as a single literal", () => {
    expect(exporter(navWorkflow("Acme Corp", "not a url Acme Corp"))).toContain('await page.goto("not a url Acme Corp");');
  });

  it("leaves non-navigate step names and the header alone", () => {
    const w = navWorkflow("new", "https://app.test/");
    w.name = "Create new invoice";
    expect(exporter(w)).toContain('workflow "Create new invoice"');
  });

  it("rejects type steps without a known param at export time", () => {
    const missing = compiledFixture();
    const { param: _p, ...step } = missing.steps[2]!;
    missing.steps[2] = step;
    expect(() => exporter(missing)).toThrow('Step "Type into textbox "Customer"" needs a parameter');
    const unknown = compiledFixture();
    unknown.steps[2] = { ...unknown.steps[2]!, param: "nope" };
    expect(() => exporter(unknown)).toThrow("needs a parameter");
  });

  it("validates the params argument in the generated preamble", () => {
    const src = exporter(compiledFixture());
    expect(src).toContain("Parameters must be a JSON object");
    expect(src).toContain("must be a string");
  });
});

describe("locator text substitution", () => {
  it("references the param in Playwright locators", () => {
    const src = exportPlaywright(optionWorkflow());
    expect(src).toContain('await page.getByRole("option", { name: params["param_1"], exact: true }).click();');
    expect(src).toContain('await page.getByTestId("row-" + params["param_1"]).click();');
    expect(src).not.toContain("Acme");
    assertValidModule(src);
  });

  it("uses act() variables in Stagehand instructions", () => {
    const src = exportStagehand(optionWorkflow());
    expect(src).toContain(
      'await stagehand.act("click the \\"%param_1%\\" option", { variables: { "param_1": params["param_1"] } });',
    );
    expect(src).toContain(
      'await stagehand.act("click the element with test id \\"row-%param_1%\\"", { variables: { "param_1": params["param_1"] } });',
    );
    expect(src).not.toContain("Acme");
    assertValidModule(src);
  });
});

describe("paramsPreamble", () => {
  const run = (arg: string): string => {
    const code = `${paramsPreamble(compiledFixture())}\nconsole.log("ok");`;
    try {
      return execFileSync(process.execPath, ["--input-type=module", "-e", code, "workflow.mjs", arg], { stdio: "pipe" }).toString();
    } catch (e) {
      return String((e as { stderr: Buffer }).stderr);
    }
  };

  it("accepts complete string params and rejects bad input with clear errors", () => {
    expect(run('{"param_1":"x","param_2":"y"}')).toContain("ok");
    expect(run('{"param_1":"x"}')).toContain("Missing parameter: param_2");
    expect(run("[1]")).toContain("Parameters must be a JSON object");
    expect(run("null")).toContain("Parameters must be a JSON object");
    expect(run('{"param_1":"x","param_2":5}')).toContain("Parameter param_2 must be a string");
  });
});

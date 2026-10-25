import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlaywright, locatorExpr } from "../src/export/playwright.js";
import { paramsPreamble, URL_PATH_MATCH } from "../src/export/shared.js";
import { exportStagehand } from "../src/export/stagehand.js";
import type { Locator, ParamDef, Workflow, WorkflowStep } from "../src/types.js";
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
    expect(src).toContain('await page.waitForURL((u) => urlPathMatches(u.href, "https://app.test/invoices/new"));');
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

function clickWorkflow(example: string, locator: Locator, fallbacks: Locator[] = []): Workflow {
  const w = navWorkflow(example, "https://app.test/");
  w.steps.push({ id: "click", name: "Click target", action: "click", locator, fallbacks, framePath: [], expected: {} });
  return w;
}

const acmeOption: Locator = { kind: "role", role: "option", name: "Acme Corp" };
const acmeCss: Locator = { kind: "css", css: "[title='Acme Corp']" };

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

describe("Playwright locator params", () => {
  const roleLine = 'await page.getByRole("option", { name: params["param_1"], exact: true }).click();';

  it("substitutes inside role names", () => {
    const src = exportPlaywright(clickWorkflow("Acme Corp", acmeOption));
    expect(src).toContain(roleLine);
    expect(src).not.toContain("Acme");
    assertValidModule(src);
  });

  it("never substitutes inside testId, css or xpath", () => {
    expect(exportPlaywright(clickWorkflow("new", { kind: "testId", testId: "new-invoice" }))).toContain(
      'await page.getByTestId("new-invoice").click();',
    );
    expect(exportPlaywright(clickWorkflow("Acme Corp", acmeCss))).toContain(
      `await page.locator("[title='Acme Corp']").click();`,
    );
  });

  it("prefers a role fallback when the primary locator embeds an example", () => {
    const src = exportPlaywright(clickWorkflow("Acme Corp", acmeCss, [{ kind: "xpath", xpath: "//x" }, acmeOption]));
    expect(src).toContain(roleLine);
    expect(src).not.toContain("Acme");
    assertValidModule(src);
  });
});

describe("Stagehand runtime targets", () => {
  const actLine = 'await stagehand.act("click the \\"" + actText(params["param_1"]) + "\\" option");';
  const notice = "  // Sends the value of param_1 to your LLM provider at run time\n";

  it("builds the act() instruction from the param value at run time", () => {
    const src = exportStagehand(clickWorkflow("Acme Corp", acmeOption));
    expect(src).toContain(`${notice}  ${actLine}`);
    expect(src).not.toContain("Acme");
    expect(src).not.toContain("%param_1%");
    assertValidModule(src);
  });

  it("applies the same locator choice as Playwright", () => {
    expect(exportStagehand(clickWorkflow("Acme Corp", acmeCss, [acmeOption]))).toContain(actLine);
    const literal = exportStagehand(clickWorkflow("new", { kind: "testId", testId: "new-invoice" }));
    expect(literal).toContain('await stagehand.act("click the element with test id \\"new-invoice\\"");');
    expect(literal).not.toContain("LLM provider");
  });

  it("keeps typed values in act() variables", () => {
    const src = exportStagehand(compiledFixture());
    expect(src).toContain(
      'await stagehand.act("type %param_1% into the \\"Customer\\" textbox", { variables: { "param_1": params["param_1"] } });',
    );
  });
});

const PLAYWRIGHT_STUB = `
const calls = [];
const locator = (d) => ({
  click: async () => calls.push(["click", d]),
  fill: async (v) => calls.push(["fill", d, v]),
  selectOption: async (v) => calls.push(["select", d, v]),
  evaluate: async () => calls.push(["submit", d]),
});
const stubPage = {
  goto: async (u) => calls.push(["goto", u]),
  waitForURL: async () => {},
  getByRole: (r, o) => locator(r + ":" + o.name),
  getByTestId: (t) => locator(t),
  locator: (c) => locator(c),
};
const chromium = { launch: async () => ({ newPage: async () => stubPage, close: async () => console.log(JSON.stringify(calls)) }) };
`;

const STAGEHAND_STUB = `
const calls = [];
class Stagehand {
  async init() {}
  get context() {
    return { pages: () => [{ goto: async (u) => calls.push(["goto", u]), url: async () => "" }] };
  }
  async act(instruction, opts) { calls.push(["act", instruction, opts?.variables]); }
  async close() { console.log(JSON.stringify(calls)); }
}
`;

/** Runs a generated script against a stub library; returns the recorded calls, or the error message. */
function runWithStub(src: string, arg: string): unknown {
  const code = src
    .replace(`import { chromium } from "playwright";`, PLAYWRIGHT_STUB)
    .replace(`import { Stagehand } from "@browserbasehq/stagehand";`, STAGEHAND_STUB);
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code, "workflow.mjs", arg], { stdio: "pipe" });
    return JSON.parse(out.toString());
  } catch (e) {
    return /Error: (.*)/.exec(String((e as { stderr: Buffer }).stderr))?.[1];
  }
}

function optionalWorkflow(...steps: Workflow["steps"]): Workflow {
  const w = compiledFixture();
  w.params = [{ name: "note", description: "", required: false, secret: false, example: "Urgent" }];
  w.steps = [{ id: "nav", name: "Open", action: "navigate", url: "https://app.test/", fallbacks: [], framePath: [], expected: {} }, ...steps];
  return w;
}

const typeNote = {
  id: "t",
  name: "Type note",
  action: "type" as const,
  locator: { kind: "role" as const, role: "textbox", name: "Note" },
  fallbacks: [],
  param: "note",
  framePath: [],
  expected: {},
};
const clickUrgent = {
  id: "c",
  name: "Pick",
  action: "click" as const,
  locator: { kind: "role" as const, role: "option", name: "Urgent" },
  fallbacks: [],
  framePath: [],
  expected: {},
};
const openNote = { ...optionalWorkflow().steps[0]!, id: "n2", url: "https://app.test/notes/Urgent" };

describe("optional params at run time", () => {
  it("Playwright skips a type step whose optional param is missing", () => {
    const src = exportPlaywright(optionalWorkflow(typeNote));
    assertValidModule(src);
    expect(runWithStub(src, "{}")).toEqual([["goto", "https://app.test/"]]);
    expect(runWithStub(src, '{"note":"Hi"}')).toEqual([
      ["goto", "https://app.test/"],
      ["fill", "textbox:Note", "Hi"],
    ]);
  });

  it("Stagehand skips a type step whose optional param is missing", () => {
    const src = exportStagehand(optionalWorkflow(typeNote));
    assertValidModule(src);
    expect(runWithStub(src, "{}")).toEqual([["goto", "https://app.test/"]]);
    expect(runWithStub(src, '{"note":"Hi"}')).toEqual([
      ["goto", "https://app.test/"],
      ["act", 'type %note% into the "Note" textbox', { note: "Hi" }],
    ]);
  });

  it.each([
    ["playwright", exportPlaywright],
    ["stagehand", exportStagehand],
  ])("%s throws a clear error when a missing optional param is needed by a locator or URL", (_name, exporter) => {
    for (const step of [clickUrgent, openNote]) {
      const src = exporter(optionalWorkflow(step));
      assertValidModule(src);
      expect(runWithStub(src, "{}")).toBe("Missing parameter: note");
      expect(runWithStub(src, '{"note":"Urgent"}')).not.toBe("Missing parameter: note");
    }
  });

  it("keeps required params unconditional", () => {
    const src = exportPlaywright(compiledFixture());
    expect(src).not.toContain("Object.hasOwn(params, \"param_1\")");
    expect(src).not.toContain("requireParam");
  });
});

describe("URL_PATH_MATCH", () => {
  const urlPathMatches = new Function(`${URL_PATH_MATCH}\nreturn urlPathMatches;`)() as (a: string, e: string) => boolean;

  it("compares origins and decoded path segments", () => {
    const expected = "https://app.test/c/" + encodeURIComponent("Smith, John");
    expect(urlPathMatches("https://app.test/c/Smith,%20John", expected)).toBe(true);
    expect(urlPathMatches("https://app.test/c/Smith,%20John?x=1#h", expected)).toBe(true);
    expect(urlPathMatches("https://app.test/c/Smith", expected)).toBe(false);
    expect(urlPathMatches("https://other.test/c/Smith,%20John", expected)).toBe(false);
  });

  it("is emitted once and used by both exporters", () => {
    for (const src of [exportPlaywright(compiledFixture()), exportStagehand(compiledFixture())]) {
      expect(src.split("function urlPathMatches(").length).toBe(2);
      expect(src).toContain('urlPathMatches(');
      assertValidModule(src);
    }
    expect(exportStagehand(compiledFixture())).toContain("if (urlPathMatches(current, expected)) return;");
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

describe("export hardening", () => {
  const wf = (steps: WorkflowStep[], params: ParamDef[]): Workflow => ({
    id: "w",
    name: "W",
    description: "",
    version: 1,
    params,
    steps,
    sourceRecordingId: "r",
    createdAt: 0,
    updatedAt: 0,
  });
  const st = (over: Partial<WorkflowStep>): WorkflowStep => ({ id: "s", name: "Step", action: "click", fallbacks: [], framePath: [], expected: {}, ...over });
  const plan: ParamDef = { name: "plan", description: "", required: true, secret: false, example: "Pro" };

  it("exports select steps", () => {
    const w = wf([st({ action: "select", param: "plan", locator: { kind: "role", role: "combobox", name: "Plan" } })], [plan]);
    expect(exportPlaywright(w)).toContain('page.getByRole("combobox", { name: "Plan", exact: true }).selectOption(params["plan"])');
    const sh = exportStagehand(w);
    expect(sh).toContain('"select %plan% in the ');
    expect(sh).toContain('variables: { "plan": params["plan"] }');
  });

  it("submits the element's form", () => {
    const w = wf([st({ action: "submit", locator: { kind: "css", css: "#f" } })], []);
    expect(exportPlaywright(w)).toContain('.evaluate((el) => (el instanceof HTMLFormElement ? el : el.closest("form"))?.requestSubmit());');
  });

  it("throws at run time for steps without a locator", () => {
    expect(exportPlaywright(wf([st({ name: "Click thing" })], []))).toContain('throw new Error("Step \\"Click thing\\" has no locator");');
  });

  it("never substitutes secret or short examples", () => {
    const pw: ParamDef = { name: "pw", description: "", required: true, secret: true, example: "hunter22" };
    const st2: ParamDef = { name: "st", description: "", required: true, secret: false, example: "NY" };
    const out = exportPlaywright(
      wf(
        [
          st({ locator: { kind: "role", role: "button", name: "hunter22" } }),
          st({ id: "t", locator: { kind: "role", role: "button", name: "NY office" } }),
        ],
        [pw, st2],
      ),
    );
    expect(out).toContain('name: "hunter22"');
    expect(out).toContain('name: "NY office"');
    expect(out).not.toContain('params["pw"]');
    expect(out).not.toContain('params["st"]');
  });

  it("keeps hostile step names on one comment line", () => {
    const out = exportPlaywright(wf([st({ name: "Click\n*/ evil()", locator: { kind: "css", css: "#a" } })], []));
    expect(out).toContain("// Click */ evil()");
    expect(out.split("\n").some((l) => l.trim().startsWith("evil()"))).toBe(false);
  });

  it("sanitizes values placed in Stagehand act() text and says they reach the LLM", () => {
    const customer: ParamDef = { name: "customer", description: "", required: true, secret: false, example: "Acme Corp" };
    const note: ParamDef = { name: "note", description: "", required: true, secret: false, example: "Rush" };
    const out = exportStagehand(wf([st({ action: "type", param: "note", locator: { kind: "role", role: "textbox", name: "Notes for Acme Corp" } })], [customer, note]));
    expect(out).toContain('actText(params["customer"])');
    expect(out).toContain("// Sends the value of customer to your LLM provider at run time");
    expect(out).toContain('variables: { "note": params["note"] }');
    expect(out).toContain("function actText(value) {");
    expect(out).toContain("Stagehand calls an LLM for every act()");
  });

  it("rejects invalid param names", () => {
    const bad: ParamDef = { name: "bad name", description: "", required: true, secret: false };
    expect(() => exportPlaywright(wf([], [bad]))).toThrow('Invalid parameter name: "bad name"');
  });

  it("runs Playwright headed unless HEADLESS=1", () => {
    expect(exportPlaywright(wf([], []))).toContain('chromium.launch({ headless: process.env.HEADLESS === "1" })');
  });
});

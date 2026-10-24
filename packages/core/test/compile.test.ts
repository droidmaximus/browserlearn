import { describe, expect, it } from "vitest";
import { chooseLocators, collapseSteps, compileRecording, unrunnableSteps, urlPath } from "../src/compile.js";
import type { RawStep, Recording } from "../src/types.js";
import { compiledFixture, fixtureSteps } from "./fixtures.js";

const raw = (seq: number, over: Partial<RawStep>): RawStep => ({
  seq,
  action: "click",
  url: "https://a.test/form",
  selectors: {},
  axSnippet: "",
  framePath: [],
  ts: 0,
  ...over,
});
const rec: Recording = { id: "r", name: "R", startUrl: "https://a.test/form", startedAt: 0, status: "complete" };
const compile = (steps: RawStep[]) => compileRecording(rec, steps, { now: 1 });
const A = { css: "#a" };
const B = { css: "#b" };
const agree = { role: "checkbox", name: "Agree" };

describe("chooseLocators", () => {
  it("orders test id, role+name, css, xpath", () => {
    expect(chooseLocators({ xpath: "//a", css: "a", role: "link", name: "Home", testId: "home" })).toEqual([
      { kind: "testId", testId: "home" },
      { kind: "role", role: "link", name: "Home" },
      { kind: "css", css: "a" },
      { kind: "xpath", xpath: "//a" },
    ]);
  });

  it("skips role when there is no accessible name", () => {
    expect(chooseLocators({ role: "button", css: ".go" })).toEqual([{ kind: "css", css: ".go" }]);
  });
});

describe("collapseSteps", () => {
  it("drops scrolls, folds click-then-type and retyping into the last value", () => {
    expect(collapseSteps(fixtureSteps).map((s) => s.seq)).toEqual([1, 4, 6, 7, 8]);
  });

  it("drops repeated navigation to the same URL", () => {
    const nav = { action: "navigate" as const, url: "https://a.test/", selectors: {}, axSnippet: "", framePath: [], ts: 0 };
    expect(collapseSteps([{ ...nav, seq: 1 }, { ...nav, seq: 2 }]).map((s) => s.seq)).toEqual([1]);
  });

  it("never merges steps that have no locator", () => {
    const types = [raw(1, { action: "type", value: "a" }), raw(2, { action: "type", value: "b" })];
    expect(collapseSteps(types).map((s) => s.seq)).toEqual([1, 2]);
    expect(collapseSteps([raw(1, {}), raw(2, { action: "type", value: "x" })]).map((s) => s.seq)).toEqual([1, 2]);
  });

  it("treats the same selector in different frames as different targets", () => {
    const steps = [
      raw(1, { action: "type", selectors: A, framePath: [0], value: "x" }),
      raw(2, { action: "type", selectors: A, framePath: [1], value: "y" }),
    ];
    expect(collapseSteps(steps).map((s) => s.seq)).toEqual([1, 2]);
  });

  it("folds a later retype of the same field on the same page into the earlier position", () => {
    const steps = [
      raw(1, { action: "type", selectors: A, value: "x" }),
      raw(2, { action: "type", selectors: B, value: "y" }),
      raw(3, { action: "type", selectors: A, value: "z" }),
    ];
    expect(collapseSteps(steps).map((s) => [s.seq, s.value])).toEqual([
      [1, "z"],
      [2, "y"],
    ]);
  });

  it("does not fold retypes across a page change", () => {
    const steps = [
      raw(1, { action: "type", selectors: A, value: "x" }),
      raw(2, { action: "type", selectors: B, value: "y" }),
      raw(3, { action: "type", selectors: A, value: "z", url: "https://a.test/other" }),
    ];
    expect(collapseSteps(steps).map((s) => s.seq)).toEqual([1, 2, 3]);
  });

  it("drops checkbox toggles that cancel out and keeps one of an odd count", () => {
    const even = [raw(1, { selectors: agree }), raw(2, { action: "type", selectors: B, value: "y" }), raw(3, { selectors: agree })];
    expect(collapseSteps(even).map((s) => s.seq)).toEqual([2]);
    const odd = [raw(1, { selectors: agree }), raw(2, { selectors: agree }), raw(3, { selectors: agree })];
    expect(collapseSteps(odd).map((s) => s.seq)).toEqual([1]);
  });
});

describe("unrunnableSteps", () => {
  it("returns non-navigate steps without a locator", () => {
    const w = compile([raw(1, {})]);
    expect(unrunnableSteps(w)).toEqual([w.steps[1]]);
    expect(w.steps[1]?.action).toBe("click");
    expect(unrunnableSteps(compiledFixture())).toEqual([]);
  });
});

describe("compileRecording edge cases", () => {
  it("expects the destination path after a final navigate", () => {
    const w = compile([raw(1, { action: "navigate", url: "https://a.test/x?y=1" })]);
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0]?.expected).toEqual({ urlPath: "https://a.test/x" });
  });

  it("compiles an empty recording to a single open step", () => {
    const w = compile([]);
    expect(w.params).toEqual([]);
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0]).toMatchObject({ action: "navigate", url: rec.startUrl, expected: {} });
  });

  it("parameterizes select steps", () => {
    const w = compile([raw(1, { action: "select", selectors: { role: "combobox", name: "Plan" }, value: "Pro" })]);
    expect(w.params).toEqual([
      { name: "param_1", description: 'Value for combobox "Plan"', required: true, secret: false, example: "Pro" },
    ]);
    expect(w.steps[1]).toMatchObject({ name: 'Select in combobox "Plan"', param: "param_1" });
  });
});

describe("urlPath", () => {
  it("returns unparseable input unchanged", () => {
    expect(urlPath("not a url")).toBe("not a url");
  });
});

describe("compileRecording", () => {
  it("compiles the fixture into a parameterized workflow", () => {
    expect(compiledFixture()).toEqual({
      id: "id1",
      name: "Create invoice",
      description: "",
      version: 1,
      sourceRecordingId: "rec1",
      createdAt: 1000,
      updatedAt: 1000,
      params: [
        { name: "param_1", description: 'Value for textbox "Customer"', required: true, secret: false, example: "Acme Corp" },
        { name: "param_2", description: 'Value for textbox "Password"', required: true, secret: true },
      ],
      steps: [
        {
          id: "id2",
          name: "Open https://app.test/invoices",
          action: "navigate",
          url: "https://app.test/invoices",
          fallbacks: [],
          framePath: [],
          expected: { urlPath: "https://app.test/invoices" },
        },
        {
          id: "id3",
          name: 'Click [data-testid="new-invoice"]',
          action: "click",
          locator: { kind: "testId", testId: "new-invoice" },
          fallbacks: [{ kind: "css", css: "#new" }],
          framePath: [],
          expected: { urlPath: "https://app.test/invoices/new" },
        },
        {
          id: "id4",
          name: 'Type into textbox "Customer"',
          action: "type",
          locator: { kind: "role", role: "textbox", name: "Customer" },
          fallbacks: [{ kind: "css", css: "#customer" }],
          param: "param_1",
          framePath: [],
          expected: {},
        },
        {
          id: "id5",
          name: 'Type into textbox "Password"',
          action: "type",
          locator: { kind: "role", role: "textbox", name: "Password" },
          fallbacks: [{ kind: "css", css: "#pw" }],
          param: "param_2",
          framePath: [],
          expected: {},
        },
        {
          id: "id6",
          name: 'Click button "Save"',
          action: "click",
          locator: { kind: "role", role: "button", name: "Save" },
          fallbacks: [],
          framePath: [],
          expected: { urlPath: "https://app.test/invoices/42" },
        },
        {
          id: "id7",
          name: 'Click link "Back"',
          action: "click",
          locator: { kind: "role", role: "link", name: "Back" },
          fallbacks: [],
          framePath: [],
          expected: {},
        },
      ],
    });
  });
});

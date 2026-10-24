import { describe, expect, it } from "vitest";
import { chooseLocators, collapseSteps } from "../src/compile.js";
import { compiledFixture, fixtureSteps } from "./fixtures.js";

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

import { describe, expect, it } from "vitest";
import { checkParamValues, MissingParamError, resolveStep, urlPathMatches } from "../src/resolve.js";
import type { ParamDef, Workflow, WorkflowStep } from "../src/types.js";
import { compiledFixture } from "./fixtures.js";

const customer: ParamDef = { name: "customer", description: "", required: true, secret: false, example: "Acme Corp" };
const note: ParamDef = { name: "note", description: "", required: false, secret: false, example: "Rush order" };
const params = [customer, note];
const step = (over: Partial<WorkflowStep>): WorkflowStep => ({
  id: "s",
  name: "step",
  action: "click",
  fallbacks: [],
  framePath: [],
  expected: {},
  ...over,
});

describe("checkParamValues", () => {
  const w: Workflow = { ...compiledFixture(), params };

  it("accepts declared string values", () => {
    expect(checkParamValues(w, { customer: "Globex" })).toEqual({ customer: "Globex" });
  });

  it("treats a missing object as no values", () => {
    expect(() => checkParamValues(w, undefined)).toThrow(MissingParamError);
  });

  it("rejects non-objects, unknown names and non-strings", () => {
    expect(() => checkParamValues(w, [])).toThrow("Parameters must be a JSON object");
    expect(() => checkParamValues(w, { customer: "x", other: "y" })).toThrow("Unknown parameter: other");
    expect(() => checkParamValues(w, { customer: 3 })).toThrow("Parameter customer must be a string");
  });

  it("requires required params", () => {
    expect(() => checkParamValues(w, { note: "x" })).toThrow("Missing parameter: customer");
  });
});

describe("resolveStep", () => {
  it("fills a type step's value and keeps locators in order", () => {
    const r = resolveStep(
      step({ action: "type", param: "customer", locator: { kind: "role", role: "textbox", name: "Customer" }, fallbacks: [{ kind: "css", css: "#customer" }] }),
      params,
      { customer: "Globex" },
    );
    expect(r).toEqual({
      skip: false,
      action: "type",
      value: "Globex",
      framePath: [],
      locators: [
        { kind: "role", role: "textbox", name: "Customer" },
        { kind: "css", css: "#customer" },
      ],
    });
  });

  it("skips an input step whose optional param was not given", () => {
    expect(resolveStep(step({ action: "type", param: "note", locator: { kind: "css", css: "#note" } }), params, {})).toEqual({
      skip: true,
      reason: "optional parameter note not given",
    });
  });

  it("substitutes run-time values into role names", () => {
    const r = resolveStep(step({ locator: { kind: "role", role: "link", name: "Acme Corp details" } }), params, { customer: "Globex" });
    expect(r.skip === false && r.locators[0]).toEqual({ kind: "role", role: "link", name: "Globex details" });
  });

  it("prefers a role locator over a test id that embeds an example", () => {
    const r = resolveStep(
      step({ locator: { kind: "testId", testId: "row-Acme Corp" }, fallbacks: [{ kind: "role", role: "row", name: "Acme Corp" }] }),
      params,
      { customer: "Globex" },
    );
    expect(r.skip === false && r.locators).toEqual([
      { kind: "role", role: "row", name: "Globex" },
      { kind: "testId", testId: "row-Acme Corp" },
    ]);
  });

  it("throws when the primary locator needs a missing optional param, but drops such a fallback", () => {
    expect(() => resolveStep(step({ locator: { kind: "role", role: "link", name: "Rush order" } }), params, { customer: "x" })).toThrow(
      MissingParamError,
    );
    const r = resolveStep(
      step({ locator: { kind: "css", css: "#go" }, fallbacks: [{ kind: "role", role: "link", name: "Rush order" }] }),
      params,
      { customer: "x" },
    );
    expect(r.skip === false && r.locators).toEqual([{ kind: "css", css: "#go" }]);
  });

  it("fills URLs with encoded values", () => {
    const r = resolveStep(
      step({
        action: "navigate",
        url: "https://app.test/customers/Acme%20Corp?q=Acme+Corp",
        expected: { urlPath: "https://app.test/customers/Acme%20Corp" },
      }),
      params,
      { customer: "Globex & Co" },
    );
    expect(r).toMatchObject({
      url: "https://app.test/customers/Globex%20%26%20Co?q=Globex%20%26%20Co",
      expectedUrl: "https://app.test/customers/Globex%20%26%20Co",
    });
  });

  it("rejects an input step without a declared param", () => {
    expect(() => resolveStep(step({ action: "type", param: "missing", locator: { kind: "css", css: "#x" } }), params, {})).toThrow(
      'Step "step" needs a parameter',
    );
  });
});

describe("urlPathMatches", () => {
  it("compares origin and decoded path, ignoring query", () => {
    expect(urlPathMatches("https://a.test/x/Globex%20Inc?y=1", "https://a.test/x/Globex Inc")).toBe(true);
    expect(urlPathMatches("https://a.test/x/", "https://a.test/x")).toBe(false);
    expect(urlPathMatches("https://b.test/x", "https://a.test/x")).toBe(false);
    expect(urlPathMatches("not a url", "not a url")).toBe(true);
  });
});

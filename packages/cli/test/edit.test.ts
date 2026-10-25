import type { Workflow } from "@browserlearn/core/types";
import { describe, expect, it } from "vitest";
import { applyPatch, parsePatch } from "../src/edit.js";
import { compileAndSave } from "../src/workflows.js";
import { seedRecording, testApp } from "./helpers.js";

function workflow(): Workflow {
  const app = testApp();
  const w = compileAndSave(app, seedRecording(app));
  app.close();
  return w;
}

describe("workflow edits", () => {
  it("renames params everywhere they are referenced", () => {
    const w = workflow();
    const out = applyPatch(w, parsePatch({ params: [{ name: "param_2", newName: "plan", description: "Plan to buy", required: false }] }), 99);
    const plan = out.params.find((p) => p.name === "plan")!;
    expect(plan).toMatchObject({ description: "Plan to buy", required: false });
    expect(out.steps.some((s) => s.param === "plan")).toBe(true);
    expect(out.steps.some((s) => s.param === "param_2")).toBe(false);
    expect(out.updatedAt).toBe(99);
  });

  it("keeps params required when later steps need them", () => {
    expect(() => applyPatch(workflow(), parsePatch({ params: [{ name: "param_1", required: false }] }), 0)).toThrow(
      "Parameter param_1 must stay required",
    );
  });

  it("validates names", () => {
    const w = workflow();
    expect(() => applyPatch(w, parsePatch({ params: [{ name: "param_1", newName: "Bad Name" }] }), 0)).toThrow("Invalid parameter name");
    expect(() => applyPatch(w, parsePatch({ params: [{ name: "param_1", newName: "param_2" }] }), 0)).toThrow("Duplicate parameter name");
    expect(() => applyPatch(w, parsePatch({ params: [{ name: "nope" }] }), 0)).toThrow("Unknown parameter: nope");
    expect(() => applyPatch(w, parsePatch({ name: "  " }), 0)).toThrow("Workflow name cannot be empty");
    expect(() => parsePatch({ steps: [{ id: 1 }] })).toThrow("Invalid steps");
  });

  it("renames steps and toggles examples", () => {
    const w = workflow();
    const out = applyPatch(w, parsePatch({ name: " Invoice ", exposeExamples: true, steps: [{ id: w.steps[0]!.id, name: "Open the form" }] }), 0);
    expect(out.name).toBe("Invoice");
    expect(out.exposeExamples).toBe(true);
    expect(out.steps[0]!.name).toBe("Open the form");
  });
});

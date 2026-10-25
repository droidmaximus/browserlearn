import { describe, expect, it } from "vitest";
import { toPublicWorkflow, workflowSummary } from "../src/public.js";
import type { Workflow } from "../src/types.js";
import { compiledFixture } from "./fixtures.js";

function leaky(exposeExamples?: boolean): Workflow {
  const w = compiledFixture();
  return {
    ...w,
    ...(exposeExamples === undefined ? {} : { exposeExamples }),
    params: w.params.map((p) => (p.name === "param_1" ? { ...p, scrubTerms: ["Jane Doe"] } : p)),
    steps: [
      ...w.steps,
      {
        id: "x1",
        name: 'Click link "Acme Corp details"',
        action: "click",
        locator: { kind: "role", role: "link", name: "Acme Corp details" },
        fallbacks: [{ kind: "role", role: "link", name: "Jane Doe" }],
        framePath: [],
        expected: { urlPath: "https://app.test/customers/Acme%20Corp" },
      },
      {
        id: "x2",
        name: "Open https://app.test/customers/Acme%20Corp?q=Acme+Corp",
        action: "navigate",
        url: "https://app.test/customers/Acme%20Corp?q=Acme+Corp",
        fallbacks: [],
        framePath: [],
        expected: {},
      },
    ],
  };
}

describe("toPublicWorkflow", () => {
  it("hides examples and scrub terms everywhere by default", () => {
    const text = JSON.stringify(toPublicWorkflow(leaky()));
    for (const leak of ["Acme Corp", "Acme%20Corp", "Acme+Corp", "Jane Doe", "scrubTerms", '"example"']) {
      expect(text).not.toContain(leak);
    }
  });

  it("replaces hidden values with param placeholders", () => {
    const p = toPublicWorkflow(leaky());
    const x1 = p.steps.find((s) => s.id === "x1")!;
    expect(x1.name).toBe('Click link "{param_1} details"');
    expect(x1.locator).toEqual({ kind: "role", role: "link", name: "{param_1} details" });
    expect(x1.fallbacks).toEqual([{ kind: "role", role: "link", name: "{param_1}" }]);
    expect(x1.expected.urlPath).toBe("https://app.test/customers/{param_1}");
    const x2 = p.steps.find((s) => s.id === "x2")!;
    expect(x2.url).toBe("https://app.test/customers/{param_1}?q={param_1}");
    expect(x2.name).toBe("Open https://app.test/customers/{param_1}?q={param_1}");
  });

  it("shows examples, but never scrub terms, when the workflow exposes them", () => {
    const p = toPublicWorkflow(leaky(true));
    expect(p.params.find((x) => x.name === "param_1")!.example).toBe("Acme Corp");
    expect(p.params.find((x) => x.name === "param_2")).not.toHaveProperty("example");
    expect(p.steps.find((s) => s.id === "x1")!.locator).toEqual({ kind: "role", role: "link", name: "Acme Corp details" });
    expect(JSON.stringify(p)).not.toContain("Jane Doe");
    expect(p).not.toHaveProperty("exposeExamples");
  });

  it("does not modify the stored workflow", () => {
    const w = leaky();
    const before = structuredClone(w);
    toPublicWorkflow(w);
    expect(w).toEqual(before);
  });
});

describe("workflowSummary", () => {
  it("omits examples by default", () => {
    const s = workflowSummary(leaky());
    expect(s.name).toBe("Create invoice");
    expect(s.version).toBe(1);
    expect(s.inputSchema.properties.param_1).not.toHaveProperty("examples");
    expect(JSON.stringify(s)).not.toContain("Acme Corp");
  });

  it("includes non-secret examples only when the workflow exposes them", () => {
    const s = workflowSummary(leaky(true));
    expect(s.inputSchema.properties.param_1!.examples).toEqual(["Acme Corp"]);
    expect(s.inputSchema.properties.param_2).not.toHaveProperty("examples");
  });
});

import { describe, expect, it } from "vitest";
import { buildEnrichmentPayload, buildSkeleton, enrichWorkflow, parseEnrichment } from "../src/enrich.js";
import type { LlmClient } from "../src/llm.js";
import { compiledFixture } from "./fixtures.js";

const fakeClient = (reply: string) => {
  const calls: { system: string; user: string }[] = [];
  const client: LlmClient = {
    async complete(system, user) {
      calls.push({ system, user });
      return reply;
    },
  };
  return { client, calls };
};

const GOOD_REPLY = [
  "```json",
  JSON.stringify({
    name: "Create invoice for customer",
    description: "Creates a new invoice.",
    steps: [{ index: 2, name: "Enter customer name" }],
    params: [
      { from: "param_1", name: "customer_name", description: "Customer to invoice", required: true },
      { from: "param_2", name: "password", description: "Account password", required: false },
    ],
  }),
  "```",
].join("\n");

describe("buildSkeleton / payload", () => {
  it("never includes typed values or examples", () => {
    const w = compiledFixture();
    const payload = buildEnrichmentPayload(w);
    expect(payload.user).not.toContain("Acme");
    expect(payload.user).toContain("param_1");
    expect(buildSkeleton(w).steps[2]).toEqual({ index: 2, action: "type", target: 'textbox "Customer"', param: "param_1" });
  });

  it("strips query strings from URLs", () => {
    const w = compiledFixture();
    w.steps[0].url = "https://app.test/invoices?token=abc";
    expect(JSON.stringify(buildSkeleton(w))).not.toContain("token=abc");
  });
});

describe("enrichWorkflow", () => {
  it("applies names and renames params everywhere; secrets stay required", async () => {
    const { client, calls } = fakeClient(GOOD_REPLY);
    const w = compiledFixture();
    const { workflow, enriched } = await enrichWorkflow(w, client);
    expect(enriched).toBe(true);
    expect(calls[0]).toEqual(buildEnrichmentPayload(w));
    expect(workflow.name).toBe("Create invoice for customer");
    expect(workflow.description).toBe("Creates a new invoice.");
    expect(workflow.steps[2]).toMatchObject({ name: "Enter customer name", param: "customer_name" });
    expect(workflow.steps[3].param).toBe("password");
    expect(workflow.params.map((p) => [p.name, p.required])).toEqual([
      ["customer_name", true],
      ["password", true],
    ]);
    expect(workflow.params[0].example).toBe("Acme Corp");
  });

  it("keeps the deterministic workflow when the reply is invalid", async () => {
    const { client } = fakeClient('{"name": "x", "description": "", "steps": [], "params": [{"from":"param_1","name":"Bad Name","description":"","required":true}]}');
    const w = compiledFixture();
    const result = await enrichWorkflow(w, client);
    expect(result.enriched).toBe(false);
    expect(result.workflow).toEqual(w);
    expect(result.error).toMatch(/invalid param/);
  });

  it("keeps the deterministic workflow when the client throws", async () => {
    const client: LlmClient = { complete: async () => Promise.reject(new Error("offline")) };
    const w = compiledFixture();
    expect(await enrichWorkflow(w, client)).toEqual({ workflow: w, enriched: false, error: "Error: offline" });
  });
});

describe("parseEnrichment", () => {
  it("rejects duplicate param names", () => {
    const dup = JSON.stringify({
      name: "x",
      description: "",
      steps: [],
      params: [
        { from: "param_1", name: "a", description: "", required: true },
        { from: "param_2", name: "a", description: "", required: true },
      ],
    });
    expect(() => parseEnrichment(dup)).toThrow(/duplicate/);
  });

  it("rejects text without JSON", () => {
    expect(() => parseEnrichment("sorry")).toThrow(/no JSON object/);
  });
});

import { describe, expect, it } from "vitest";
import { compileRecording } from "../src/compile.js";
import { buildEnrichmentPayload, buildSkeleton, enrichWorkflow, parseEnrichment } from "../src/enrich.js";
import { openAiCompatibleClient, type LlmClient } from "../src/llm.js";
import type { WorkflowStep } from "../src/types.js";
import { compiledFixture } from "./fixtures.js";

const hangingFetch = ((_url: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

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

  it("scrubs param examples from targets, URLs and the workflow name", () => {
    const w = compiledFixture();
    const extra = { fallbacks: [], framePath: [], expected: {} };
    w.name = "Invoice Acme Corp";
    w.steps.push(
      { ...extra, id: "x1", name: "pick", action: "click", locator: { kind: "role", role: "option", name: "Acme Corp" } },
      { ...extra, id: "x2", name: "go", action: "navigate", url: "https://app.test/customers/Acme%20Corp" },
      { ...extra, id: "x3", name: "go2", action: "navigate", url: "https://app.test/search/Acme+Corp" },
      { ...extra, id: "x4", name: "css", action: "click", locator: { kind: "css", css: "[title='Acme Corp']" } },
    );
    const { user } = buildEnrichmentPayload(w);
    expect(user).not.toContain("Acme");
    expect(user).toContain("{param_1}");
  });

  const navigateTo = (url: string, i = 0): WorkflowStep => ({
    id: `u${i}`,
    name: "go",
    action: "navigate",
    url,
    fallbacks: [],
    framePath: [],
    expected: {},
  });

  it.each(["Smith & Co", "Acme, Inc."])("scrubs the example %j from URL paths in every form", (example) => {
    const w = compiledFixture();
    w.params[0].example = example;
    w.steps = [
      navigateTo(`https://app.test/c/${example}/x`, 0),
      navigateTo(`https://app.test/c/${encodeURIComponent(example)}/x`, 1),
      navigateTo(`https://app.test/c/${encodeURIComponent(example).replace(/%20/g, "+")}/x`, 2),
    ];
    const { user } = buildEnrichmentPayload(w);
    for (const word of ["Smith", "Acme", "Inc"]) expect(user).not.toContain(word);
    expect(buildSkeleton(w).steps.every((s) => s.url!.startsWith("https://app.test/c/") && s.url!.endsWith("/x"))).toBe(true);
  });

  it("scrubs host labels but never the scheme or port", () => {
    const w = compiledFixture();
    w.params[0].example = "app";
    w.steps = [navigateTo("https://app.test:8443/app/x")];
    expect(buildSkeleton(w).steps[0].url).toBe("https://{param_1}.test:8443/%7Bparam_1%7D/x");
    w.params[0].example = "http";
    w.steps = [navigateTo("https://a.test/")];
    expect(buildSkeleton(w).steps[0].url).toBe("https://a.test/");
  });

  it("scrubs a typed value from the host", () => {
    const w = compiledFixture();
    w.params[0].example = "acmecorp";
    w.steps = [navigateTo("https://acmecorp.slack.test/messages")];
    expect(buildSkeleton(w).steps[0].url).toBe("https://{param_1}.slack.test/messages");
  });

  it("scrubs values containing a slash from URL paths", () => {
    const w = compiledFixture();
    w.params[0].example = "docs/q3";
    w.steps = [navigateTo("https://app.test/files/docs/q3"), navigateTo("https://app.test/files/docs%2Fq3", 1)];
    const { user } = buildEnrichmentPayload(w);
    expect(user).not.toContain("q3");
    expect(buildSkeleton(w).steps[0].url).toBe("https://app.test/files/%7Bparam_1%7D");
  });

  it("scrubs the plaintext left in a partly redacted value", () => {
    const w = compileRecording(
      { id: "r", name: "Find person", startUrl: "https://app.test/", startedAt: 0, status: "complete" },
      [
        { seq: 1, action: "type", url: "https://app.test/", selectors: { role: "searchbox", name: "Search" }, axSnippet: "", framePath: [], ts: 0, value: "Jane Doe [REDACTED:email]" },
        { seq: 2, action: "click", url: "https://app.test/", selectors: { role: "link", name: "Jane Doe profile" }, axSnippet: "", framePath: [], ts: 0 },
        { seq: 3, action: "navigate", url: "https://app.test/people/Jane%20Doe", selectors: {}, axSnippet: "", framePath: [], ts: 0 },
      ],
      { now: 0 },
    );
    expect(w.params[0]).not.toHaveProperty("example");
    const { user } = buildEnrichmentPayload(w);
    expect(user).not.toContain("Jane");
    expect(user).toContain('link \\"{param_1} profile\\"');
    expect(user).toContain("https://app.test/people/%7Bparam_1%7D");
  });

  it("never sends scrub terms or examples", () => {
    const w = compiledFixture();
    w.params[0].scrubTerms = ["Zebra Holdings"];
    w.name = "Invoice Zebra Holdings";
    const { user } = buildEnrichmentPayload(w);
    expect(user).not.toContain("Zebra");
    expect(user).not.toContain("scrubTerms");
  });

  it("matches examples case-insensitively", () => {
    const w = compiledFixture();
    w.params[0].example = "acme corp";
    w.steps.push({ id: "x1", name: "pick", action: "click", locator: { kind: "role", role: "option", name: "Acme Corp" }, fallbacks: [], framePath: [], expected: {} });
    const { user } = buildEnrichmentPayload(w);
    expect(user.toLowerCase()).not.toContain("acme");
    expect(user).toContain('option \\"{param_1}\\"');
  });

  it("generalizes IDs in URL paths and drops query and fragment", () => {
    const w = compiledFixture();
    const urls = [
      "https://app.test/invoices/42/edit",
      "https://app.test/u/3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b",
      "https://app.test/settings/profile",
      "https://app.test/a/Xy9_abcdefghijklmnop?q=1#frag",
    ];
    w.steps = urls.map((url, i) => ({ id: `n${i}`, name: "go", action: "navigate", url, fallbacks: [], framePath: [], expected: {} }));
    expect(buildSkeleton(w).steps.map((s) => s.url)).toEqual([
      "https://app.test/invoices/:id/edit",
      "https://app.test/u/:id",
      "https://app.test/settings/profile",
      "https://app.test/a/:id",
    ]);
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

  it("keeps the deterministic workflow when the LLM request times out", async () => {
    const client = openAiCompatibleClient({ baseUrl: "http://x/v1", model: "m", timeoutMs: 20, fetchImpl: hangingFetch });
    const w = compiledFixture();
    const result = await enrichWorkflow(w, client);
    expect(result).toMatchObject({ enriched: false, workflow: w });
    expect(result.error).toMatch(/timed out after 20ms/);
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

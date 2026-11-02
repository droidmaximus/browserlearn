import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type ApiDeps, createApiHandler } from "../src/api.js";
import type { App } from "../src/app.js";
import type { RunOutcome } from "../src/runner.js";
import { type RunningServer, startServer } from "../src/server.js";
import { seedRecording, testApp } from "./helpers.js";

const TOKEN = "dashboard-token";
const NOW = 1_700_000_000_000;
const llmReply = {
  name: "Create a customer invoice",
  description: "Creates an invoice for a customer.",
  steps: [],
  params: [{ from: "param_1", name: "customer", description: "Customer name", required: true }],
};

describe("dashboard API", () => {
  let app: App;
  let server: RunningServer;
  const llmCalls: string[] = [];
  let llmFails = false;

  afterEach(async () => {
    await server?.close();
    app?.close();
    llmCalls.length = 0;
    llmFails = false;
  });

  async function setup(extra: Partial<ApiDeps> = {}) {
    app = testApp({ now: () => NOW });
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      llmCalls.push(JSON.parse(String(init.body)).messages[1].content);
      if (llmFails) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmReply) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    server = await startServer(app, {
      port: 0,
      handler: (ingest) => {
        const api = createApiHandler(app, { dashboardToken: TOKEN, ingest, fetchImpl, ...extra });
        return async (req, res) => {
          if (!(await api(req, res))) res.writeHead(404).end();
        };
      },
    });
  }

  async function api(method: string, path: string, body?: unknown, token = TOKEN) {
    const res = await fetch(`${server.url}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : await res.text() };
  }

  it("requires the dashboard token", async () => {
    await setup();
    expect((await api("GET", "/status", undefined, "wrong")).status).toBe(401);
    const status = await api("GET", "/status");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ extensionConnected: false, llmConfigured: false });
    expect(status.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects foreign Host headers before auth", async () => {
    await setup();
    const code = await new Promise<number>((resolve, reject) => {
      request({ host: "127.0.0.1", port: server.port, path: "/api/status", headers: { host: "evil.test", authorization: `Bearer ${TOKEN}` } }, (res) =>
        resolve(res.statusCode!),
      )
        .on("error", reject)
        .end();
    });
    expect(code).toBe(403);
  });

  it("lists, compiles and deletes recordings", async () => {
    await setup();
    seedRecording(app);
    expect((await api("GET", "/recordings")).body).toMatchObject([{ id: "rec-form", stepCount: 6 }]);
    expect((await api("GET", "/recordings/rec-form")).body.steps).toHaveLength(6);
    const w = (await api("POST", "/recordings/rec-form/compile")).body;
    expect(w.name).toBe("Create invoice");
    expect((await api("DELETE", "/recordings/rec-form")).body).toEqual({ deleted: true });
    expect((await api("GET", "/recordings/rec-form")).status).toBe(404);
    expect((await api("PATCH", "/recordings")).status).toBe(405);
    expect((await api("GET", "/nope")).status).toBe(404);
  });

  it("gets and edits workflows", async () => {
    await setup();
    seedRecording(app);
    const w = (await api("POST", "/recordings/rec-form/compile")).body;
    const detail = (await api("GET", `/workflows/${w.id}`)).body;
    expect(detail.lockedRequired).toEqual(["param_1"]);
    expect(detail.unrunnable).toEqual([]);
    const edited = await api("PUT", `/workflows/${w.id}`, { name: "Invoice", params: [{ name: "param_2", newName: "plan" }] });
    expect(edited.status).toBe(200);
    expect(edited.body.workflow).toMatchObject({ name: "Invoice", version: 2 });
    expect((await api("PUT", `/workflows/${w.id}`, { params: [{ name: "param_1", required: false }] })).status).toBe(400);
    await api("POST", "/recordings/rec-form/compile");
    const other = (await api("GET", "/workflows")).body.find((x: { id: string }) => x.id !== w.id);
    expect((await api("PUT", `/workflows/${other.id}`, { name: "Invoice" })).status).toBe(409);
  });

  it("exports scripts", async () => {
    await setup();
    seedRecording(app);
    const w = (await api("POST", "/recordings/rec-form/compile")).body;
    const res = await api("GET", `/workflows/${w.id}/export?format=playwright`);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="create-invoice.playwright.mjs"');
    expect(res.body).toContain("chromium.launch");
    expect((await api("GET", `/workflows/${w.id}/export?format=cobol`)).status).toBe(400);
  });

  it("previews and sends the LLM payload, keeping the workflow when the LLM fails", async () => {
    await setup();
    seedRecording(app);
    const w = (await api("POST", "/recordings/rec-form/compile")).body;
    expect((await api("POST", `/workflows/${w.id}/enrich`, {})).status).toBe(409);
    await api("PUT", "/settings", { llm: { baseUrl: "http://llm.test/v1", model: "fake" } });
    const preview = (await api("GET", `/workflows/${w.id}/enrich/preview`)).body;
    expect(preview.user).toContain("param_1");
    expect(preview.user).not.toContain("Acme");

    llmFails = true;
    const failed = (await api("POST", `/workflows/${w.id}/enrich`, {})).body;
    expect(failed).toMatchObject({ enriched: false, workflow: { name: "Create invoice" } });
    expect(failed.error).toContain("503");

    llmFails = false;
    const edited = `${preview.user}\n`;
    const done = (await api("POST", `/workflows/${w.id}/enrich`, { user: edited })).body;
    expect(done).toMatchObject({ enriched: true, workflow: { name: "Create a customer invoice" } });
    expect(llmCalls.at(-1)).toBe(edited);
  });

  it("runs workflows", async () => {
    const outcome: RunOutcome = { run: { id: "r1", workflowId: "w", params: {}, status: "succeeded", log: [], startedAt: 0 }, outputs: { title: "done" } };
    const runs: unknown[] = [];
    await setup({
      run: async (_w, params, headless) => {
        runs.push({ params, headless });
        return outcome;
      },
    });
    seedRecording(app);
    const w = (await api("POST", "/recordings/rec-form/compile")).body;
    const res = await api("POST", `/workflows/${w.id}/run`, { params: { param_1: "x" }, headed: true });
    expect(res.body).toMatchObject({ status: "succeeded", outputs: { title: "done" } });
    expect(runs).toEqual([{ params: { param_1: "x" }, headless: false }]);
  });

  it("saves settings without echoing the API key", async () => {
    await setup();
    const saved = await api("PUT", "/settings", {
      llm: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "sk-secret-value" },
      fieldRules: [{ domain: "app.test", field: "ssn" }],
    });
    expect(saved.body.llm).toEqual({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", hasApiKey: true });
    expect(JSON.stringify(saved.body)).not.toContain("sk-secret-value");
    await api("PUT", "/settings", { llm: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" } });
    expect(app.config.llm?.apiKey).toBe("sk-secret-value");
    await api("PUT", "/settings", { llm: { baseUrl: "https://api.openai.com/v1", model: "m", apiKey: null } });
    expect(app.config.llm?.apiKey).toBeUndefined();
    expect((await api("PUT", "/settings", { llm: { baseUrl: "ftp://x", model: "m" } })).status).toBe(400);
    expect((await api("PUT", "/settings", { fieldRules: [{ domain: "" }] })).status).toBe(400);
    expect((await api("PUT", "/settings", { llm: null })).body.llm).toBeNull();
  });

  it("resets the pairing code", async () => {
    await setup();
    const before = app.config.pairToken;
    const res = await api("POST", "/pair/reset");
    expect(res.body.pairToken).not.toBe(before);
    expect((await api("GET", "/settings")).body.pairToken).toBe(res.body.pairToken);
  });

});

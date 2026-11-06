import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { createMcpServer, type McpDeps } from "../src/mcp.js";
import type { RunOutcome } from "../src/runner.js";
import { compileAndSave } from "../src/workflows.js";
import { seedRecording, tempHome, testApp } from "./helpers.js";

type TextResult = { content: { type: string; text: string }[]; isError?: boolean };

async function connected(app: App, deps: McpDeps = {}): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(app, deps).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<TextResult> =>
  (await client.callTool({ name, arguments: args })) as TextResult;

const text = (r: TextResult): string => r.content.map((c) => c.text).join("");

describe("MCP server", () => {
  it("exposes exactly the four tools", async () => {
    const client = await connected(testApp());
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["get_workflow", "list_workflows", "run_workflow", "search_recordings"]);
  });

  it("declares all four boolean hints on every tool", async () => {
    const client = await connected(testApp());
    const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.annotations]));
    const hints = (a: (typeof byName)[string]) => ({
      readOnlyHint: a?.readOnlyHint,
      destructiveHint: a?.destructiveHint,
      idempotentHint: a?.idempotentHint,
      openWorldHint: a?.openWorldHint,
    });
    for (const name of ["list_workflows", "get_workflow", "search_recordings"] as const) {
      expect(hints(byName[name]), name).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    expect(hints(byName.run_workflow)).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("lists and gets workflows without recorded values", async () => {
    const app = testApp();
    compileAndSave(app, seedRecording(app));
    const client = await connected(app);
    const list = text(await call(client, "list_workflows"));
    expect(JSON.parse(list).workflows[0]).toMatchObject({ name: "Create invoice", version: 1 });
    expect(list).not.toContain("Acme");
    const got = text(await call(client, "get_workflow", { name: "Create invoice" }));
    expect(got).toContain("{param_1} details");
    expect(got).not.toContain("Acme");
    expect(got).not.toContain("scrubTerms");
    const missing = await call(client, "get_workflow", { name: "Nope" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('No workflow named "Nope"');
  });

  it("includes examples once the user exposes them", async () => {
    const app = testApp();
    const w = compileAndSave(app, seedRecording(app));
    app.store.saveWorkflow({ ...w, exposeExamples: true });
    const client = await connected(app);
    expect(text(await call(client, "list_workflows"))).toContain('"Acme Corp"');
  });

  it("runs workflows and flags failures", async () => {
    const app = testApp();
    compileAndSave(app, seedRecording(app));
    const calls: unknown[] = [];
    const outcome = (status: "succeeded" | "failed"): RunOutcome => ({
      run: { id: "run1", workflowId: "w", params: {}, status, log: ["1. Open"], startedAt: 0, ...(status === "failed" ? { failedStep: 0 } : {}) },
      outputs: status === "succeeded" ? { title: "done" } : {},
      ...(status === "failed" ? { error: "No element matched" } : {}),
    });
    let next: "succeeded" | "failed" = "succeeded";
    const client = await connected(app, {
      run: async (_w, params) => {
        calls.push(params);
        return outcome(next);
      },
    });
    const ok = await call(client, "run_workflow", { name: "Create invoice", params: { param_1: "Globex" } });
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(text(ok))).toMatchObject({ status: "succeeded", outputs: { title: "done" } });
    expect(calls[0]).toEqual({ param_1: "Globex" });
    next = "failed";
    const failed = await call(client, "run_workflow", { name: "Create invoice" });
    expect(failed.isError).toBe(true);
    expect(JSON.parse(text(failed))).toMatchObject({ status: "failed", failedStep: 0, error: "No element matched" });
  });

  it("searches recordings", async () => {
    const app = testApp();
    seedRecording(app);
    const client = await connected(app);
    expect(JSON.parse(text(await call(client, "search_recordings", { query: "invoice" }))).recordings[0].id).toBe("rec-form");
  });

  it("runs over stdio with nothing but protocol on stdout", async () => {
    const home = tempHome();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../dist/bin.js", import.meta.url)), "mcp"],
      env: { ...process.env, BROWSERLEARN_HOME: home } as Record<string, string>,
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(4);
    await client.close();
  });
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toPublicWorkflow, workflowSummary } from "@browserlearn/core/public";
import type { Workflow } from "@browserlearn/core/types";
import { z } from "zod";
import type { App } from "./app.js";
import type { RunOutcome } from "./runner.js";
import { executeRun, runReport } from "./runs.js";
import { searchRecordings } from "./search.js";
import { VERSION } from "./version.js";
import { findWorkflow } from "./workflows.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const notFound = (name: string): ToolResult => fail(`No workflow named "${name}". Call list_workflows to see the available names.`);

export interface McpDeps {
  run?: (w: Workflow, params: unknown) => Promise<RunOutcome>;
}

export function createMcpServer(app: App, deps: McpDeps = {}): McpServer {
  const run = deps.run ?? ((w: Workflow, params: unknown) => executeRun(app, w, params));
  const server = new McpServer({ name: "browserlearn", version: VERSION });

  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description: "List the browser workflows the user recorded with BrowserLearn. Each has a name, a description, and its parameters as JSON Schema.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => ok({ workflows: app.store.listWorkflows().map(workflowSummary) }),
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description: "Get a workflow's full definition: its steps, target elements, expected pages, and parameters.",
      inputSchema: { name: z.string().describe("Workflow name from list_workflows") },
      annotations: readOnly,
    },
    async ({ name }) => {
      const w = findWorkflow(app.store, name);
      return w ? ok(toPublicWorkflow(w)) : notFound(name);
    },
  );

  server.registerTool(
    "run_workflow",
    {
      title: "Run workflow",
      description: "Run a workflow in a local headless browser with the given parameter values, and report whether every step succeeded.",
      inputSchema: {
        name: z.string().describe("Workflow name from list_workflows"),
        params: z.record(z.string(), z.string()).optional().describe("Parameter values by name"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, params }) => {
      const w = findWorkflow(app.store, name);
      if (!w) return notFound(name);
      const outcome = await run(w, params ?? {});
      const result = ok(runReport(w, outcome));
      return outcome.run.status === "succeeded" ? result : { ...result, isError: true };
    },
  );

  server.registerTool(
    "search_recordings",
    {
      title: "Search recordings",
      description: "Search the user's recorded browser sessions by name, page URL, or element label.",
      inputSchema: {
        query: z.string().min(1).describe("Text to look for"),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnly,
    },
    async ({ query, limit }) => ok({ recordings: searchRecordings(app.store, query, limit) }),
  );

  return server;
}

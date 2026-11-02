import type { IncomingMessage, ServerResponse } from "node:http";
import { unrunnableSteps } from "@browserlearn/core/compile";
import { buildEnrichmentPayload, lockedRequiredParams } from "@browserlearn/core/enrich";
import type { Workflow } from "@browserlearn/core/types";
import type { App } from "./app.js";
import { newToken } from "./config.js";
import { applyPatch, parsePatch } from "./edit.js";
import { enrichSaved, llmClientFor } from "./enrichment.js";
import { errorMessage, HttpError, NotFoundError, ValidationError } from "./errors.js";
import { tokensEqual } from "./ingest.js";
import type { RunOutcome } from "./runner.js";
import { executeRun, runReport } from "./runs.js";
import { applySettings, settingsView } from "./settings.js";
import { VERSION } from "./version.js";
import { compileAndSave, exportWorkflow, isExportFormat } from "./workflows.js";

export interface ApiDeps {
  dashboardToken: string;
  ingest: { readonly connected: number };
  run?: (w: Workflow, params: unknown, headless: boolean) => Promise<RunOutcome>;
  fetchImpl?: typeof fetch;
}

class RawBody {
  constructor(
    readonly body: string,
    readonly contentType: string,
    readonly filename: string,
  ) {}
}

interface Ctx {
  params: Record<string, string>;
  url: URL;
  body(): Promise<unknown>;
}

type Route = [method: string, pattern: RegExp, handler: (ctx: Ctx) => unknown];

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("Request body is not valid JSON");
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workflow";

function authorized(header: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  return match !== null && tokensEqual(match[1]!, token);
}

export function createApiHandler(app: App, deps: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const run = deps.run ?? ((w: Workflow, params: unknown, headless: boolean) => executeRun(app, w, params, { headless }));
  const workflowOr404 = (id: string): Workflow => {
    const w = app.store.getWorkflow(id);
    if (!w) throw new NotFoundError(`Workflow not found: ${id}`);
    return w;
  };
  const detail = (w: Workflow) => ({
    workflow: w,
    lockedRequired: [...lockedRequiredParams(w)].filter((name) => !w.params.find((p) => p.name === name)?.secret),
    unrunnable: unrunnableSteps(w).map((s) => s.id),
    runs: app.store.listRuns(w.id).slice(0, 20),
  });
  const ID = "(?<id>[^/]+)";

  const routes: Route[] = [
    ["GET", /^\/api\/status$/, () => ({
      version: VERSION,
      extensionConnected: deps.ingest.connected > 0,
      llmConfigured: app.config.llm !== undefined,
    })],
    ["GET", /^\/api\/recordings$/, () => app.store.listRecordings().map((r) => ({ ...r, stepCount: app.store.listSteps(r.id).length }))],
    ["GET", new RegExp(`^/api/recordings/${ID}$`), ({ params }) => {
      const recording = app.store.getRecording(params.id!);
      if (!recording) throw new NotFoundError(`Recording not found: ${params.id}`);
      return { recording, steps: app.store.listSteps(recording.id) };
    }],
    ["DELETE", new RegExp(`^/api/recordings/${ID}$`), ({ params }) => {
      if (!app.store.deleteRecording(params.id!)) throw new NotFoundError(`Recording not found: ${params.id}`);
      return { deleted: true };
    }],
    ["POST", new RegExp(`^/api/recordings/${ID}/compile$`), ({ params }) => compileAndSave(app, params.id!)],
    ["GET", /^\/api\/workflows$/, () => app.store.listWorkflows()],
    ["GET", new RegExp(`^/api/workflows/${ID}$`), ({ params }) => detail(workflowOr404(params.id!))],
    ["PUT", new RegExp(`^/api/workflows/${ID}$`), async ({ params, body }) => {
      const w = workflowOr404(params.id!);
      const next = applyPatch(w, parsePatch(await body()), app.now());
      if (app.store.uniqueWorkflowName(next.name, w.id) !== next.name) throw new HttpError(409, `A workflow named "${next.name}" already exists`);
      return detail(app.store.saveWorkflow(next));
    }],
    ["DELETE", new RegExp(`^/api/workflows/${ID}$`), ({ params }) => {
      if (!app.store.deleteWorkflow(params.id!)) throw new NotFoundError(`Workflow not found: ${params.id}`);
      return { deleted: true };
    }],
    ["GET", new RegExp(`^/api/workflows/${ID}/enrich/preview$`), ({ params }) => buildEnrichmentPayload(workflowOr404(params.id!))],
    ["POST", new RegExp(`^/api/workflows/${ID}/enrich$`), async ({ params, body }) => {
      const w = workflowOr404(params.id!);
      const b = await body();
      const user = isRecord(b) && typeof b.user === "string" ? b.user : undefined;
      return enrichSaved(app, w, llmClientFor(app.config.llm, deps.fetchImpl), user);
    }],
    ["GET", new RegExp(`^/api/workflows/${ID}/export$`), ({ params, url }) => {
      const format = url.searchParams.get("format");
      if (!isExportFormat(format)) throw new ValidationError("format must be playwright or stagehand");
      const w = workflowOr404(params.id!);
      return new RawBody(exportWorkflow(w, format), "text/javascript; charset=utf-8", `${slug(w.name)}.${format}.mjs`);
    }],
    ["POST", new RegExp(`^/api/workflows/${ID}/run$`), async ({ params, body }) => {
      const w = workflowOr404(params.id!);
      const b = await body();
      const values = isRecord(b) && b.params !== undefined ? b.params : {};
      const headless = !(isRecord(b) && b.headed === true);
      return runReport(w, await run(w, values, headless));
    }],
    ["GET", /^\/api\/settings$/, () => settingsView(app)],
    ["PUT", /^\/api\/settings$/, async ({ body }) => {
      app.saveConfig(applySettings(app.config, await body()));
      return settingsView(app);
    }],
    ["POST", /^\/api\/pair\/reset$/, () => {
      app.saveConfig({ ...app.config, pairToken: newToken() });
      return { pairToken: app.config.pairToken };
    }],
  ];

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      if (!authorized(req.headers.authorization, deps.dashboardToken)) {
        throw new HttpError(401, "Open the dashboard from the link printed by npx browserlearn");
      }
      const matching = routes.filter(([, pattern]) => pattern.test(url.pathname));
      if (matching.length === 0) throw new NotFoundError("Not found");
      const route = matching.find(([method]) => method === req.method);
      if (!route) throw new HttpError(405, "Method not allowed");
      const groups = route[1].exec(url.pathname)!.groups ?? {};
      const params = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, decodeURIComponent(v)]));
      const result = await route[2]({ params, url, body: () => readJson(req) });
      if (result instanceof RawBody) {
        res
          .writeHead(200, {
            "content-type": result.contentType,
            "content-disposition": `attachment; filename="${result.filename}"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          })
          .end(result.body);
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else sendJson(res, 500, { error: errorMessage(err) });
    }
    return true;
  };
}

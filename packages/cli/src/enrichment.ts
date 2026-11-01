import { applyEnrichment, buildEnrichmentPayload, parseEnrichment } from "@browserlearn/core/enrich";
import { type LlmClient, openAiCompatibleClient } from "@browserlearn/core/llm";
import type { Workflow } from "@browserlearn/core/types";
import type { App } from "./app.js";
import { hostedLlmClient } from "./backend.js";
import type { LlmSettings } from "./config.js";
import { errorMessage, HttpError } from "./errors.js";

export function llmClientFor(settings: LlmSettings | undefined, fetchImpl?: typeof fetch, app?: App): LlmClient {
  if (!settings) throw new HttpError(409, "Set up an LLM in Settings first");
  if (settings.baseUrl === "hosted") {
    if (!app) throw new HttpError(409, "Hosted compiles require the local app");
    return hostedLlmClient(app, fetchImpl ?? fetch);
  }
  return openAiCompatibleClient({ ...settings, ...(fetchImpl ? { fetchImpl } : {}) });
}

/** Sends the payload (or the user's edit of it) and saves the result; on any failure the workflow is kept as is. */
export async function enrichSaved(
  app: App,
  w: Workflow,
  client: LlmClient,
  user?: string,
): Promise<{ workflow: Workflow; enriched: boolean; error?: string }> {
  const payload = buildEnrichmentPayload(w);
  try {
    const reply = await client.complete(payload.system, user ?? payload.user);
    const enriched = applyEnrichment(w, parseEnrichment(reply));
    const saved = app.store.saveWorkflow({ ...enriched, name: app.store.uniqueWorkflowName(enriched.name, w.id), updatedAt: app.now() });
    return { workflow: saved, enriched: true };
  } catch (err) {
    return { workflow: w, enriched: false, error: errorMessage(err) };
  }
}

import { compileRecording } from "@browserlearn/core/compile";
import { exportPlaywright, exportStagehand } from "@browserlearn/core/export";
import type { Store } from "@browserlearn/core/store";
import type { Workflow } from "@browserlearn/core/types";
import type { App } from "./app.js";
import { HttpError, NotFoundError } from "./errors.js";

export type ExportFormat = "playwright" | "stagehand";

export const isExportFormat = (v: unknown): v is ExportFormat => v === "playwright" || v === "stagehand";

/** A workflow by name, or by id. */
export function findWorkflow(store: Store, ref: string): Workflow | undefined {
  return store.getWorkflowByName(ref) ?? store.getWorkflow(ref);
}

export function exportWorkflow(w: Workflow, format: ExportFormat): string {
  return format === "playwright" ? exportPlaywright(w) : exportStagehand(w);
}

export function compileAndSave(app: App, recordingId: string): Workflow {
  const rec = app.store.getRecording(recordingId);
  if (!rec) throw new NotFoundError(`Recording not found: ${recordingId}`);
  const steps = app.store.listSteps(recordingId);
  if (steps.length === 0) throw new HttpError(409, "Recording has no steps");
  const w = compileRecording(rec, steps, { now: app.now() });
  return app.store.saveWorkflow({ ...w, name: app.store.uniqueWorkflowName(w.name.trim() || "Untitled workflow") });
}

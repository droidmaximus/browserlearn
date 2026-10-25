import { toPublicWorkflow } from "@browserlearn/core/public";
import type { RunStatus, Workflow } from "@browserlearn/core/types";
import type { App } from "./app.js";
import { type RunOptions, type RunOutcome, runWorkflow } from "./runner.js";

export async function executeRun(app: App, w: Workflow, input: unknown, opts: Partial<RunOptions> = {}): Promise<RunOutcome> {
  const outcome = await runWorkflow(w, input, {
    screenshotDir: app.paths.runs,
    now: app.now,
    ...opts,
    onUpdate: (run) => app.store.saveRun(run),
  });
  app.store.saveRun(outcome.run);
  return outcome;
}

export interface RunReport {
  runId: string;
  status: RunStatus;
  failedStep?: number;
  failedStepName?: string;
  error?: string;
  outputs: RunOutcome["outputs"];
  screenshot?: string;
  log: string[];
}

/** What a run looks like to the user or an agent: public step names only. */
export function runReport(w: Workflow, o: RunOutcome): RunReport {
  const names = toPublicWorkflow(w).steps.map((s) => s.name);
  const failed = o.run.failedStep;
  return {
    runId: o.run.id,
    status: o.run.status,
    ...(failed !== undefined ? { failedStep: failed, failedStepName: names[failed] } : {}),
    ...(o.error ? { error: o.error } : {}),
    outputs: o.outputs,
    ...(o.screenshot ? { screenshot: o.screenshot } : {}),
    log: o.run.log,
  };
}

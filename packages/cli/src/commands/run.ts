import { parseArgs } from "node:util";
import { openApp } from "../app.js";
import type { Io } from "../io.js";
import { executeRun, runReport } from "../runs.js";
import { findWorkflow } from "../workflows.js";

const USAGE = `Usage: browserlearn run <workflow> [--params '{"name":"value"}'] [--headed]`;

function parseParams(text: string | undefined): unknown {
  if (text === undefined) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    v = undefined;
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v;
  throw new Error("--params must be a JSON object");
}

export async function runCmd(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { params: { type: "string", short: "p" }, headed: { type: "boolean" } },
  });
  const ref = positionals[0];
  if (!ref) throw new Error(USAGE);
  const params = parseParams(values.params);
  const app = openApp({ env: io.env });
  try {
    const w = findWorkflow(app.store, ref);
    if (!w) throw new Error(`No workflow named "${ref}". Run "browserlearn list" to see your workflows.`);
    const outcome = await executeRun(app, w, params, { headless: !values.headed });
    io.stdout(`${JSON.stringify(runReport(w, outcome), null, 2)}\n`);
    return outcome.run.status === "succeeded" ? 0 : 1;
  } finally {
    app.close();
  }
}

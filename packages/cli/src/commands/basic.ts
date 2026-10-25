import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openApp } from "../app.js";
import { newToken } from "../config.js";
import type { Io } from "../io.js";
import { exportWorkflow, findWorkflow, isExportFormat } from "../workflows.js";

export async function pairCmd(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { reset: { type: "boolean" } } });
  const app = openApp({ env: io.env });
  try {
    if (values.reset) app.saveConfig({ ...app.config, pairToken: newToken() });
    io.stdout(`Pairing code (paste it into the BrowserLearn extension):\n${app.config.pairToken}\n`);
    return 0;
  } finally {
    app.close();
  }
}

export async function listCmd(_args: string[], io: Io): Promise<number> {
  const app = openApp({ env: io.env });
  try {
    const workflows = app.store.listWorkflows();
    if (workflows.length === 0) {
      io.stdout("No workflows yet. Record one with the BrowserLearn extension.\n");
      return 0;
    }
    for (const w of workflows) {
      const params = w.params.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ");
      io.stdout(`${w.name}  v${w.version}${params ? `  (${params})` : ""}\n`);
    }
    return 0;
  } finally {
    app.close();
  }
}

const EXPORT_USAGE = "Usage: browserlearn export <workflow> --format playwright|stagehand [--out file]";

export async function exportCmd(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { format: { type: "string", short: "f" }, out: { type: "string", short: "o" } },
  });
  const ref = positionals[0];
  if (!ref || !isExportFormat(values.format)) throw new Error(EXPORT_USAGE);
  const app = openApp({ env: io.env });
  try {
    const w = findWorkflow(app.store, ref);
    if (!w) throw new Error(`No workflow named "${ref}". Run "browserlearn list" to see your workflows.`);
    const script = exportWorkflow(w, values.format);
    if (values.out) {
      writeFileSync(values.out, script);
      io.stdout(`Wrote ${values.out}\n`);
    } else {
      io.stdout(script);
    }
    return 0;
  } finally {
    app.close();
  }
}

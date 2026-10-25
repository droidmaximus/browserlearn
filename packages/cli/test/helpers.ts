import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawStep, Recording } from "@browserlearn/core/types";
import { type App, type OpenAppOptions, openApp } from "../src/app.js";
import type { Io } from "../src/io.js";

export const tempHome = (): string => mkdtempSync(join(tmpdir(), "browserlearn-"));

export interface CapturedIo extends Io {
  out: string[];
  err: string[];
  stop(): void;
}

export function captureIo(env: NodeJS.ProcessEnv): CapturedIo {
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, env, stdout: (t) => void out.push(t), stderr: (t) => void err.push(t), untilStopped: () => stopped, stop: () => stop() };
}

export const testApp = (opts: OpenAppOptions = {}): App => openApp({ env: { BROWSERLEARN_HOME: tempHome() }, ...opts });

export const formRecording = (base: string, id = "rec-form"): Recording => ({
  id,
  name: "Create invoice",
  startUrl: `${base}/form`,
  startedAt: 1,
  status: "recording",
});

/** A recorded run through the fixture form: type, select, tick, save, open the customer, finish. */
export function formSteps(base: string): RawStep[] {
  const s = { axSnippet: "", framePath: [] as number[], ts: 0 };
  return [
    { ...s, seq: 1, action: "type", url: `${base}/form`, selectors: { role: "textbox", name: "Customer", css: "#customer" }, value: "Acme Corp" },
    { ...s, seq: 2, action: "select", url: `${base}/form`, selectors: { role: "combobox", name: "Plan", css: "#plan" }, value: "pro" },
    { ...s, seq: 3, action: "click", url: `${base}/form`, selectors: { role: "checkbox", name: "Rush", css: "#rush" } },
    { ...s, seq: 4, action: "click", url: `${base}/form`, selectors: { role: "button", name: "Save", css: "#save" } },
    { ...s, seq: 5, action: "click", url: `${base}/saved?customer=Acme+Corp&plan=pro&rush=on`, selectors: { role: "link", name: "Acme Corp details" } },
    { ...s, seq: 6, action: "click", url: `${base}/customers/Acme%20Corp`, selectors: { role: "button", name: "Done" } },
  ];
}

export function seedRecording(app: App, base = "https://app.test", id = "rec-form"): string {
  app.store.createRecording(formRecording(base, id));
  for (const step of formSteps(base)) app.store.ingestStep(id, step);
  app.store.finishRecording(id, 2);
  return id;
}

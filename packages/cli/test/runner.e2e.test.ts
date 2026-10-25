import { existsSync } from "node:fs";
import type { RawStep } from "@browserlearn/core/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { launchBrowser } from "../src/runner.js";
import { executeRun } from "../src/runs.js";
import { compileAndSave } from "../src/workflows.js";
import { type FixtureServer, startFixtureServer } from "./fixture-server.js";
import { seedRecording, testApp } from "./helpers.js";

const launch = (headless: boolean) => launchBrowser(headless, { BROWSERLEARN_BROWSER: "chromium" });

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function noteRecording(app: App, id: string, startUrl: string, framePath: number[]): string {
  app.store.createRecording({ id, name: id, startUrl, startedAt: 1, status: "recording" });
  const base = { axSnippet: "", framePath, ts: 0, url: startUrl };
  const steps: RawStep[] = [
    { ...base, seq: 1, action: "type", selectors: { role: "textbox", name: "Note", css: "#n" }, value: "first note" },
    { ...base, seq: 2, action: "click", selectors: { role: "button", name: "Add" } },
  ];
  for (const s of steps) app.store.ingestStep(id, s);
  return id;
}

describe("runner (real browser)", () => {
  let fixture: FixtureServer;
  let app: App;
  beforeAll(async () => {
    fixture = await startFixtureServer();
    app = testApp();
  });
  afterAll(async () => {
    app.close();
    await fixture.close();
  });

  it("replays a recorded form with new values", async () => {
    const w = compileAndSave(app, seedRecording(app, fixture.url, "rec-ok"));
    const outcome = await executeRun(app, w, { param_1: "Globex Inc", param_2: "free" }, { launch });
    expect(outcome.error).toBeUndefined();
    expect(outcome.run.status).toBe("succeeded");
    expect(fixture.submissions.at(-1)).toEqual({ customer: "Globex Inc", plan: "free", rush: "on" });
    expect(outcome.outputs.title).toBe("done");
    expect(app.store.getRun(outcome.run.id)!.status).toBe("succeeded");
    expect(app.store.getRun(outcome.run.id)!.params).toEqual({ param_1: "Globex Inc", param_2: "free" });
  });

  it("stops at the first mismatch and saves a screenshot", async () => {
    const w = compileAndSave(app, seedRecording(app, fixture.url, "rec-moved"));
    fixture.layout = "moved";
    try {
      const outcome = await executeRun(app, w, { param_1: "Globex Inc", param_2: "free" }, { launch, stepTimeoutMs: 1500 });
      expect(outcome.run.status).toBe("failed");
      expect(outcome.run.failedStep).toBe(w.steps.findIndex((s) => s.name.includes("Save")));
      expect(outcome.error).toContain("No element matched");
      expect(outcome.screenshot!.startsWith(app.paths.runs)).toBe(true);
      expect(existsSync(outcome.screenshot!)).toBe(true);
    } finally {
      fixture.layout = "normal";
    }
  });

  it("acts inside iframes and open shadow roots", async () => {
    const framed = compileAndSave(app, noteRecording(app, "rec-frame", `${fixture.url}/frame`, [0]));
    expect((await executeRun(app, framed, { param_1: "framed" }, { launch })).run.status).toBe("succeeded");
    await waitFor(() => fixture.notes.includes("framed"));

    const shadow = compileAndSave(app, noteRecording(app, "rec-shadow", `${fixture.url}/shadow`, []));
    expect((await executeRun(app, shadow, { param_1: "shadowed" }, { launch })).run.status).toBe("succeeded");
    await waitFor(() => fixture.notes.includes("shadowed"));
  });
});

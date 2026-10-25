import type { Workflow } from "@browserlearn/core/types";
import { describe, expect, it } from "vitest";
import { openApp } from "../src/app.js";
import { main } from "../src/main.js";
import { runWorkflow } from "../src/runner.js";
import { runReport } from "../src/runs.js";
import { compileAndSave } from "../src/workflows.js";
import { captureIo, seedRecording, tempHome, testApp } from "./helpers.js";

const noLaunch = async (): Promise<never> => {
  throw new Error("browser unavailable");
};

describe("runWorkflow without a browser", () => {
  it("fails before launching when params are invalid", async () => {
    const app = testApp();
    const w = compileAndSave(app, seedRecording(app));
    let launched = false;
    const outcome = await runWorkflow(w, {}, {
      screenshotDir: app.paths.runs,
      launch: async () => {
        launched = true;
        throw new Error("unexpected");
      },
    });
    expect(launched).toBe(false);
    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failedStep).toBeUndefined();
    expect(outcome.error).toBe("Missing parameter: param_1");
    app.close();
  });

  it("never keeps secret values in the run record", async () => {
    const app = testApp();
    const base = compileAndSave(app, seedRecording(app));
    const w: Workflow = {
      ...base,
      params: [...base.params, { name: "pw", description: "", required: false, secret: true }],
    };
    const outcome = await runWorkflow(w, { param_1: "bob@x.com", param_2: "pro", pw: "hunter2" }, { screenshotDir: app.paths.runs, launch: noLaunch });
    expect(outcome.run.params).toEqual({ param_1: "[REDACTED:email]", param_2: "pro", pw: "[REDACTED:password]" });
    expect(outcome.error).toBe("browser unavailable");
    app.close();
  });

  it("omits query and fragment from successful run outputs", async () => {
    const app = testApp();
    const w: Workflow = {
      id: "w",
      name: "Go",
      description: "",
      version: 1,
      params: [],
      steps: [
        {
          id: "s1",
          name: "Open",
          action: "navigate",
          url: "https://app.test/done",
          fallbacks: [],
          framePath: [],
          expected: { urlPath: "https://app.test/done" },
        },
      ],
      sourceRecordingId: "r",
      createdAt: 0,
      updatedAt: 0,
    };
    const page = {
      url: () => "https://app.test/done?token=SECRET#frag",
      title: async () => "Done",
      goto: async () => undefined,
    };
    const outcome = await runWorkflow(w, {}, {
      screenshotDir: app.paths.runs,
      launch: async () => ({ newPage: async () => page, close: async () => undefined }) as never,
    });
    const leaked = JSON.stringify({ outputs: outcome.outputs, report: runReport(w, outcome) });
    expect(outcome.run.status).toBe("succeeded");
    expect(leaked).not.toContain("SECRET");
    expect(leaked).not.toContain("token=");
    expect(leaked).not.toContain("?token");
    expect(leaked).not.toContain("#frag");
    app.close();
  });

  it("reports public step names only", async () => {
    const app = testApp();
    const w = compileAndSave(app, seedRecording(app));
    const linkStep = w.steps.findIndex((s) => s.name.includes("Acme Corp details"));
    const report = runReport(w, {
      run: { id: "r", workflowId: w.id, params: {}, status: "failed", failedStep: linkStep, log: [], startedAt: 0 },
      outputs: {},
      error: "x",
    });
    expect(report.failedStepName).toBe('Click link "{param_1} details"');
    app.close();
  });
});

describe("browserlearn run", () => {
  it("prints a JSON report and exits 1 on failure", async () => {
    const home = tempHome();
    const app = openApp({ env: { BROWSERLEARN_HOME: home } });
    compileAndSave(app, seedRecording(app));
    app.close();
    const io = captureIo({ BROWSERLEARN_HOME: home });
    expect(await main(["run", "Create invoice", "--params", "{}"], io)).toBe(1);
    expect(JSON.parse(io.out.join(""))).toMatchObject({ status: "failed", error: "Missing parameter: param_1" });

    const bad = captureIo({ BROWSERLEARN_HOME: home });
    expect(await main(["run", "Create invoice", "--params", "nope"], bad)).toBe(1);
    expect(bad.err.join("")).toContain("--params must be a JSON object");
  });
});

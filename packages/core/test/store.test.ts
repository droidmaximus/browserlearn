import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store.js";
import type { RawStep, Workflow } from "../src/types.js";
import { compiledFixture, fixtureRecording, fixtureSteps } from "./fixtures.js";

let store: Store;
beforeEach(() => {
  store = new Store(":memory:");
});
afterEach(() => store.close());

const { endedAt: _e, ...openRecording } = { ...fixtureRecording, status: "recording" as const };

it("stores recordings and returns steps in seq order", () => {
  store.createRecording(openRecording);
  for (const s of [...fixtureSteps].reverse()) store.ingestStep("rec1", s);
  expect(store.listSteps("rec1")).toEqual(fixtureSteps);
  const done = store.finishRecording("rec1", 99);
  expect(done).toMatchObject({ status: "complete", endedAt: 99 });
  expect(store.getRecording("rec1")).toEqual(done);
  expect(store.listRecordings()).toHaveLength(1);
});

describe("redaction before disk", () => {
  it("redacts recordings before storing them", () => {
    const stored = store.createRecording({ ...openRecording, name: "bob@x.com", startUrl: "https://app.test/?token=SECRET123" });
    expect(stored).toMatchObject({ name: "[REDACTED:email]", startUrl: "https://app.test/?token=REDACTED" });
    expect(store.getRecording("rec1")).toEqual(stored);
  });

  it("redacts steps before storing them", () => {
    store.createRecording(openRecording);
    const wire = { ...fixtureSteps[2]!, value: "bob@x.com", outerHTML: "<input value='bob@x.com'>" } as RawStep;
    const stored = store.ingestStep("rec1", wire).step;
    expect(stored).toEqual({ ...fixtureSteps[2], value: "[REDACTED:email]" });
    expect(store.listSteps("rec1")).toEqual([stored]);
  });

  it("applies field rules on ingest", () => {
    store.createRecording(openRecording);
    store.ingestStep("rec1", fixtureSteps[2]!, [{ domain: "app.test", field: "customer" }]);
    expect(store.listSteps("rec1")[0]?.value).toBe("[REDACTED:field]");
  });

  it("drops invalid steps without storing them", () => {
    store.createRecording(openRecording);
    expect(store.ingestStep("rec1", { ...fixtureSteps[0]!, action: "hover" })).toEqual({ status: "dropped" });
    expect(store.listSteps("rec1")).toEqual([]);
  });

  it("has no raw step insert", () => {
    expect("appendStep" in store).toBe(false);
  });
});

it("ignores a re-sent step with the same seq", () => {
  store.createRecording(openRecording);
  store.ingestStep("rec1", fixtureSteps[2]!);
  expect(() => store.ingestStep("rec1", { ...fixtureSteps[2]!, value: "Other" })).not.toThrow();
  expect(store.listSteps("rec1")).toEqual([fixtureSteps[2]]);
});

it("throws when finishing an unknown recording", () => {
  expect(() => store.finishRecording("nope", 1)).toThrow(/recording not found/);
});

it("bumps workflow version on re-save and keeps createdAt", () => {
  const w = compiledFixture();
  expect(store.saveWorkflow(w).version).toBe(1);
  const again = store.saveWorkflow({ ...w, name: "Renamed", updatedAt: 2000 });
  expect(again).toMatchObject({ version: 2, createdAt: 1000, updatedAt: 2000, name: "Renamed" });
  expect(store.getWorkflowByName("Renamed")?.version).toBe(2);
  expect(store.listWorkflows()).toHaveLength(1);
});

it("upserts runs", () => {
  store.saveRun({ id: "r1", workflowId: "id1", params: {}, status: "running", log: [], startedAt: 1 });
  store.saveRun({ id: "r1", workflowId: "id1", params: {}, status: "failed", failedStep: 2, log: ["x"], startedAt: 1, endedAt: 5 });
  expect(store.listRuns("id1")).toEqual([
    { id: "r1", workflowId: "id1", params: {}, status: "failed", failedStep: 2, log: ["x"], startedAt: 1, endedAt: 5 },
  ]);
});

it("moves a run to its new workflow and start time on upsert", () => {
  store.saveRun({ id: "r1", workflowId: "id1", params: {}, status: "running", log: [], startedAt: 1 });
  store.saveRun({ id: "r2", workflowId: "id2", params: {}, status: "running", log: [], startedAt: 5 });
  store.saveRun({ id: "r1", workflowId: "id2", params: {}, status: "running", log: [], startedAt: 9 });
  expect(store.listRuns("id1")).toEqual([]);
  expect(store.listRuns("id2").map((r) => r.id)).toEqual(["r1", "r2"]);
});

it("lists the most recently inserted first when timestamps tie", () => {
  for (const id of ["a", "b", "c"]) store.createRecording({ ...openRecording, id });
  expect(store.listRecordings().map((r) => r.id)).toEqual(["c", "b", "a"]);
  for (const id of ["w1", "w2"]) store.saveWorkflow({ ...compiledFixture(), id });
  expect(store.listWorkflows().map((w) => w.id)).toEqual(["w2", "w1"]);
  expect(store.getWorkflowByName("Create invoice")?.id).toBe("w2");
  for (const id of ["r1", "r2"]) store.saveRun({ id, workflowId: "w1", params: {}, status: "running", log: [], startedAt: 1 });
  expect(store.listRuns("w1").map((r) => r.id)).toEqual(["r2", "r1"]);
});

describe("database file", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bl-store-"));
    file = join(dir, "browserlearn.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const pragma = (name: string): unknown => {
    const db = new DatabaseSync(file);
    try {
      return Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];
    } finally {
      db.close();
    }
  };

  it("records schema version 1 and uses WAL", () => {
    new Store(file).close();
    expect(pragma("user_version")).toBe(1);
    expect(pragma("journal_mode")).toBe("wal");
  });

  it("keeps data across reopen without re-running migrations", () => {
    const first = new Store(file);
    first.createRecording(openRecording);
    first.close();
    const again = new Store(file);
    expect(again.getRecording("rec1")).toEqual(openRecording);
    again.close();
    expect(pragma("user_version")).toBe(1);
  });

  it("refuses a database from a newer version", () => {
    new Store(file).close();
    const db = new DatabaseSync(file);
    db.exec("PRAGMA user_version = 99");
    db.close();
    expect(() => new Store(file)).toThrow(/schema version 99/);
  });

  it("waits for another process's write lock instead of failing", async () => {
    new Store(file).close();
    const holder = spawn(
      process.execPath,
      [
        "--no-warnings",
        "--input-type=module",
        "-e",
        `import { DatabaseSync } from "node:sqlite";
         const db = new DatabaseSync(process.argv[1]);
         db.exec("BEGIN IMMEDIATE");
         console.log("locked");
         setTimeout(() => { db.exec("COMMIT"); db.close(); }, 300);`,
        file,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()));
    const s = new Store(file);
    try {
      expect(() => s.createRecording(openRecording)).not.toThrow();
    } finally {
      s.close();
      await new Promise((resolve) => holder.once("exit", resolve));
    }
  });
});

it("stores a single license", () => {
  expect(store.getLicense()).toBeUndefined();
  const lic = { token: "t", plan: "pro" as const, installId: "i", expiresAt: 10, lastRefreshedAt: 1 };
  store.setLicense(lic);
  store.setLicense({ ...lic, token: "t2" });
  expect(store.getLicense()?.token).toBe("t2");
  store.clearLicense();
  expect(store.getLicense()).toBeUndefined();
});

describe("store carry-overs", () => {
  const rec = (id: string, startedAt = 1) => ({ id, name: "R", startUrl: "https://app.test/", startedAt, status: "recording" as const });
  const step = (seq: number, extra: Record<string, unknown> = {}) => ({
    seq,
    action: "click",
    selectors: { css: "#a" },
    axSnippet: "",
    url: "https://app.test/",
    framePath: [],
    ts: 0,
    ...extra,
  });
  const wf = (id: string, name: string, updatedAt: number, sourceRecordingId = "r1"): Workflow => ({
    id,
    name,
    description: "",
    version: 1,
    params: [],
    steps: [],
    sourceRecordingId,
    createdAt: updatedAt,
    updatedAt,
  });
  let s: Store;
  beforeEach(() => {
    s = new Store(":memory:");
  });

  it("reports stored, duplicate and dropped steps", () => {
    s.createRecording(rec("r1"));
    expect(s.ingestStep("r1", step(1)).status).toBe("stored");
    expect(s.ingestStep("r1", step(1, { axSnippet: "changed" })).status).toBe("duplicate");
    expect(s.listSteps("r1")[0]!.axSnippet).toBe("");
    expect(s.ingestStep("r1", { seq: 2, action: "hover" })).toEqual({ status: "dropped" });
  });

  it("refuses steps for an unknown recording", () => {
    expect(() => s.ingestStep("nope", step(1))).toThrow(/FOREIGN KEY/);
  });

  it("lists equal timestamps newest-inserted first", () => {
    s.createRecording(rec("a", 5));
    s.createRecording(rec("b", 5));
    expect(s.listRecordings().map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("finds the most recently updated workflow by name", () => {
    s.saveWorkflow(wf("w1", "Same", 1));
    s.saveWorkflow(wf("w2", "Same", 2));
    expect(s.getWorkflowByName("Same")!.id).toBe("w2");
  });

  it("deletes recordings with their steps, and workflows with their runs", () => {
    s.createRecording(rec("r1"));
    s.ingestStep("r1", step(1));
    expect(s.deleteRecording("r1")).toBe(true);
    expect(s.listSteps("r1")).toEqual([]);
    expect(s.deleteRecording("r1")).toBe(false);
    s.saveWorkflow(wf("w1", "W", 1));
    s.saveRun({ id: "run1", workflowId: "w1", params: {}, status: "succeeded", log: [], startedAt: 1 });
    expect(s.getRun("run1")!.status).toBe("succeeded");
    expect(s.deleteWorkflow("w1")).toBe(true);
    expect(s.getRun("run1")).toBeUndefined();
    expect(s.deleteWorkflow("w1")).toBe(false);
  });

  it("makes workflow names unique", () => {
    expect(s.uniqueWorkflowName("W")).toBe("W");
    s.saveWorkflow(wf("w1", "W", 1));
    expect(s.uniqueWorkflowName("W")).toBe("W (2)");
    expect(s.uniqueWorkflowName("W", "w1")).toBe("W");
    s.saveWorkflow(wf("w2", "W (2)", 2));
    expect(s.uniqueWorkflowName("W")).toBe("W (3)");
  });

  it("finds the latest workflow compiled from a recording", () => {
    s.saveWorkflow(wf("w1", "A", 1, "r9"));
    s.saveWorkflow(wf("w2", "B", 2, "r9"));
    expect(s.findWorkflowBySource("r9")!.id).toBe("w2");
    expect(s.findWorkflowBySource("other")).toBeUndefined();
  });
});

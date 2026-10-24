import { afterEach, beforeEach, expect, it } from "vitest";
import { Store } from "../src/store.js";
import { compiledFixture, fixtureRecording, fixtureSteps } from "./fixtures.js";

let store: Store;
beforeEach(() => {
  store = new Store(":memory:");
});
afterEach(() => store.close());

it("stores recordings and returns steps in seq order", () => {
  store.createRecording({ ...fixtureRecording, status: "recording", endedAt: undefined });
  for (const s of [...fixtureSteps].reverse()) store.appendStep("rec1", s);
  expect(store.listSteps("rec1").map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  const done = store.finishRecording("rec1", 99);
  expect(done).toMatchObject({ status: "complete", endedAt: 99 });
  expect(store.getRecording("rec1")).toEqual(done);
  expect(store.listRecordings()).toHaveLength(1);
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

it("stores a single license", () => {
  expect(store.getLicense()).toBeUndefined();
  const lic = { token: "t", plan: "pro" as const, installId: "i", expiresAt: 10, lastRefreshedAt: 1 };
  store.setLicense(lic);
  store.setLicense({ ...lic, token: "t2" });
  expect(store.getLicense()?.token).toBe("t2");
  store.clearLicense();
  expect(store.getLicense()).toBeUndefined();
});

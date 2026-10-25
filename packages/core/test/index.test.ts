import { expect, it } from "vitest";
import * as core from "../src/index.js";

it("exposes the public API", () => {
  for (const name of [
    "paramsToJsonSchema",
    "redactText",
    "redactUrl",
    "redactStep",
    "redactRecording",
    "safeRedactStep",
    "chooseLocators",
    "describeLocator",
    "urlPath",
    "collapseSteps",
    "unrunnableSteps",
    "compileRecording",
    "generateLicenseKeyPair",
    "signLicense",
    "verifyLicense",
    "LICENSE_TTL_MS",
    "LICENSE_GRACE_MS",
    "openAiCompatibleClient",
    "buildSkeleton",
    "buildEnrichmentPayload",
    "parseEnrichment",
    "applyEnrichment",
    "enrichWorkflow",
    "locatorExpr",
    "exportPlaywright",
    "exportStagehand",
  ]) {
    expect(core, name).toHaveProperty(name);
  }
});

it("does not leak internal export helpers", () => {
  for (const name of ["q", "oneLine", "urlChunks", "neededRef"]) {
    expect(core, name).not.toHaveProperty(name);
  }
});

it("keeps the SQLite store off the root entry", async () => {
  expect(core).not.toHaveProperty("Store");
  expect(await import("../src/store.js")).toHaveProperty("Store");
});

it("generates random UUIDs without node:crypto", () => {
  const rec = { id: "r", name: "R", startUrl: "https://a.test/", startedAt: 0, status: "complete" as const };
  const w = core.compileRecording(rec, [], { now: 0 });
  expect(w.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(w.steps[0]!.id).not.toBe(w.id);
});

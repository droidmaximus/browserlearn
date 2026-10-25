import { expect, it } from "vitest";
import * as core from "../src/index.js";

it("exposes the public API", () => {
  for (const name of [
    "paramsToJsonSchema",
    "redactText",
    "redactUrl",
    "redactStep",
    "safeRedactStep",
    "chooseLocators",
    "describeLocator",
    "urlPath",
    "collapseSteps",
    "unrunnableSteps",
    "compileRecording",
    "Store",
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
  for (const name of ["q", "oneLine", "urlChunks"]) {
    expect(core, name).not.toHaveProperty(name);
  }
});

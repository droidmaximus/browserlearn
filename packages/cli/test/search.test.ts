import { describe, expect, it } from "vitest";
import { searchRecordings } from "../src/search.js";
import { seedRecording, testApp } from "./helpers.js";

describe("searchRecordings", () => {
  it("matches recording names and element labels", () => {
    const app = testApp();
    seedRecording(app);
    expect(searchRecordings(app.store, "invoice").map((r) => r.id)).toEqual(["rec-form"]);
    const hits = searchRecordings(app.store, "done");
    expect(hits[0]!.matchingSteps).toEqual([{ seq: 6, action: "click", url: "https://app.test/customers/{value}", target: "Done" }]);
    app.close();
  });

  it("never matches on or returns typed values", () => {
    const app = testApp();
    seedRecording(app);
    expect(searchRecordings(app.store, "acme")).toEqual([]);
    const text = JSON.stringify(searchRecordings(app.store, "details"));
    expect(text).toContain("{value} details");
    expect(text).not.toMatch(/acme/i);
    app.close();
  });

  it("respects the limit", () => {
    const app = testApp();
    seedRecording(app, "https://app.test", "a");
    seedRecording(app, "https://app.test", "b");
    expect(searchRecordings(app.store, "invoice", 1)).toHaveLength(1);
    app.close();
  });
});

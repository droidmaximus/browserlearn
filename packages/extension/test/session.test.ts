import { describe, expect, it } from "vitest";
import { createSession } from "../src/session.js";
import { fakeChrome } from "./helpers.js";

describe("recording session", () => {
  it("requests the tab origin, injects all frames, and numbers steps", async () => {
    const chrome = fakeChrome();
    const notified: number[] = [];
    const session = createSession({
      chrome: chrome as never,
      uuid: () => "rec-1",
      now: () => 42,
      client: { notify: () => notified.push(1), connect: () => undefined, disconnect: () => undefined },
    });
    await session.pair("token", 7420);
    await chrome.permissions.request({ origins: ["https://app.test/*"] });
    const started = await session.start("Create invoice");
    expect(started.recordingId).toBe("rec-1");
    expect(chrome.granted.has("https://app.test/*")).toBe(true);
    expect(chrome.injected[0]).toMatchObject({ tabId: 1, files: ["content.js"], allFrames: true });
    expect(chrome.alarms).toContain("browserlearn.keepalive");
    session.handleCaptured({
      action: "type",
      selectors: { role: "textbox", name: "Customer" },
      axSnippet: "",
      url: "https://app.test/form",
      framePath: [],
      value: "Acme Corp",
      ts: 1,
    });
    session.handleCaptured({
      action: "click",
      selectors: { role: "button", name: "Save" },
      axSnippet: "",
      url: "https://app.test/form",
      framePath: [],
      ts: 2,
    });
    const q = session.queue();
    expect(q.items[0]).toMatchObject({ type: "recording.start", recording: { id: "rec-1", name: "Create invoice", status: "recording" } });
    expect(q.items[1]).toMatchObject({ type: "step", step: { seq: 1, action: "type", value: "Acme Corp" } });
    expect(q.items[2]).toMatchObject({ type: "step", step: { seq: 2, action: "click" } });
    expect(JSON.stringify(q.items[0])).not.toMatch(/screenshot/);
    await session.stop();
    expect(session.queue().items.at(-1)).toMatchObject({ type: "recording.stop", recordingId: "rec-1" });
    expect(notified.length).toBeGreaterThan(0);
  });

  it("turns a top-frame navigation into a navigate step and re-injects", async () => {
    const chrome = fakeChrome();
    const session = createSession({
      chrome: chrome as never,
      uuid: () => "rec-1",
      now: () => 1,
      client: { notify: () => undefined, connect: () => undefined, disconnect: () => undefined },
    });
    await session.pair("t", 7420);
    await chrome.permissions.request({ origins: ["https://app.test/*"] });
    await session.start("T");
    await session.onCommitted({ tabId: 1, frameId: 0, url: "https://app.test/saved" });
    const nav = session.queue().items.find((m) => m.type === "step" && m.step.action === "navigate");
    expect(nav).toMatchObject({ type: "step", step: { action: "navigate", url: "https://app.test/saved", framePath: [] } });
    expect(chrome.injected.length).toBeGreaterThan(1);
  });
});

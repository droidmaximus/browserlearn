import { describe, expect, it, vi } from "vitest";

describe("content script wiring", () => {
  it("posts captured clicks to the worker and skips extension pages", async () => {
    vi.resetModules();
    const sendMessage = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
    await import("../src/content.js");
    document.body.innerHTML = `<button id="go">Go</button>`;
    document.getElementById("go")!.click();
    expect(sendMessage).toHaveBeenCalled();
    const payload = sendMessage.mock.calls[0]![0] as { type: string; captured: { action: string } };
    expect(payload.type).toBe("captured");
    expect(payload.captured.action).toBe("click");
  });
});

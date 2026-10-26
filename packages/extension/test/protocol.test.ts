import { PROTOCOL_VERSION as CORE_VERSION } from "@browserlearn/core/protocol";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, ingestUrl, PROTOCOL_VERSION } from "../src/protocol.js";

describe("protocol constants", () => {
  it("matches @browserlearn/core/protocol", () => {
    expect(PROTOCOL_VERSION).toBe(CORE_VERSION);
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("only speaks loopback ingest", () => {
    expect(ingestUrl(DEFAULT_PORT)).toBe("ws://127.0.0.1:7420/ingest");
    expect(ingestUrl(9)).toBe("ws://127.0.0.1:9/ingest");
    expect(ingestUrl(DEFAULT_PORT)).not.toContain("0.0.0.0");
  });
});

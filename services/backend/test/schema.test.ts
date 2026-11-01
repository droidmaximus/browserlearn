import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db.js";

describe("schema", () => {
  it("migrates core tables", async () => {
    const db = openMemoryDb();
    const row = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='entitlements'`)
      .first<{ name: string }>();
    expect(row?.name).toBe("entitlements");
  });
});

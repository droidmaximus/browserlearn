import { describe, expect, it } from "vitest";
import { redactStep, redactText, redactUrl, safeRedactStep } from "../src/redact.js";
import type { RawStep } from "../src/types.js";

describe("redactText", () => {
  it.each([
    ["mail me at jane.doe@example.com", "mail me at [REDACTED:email]"],
    ["ssn 123-45-6789", "ssn [REDACTED:ssn]"],
    ["card 4111 1111 1111 1111 ok", "card [REDACTED:card] ok"],
    ["call (415) 555-0132", "call [REDACTED:phone]"],
    ["key sk-abcdefghijklmnopqrstuvwx", "key [REDACTED:key]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123", "jwt [REDACTED:jwt]"],
  ])("%s", (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it("leaves digit runs that fail the Luhn check alone", () => {
    expect(redactText("order 1234567890123")).toBe("order 1234567890123");
  });

  it("redacts a valid card adjacent to extra digits", () => {
    const out = redactText("card 4111 1111 1111 1111 123");
    expect(out).toContain("[REDACTED:card]");
    expect(out).not.toContain("4111");
  });
});

describe("redactUrl", () => {
  it("masks sensitive query params and PII values, keeps the rest", () => {
    const out = redactUrl("https://app.example.com/cb?code=abc&page=2&email=a@b.com");
    expect(out).toContain("code=REDACTED");
    expect(out).toContain("page=2");
    expect(out).not.toContain("a@b.com");
    expect(out.startsWith("https://app.example.com/cb?")).toBe(true);
  });

  it("redacts PII hidden by percent-encoding in the path", () => {
    expect(redactUrl("https://x.com/u/4111%201111%201111%201111")).not.toContain("4111");
  });

  it("drops query and fragment from unparseable URLs", () => {
    expect(redactUrl("/cb?token=abc&code=xyz")).toBe("/cb");
  });
});

const step = (over: Partial<RawStep>): RawStep => ({
  seq: 1,
  action: "type",
  selectors: { role: "textbox", name: "Email" },
  axSnippet: "textbox 'Email'",
  url: "https://app.example.com/login",
  framePath: [],
  ts: 0,
  ...over,
});

describe("redactStep", () => {
  it("always masks password values", () => {
    expect(redactStep(step({ value: "hunter2", isPassword: true })).value).toBe("[REDACTED:password]");
  });

  it("masks values matched by a domain field rule", () => {
    const out = redactStep(step({ value: "ACC-998877", selectors: { role: "textbox", name: "Account number" } }), [
      { domain: "example.com", field: "account" },
    ]);
    expect(out.value).toBe("[REDACTED:field]");
  });

  it("redacts PII inside values, ax snippets, and selectors", () => {
    const out = redactStep(
      step({ value: "jane@x.io", axSnippet: "text 'Hi jane@x.io'", selectors: { css: "[value='jane@x.io']" } }),
    );
    expect(JSON.stringify(out)).not.toContain("jane@x.io");
  });

  it("masks a field-rule value everywhere it appears in the step", () => {
    const out = redactStep(
      step({
        value: "ACC-998877",
        axSnippet: "textbox 'Account number' value 'ACC-998877'",
        selectors: { role: "textbox", name: "Account number", css: "[value='ACC-998877']" },
      }),
      [{ domain: "example.com", field: "account" }],
    );
    expect(JSON.stringify(out)).not.toContain("ACC-998877");
  });

  it("masks a password value everywhere it appears in the step", () => {
    const out = redactStep(step({ value: "hunter2", isPassword: true, axSnippet: "textbox 'Password' value 'hunter2'" }));
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("matches rule domains case-insensitively", () => {
    const out = redactStep(step({ value: "ACC-998877", selectors: { role: "textbox", name: "Account number" } }), [
      { domain: "Example.com", field: "account" },
    ]);
    expect(out.value).toBe("[REDACTED:field]");
  });

  it("does not apply rules for other domains", () => {
    const out = redactStep(step({ value: "ACC-998877", selectors: { role: "textbox", name: "Account number" } }), [
      { domain: "other.com", field: "account" },
    ]);
    expect(out.value).toBe("ACC-998877");
  });

  it("redacts PII inside test ids", () => {
    const out = redactStep(step({ selectors: { testId: "row-jane@x.io" } }));
    expect(JSON.stringify(out)).not.toContain("jane@x.io");
  });

  it("keeps ordinary values", () => {
    expect(redactStep(step({ value: "Acme Corp" })).value).toBe("Acme Corp");
  });
});

describe("safeRedactStep", () => {
  it("drops the step (returns null) when redaction throws", () => {
    const broken = step({});
    Object.defineProperty(broken, "axSnippet", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(safeRedactStep(broken)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { redactRecording, redactStep, redactText, redactUrl, safeRedactStep } from "../src/redact.js";
import type { RawStep, Recording } from "../src/types.js";

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

  it.each(["exp 0425 4111 1111 1111 1111", "cvv 123 4111 1111 1111 1111", "card 4111 1111 1111 1111 123"])(
    "redacts the whole digit span around a card: %s",
    (input) => {
      const out = redactText(input);
      expect(out).toContain("[REDACTED:card]");
      expect(out).not.toContain("1111");
    },
  );
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

  it("keeps encoded path segments unchanged when nothing is redacted", () => {
    expect(redactUrl("https://x.com/a%2Fb/c%3Fd?x=1")).toBe("https://x.com/a%2Fb/c%3Fd?x=1");
  });

  it("keeps malformed escapes in the path unchanged", () => {
    expect(redactUrl("https://x.com/%E0%A4%A")).toBe("https://x.com/%E0%A4%A");
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

  it("does not literal-mask short values inside selectors", () => {
    const out = redactStep(step({ value: "a", isPassword: true, selectors: { css: "[name='a']" } }));
    expect(out.selectors.css).toBe("[name='a']");
  });

  it("masks a field-rule value inside the step URL", () => {
    const out = redactStep(
      step({
        value: "ACC-998877",
        url: "https://app.example.com/s?acct=ACC-998877",
        selectors: { role: "textbox", name: "Account number" },
      }),
      [{ domain: "example.com", field: "account" }],
    );
    expect(out.url).not.toContain("ACC-998877");
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

describe("redactStep allowlist and validation", () => {
  it("drops fields that are not part of RawStep", () => {
    const wire = { ...step({ value: "x" }), outerHTML: "<input value='bob@x.com' data-ssn='123-45-6789'>" };
    const out = safeRedactStep(wire as RawStep);
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty("outerHTML");
    expect(JSON.stringify(out)).not.toContain("bob@x.com");
  });

  it("drops unknown selector fields", () => {
    const wire = step({ selectors: { role: "textbox", name: "Email", label: "bob@x.com" } as RawStep["selectors"] });
    expect(redactStep(wire).selectors).toEqual({ role: "textbox", name: "Email" });
  });

  it("never carries screenshot paths from the wire", () => {
    const out = redactStep(step({ screenshotBefore: "/etc/passwd", screenshotAfter: "../../x.png" }));
    expect(out).not.toHaveProperty("screenshotBefore");
    expect(out).not.toHaveProperty("screenshotAfter");
  });

  it("keeps every allowed field", () => {
    const full = step({ seq: 7, value: "Acme", isPassword: false, framePath: [0, 2], ts: 42 });
    expect(redactStep(full)).toEqual(full);
  });

  it.each<[string, Record<string, unknown>]>([
    ["unknown action", { action: "hover" }],
    ["non-integer seq", { seq: "1" }],
    ["non-string url", { url: 5 }],
    ["non-string axSnippet", { axSnippet: null }],
    ["non-array framePath", { framePath: "0" }],
    ["non-integer frame index", { framePath: [0.5] }],
    ["non-number ts", { ts: "now" }],
    ["non-string value", { value: 42 }],
    ["non-boolean isPassword", { isPassword: "yes" }],
    ["non-object selectors", { selectors: "css" }],
    ["non-string selector", { selectors: { css: 1 } }],
  ])("rejects a step with %s", (_label, over) => {
    const bad = { ...step({}), ...over } as unknown as RawStep;
    expect(() => redactStep(bad)).toThrow();
    expect(safeRedactStep(bad)).toBeNull();
  });

  it.each([null, "step", 3])("rejects non-object step %j", (bad) => {
    expect(safeRedactStep(bad as unknown as RawStep)).toBeNull();
  });
});

describe("masked values in step URLs", () => {
  const pw = (value: string, url: string) => redactStep(step({ value, isPassword: true, url })).url;

  it("masks whole path segments and never touches the host", () => {
    expect(pw("pass", "https://pass.test/passport")).toBe("https://pass.test/%5BREDACTED%3Apassword%5D");
  });

  it("masks whole query values", () => {
    expect(pw("hunter22", "https://a.test/s?q=xhunter22y&page=2")).toBe(
      "https://a.test/s?q=%5BREDACTED%3Apassword%5D&page=2",
    );
  });

  it("matches +-encoded spaces in the query and the path", () => {
    const out = pw("hunter two", "https://a.test/u/hunter+two/x?q=hunter+two");
    expect(out).toBe("https://a.test/u/%5BREDACTED%3Apassword%5D/x?q=%5BREDACTED%3Apassword%5D");
  });

  it("matches percent-encoded values in path segments", () => {
    expect(pw("hunter two", "https://a.test/u/hunter%20two")).toBe("https://a.test/u/%5BREDACTED%3Apassword%5D");
  });

  it("masks the value in unparseable URLs", () => {
    expect(pw("hunter22", "/u/hunter22?x=1")).toBe("/u/[REDACTED:password]");
  });
});

describe("redactRecording", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123";
  const rec: Recording = {
    id: "r1",
    name: "Invoice for bob@x.com",
    startUrl: `https://app.test/s/${jwt}?token=SECRET123&email=bob@x.com&page=2`,
    startedAt: 5,
    status: "recording",
  };

  it("redacts the start URL and the name", () => {
    const out = redactRecording(rec);
    const text = JSON.stringify(out);
    for (const leak of ["SECRET123", "bob@x.com", "eyJ"]) expect(text).not.toContain(leak);
    expect(out).toEqual({
      ...rec,
      name: "Invoice for [REDACTED:email]",
      startUrl: "https://app.test/s/%5BREDACTED%3Ajwt%5D?token=REDACTED&email=%5BREDACTED%3Aemail%5D&page=2",
    });
  });

  it("keeps only known fields", () => {
    const out = redactRecording({ ...rec, endedAt: 9, notes: "bob@x.com" } as Recording);
    expect(out).not.toHaveProperty("notes");
    expect(out.endedAt).toBe(9);
  });

  it.each<[string, Record<string, unknown>]>([
    ["non-string id", { id: 1 }],
    ["non-string startUrl", { startUrl: undefined }],
    ["non-number startedAt", { startedAt: "0" }],
    ["unknown status", { status: "paused" }],
    ["non-number endedAt", { endedAt: "x" }],
  ])("rejects a recording with %s", (_label, over) => {
    expect(() => redactRecording({ ...rec, ...over } as unknown as Recording)).toThrow();
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

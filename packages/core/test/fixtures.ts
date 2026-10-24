import { compileRecording } from "../src/compile.js";
import type { RawStep, Recording, Workflow } from "../src/types.js";

export const fixtureRecording: Recording = {
  id: "rec1",
  name: "Create invoice",
  startUrl: "https://app.test/invoices",
  startedAt: 0,
  endedAt: 10,
  status: "complete",
};

const base = { axSnippet: "", framePath: [] as number[], ts: 0 };
const customer = { role: "textbox", name: "Customer", css: "#customer" };

export const fixtureSteps: RawStep[] = [
  { ...base, seq: 1, action: "click", url: "https://app.test/invoices", selectors: { testId: "new-invoice", css: "#new" } },
  { ...base, seq: 2, action: "click", url: "https://app.test/invoices/new", selectors: customer },
  { ...base, seq: 3, action: "type", url: "https://app.test/invoices/new", selectors: customer, value: "Acm" },
  { ...base, seq: 4, action: "type", url: "https://app.test/invoices/new", selectors: customer, value: "Acme Corp" },
  { ...base, seq: 5, action: "scroll", url: "https://app.test/invoices/new", selectors: {} },
  {
    ...base,
    seq: 6,
    action: "type",
    url: "https://app.test/invoices/new",
    selectors: { role: "textbox", name: "Password", css: "#pw" },
    value: "[REDACTED:password]",
    isPassword: true,
  },
  { ...base, seq: 7, action: "click", url: "https://app.test/invoices/new", selectors: { role: "button", name: "Save" } },
  { ...base, seq: 8, action: "click", url: "https://app.test/invoices/42", selectors: { role: "link", name: "Back" } },
];

export function compiledFixture(): Workflow {
  let n = 0;
  return compileRecording(fixtureRecording, fixtureSteps, { now: 1000, newId: () => `id${++n}` });
}

import { expect, it } from "vitest";
import { paramsToJsonSchema } from "../src/schema.js";
import type { ParamDef } from "../src/types.js";

const params: ParamDef[] = [
  { name: "company", description: "Company name", required: true, example: "Acme", secret: false, scrubTerms: ["Acme"] },
  { name: "password", description: "Password", required: true, example: "hunter2", secret: true },
  { name: "note", description: "Note", required: false, secret: false },
];

it("builds a JSON schema without examples by default", () => {
  expect(paramsToJsonSchema(params)).toEqual({
    type: "object",
    properties: {
      company: { type: "string", description: "Company name" },
      password: { type: "string", description: "Password" },
      note: { type: "string", description: "Note" },
    },
    required: ["company", "password"],
    additionalProperties: false,
  });
});

it("includes non-secret examples only when asked", () => {
  expect(paramsToJsonSchema(params, { includeExamples: true }).properties).toEqual({
    company: { type: "string", description: "Company name", examples: ["Acme"] },
    password: { type: "string", description: "Password" },
    note: { type: "string", description: "Note" },
  });
});

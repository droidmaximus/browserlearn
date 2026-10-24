import { expect, it } from "vitest";
import { paramsToJsonSchema } from "../src/schema.js";

it("builds a JSON schema and never exposes secret examples", () => {
  const schema = paramsToJsonSchema([
    { name: "company", description: "Company name", required: true, example: "Acme", secret: false },
    { name: "password", description: "Password", required: true, example: "hunter2", secret: true },
    { name: "note", description: "Note", required: false, secret: false },
  ]);
  expect(schema).toEqual({
    type: "object",
    properties: {
      company: { type: "string", description: "Company name", examples: ["Acme"] },
      password: { type: "string", description: "Password" },
      note: { type: "string", description: "Note" },
    },
    required: ["company", "password"],
    additionalProperties: false,
  });
});

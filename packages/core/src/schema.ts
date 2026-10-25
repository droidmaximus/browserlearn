import type { ParamDef } from "./types.js";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, { type: "string"; description: string; examples?: string[] }>;
  required: string[];
  additionalProperties: false;
}

export interface JsonSchemaOptions {
  /** Include non-secret recorded examples. Off by default: schemas reach agent LLMs through MCP. */
  includeExamples?: boolean;
}

export function paramsToJsonSchema(params: ParamDef[], { includeExamples = false }: JsonSchemaOptions = {}): JsonSchemaObject {
  return {
    type: "object",
    properties: Object.fromEntries(
      params.map((p) => [
        p.name,
        {
          type: "string" as const,
          description: p.description,
          ...(includeExamples && p.example !== undefined && !p.secret ? { examples: [p.example] } : {}),
        },
      ]),
    ),
    required: params.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false,
  };
}

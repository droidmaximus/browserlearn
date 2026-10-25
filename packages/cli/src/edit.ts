import { lockedRequiredParams } from "@browserlearn/core/enrich";
import type { Workflow } from "@browserlearn/core/types";
import { ValidationError } from "./errors.js";

export interface WorkflowPatch {
  name?: string;
  description?: string;
  exposeExamples?: boolean;
  params?: { name: string; newName?: string; description?: string; required?: boolean }[];
  steps?: { id: string; name: string }[];
}

const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optString = (v: unknown): boolean => v === undefined || typeof v === "string";

export function parsePatch(v: unknown): WorkflowPatch {
  if (!isRecord(v)) throw new ValidationError("Expected a JSON object");
  if (!optString(v.name) || !optString(v.description)) throw new ValidationError("Invalid name or description");
  if (v.exposeExamples !== undefined && typeof v.exposeExamples !== "boolean") throw new ValidationError("Invalid exposeExamples");
  if (
    v.params !== undefined &&
    !(
      Array.isArray(v.params) &&
      v.params.every(
        (p) =>
          isRecord(p) &&
          typeof p.name === "string" &&
          optString(p.newName) &&
          optString(p.description) &&
          (p.required === undefined || typeof p.required === "boolean"),
      )
    )
  ) {
    throw new ValidationError("Invalid params");
  }
  if (v.steps !== undefined && !(Array.isArray(v.steps) && v.steps.every((s) => isRecord(s) && typeof s.id === "string" && typeof s.name === "string"))) {
    throw new ValidationError("Invalid steps");
  }
  return v as WorkflowPatch;
}

export function applyPatch(w: Workflow, patch: WorkflowPatch, now: number): Workflow {
  const locked = lockedRequiredParams(w);
  const known = new Set(w.params.map((p) => p.name));
  for (const e of patch.params ?? []) if (!known.has(e.name)) throw new ValidationError(`Unknown parameter: ${e.name}`);

  const renames = new Map<string, string>();
  const params = w.params.map((p) => {
    const e = patch.params?.find((x) => x.name === p.name);
    if (!e) return p;
    const newName = e.newName?.trim() || p.name;
    if (newName !== p.name && !PARAM_NAME.test(newName)) {
      throw new ValidationError(`Invalid parameter name: ${newName}. Use lowercase letters, digits and underscores.`);
    }
    if (e.required === false && locked.has(p.name)) {
      throw new ValidationError(`Parameter ${p.name} must stay required: it is a secret, or later steps need its value`);
    }
    if (newName !== p.name) renames.set(p.name, newName);
    return { ...p, name: newName, description: (e.description ?? p.description).trim().slice(0, 300), required: e.required ?? p.required };
  });
  const names = params.map((p) => p.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new ValidationError(`Duplicate parameter name: ${dup}`);

  const steps = w.steps.map((s) => {
    const renamed = patch.steps?.find((x) => x.id === s.id)?.name.trim().slice(0, 120);
    const param = s.param ? (renames.get(s.param) ?? s.param) : undefined;
    return { ...s, name: renamed || s.name, ...(param ? { param } : {}) };
  });

  const name = patch.name === undefined ? w.name : patch.name.trim().slice(0, 80);
  if (!name) throw new ValidationError("Workflow name cannot be empty");
  return {
    ...w,
    name,
    description: patch.description === undefined ? w.description : patch.description.trim().slice(0, 300),
    ...(patch.exposeExamples === undefined ? {} : { exposeExamples: patch.exposeExamples }),
    params,
    steps,
    updatedAt: now,
  };
}

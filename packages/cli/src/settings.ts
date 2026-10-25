import type { FieldRule } from "@browserlearn/core/redact";
import type { App } from "./app.js";
import { checkLlmSettings, type Config } from "./config.js";
import { errorMessage, ValidationError } from "./errors.js";

export interface SettingsView {
  llm: { baseUrl: string; model: string; timeoutMs?: number; hasApiKey: boolean } | null;
  fieldRules: FieldRule[];
  pairToken: string;
  installId: string;
}

export function settingsView(app: App): SettingsView {
  const llm = app.config.llm;
  return {
    llm: llm
      ? { baseUrl: llm.baseUrl, model: llm.model, ...(llm.timeoutMs !== undefined ? { timeoutMs: llm.timeoutMs } : {}), hasApiKey: Boolean(llm.apiKey) }
      : null,
    fieldRules: app.config.fieldRules,
    pairToken: app.config.pairToken,
    installId: app.config.installId,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `llm: null` removes the LLM; an omitted `apiKey` keeps the saved key; `apiKey: null` or "" removes it. */
export function applySettings(config: Config, input: unknown): Config {
  if (!isRecord(input)) throw new ValidationError("Expected a JSON object");
  let next: Config = { ...config };
  if ("llm" in input) {
    if (input.llm === null) {
      const { llm: _removed, ...rest } = next;
      next = rest;
    } else {
      if (!isRecord(input.llm)) throw new ValidationError("Invalid llm settings");
      const { apiKey, ...rest } = input.llm;
      const keep = apiKey === undefined && config.llm?.apiKey ? { apiKey: config.llm.apiKey } : {};
      const set = typeof apiKey === "string" && apiKey ? { apiKey } : {};
      try {
        next.llm = checkLlmSettings({ ...rest, ...keep, ...set });
      } catch (err) {
        throw new ValidationError(errorMessage(err));
      }
    }
  }
  if ("fieldRules" in input) {
    const rules = input.fieldRules;
    if (!Array.isArray(rules) || !rules.every((r) => isRecord(r) && typeof r.domain === "string" && r.domain.trim() && typeof r.field === "string" && r.field.trim())) {
      throw new ValidationError("Each redaction rule needs a domain and a field");
    }
    next.fieldRules = rules.map((r) => ({ domain: String(r.domain).trim(), field: String(r.field).trim() }));
  }
  return next;
}

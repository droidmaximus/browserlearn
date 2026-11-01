import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FieldRule } from "@browserlearn/core/redact";

export interface LlmSettings {
  /** Use `"hosted"` for BrowserLearn hosted compiles (Pro). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface Config {
  installId: string;
  pairToken: string;
  port: number;
  fieldRules: FieldRule[];
  llm?: LlmSettings;
  /** BrowserLearn backend base URL for claim / hosted compile. */
  backendUrl?: string;
}

export interface Paths {
  home: string;
  db: string;
  config: string;
  runs: string;
}

export const DEFAULT_PORT = 7420;

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.BROWSERLEARN_HOME || join(homedir(), ".browserlearn");
  return { home, db: join(home, "browserlearn.db"), config: join(home, "config.json"), runs: join(home, "runs") };
}

export const newToken = (): string => randomBytes(32).toString("base64url");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function checkLlmSettings(v: unknown): LlmSettings {
  if (!isRecord(v)) throw new Error("invalid llm settings");
  const { baseUrl, model, apiKey, timeoutMs } = v;
  if (typeof baseUrl !== "string") throw new Error("invalid llm.baseUrl: use an http(s) URL or \"hosted\"");
  if (baseUrl !== "hosted" && !/^https?:\/\/[^\s]+$/.test(baseUrl)) throw new Error("invalid llm.baseUrl: use an http(s) URL or \"hosted\"");
  if (typeof model !== "string" || !model.trim()) throw new Error("invalid llm.model");
  if (apiKey !== undefined && typeof apiKey !== "string") throw new Error("invalid llm.apiKey");
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("invalid llm.timeoutMs");
  }
  return {
    baseUrl,
    model: model.trim(),
    ...(apiKey ? { apiKey } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function parseConfig(text: string, file: string): Config {
  const bad = (field: string): never => {
    throw new Error(`${file}: invalid ${field}`);
  };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return bad("JSON");
  }
  if (!isRecord(v)) return bad("config");
  if (typeof v.installId !== "string" || !v.installId) bad("installId");
  if (typeof v.pairToken !== "string" || v.pairToken.length < 32) bad("pairToken");
  const port = v.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) bad("port");
  const fieldRules = v.fieldRules ?? [];
  if (!Array.isArray(fieldRules) || !fieldRules.every((r) => isRecord(r) && typeof r.domain === "string" && typeof r.field === "string")) {
    bad("fieldRules");
  }
  let llm: LlmSettings | undefined;
  if (v.llm !== undefined) {
    try {
      llm = checkLlmSettings(v.llm);
    } catch (err) {
      bad((err as Error).message.replace(/^invalid /, ""));
    }
  }
  let backendUrl: string | undefined;
  if (v.backendUrl !== undefined) {
    if (typeof v.backendUrl !== "string" || !/^https?:\/\/[^\s]+$/.test(v.backendUrl)) bad("backendUrl");
    backendUrl = (v.backendUrl as string).replace(/\/+$/, "");
  }
  return {
    installId: v.installId as string,
    pairToken: v.pairToken as string,
    port: port as number,
    fieldRules: fieldRules as FieldRule[],
    ...(llm ? { llm } : {}),
    ...(backendUrl ? { backendUrl } : {}),
  };
}

export function saveConfig(paths: Paths, config: Config): void {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  const tmp = `${paths.config}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, paths.config);
  chmodSync(paths.config, 0o600);
}

export function loadConfig(paths: Paths): Config {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  if (!existsSync(paths.config)) {
    const config: Config = { installId: randomUUID(), pairToken: newToken(), port: DEFAULT_PORT, fieldRules: [] };
    saveConfig(paths, config);
    return config;
  }
  return parseConfig(readFileSync(paths.config, "utf8"), paths.config);
}

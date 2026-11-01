export interface Env {
  DB: D1Like;
  LICENSE_PRIVATE_KEY: string;
  POLAR_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
  POLAR_PRODUCT_ID: string;
  /** Optional override for tests. */
  now?: () => number;
  /** Optional LLM for tests. */
  llm?: import("./llm/types.js").LlmProvider;
  /** Optional billing for tests. */
  billing?: import("./billing/types.js").BillingProvider;
}

/** Minimal D1 / sqlite surface used by the Worker. */
export interface D1Like {
  prepare(sql: string): D1Prepared;
  exec?(sql: string): unknown;
  batch?<T>(statements: D1Prepared[]): Promise<T[]>;
}

export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

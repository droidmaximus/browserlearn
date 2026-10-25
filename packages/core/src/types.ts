export type ActionType = "click" | "type" | "select" | "navigate" | "scroll" | "submit";

export interface SelectorCandidates {
  testId?: string;
  role?: string;
  name?: string;
  css?: string;
  xpath?: string;
}

/** One captured user action, as sent by the extension. */
export interface RawStep {
  seq: number;
  action: ActionType;
  selectors: SelectorCandidates;
  axSnippet: string;
  /** Page URL at the moment of the action (for navigate: the destination). */
  url: string;
  /** Indexes of nested iframes from the top document; [] for the top frame. */
  framePath: number[];
  value?: string;
  isPassword?: boolean;
  ts: number;
  screenshotBefore?: string;
  screenshotAfter?: string;
}

export interface Recording {
  id: string;
  name: string;
  startUrl: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "complete";
}

export type Locator =
  | { kind: "testId"; testId: string }
  | { kind: "role"; role: string; name: string }
  | { kind: "css"; css: string }
  | { kind: "xpath"; xpath: string };

export interface ExpectedState {
  /** origin + pathname the page must be on after the step. */
  urlPath?: string;
}

export type WorkflowAction = Exclude<ActionType, "scroll">;

export interface WorkflowStep {
  id: string;
  name: string;
  action: WorkflowAction;
  locator?: Locator;
  fallbacks: Locator[];
  url?: string;
  param?: string;
  framePath: number[];
  expected: ExpectedState;
}

export interface ParamDef {
  name: string;
  description: string;
  required: boolean;
  example?: string;
  secret: boolean;
  /**
   * Plaintext fragments of the recorded value, kept even when `example` is hidden so the LLM skeleton
   * can scrub them. Local only: never include in exports, MCP responses or LLM payloads.
   */
  scrubTerms?: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: number;
  params: ParamDef[];
  steps: WorkflowStep[];
  sourceRecordingId: string;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = "running" | "succeeded" | "failed";

export interface Run {
  id: string;
  workflowId: string;
  params: Record<string, string>;
  status: RunStatus;
  failedStep?: number;
  log: string[];
  repairApplied?: { stepId: string; locator: Locator }[];
  startedAt: number;
  endedAt?: number;
}

export interface StoredLicense {
  token: string;
  plan: "pro";
  installId: string;
  expiresAt: number;
  lastRefreshedAt: number;
}

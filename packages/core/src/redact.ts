import type { ActionType, RawStep, Recording, SelectorCandidates } from "./types.js";

export interface FieldRule {
  /** Hostname suffix, e.g. "example.com" matches "app.example.com". */
  domain: string;
  /** Case-insensitive substring matched against the field's name, test id, or CSS. */
  field: string;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function redactCards(match: string): string {
  const digits = match.replace(/[ -]/g, "");
  for (let start = 0; start + 13 <= digits.length; start++) {
    for (let len = 13; len <= 19 && start + len <= digits.length; len++) {
      if (luhnValid(digits.slice(start, start + len))) return "[REDACTED:card]";
    }
  }
  return match;
}

const RULES: Array<[RegExp, string | ((match: string) => string)]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED:jwt]"],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, "[REDACTED:key]"],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED:key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:key]"],
  [/\b\d(?:[ -]?\d){12,47}\b/g, redactCards],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED:email]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED:ssn]"],
  [/(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g, "[REDACTED:phone]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[REDACTED:token]"],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, (match) => (typeof replacement === "string" ? replacement : replacement(match)));
  }
  return out;
}

const SENSITIVE_PARAM = /token|key|secret|password|passwd|auth|session|code|sig/i;

/** A masked value and its marker; any query value or path segment containing the value becomes the marker. */
interface Masked {
  literal: string;
  mask: string;
}

const containsMasked = (decoded: string, m: Masked | undefined): boolean =>
  m !== undefined && (decoded.includes(m.literal) || decoded.replace(/\+/g, " ").includes(m.literal));

function cleanUrl(url: string, masked?: Masked): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    const base = url.split(/[?#]/, 1)[0]!;
    return redactText(masked ? base.split(masked.literal).join(masked.mask) : base);
  }
  const query = [...parsed.searchParams.entries()]
    .map(([k, v]) => {
      const value = SENSITIVE_PARAM.test(k)
        ? "REDACTED"
        : encodeURIComponent(containsMasked(v, masked) ? masked!.mask : redactText(v));
      return `${encodeURIComponent(k)}=${value}`;
    })
    .join("&");
  const pathname = parsed.pathname
    .split("/")
    .map((segment) => {
      let decoded: string | undefined;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = undefined;
      }
      if (containsMasked(decoded ?? segment, masked)) return encodeURIComponent(masked!.mask);
      if (decoded === undefined) return redactText(segment);
      const redacted = redactText(decoded);
      return redacted === decoded ? segment : encodeURIComponent(redacted);
    })
    .join("/");
  return `${parsed.origin}${pathname}${query ? `?${query}` : ""}`;
}

export function redactUrl(url: string): string {
  return cleanUrl(url);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function fieldMatches(selectors: SelectorCandidates, field: string): boolean {
  const needle = field.toLowerCase();
  return [selectors.name, selectors.testId, selectors.css].some((v) => v?.toLowerCase().includes(needle));
}

const ACTIONS: ReadonlySet<string> = new Set<ActionType>(["click", "type", "select", "navigate", "scroll", "submit"]);
const SELECTOR_KEYS = ["testId", "role", "name", "css", "xpath"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function invalid(field: string, what = "step"): never {
  throw new Error(`invalid ${what} field: ${field}`);
}

function optString(v: unknown, field: string): string | undefined {
  if (v !== undefined && typeof v !== "string") invalid(field);
  return v;
}

/** Copies only known RawStep fields, checking their types; screenshot paths are never taken from the wire. */
function pickRawStep(input: unknown): RawStep {
  if (!isObject(input)) invalid("step");
  const { seq, action, selectors, axSnippet, url, framePath, value, isPassword, ts } = input;
  if (!Number.isInteger(seq)) invalid("seq");
  if (typeof action !== "string" || !ACTIONS.has(action)) invalid("action");
  if (!isObject(selectors)) invalid("selectors");
  if (typeof axSnippet !== "string") invalid("axSnippet");
  if (typeof url !== "string") invalid("url");
  if (!Array.isArray(framePath) || !framePath.every((i) => Number.isInteger(i) && i >= 0)) invalid("framePath");
  if (!isTime(ts)) invalid("ts");
  if (isPassword !== undefined && typeof isPassword !== "boolean") invalid("isPassword");
  const picked: SelectorCandidates = {};
  for (const key of SELECTOR_KEYS) {
    const v = optString(selectors[key], `selectors.${key}`);
    if (v !== undefined) picked[key] = v;
  }
  const v = optString(value, "value");
  return {
    seq: seq as number,
    action: action as ActionType,
    selectors: picked,
    axSnippet,
    url,
    framePath: [...(framePath as number[])],
    ...(v !== undefined ? { value: v } : {}),
    ...(isPassword !== undefined ? { isPassword } : {}),
    ts,
  };
}

/** Validates and redacts a step received from the extension; throws on any malformed field. */
export function redactStep(input: unknown, rules: FieldRule[] = []): RawStep {
  const step = pickRawStep(input);
  const host = hostOf(step.url);
  const ruleHit = rules.some((r) => {
    const domain = r.domain.toLowerCase();
    return (host === domain || host.endsWith(`.${domain}`)) && fieldMatches(step.selectors, r.field);
  });
  const raw = step.value;
  let value = raw;
  let mask: string | undefined;
  if (raw !== undefined) {
    if (step.isPassword) mask = "[REDACTED:password]";
    else if (ruleHit) mask = "[REDACTED:field]";
    value = mask ?? redactText(raw);
  }
  const masked = mask !== undefined && raw !== undefined && raw.length >= 4 ? { literal: raw, mask } : undefined;
  const maskLiteral = (text: string): string => (masked ? text.split(masked.literal).join(masked.mask) : text);
  const scrub = (text: string): string => redactText(maskLiteral(text));
  const selectors: SelectorCandidates = { ...step.selectors };
  for (const key of ["testId", "name", "css", "xpath"] as const) {
    if (selectors[key] !== undefined) selectors[key] = scrub(selectors[key]);
  }
  return {
    ...step,
    ...(value !== undefined ? { value } : {}),
    url: cleanUrl(step.url, masked),
    axSnippet: scrub(step.axSnippet),
    selectors,
  };
}

/** Validates a recording received from the extension and redacts its name and start URL; throws on malformed input. */
export function redactRecording(input: unknown): Recording {
  if (!isObject(input)) invalid("recording", "recording");
  const { id, name, startUrl, startedAt, endedAt, status } = input;
  if (typeof id !== "string") invalid("id", "recording");
  if (typeof name !== "string") invalid("name", "recording");
  if (typeof startUrl !== "string") invalid("startUrl", "recording");
  if (!isTime(startedAt)) invalid("startedAt", "recording");
  if (endedAt !== undefined && !isTime(endedAt)) invalid("endedAt", "recording");
  if (status !== "recording" && status !== "complete") invalid("status", "recording");
  return {
    id,
    name: redactText(name),
    startUrl: redactUrl(startUrl),
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    status,
  };
}

export function safeRedactStep(input: unknown, rules: FieldRule[] = []): RawStep | null {
  try {
    return redactStep(input, rules);
  } catch {
    return null;
  }
}

import type { RawStep, SelectorCandidates } from "./types.js";

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

const RULES: Array<[RegExp, string | ((match: string) => string)]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED:jwt]"],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, "[REDACTED:key]"],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED:key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:key]"],
  [
    /\b\d(?:[ -]?\d){12,18}\b/g,
    (m) => {
      const digits = m.replace(/[ -]/g, "");
      return luhnValid(digits) ? "[REDACTED:card]" : m;
    },
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED:email]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED:ssn]"],
  [/(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g, "[REDACTED:phone]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[REDACTED:token]"],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = typeof replacement === "string" ? out.replace(pattern, replacement) : out.replace(pattern, replacement);
  }
  return out;
}

const SENSITIVE_PARAM = /token|key|secret|password|passwd|auth|session|code|sig/i;

export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return redactText(url);
  }
  const query = [...parsed.searchParams.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${SENSITIVE_PARAM.test(k) ? "REDACTED" : encodeURIComponent(redactText(v))}`)
    .join("&");
  return `${parsed.origin}${redactText(parsed.pathname)}${query ? `?${query}` : ""}`;
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

const opt = (v: string | undefined): string | undefined => (v === undefined ? undefined : redactText(v));

export function redactStep(step: RawStep, rules: FieldRule[] = []): RawStep {
  const host = hostOf(step.url);
  const ruleHit = rules.some(
    (r) => (host === r.domain || host.endsWith(`.${r.domain}`)) && fieldMatches(step.selectors, r.field),
  );
  let value = step.value;
  if (value !== undefined) {
    if (step.isPassword) value = "[REDACTED:password]";
    else if (ruleHit) value = "[REDACTED:field]";
    else value = redactText(value);
  }
  return {
    ...step,
    value,
    url: redactUrl(step.url),
    axSnippet: redactText(step.axSnippet),
    selectors: {
      ...step.selectors,
      name: opt(step.selectors.name),
      css: opt(step.selectors.css),
      xpath: opt(step.selectors.xpath),
    },
  };
}

export function safeRedactStep(step: RawStep, rules: FieldRule[] = []): RawStep | null {
  try {
    return redactStep(step, rules);
  } catch {
    return null;
  }
}

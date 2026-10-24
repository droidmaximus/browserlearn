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
    return redactText(url.split(/[?#]/, 1)[0]!);
  }
  const query = [...parsed.searchParams.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${SENSITIVE_PARAM.test(k) ? "REDACTED" : encodeURIComponent(redactText(v))}`)
    .join("&");
  const pathname = parsed.pathname
    .split("/")
    .map((segment) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return redactText(segment);
      }
      const redacted = redactText(decoded);
      return redacted === decoded ? segment : encodeURIComponent(redacted);
    })
    .join("/");
  return `${parsed.origin}${pathname}${query ? `?${query}` : ""}`;
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

export function redactStep(step: RawStep, rules: FieldRule[] = []): RawStep {
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
  const literal = mask !== undefined && raw !== undefined && raw.length >= 4 ? raw : undefined;
  const maskLiteral = (text: string): string =>
    literal === undefined ? text : text.split(literal).join(mask!);
  const scrub = (text: string): string => redactText(maskLiteral(text));
  const opt = (v: string | undefined): string | undefined => (v === undefined ? undefined : scrub(v));
  let url = maskLiteral(step.url);
  if (literal !== undefined) url = url.split(encodeURIComponent(literal)).join(mask!);
  return {
    ...step,
    value,
    url: redactUrl(url),
    axSnippet: scrub(step.axSnippet),
    selectors: {
      ...step.selectors,
      testId: opt(step.selectors.testId),
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

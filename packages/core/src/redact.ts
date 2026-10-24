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
  const positions: number[] = [];
  for (let i = 0; i < match.length; i++) if (/\d/.test(match[i]!)) positions.push(i);
  if (luhnValid(positions.map((p) => match[p]).join(""))) return "[REDACTED:card]";
  let out = "";
  let cursor = 0;
  let start = 0;
  while (start <= positions.length - 13) {
    let hit = 0;
    for (let len = Math.min(19, positions.length - start); len >= 13; len--) {
      const digits = positions.slice(start, start + len).map((p) => match[p]).join("");
      if (luhnValid(digits)) {
        hit = len;
        break;
      }
    }
    if (hit) {
      out += match.slice(cursor, positions[start]) + "[REDACTED:card]";
      cursor = positions[start + hit - 1]! + 1;
      start += hit;
    } else {
      start++;
    }
  }
  return out + match.slice(cursor);
}

const RULES: Array<[RegExp, string | ((match: string) => string)]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED:jwt]"],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, "[REDACTED:key]"],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED:key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:key]"],
  [/\b\d(?:[ -]?\d){12,18}\b/g, redactCards],
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
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = parsed.pathname;
  }
  return `${parsed.origin}${encodeURI(redactText(pathname))}${query ? `?${query}` : ""}`;
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
  const scrub = (text: string): string =>
    redactText(mask !== undefined && raw ? text.split(raw).join(mask) : text);
  const opt = (v: string | undefined): string | undefined => (v === undefined ? undefined : scrub(v));
  return {
    ...step,
    value,
    url: redactUrl(step.url),
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

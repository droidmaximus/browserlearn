import type { ActionType, SelectorCandidates } from "./protocol.js";

export interface Captured {
  action: ActionType;
  selectors: SelectorCandidates;
  axSnippet: string;
  url: string;
  framePath: number[];
  value?: string;
  isPassword?: boolean;
  ts: number;
}

const TEST_ID_ATTRS = ["data-testid", "data-test-id", "data-cy"] as const;

const IMPLICIT_ROLE: Record<string, (el: Element) => string | undefined> = {
  A: (el) => (el.hasAttribute("href") ? "link" : undefined),
  BUTTON: () => "button",
  SELECT: () => "combobox",
  TEXTAREA: () => "textbox",
  SUMMARY: () => "button",
  H1: () => "heading",
  H2: () => "heading",
  H3: () => "heading",
  H4: () => "heading",
  H5: () => "heading",
  H6: () => "heading",
  INPUT: (el) => {
    const t = (el as HTMLInputElement).type;
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "submit" || t === "button" || t === "reset" || t === "image") return "button";
    if (t === "number") return "spinbutton";
    if (t === "range") return "slider";
    if (t === "file" || t === "hidden") return undefined;
    return "textbox";
  },
};

const LANDMARK = new Set(["MAIN", "NAV", "HEADER", "FOOTER", "ASIDE", "FORM"]);
const LANDMARK_ROLES = new Set(["main", "navigation", "banner", "contentinfo", "complementary", "form", "search", "region"]);

export function framePathOf(win: Window): number[] {
  const path: number[] = [];
  let w: Window | null = win;
  try {
    while (w && w !== w.top && w.parent) {
      const parent: Window = w.parent;
      let index = -1;
      for (let i = 0; i < parent.frames.length; i++) if (parent.frames[i] === w) index = i;
      if (index < 0) break;
      path.push(index);
      w = parent;
    }
  } catch {
    return path.reverse();
  }
  return path.reverse();
}

export function isPasswordField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const auto = (el.autocomplete || "").toLowerCase();
  return el.type === "password" || auto === "current-password" || auto === "new-password";
}

function testIdOf(el: Element): string | undefined {
  for (const a of TEST_ID_ATTRS) {
    const v = el.getAttribute(a);
    if (v) return v;
  }
  return undefined;
}

function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  return IMPLICIT_ROLE[el.tagName]?.(el);
}

function labelledBy(el: Element): string | undefined {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return undefined;
  const text = ids
    .split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function labelFor(el: Element): string | undefined {
  if (!el.id) return undefined;
  const label = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
  return label?.textContent?.trim() || undefined;
}

function nameOf(el: Element): string | undefined {
  const fromAttr = el.getAttribute("aria-label") || labelledBy(el) || labelFor(el);
  if (fromAttr) return fromAttr.slice(0, 200);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return (el.placeholder || el.getAttribute("title") || "").trim().slice(0, 200) || undefined;
  }
  const text = el.textContent?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : undefined;
}

function cssOf(el: Element): string | undefined {
  const id = el.id && /^[A-Za-z][\w-]*$/.test(el.id) ? `#${el.id}` : undefined;
  if (id && el.ownerDocument.querySelectorAll(id).length === 1) return id;
  const tid = testIdOf(el);
  if (tid) return `[data-testid="${cssEscape(tid)}"]`;
  const parts: string[] = [];
  let n: Element | null = el;
  for (let depth = 0; n && depth < 6; depth++) {
    const tag = n.tagName.toLowerCase();
    const parent: Element | null = n.parentElement;
    if (!parent) {
      parts.push(tag);
      break;
    }
    const same = [...parent.children].filter((c) => c.tagName === n!.tagName);
    const part = same.length === 1 ? tag : `${tag}:nth-of-type(${same.indexOf(n) + 1})`;
    parts.push(part);
    if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) {
      parts.push(`#${n.id}`);
      break;
    }
    n = parent;
  }
  const sel = parts.reverse().join(" > ");
  return sel.length <= 300 ? sel : undefined;
}

function xpathOf(el: Element): string | undefined {
  if (el.id) return `//*[@id="${el.id.replace(/"/g, '\\"')}"]`;
  const tid = testIdOf(el);
  if (tid) return `//*[@data-testid="${tid.replace(/"/g, '\\"')}"]`;
  const parts: string[] = [];
  let n: Element | null = el;
  for (let depth = 0; n && n.nodeType === 1 && depth < 8; depth++) {
    const tag = n.tagName.toLowerCase();
    const parent: Element | null = n.parentElement;
    if (!parent) {
      parts.push(`/${tag}`);
      break;
    }
    const same = [...parent.children].filter((c) => c.tagName === n!.tagName);
    parts.push(`/${tag}[${same.indexOf(n) + 1}]`);
    n = parent;
  }
  const path = parts.reverse().join("");
  return path.length <= 300 ? path : undefined;
}

export function selectorsFor(el: Element): SelectorCandidates {
  const testId = testIdOf(el);
  const role = roleOf(el);
  const name = nameOf(el);
  const css = cssOf(el);
  const xpath = xpathOf(el);
  return {
    ...(testId ? { testId } : {}),
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(css ? { css } : {}),
    ...(xpath ? { xpath } : {}),
  };
}

function describe(el: Element): string {
  const role = roleOf(el) ?? el.tagName.toLowerCase();
  const name = nameOf(el);
  return name ? `${role} "${name.slice(0, 80)}"` : role;
}

function isLandmark(el: Element): boolean {
  const role = el.getAttribute("role");
  return LANDMARK.has(el.tagName) || (role !== null && LANDMARK_ROLES.has(role));
}

export function axSnippetFor(el: Element): string {
  const ancestors: string[] = [];
  let n = el.parentElement;
  while (n && ancestors.length < 8) {
    ancestors.push(describe(n));
    if (isLandmark(n)) break;
    n = n.parentElement;
  }
  const siblings = [...(el.parentElement?.children ?? [])]
    .filter((c) => c !== el)
    .slice(0, 4)
    .map(describe);
  return [`target: ${describe(el)}`, ancestors.length ? `ancestors: ${ancestors.join(" < ")}` : "", siblings.length ? `siblings: ${siblings.join(", ")}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

export function valueOf(el: Element): string | undefined {
  if (isPasswordField(el)) return undefined;
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio" || el.type === "file" || el.type === "hidden") return undefined;
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  return undefined;
}

function eventTarget(ev: Event): Element | undefined {
  const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
  for (const n of path) if (n instanceof Element) return n;
  const t = ev.target;
  return t instanceof Element ? t : undefined;
}

function actionFor(ev: Event, el: Element): ActionType | undefined {
  if (ev.type === "submit") return "submit";
  if (ev.type === "change" || ev.type === "blur") {
    if (el instanceof HTMLSelectElement) return "select";
    if (el instanceof HTMLTextAreaElement) return "type";
    if (el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio" && el.type !== "file" && el.type !== "button" && el.type !== "submit") {
      return "type";
    }
  }
  if (ev.type === "click") {
    if (el instanceof HTMLInputElement && (el.type === "file" || el.type === "hidden")) return undefined;
    return "click";
  }
  return undefined;
}

export function captureFromEvent(ev: Event, win: Window, now: () => number = Date.now): Captured | undefined {
  const el = eventTarget(ev);
  if (!el) return undefined;
  const action = actionFor(ev, el);
  if (!action) return undefined;
  const password = isPasswordField(el);
  const value = action === "type" || action === "select" ? valueOf(el) : undefined;
  return {
    action,
    selectors: selectorsFor(el),
    axSnippet: axSnippetFor(el),
    url: win.location.href,
    framePath: framePathOf(win),
    ...(password ? { isPassword: true } : {}),
    ...(value !== undefined && !password ? { value } : {}),
    ts: now(),
  };
}

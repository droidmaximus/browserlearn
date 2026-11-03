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

export function isComboboxLike(el: Element): boolean {
  if (el instanceof HTMLSelectElement) return true;
  if (el.getAttribute("role") === "combobox") return true;
  if (el instanceof HTMLInputElement) {
    if (el.list) return true;
    const auto = (el.getAttribute("aria-autocomplete") || "").toLowerCase();
    return auto === "list" || auto === "both";
  }
  return false;
}

export async function microSettle(
  ev: Event,
  el: Element,
  opts?: { raf?: (cb: FrameRequestCallback) => number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const raf = opts?.raf ?? requestAnimationFrame.bind(globalThis);
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitFrames = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise<void>((resolve) => raf(() => resolve()));
  };
  if (ev.type === "change" && isComboboxLike(el)) {
    await sleep(200);
    return;
  }
  await waitFrames(2);
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

export const AX_SNIPPET_MAX = 4000;
const CONTROL_CAP = 24;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SnapshotControl {
  role?: string;
  name?: string;
  value?: string;
  box: Box;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "spinbutton",
  "slider",
  "searchbox",
  "switch",
  "menuitem",
  "tab",
  "option",
]);

function boxOf(el: Element): Box | undefined {
  const r = el.getBoundingClientRect();
  // Layout-less test DOMs often report 0×0; keep a 1×1 stand-in so snapshots still include the control.
  if (!(r.width > 0 && r.height > 0)) return { x: r.left, y: r.top, w: 1, h: 1 };
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function center(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function inViewport(b: Box, win: Window): boolean {
  const vw = win.innerWidth || 1e9;
  const vh = win.innerHeight || 1e9;
  return b.x + b.w > 0 && b.y + b.h > 0 && b.x < vw && b.y < vh;
}

function isHidden(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return true;
  if (el instanceof HTMLElement && el.hidden) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle?.(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  return false;
}

function isCovered(el: Element, b: Box): boolean {
  const doc = el.ownerDocument;
  const c = center(b);
  const top = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(c.x, c.y) : null;
  if (!top) return false; // happy-dom / missing API: treat as not covered
  return !(top === el || el.contains(top) || top.contains(el));
}

function isInteractive(el: Element): boolean {
  const role = roleOf(el);
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  const tag = el.tagName;
  return tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "A" || tag === "INPUT" || tag === "SUMMARY";
}

function toControl(el: Element): SnapshotControl | undefined {
  const box = boxOf(el);
  if (!box) return undefined;
  const win = el.ownerDocument.defaultView;
  if (!win || !inViewport(box, win) || isHidden(el) || isCovered(el, box)) return undefined;
  if (!isInteractive(el)) return undefined;
  const role = roleOf(el);
  const name = nameOf(el);
  const password = isPasswordField(el);
  const value = password ? undefined : valueOf(el);
  return {
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(value !== undefined ? { value } : {}),
    box,
  };
}

/** Legacy plain-text snippet kept for callers; new captures use atomicSnapshotFor. */
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

export function atomicSnapshotFor(target: Element, root?: ParentNode): string {
  try {
    const scope = root ?? target.ownerDocument;
    const targetCtrl = toControl(target) ?? (() => {
      const box = boxOf(target) ?? { x: 0, y: 0, w: 1, h: 1 };
      const role = roleOf(target);
      const name = nameOf(target);
      return {
        ...(role ? { role } : {}),
        ...(name ? { name } : {}),
        box,
      } satisfies SnapshotControl;
    })();
    const tCenter = center(targetCtrl.box);
    const candidates: { el: Element; ctrl: SnapshotControl; dist: number }[] = [];
    const nodes = scope.querySelectorAll("a,button,input,select,textarea,summary,[role]");
    for (const el of nodes) {
      if (el === target) continue;
      const ctrl = toControl(el);
      if (!ctrl) continue;
      const c = center(ctrl.box);
      const dist = Math.hypot(c.x - tCenter.x, c.y - tCenter.y);
      candidates.push({ el, ctrl, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    let controls = candidates.slice(0, CONTROL_CAP).map((c) => c.ctrl);
    let payload: { v: 1; target: SnapshotControl | null; controls: SnapshotControl[] } = {
      v: 1,
      target: targetCtrl,
      controls,
    };
    let raw = JSON.stringify(payload);
    while (raw.length > AX_SNIPPET_MAX && controls.length > 0) {
      controls = controls.slice(0, -1);
      payload = { v: 1, target: targetCtrl, controls };
      raw = JSON.stringify(payload);
    }
    if (raw.length > AX_SNIPPET_MAX) {
      payload = { v: 1, target: { box: targetCtrl.box, ...(targetCtrl.role ? { role: targetCtrl.role } : {}), ...(targetCtrl.name ? { name: targetCtrl.name.slice(0, 40) } : {}) }, controls: [] };
      raw = JSON.stringify(payload);
    }
    return raw.length <= AX_SNIPPET_MAX ? raw : JSON.stringify({ v: 1, target: null, controls: [] });
  } catch {
    return JSON.stringify({ v: 1, target: null, controls: [] });
  }
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
    axSnippet: atomicSnapshotFor(el),
    url: win.location.href,
    framePath: framePathOf(win),
    ...(password ? { isPassword: true } : {}),
    ...(value !== undefined && !password ? { value } : {}),
    ts: now(),
  };
}

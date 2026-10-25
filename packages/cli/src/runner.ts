import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describeLocator, urlPath } from "@browserlearn/core/compile";
import { toPublicWorkflow } from "@browserlearn/core/public";
import { redactText } from "@browserlearn/core/redact";
import { checkParamValues, type ParamValues, type ResolvedAction, resolveStep, urlPathMatches } from "@browserlearn/core/resolve";
import type { Locator, Run, Workflow } from "@browserlearn/core/types";
import { type Browser, chromium, type FrameLocator, type Locator as PwLocator, type Page } from "playwright-core";
import { errorMessage } from "./errors.js";

const BROWSER_HELP = "No browser found. Install Google Chrome, or run: npx playwright install chromium";

export async function launchBrowser(headless: boolean, env: NodeJS.ProcessEnv = process.env): Promise<Browser> {
  const attempts = env.BROWSERLEARN_BROWSER === "chromium" ? [{}] : [{ channel: "chrome" }, {}];
  let last: unknown;
  for (const extra of attempts) {
    try {
      return await chromium.launch({ ...extra, headless });
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`${BROWSER_HELP} (${errorMessage(last)})`);
}

export interface RunOptions {
  screenshotDir: string;
  now?: () => number;
  newId?: () => string;
  headless?: boolean;
  stepTimeoutMs?: number;
  launch?: (headless: boolean) => Promise<Browser>;
  onUpdate?: (run: Run) => void;
}

export interface RunOutcome {
  run: Run;
  outputs: { finalUrl?: string; title?: string };
  screenshot?: string;
  error?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function scopeFor(page: Page, framePath: number[]): Page | FrameLocator {
  return framePath.reduce<Page | FrameLocator>((scope, i) => scope.frameLocator(`iframe >> nth=${i}`), page);
}

function toPlaywright(scope: Page | FrameLocator, l: Locator): PwLocator {
  switch (l.kind) {
    case "testId":
      return scope.getByTestId(l.testId);
    case "role":
      return scope.getByRole(l.role as Parameters<Page["getByRole"]>[0], { name: l.name, exact: true });
    case "css":
      return scope.locator(l.css);
    case "xpath":
      return scope.locator(`xpath=${l.xpath}`);
  }
}

/** The first candidate locator that matches an element, polling until the deadline. */
async function findTarget(page: Page, step: ResolvedAction, timeoutMs: number): Promise<PwLocator> {
  if (step.locators.length === 0) throw new Error("This step has no element to target. Re-record it.");
  const scope = scopeFor(page, step.framePath);
  const candidates = step.locators.map((l) => toPlaywright(scope, l));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const c of candidates) if ((await c.count()) > 0) return c.first();
    if (Date.now() >= deadline) throw new Error(`No element matched ${step.locators.map(describeLocator).join(" or ")}`);
    await sleep(100);
  }
}

async function expectUrl(page: Page, expected: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!urlPathMatches(page.url(), expected)) {
    if (Date.now() >= deadline) throw new Error(`Expected to reach ${urlPath(expected)}, but the page is ${urlPath(page.url())}`);
    await sleep(100);
  }
}

async function perform(page: Page, step: ResolvedAction, timeoutMs: number): Promise<void> {
  if (step.action === "navigate") {
    if (!step.url) throw new Error("This navigate step has no URL");
    await page.goto(step.url, { timeout: timeoutMs });
    return;
  }
  const target = await findTarget(page, step, timeoutMs);
  if (step.action === "click") await target.click({ timeout: timeoutMs });
  else if (step.action === "type") await target.fill(step.value ?? "", { timeout: timeoutMs });
  else if (step.action === "select") await target.selectOption(step.value ?? "", { timeout: timeoutMs });
  else await target.evaluate((el) => (el instanceof HTMLFormElement ? el : el.closest("form"))?.requestSubmit());
}

function maskValues(w: Workflow, values: ParamValues): Record<string, string> {
  const secret = new Set(w.params.filter((p) => p.secret).map((p) => p.name));
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, secret.has(k) ? "[REDACTED:password]" : redactText(v)]));
}

export async function runWorkflow(w: Workflow, input: unknown, opts: RunOptions): Promise<RunOutcome> {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.stepTimeoutMs ?? 10_000;
  const names = toPublicWorkflow(w).steps.map((s) => s.name);
  const run: Run = {
    id: (opts.newId ?? (() => globalThis.crypto.randomUUID()))(),
    workflowId: w.id,
    params: {},
    status: "running",
    log: [],
    startedAt: now(),
  };

  let values: ParamValues;
  try {
    values = checkParamValues(w, input);
  } catch (err) {
    const error = errorMessage(err);
    return { run: { ...run, status: "failed", log: [error], endedAt: now() }, outputs: {}, error };
  }
  run.params = maskValues(w, values);
  opts.onUpdate?.(run);

  let browser: Browser | undefined;
  let page: Page | undefined;
  let index = -1;
  try {
    browser = await (opts.launch ?? launchBrowser)(opts.headless ?? true);
    page = await browser.newPage();
    for (index = 0; index < w.steps.length; index++) {
      const resolved = resolveStep(w.steps[index]!, w.params, values);
      if (resolved.skip) {
        run.log.push(`${index + 1}. ${names[index]} (skipped: ${resolved.reason})`);
        continue;
      }
      await perform(page, resolved, timeoutMs);
      if (resolved.expectedUrl) await expectUrl(page, resolved.expectedUrl, timeoutMs);
      run.log.push(`${index + 1}. ${names[index]}`);
    }
    const outputs = { finalUrl: page.url(), title: await page.title() };
    return { run: { ...run, status: "succeeded", endedAt: now() }, outputs };
  } catch (err) {
    const error = errorMessage(err);
    const failedStep = index >= 0 && index < w.steps.length ? index : undefined;
    let screenshot: string | undefined;
    if (page) {
      try {
        mkdirSync(opts.screenshotDir, { recursive: true, mode: 0o700 });
        screenshot = join(opts.screenshotDir, `${run.id}.png`);
        await page.screenshot({ path: screenshot });
      } catch {
        screenshot = undefined;
      }
    }
    run.log.push(failedStep === undefined ? error : `${failedStep + 1}. ${names[failedStep]} failed: ${error}`);
    return {
      run: { ...run, status: "failed", ...(failedStep !== undefined ? { failedStep } : {}), endedAt: now() },
      outputs: {},
      ...(screenshot ? { screenshot } : {}),
      error,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

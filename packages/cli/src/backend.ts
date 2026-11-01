import type { LlmClient } from "@browserlearn/core/llm";
import type { App } from "./app.js";
import { activateLicense } from "./license.js";
import { HttpError } from "./errors.js";

export const DEFAULT_BACKEND_URL = "https://api.browserlearn.dev";

export function backendUrlOf(app: App, env: NodeJS.ProcessEnv = process.env): string {
  return (app.config.backendUrl ?? env.BROWSERLEARN_BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

export async function claimLicense(
  app: App,
  code: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReturnType<typeof activateLicense>> {
  const res = await fetchImpl(`${backendUrlOf(app, env)}/v1/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim(), installId: app.config.installId }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || typeof body.token !== "string") {
    throw new HttpError(res.status === 409 || res.status === 410 || res.status === 404 ? res.status : 502, body.error ?? `Claim failed (${res.status})`);
  }
  return activateLicense(app, body.token);
}

export async function refreshLicense(
  app: App,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReturnType<typeof activateLicense> | null> {
  const stored = app.store.getLicense();
  if (!stored) return null;
  const res = await fetchImpl(`${backendUrlOf(app, env)}/v1/license/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: stored.token }),
  });
  if (res.status === 403) return null;
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || typeof body.token !== "string") throw new HttpError(502, `License refresh failed (${res.status})`);
  return activateLicense(app, body.token);
}

export function hostedLlmClient(app: App, fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): LlmClient {
  return {
    async complete(system, user) {
      const stored = app.store.getLicense();
      if (!stored) throw new Error("Activate a Pro license to use hosted compiles");
      const res = await fetchImpl(`${backendUrlOf(app, env)}/v1/compile`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${stored.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ system, user }),
      });
      if (res.status === 402) throw new Error("Hosted compile credits exhausted");
      if (res.status === 401 || res.status === 403) throw new Error("Hosted compile unauthorized — refresh or reclaim your license");
      const body = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
      if (!res.ok || typeof body.content !== "string") {
        throw new Error(body.error ?? `Hosted compile failed (${res.status})`);
      }
      return body.content;
    },
  };
}

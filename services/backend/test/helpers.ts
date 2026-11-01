import worker from "../src/index.js";
import { openMemoryDb } from "../src/db.js";
import { signPolarWebhook } from "../src/billing/polar.js";
import type { Env } from "../src/env.js";
import type { LlmProvider } from "../src/llm/types.js";

export const DEV_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIOtTbnUasEwTPxEQWvtMQeSOlLr9VAuWY6Bly6713Lhj
-----END PRIVATE KEY-----
`;

export const DEV_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqRGguM6BdasAPjwEWWpKMWVulHj+GyAj3qkG6JKpD0s=
-----END PUBLIC KEY-----
`;

export const WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldGZvcnBvbGFyd2ViaG9vaw"; // base64 "testsecretforpolarwebhook"
export const PRODUCT_ID = "prod_pro";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: openMemoryDb(),
    LICENSE_PRIVATE_KEY: DEV_PRIVATE_KEY,
    POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ANTHROPIC_API_KEY: "test-key",
    POLAR_PRODUCT_ID: PRODUCT_ID,
    now: () => 1_700_000_000_000,
    llm: {
      async complete() {
        return '{"ok":true}';
      },
    } satisfies LlmProvider,
    ...overrides,
  };
}

export async function fetchWorker(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://backend.test${path}`, init), env);
}

export async function activateSubscription(
  env: Env,
  opts: { subscriptionId?: string; periodKey?: string; periodEnd?: number } = {},
): Promise<{ claimCode: string }> {
  const now = env.now?.() ?? Date.now();
  const raw = JSON.stringify({
    type: "subscription.active",
    data: {
      id: opts.subscriptionId ?? "sub_1",
      status: "active",
      customer_id: "cus_1",
      product_id: PRODUCT_ID,
      current_period_start: opts.periodKey ?? "period-1",
      current_period_end: opts.periodEnd ?? now + 30 * 86400000,
    },
  });
  const id = "msg_1";
  const ts = String(Math.floor(now / 1000));
  const sig = signPolarWebhook(WEBHOOK_SECRET, id, ts, raw);
  const res = await fetchWorker(env, "/webhooks/polar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sig,
    },
    body: raw,
  });
  if (!res.ok) throw new Error(`webhook failed ${res.status}`);
  const json = (await res.json()) as { claimCode?: string };
  if (!json.claimCode) throw new Error("expected claimCode");
  return { claimCode: json.claimCode };
}

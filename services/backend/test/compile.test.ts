import { describe, expect, it } from "vitest";
import { signPolarWebhook } from "../src/billing/polar.js";
import { PRO_ALLOTMENT } from "../src/claims.js";
import { activateSubscription, fetchWorker, PRODUCT_ID, testEnv, WEBHOOK_SECRET } from "./helpers.js";

async function claimToken(env: ReturnType<typeof testEnv>): Promise<string> {
  const { claimCode } = await activateSubscription(env);
  const res = await fetchWorker(env, "/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: claimCode, installId: "inst-1" }),
  });
  const { token } = (await res.json()) as { token: string };
  return token;
}

describe("compile metering", () => {
  it("debits allotment and returns content", async () => {
    const env = testEnv();
    const token = await claimToken(env);
    const res = await fetchWorker(env, "/v1/compile", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ system: "s", user: "u" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: '{"ok":true}' });
    const ent = await fetchWorker(env, "/v1/entitlement", { headers: { authorization: `Bearer ${token}` } });
    const body = (await ent.json()) as { remaining: number };
    expect(body.remaining).toBe(PRO_ALLOTMENT - 1);
  });

  it("refunds credit when LLM fails", async () => {
    const env = testEnv({
      llm: {
        async complete() {
          throw new Error("boom");
        },
      },
    });
    const token = await claimToken(env);
    const res = await fetchWorker(env, "/v1/compile", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ system: "s", user: "u" }),
    });
    expect(res.status).toBe(502);
    const ent = await fetchWorker(env, "/v1/entitlement", { headers: { authorization: `Bearer ${token}` } });
    expect(((await ent.json()) as { remaining: number }).remaining).toBe(PRO_ALLOTMENT);
  });

  it("returns 402 when allotment is empty", async () => {
    const env = testEnv();
    const token = await claimToken(env);
    await env.DB.prepare(`UPDATE entitlements SET remaining = 0`).run();
    const res = await fetchWorker(env, "/v1/compile", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ system: "s", user: "u" }),
    });
    expect(res.status).toBe(402);
  });

  it("resets allotment on period renew", async () => {
    const env = testEnv();
    const token = await claimToken(env);
    await env.DB.prepare(`UPDATE entitlements SET remaining = 1`).run();
    const now = env.now!();
    const raw = JSON.stringify({
      type: "subscription.updated",
      data: {
        id: "sub_1",
        status: "active",
        customer_id: "cus_1",
        product_id: PRODUCT_ID,
        current_period_start: "period-2",
        current_period_end: now + 60 * 86400000,
      },
    });
    // normalizePolar maps subscription.updated+active to subscription.active which also resets on period_key change
    const id = "msg_2";
    const ts = String(Math.floor(now / 1000));
    const sig = signPolarWebhook(WEBHOOK_SECRET, id, ts, raw);
    await fetchWorker(env, "/webhooks/polar", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": sig,
      },
      body: raw,
    });
    const ent = await fetchWorker(env, "/v1/entitlement", { headers: { authorization: `Bearer ${token}` } });
    expect(((await ent.json()) as { remaining: number }).remaining).toBe(PRO_ALLOTMENT);
  });
});

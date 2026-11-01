import { verifyLicense } from "@browserlearn/core/license";
import { describe, expect, it } from "vitest";
import { activateSubscription, DEV_PUBLIC_KEY, fetchWorker, testEnv } from "./helpers.js";

describe("claim and refresh", () => {
  it("activates via polar, claims a license that core verifies", async () => {
    const env = testEnv();
    const { claimCode } = await activateSubscription(env);
    const res = await fetchWorker(env, "/v1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: claimCode, installId: "inst-1" }),
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const status = verifyLicense(token, DEV_PUBLIC_KEY, "inst-1", env.now!() + 1);
    expect(status).toMatchObject({ active: true, plan: "pro" });

    const reused = await fetchWorker(env, "/v1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: claimCode, installId: "inst-2" }),
    });
    expect(reused.status).toBe(409);
  });

  it("refreshes when entitlement active and rejects when canceled", async () => {
    const env = testEnv();
    const { claimCode } = await activateSubscription(env);
    const claim = await fetchWorker(env, "/v1/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: claimCode, installId: "inst-1" }),
    });
    const { token } = (await claim.json()) as { token: string };

    const refreshed = await fetchWorker(env, "/v1/license/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(refreshed.status).toBe(200);

    await env.DB.prepare(`UPDATE entitlements SET status = 'canceled'`).run();
    const blocked = await fetchWorker(env, "/v1/license/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(blocked.status).toBe(403);
  });

  it("rejects forged webhook signatures", async () => {
    const env = testEnv();
    const res = await fetchWorker(env, "/webhooks/polar", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": "x",
        "webhook-timestamp": "1",
        "webhook-signature": "v1,AAAA",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});

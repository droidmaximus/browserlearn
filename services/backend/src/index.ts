import { polarBilling } from "./billing/polar.js";
import { redeemClaim } from "./claims.js";
import { parseLicenseToken, verifyLicenseSignature } from "./crypto/license.js";
import { checkRateLimit, debitOne, logCompile, refundOne } from "./credits.js";
import { applyBillingEvent } from "./entitlements.js";
import type { Env } from "./env.js";
import { bearer, json } from "./http.js";
import { getEntitlementByInstall, issueLicense } from "./licenses.js";
import { anthropicProvider } from "./llm/anthropic.js";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const now = env.now?.() ?? Date.now();
    const billing = env.billing ?? polarBilling();
    const llm = env.llm ?? anthropicProvider(env.ANTHROPIC_API_KEY);

    try {
      if (req.method === "POST" && url.pathname === "/webhooks/polar") {
        const event = await billing.verifyAndParse(req, env.POLAR_WEBHOOK_SECRET);
        if (!event) return json({ error: "unauthorized" }, 401);
        const result = await applyBillingEvent(env.DB, event, env.POLAR_PRODUCT_ID, now);
        return json({ ok: true, ...result });
      }

      if (req.method === "POST" && url.pathname === "/v1/claim") {
        const body = (await req.json()) as { code?: string; installId?: string };
        if (!body.code || !body.installId) return json({ error: "bad_request" }, 400);
        const result = await redeemClaim(env.DB, body.code, body.installId, now);
        if ("error" in result) {
          const status = result.error === "not_found" ? 404 : result.error === "expired" ? 410 : 409;
          return json({ error: result.error }, status);
        }
        const token = await issueLicense(env.DB, env.LICENSE_PRIVATE_KEY, result.entitlementId, body.installId, now);
        return json({ token });
      }

      if (req.method === "POST" && url.pathname === "/v1/license/refresh") {
        const body = (await req.json()) as { token?: string };
        if (!body.token || !verifyLicenseSignature(body.token, env.LICENSE_PRIVATE_KEY)) return json({ error: "unauthorized" }, 401);
        const payload = parseLicenseToken(body.token);
        if (!payload) return json({ error: "unauthorized" }, 401);
        const ent = await getEntitlementByInstall(env.DB, payload.installId);
        if (!ent || ent.status !== "active") return json({ error: "forbidden" }, 403);
        if (ent.install_id !== payload.installId) return json({ error: "forbidden" }, 403);
        const token = await issueLicense(env.DB, env.LICENSE_PRIVATE_KEY, ent.id, payload.installId, now);
        return json({ token });
      }

      if (req.method === "GET" && url.pathname === "/v1/entitlement") {
        const token = bearer(req);
        if (!token || !verifyLicenseSignature(token, env.LICENSE_PRIVATE_KEY)) return json({ error: "unauthorized" }, 401);
        const payload = parseLicenseToken(token);
        if (!payload) return json({ error: "unauthorized" }, 401);
        const ent = await getEntitlementByInstall(env.DB, payload.installId);
        if (!ent) return json({ error: "not_found" }, 404);
        return json({ remaining: ent.remaining, periodEnd: ent.period_end, status: ent.status });
      }

      if (req.method === "POST" && url.pathname === "/v1/compile") {
        const token = bearer(req);
        if (!token || !verifyLicenseSignature(token, env.LICENSE_PRIVATE_KEY)) return json({ error: "unauthorized" }, 401);
        const payload = parseLicenseToken(token);
        if (!payload) return json({ error: "unauthorized" }, 401);
        const ent = await getEntitlementByInstall(env.DB, payload.installId);
        if (!ent || ent.status !== "active") return json({ error: "forbidden" }, 403);

        const idem = req.headers.get("idempotency-key");
        if (idem) {
          const cached = await env.DB.prepare(`SELECT response_json FROM compile_idempotency WHERE key = ?`)
            .bind(idem)
            .first<{ response_json: string }>();
          if (cached) return json(JSON.parse(cached.response_json));
        }

        if (!(await checkRateLimit(env.DB, ent.id, now))) {
          await logCompile(env.DB, ent.id, payload.installId, "rate_limited", now);
          return json({ error: "rate_limited" }, 429);
        }

        if (!(await debitOne(env.DB, ent.id))) {
          await logCompile(env.DB, ent.id, payload.installId, "no_credits", now);
          return json({ error: "no_credits" }, 402);
        }

        const body = (await req.json()) as { system?: string; user?: string };
        if (typeof body.system !== "string" || typeof body.user !== "string") {
          await refundOne(env.DB, ent.id);
          return json({ error: "bad_request" }, 400);
        }

        try {
          const content = await llm.complete(body.system, body.user);
          await logCompile(env.DB, ent.id, payload.installId, "ok", now);
          const out = { content };
          if (idem) {
            await env.DB.prepare(
              `INSERT OR REPLACE INTO compile_idempotency (key, entitlement_id, response_json, created_at) VALUES (?, ?, ?, ?)`,
            )
              .bind(idem, ent.id, JSON.stringify(out), now)
              .run();
          }
          return json(out);
        } catch {
          await refundOne(env.DB, ent.id);
          await logCompile(env.DB, ent.id, payload.installId, "error", now);
          return json({ error: "llm_failed" }, 502);
        }
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(err instanceof Error ? err.message : "internal");
      return json({ error: "internal" }, 500);
    }
  },
};

export type { Env };

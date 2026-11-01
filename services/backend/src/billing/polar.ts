import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingEvent, BillingProvider } from "./types.js";

/**
 * Polar uses Standard Webhooks-style signing:
 * base = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 * signature header may contain `v1,<base64>` parts.
 */
export function polarBilling(): BillingProvider {
  return {
    async verifyAndParse(req, secret) {
      const raw = await req.text();
      const id = req.headers.get("webhook-id") ?? "";
      const ts = req.headers.get("webhook-timestamp") ?? "";
      const sigHeader = req.headers.get("webhook-signature") ?? "";
      if (!id || !ts || !sigHeader) return null;
      const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
      const base = `${id}.${ts}.${raw}`;
      const expected = createHmac("sha256", key).update(base).digest();
      const ok = sigHeader.split(" ").some((part) => {
        const [, b64] = part.split(",");
        if (!b64) return false;
        try {
          const got = Buffer.from(b64, "base64");
          return got.length === expected.length && timingSafeEqual(got, expected);
        } catch {
          return false;
        }
      });
      if (!ok) return null;
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return null;
      }
      return normalizePolar(body);
    },
  };
}

function normalizePolar(body: unknown): BillingEvent | null {
  const b = body as {
    type?: string;
    data?: {
      id?: string;
      status?: string;
      customer_id?: string;
      product_id?: string;
      current_period_end?: string | number;
      current_period_start?: string | number;
    };
  };
  if (!b?.type || !b.data?.id) return null;
  const subId = b.data.id;
  const periodEnd = toMs(b.data.current_period_end) ?? Date.now() + 30 * 86400000;
  const periodKey = String(b.data.current_period_start ?? b.data.current_period_end ?? periodEnd);
  if (b.type === "subscription.active" || b.type === "subscription.created" || (b.type === "subscription.updated" && b.data.status === "active")) {
    return {
      type: "subscription.active",
      polarCustomerId: String(b.data.customer_id ?? ""),
      polarSubscriptionId: subId,
      periodEnd,
      periodKey,
      productId: String(b.data.product_id ?? ""),
    };
  }
  if (b.type === "subscription.updated" && b.data.status === "active") {
    return { type: "subscription.renewed", polarSubscriptionId: subId, periodEnd, periodKey };
  }
  if (b.type === "subscription.canceled" || b.data.status === "canceled") {
    return { type: "subscription.canceled", polarSubscriptionId: subId };
  }
  if (b.data.status === "past_due") {
    return { type: "subscription.past_due", polarSubscriptionId: subId };
  }
  return null;
}

function toMs(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Test helper: sign a body the way Polar would. */
export function signPolarWebhook(secret: string, id: string, ts: string, raw: string): string {
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
  const dig = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return `v1,${dig}`;
}

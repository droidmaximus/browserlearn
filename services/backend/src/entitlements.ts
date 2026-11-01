import { mintClaimForEntitlement, PRO_ALLOTMENT } from "./claims.js";
import { resetAllotment } from "./credits.js";
import { newId } from "./ids.js";
import type { BillingEvent } from "./billing/types.js";
import type { D1Like } from "./env.js";

export async function applyBillingEvent(
  db: D1Like,
  event: BillingEvent,
  productId: string,
  now: number,
): Promise<{ claimCode?: string }> {
  if (event.type === "subscription.active") {
    if (productId && event.productId && event.productId !== productId) return {};
    const existing = await db
      .prepare(`SELECT id, period_key FROM entitlements WHERE polar_subscription_id = ?`)
      .bind(event.polarSubscriptionId)
      .first<{ id: string; period_key: string }>();
    if (existing) {
      if (existing.period_key !== event.periodKey) {
        await resetAllotment(db, existing.id, PRO_ALLOTMENT, event.periodKey, event.periodEnd, now);
      }
      await db
        .prepare(`UPDATE entitlements SET status = 'active', period_end = ?, updated_at = ? WHERE id = ?`)
        .bind(event.periodEnd, now, existing.id)
        .run();
      const code = await mintClaimForEntitlement(db, existing.id, now);
      return code ? { claimCode: code } : {};
    }
    const id = newId();
    await db
      .prepare(
        `INSERT INTO entitlements (id, polar_customer_id, polar_subscription_id, status, period_end, period_key, install_id, remaining, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?)`,
      )
      .bind(id, event.polarCustomerId, event.polarSubscriptionId, event.periodEnd, event.periodKey, PRO_ALLOTMENT, now, now)
      .run();
    const claimCode = await mintClaimForEntitlement(db, id, now);
    return { claimCode };
  }
  if (event.type === "subscription.renewed") {
    const existing = await db
      .prepare(`SELECT id, period_key FROM entitlements WHERE polar_subscription_id = ?`)
      .bind(event.polarSubscriptionId)
      .first<{ id: string; period_key: string }>();
    if (!existing) return {};
    if (existing.period_key !== event.periodKey) {
      await resetAllotment(db, existing.id, PRO_ALLOTMENT, event.periodKey, event.periodEnd, now);
    } else {
      await db.prepare(`UPDATE entitlements SET period_end = ?, updated_at = ? WHERE id = ?`).bind(event.periodEnd, now, existing.id).run();
    }
    await db.prepare(`UPDATE entitlements SET status = 'active', updated_at = ? WHERE id = ?`).bind(now, existing.id).run();
    return {};
  }
  if (event.type === "subscription.canceled") {
    await db
      .prepare(`UPDATE entitlements SET status = 'canceled', updated_at = ? WHERE polar_subscription_id = ?`)
      .bind(now, event.polarSubscriptionId)
      .run();
    return {};
  }
  if (event.type === "subscription.past_due") {
    await db
      .prepare(`UPDATE entitlements SET status = 'past_due', updated_at = ? WHERE polar_subscription_id = ?`)
      .bind(now, event.polarSubscriptionId)
      .run();
    return {};
  }
  return {};
}

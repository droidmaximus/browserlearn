import { newId } from "./ids.js";
import type { D1Like } from "./env.js";

export const RATE_LIMIT_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export async function debitOne(db: D1Like, entitlementId: string): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE entitlements SET remaining = remaining - 1, updated_at = ? WHERE id = ? AND remaining > 0 AND status = 'active'`)
    .bind(Date.now(), entitlementId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function refundOne(db: D1Like, entitlementId: string): Promise<void> {
  await db.prepare(`UPDATE entitlements SET remaining = remaining + 1, updated_at = ? WHERE id = ?`).bind(Date.now(), entitlementId).run();
}

export async function resetAllotment(db: D1Like, entitlementId: string, remaining: number, periodKey: string, periodEnd: number, now: number): Promise<void> {
  await db
    .prepare(`UPDATE entitlements SET remaining = ?, period_key = ?, period_end = ?, updated_at = ? WHERE id = ?`)
    .bind(remaining, periodKey, periodEnd, now, entitlementId)
    .run();
}

export async function checkRateLimit(db: D1Like, entitlementId: string, now: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT window_start, count FROM compile_rate WHERE entitlement_id = ?`)
    .bind(entitlementId)
    .first<{ window_start: number; count: number }>();
  if (!row || now - row.window_start >= HOUR_MS) {
    await db
      .prepare(
        `INSERT INTO compile_rate (entitlement_id, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(entitlement_id) DO UPDATE SET window_start = excluded.window_start, count = 1`,
      )
      .bind(entitlementId, now)
      .run();
    return true;
  }
  if (row.count >= RATE_LIMIT_PER_HOUR) return false;
  await db.prepare(`UPDATE compile_rate SET count = count + 1 WHERE entitlement_id = ?`).bind(entitlementId).run();
  return true;
}

export async function logCompile(
  db: D1Like,
  entitlementId: string,
  installId: string,
  status: "ok" | "error" | "rate_limited" | "no_credits",
  now: number,
): Promise<void> {
  await db
    .prepare(`INSERT INTO compile_events (id, entitlement_id, install_id, ts, status) VALUES (?, ?, ?, ?, ?)`)
    .bind(newId(), entitlementId, installId, now, status)
    .run();
}

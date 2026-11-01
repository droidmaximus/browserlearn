import { sha256Hex } from "./crypto/hash.js";
import { mintClaimCode, newId } from "./ids.js";
import type { D1Like } from "./env.js";

const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PRO_ALLOTMENT = 300;

export async function mintClaimForEntitlement(db: D1Like, entitlementId: string, now: number): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM claim_codes WHERE entitlement_id = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`)
    .bind(entitlementId, now)
    .first<{ id: string }>();
  if (existing) {
    /* Do not re-reveal; caller should already have shown the code. Mint only when none unused. */
    return "";
  }
  const code = mintClaimCode();
  await db
    .prepare(
      `INSERT INTO claim_codes (id, code_hash, entitlement_id, expires_at, used_at, used_install_id) VALUES (?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(newId(), sha256Hex(code), entitlementId, now + CLAIM_TTL_MS)
    .run();
  return code;
}

export async function redeemClaim(
  db: D1Like,
  code: string,
  installId: string,
  now: number,
): Promise<{ entitlementId: string } | { error: "not_found" | "expired" | "used" }> {
  const hash = sha256Hex(code);
  const row = await db
    .prepare(`SELECT id, entitlement_id, expires_at, used_at FROM claim_codes WHERE code_hash = ?`)
    .bind(hash)
    .first<{ id: string; entitlement_id: string; expires_at: number; used_at: number | null }>();
  if (!row) return { error: "not_found" };
  if (row.used_at != null) return { error: "used" };
  if (row.expires_at <= now) return { error: "expired" };
  const upd = await db
    .prepare(`UPDATE claim_codes SET used_at = ?, used_install_id = ? WHERE id = ? AND used_at IS NULL`)
    .bind(now, installId, row.id)
    .run();
  if (!upd.meta?.changes) return { error: "used" };
  await db.prepare(`UPDATE entitlements SET install_id = ?, updated_at = ? WHERE id = ?`).bind(installId, now, row.entitlement_id).run();
  return { entitlementId: row.entitlement_id };
}

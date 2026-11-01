import { issuePayload, signLicenseToken } from "./crypto/license.js";
import { newId } from "./ids.js";
import type { D1Like } from "./env.js";

export async function issueLicense(
  db: D1Like,
  privateKeyPem: string,
  entitlementId: string,
  installId: string,
  now: number,
): Promise<string> {
  const payload = issuePayload(installId, now);
  const token = signLicenseToken(payload, privateKeyPem);
  await db
    .prepare(`INSERT INTO license_issues (id, entitlement_id, install_id, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(newId(), entitlementId, installId, payload.issuedAt, payload.expiresAt)
    .run();
  return token;
}

export async function getEntitlementByInstall(db: D1Like, installId: string) {
  return db
    .prepare(`SELECT * FROM entitlements WHERE install_id = ?`)
    .bind(installId)
    .first<{
      id: string;
      status: string;
      remaining: number;
      period_end: number;
      install_id: string | null;
    }>();
}

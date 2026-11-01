import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { LICENSE_TTL_MS, type LicensePayload } from "@browserlearn/core/license";

export { LICENSE_TTL_MS };

export function publicKeyPemFromPrivate(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "pem" })
    .toString();
}

export function signLicenseToken(payload: LicensePayload, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(null, Buffer.from(body), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${body}.${sig}`;
}

export function parseLicenseToken(token: string): LicensePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as LicensePayload;
    if (payload.plan !== "pro" || typeof payload.installId !== "string") return null;
    if (typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyLicenseSignature(token: string, privateKeyPem: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const pub = createPublicKey(createPrivateKey(privateKeyPem));
  try {
    return verify(null, Buffer.from(parts[0]), pub, Buffer.from(parts[1], "base64url"));
  } catch {
    return false;
  }
}

export function issuePayload(installId: string, now: number): LicensePayload {
  return { plan: "pro", installId, issuedAt: now, expiresAt: now + LICENSE_TTL_MS };
}

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
export const LICENSE_TTL_MS = 30 * DAY_MS;
export const LICENSE_GRACE_MS = 14 * DAY_MS;

export interface LicensePayload {
  plan: "pro";
  installId: string;
  issuedAt: number;
  expiresAt: number;
}

export type LicenseStatus =
  | { active: true; plan: "pro"; expiresAt: number; inGrace: boolean }
  | { active: false; reason: "malformed" | "bad_signature" | "wrong_install" | "expired" };

export function generateLicenseKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(null, Buffer.from(body), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${body}.${sig}`;
}

function isPayload(v: unknown): v is LicensePayload {
  const p = v as LicensePayload;
  return (
    typeof v === "object" &&
    v !== null &&
    p.plan === "pro" &&
    typeof p.installId === "string" &&
    typeof p.issuedAt === "number" &&
    typeof p.expiresAt === "number"
  );
}

export function verifyLicense(token: string, publicKeyPem: string, installId: string, now: number): LicenseStatus {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { active: false, reason: "malformed" };
  const [body, sig] = parts;

  let ok = false;
  try {
    ok = verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(sig, "base64url"));
  } catch {
    ok = false;
  }
  if (!ok) return { active: false, reason: "bad_signature" };

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { active: false, reason: "malformed" };
  }
  if (!isPayload(payload)) return { active: false, reason: "malformed" };
  if (payload.installId !== installId) return { active: false, reason: "wrong_install" };
  if (now > payload.expiresAt + LICENSE_GRACE_MS) return { active: false, reason: "expired" };
  return { active: true, plan: payload.plan, expiresAt: payload.expiresAt, inGrace: now > payload.expiresAt };
}

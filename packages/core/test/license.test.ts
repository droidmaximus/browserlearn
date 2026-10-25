import { describe, expect, it } from "vitest";
import {
  generateLicenseKeyPair,
  LICENSE_GRACE_MS,
  LICENSE_TTL_MS,
  signLicense,
  verifyLicense,
} from "../src/license.js";

const { publicKeyPem, privateKeyPem } = generateLicenseKeyPair();
const issuedAt = 1_000_000;
const payload = { plan: "pro" as const, installId: "inst-1", issuedAt, expiresAt: issuedAt + LICENSE_TTL_MS };
const token = signLicense(payload, privateKeyPem);

describe("verifyLicense", () => {
  it("accepts a valid token before expiry", () => {
    expect(verifyLicense(token, publicKeyPem, "inst-1", issuedAt + 1)).toEqual({
      active: true,
      plan: "pro",
      expiresAt: payload.expiresAt,
      inGrace: false,
    });
  });

  it("stays active but flags grace after expiry", () => {
    const status = verifyLicense(token, publicKeyPem, "inst-1", payload.expiresAt + 1);
    expect(status).toMatchObject({ active: true, inGrace: true });
  });

  it("expires after the grace period", () => {
    expect(verifyLicense(token, publicKeyPem, "inst-1", payload.expiresAt + LICENSE_GRACE_MS + 1)).toEqual({
      active: false,
      reason: "expired",
    });
  });

  it("rejects another install", () => {
    expect(verifyLicense(token, publicKeyPem, "inst-2", issuedAt)).toEqual({ active: false, reason: "wrong_install" });
  });

  it("rejects a tampered payload", () => {
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, expiresAt: Number.MAX_SAFE_INTEGER })).toString("base64url");
    expect(verifyLicense(`${forged}.${sig}`, publicKeyPem, "inst-1", issuedAt)).toEqual({
      active: false,
      reason: "bad_signature",
    });
  });

  it("rejects a token signed by another key", () => {
    const other = generateLicenseKeyPair();
    expect(verifyLicense(signLicense(payload, other.privateKeyPem), publicKeyPem, "inst-1", issuedAt)).toEqual({
      active: false,
      reason: "bad_signature",
    });
  });

  it("rejects garbage", () => {
    expect(verifyLicense("not-a-token", publicKeyPem, "inst-1", issuedAt)).toEqual({ active: false, reason: "malformed" });
  });

  it.each([undefined, null, 42, {}])("reports a non-string token %j as malformed", (bad) => {
    expect(verifyLicense(bad as unknown as string, publicKeyPem, "inst-1", issuedAt)).toEqual({
      active: false,
      reason: "malformed",
    });
  });

  it("is active and not in grace exactly at expiry", () => {
    expect(verifyLicense(token, publicKeyPem, "inst-1", payload.expiresAt)).toMatchObject({ active: true, inGrace: false });
  });

  it("is still active, in grace, on the last millisecond of the grace period", () => {
    expect(verifyLicense(token, publicKeyPem, "inst-1", payload.expiresAt + LICENSE_GRACE_MS)).toMatchObject({
      active: true,
      inGrace: true,
    });
  });
});

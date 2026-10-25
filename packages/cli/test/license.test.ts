import { createPublicKey } from "node:crypto";
import { generateLicenseKeyPair, signLicense } from "@browserlearn/core/license";
import { describe, expect, it } from "vitest";
import { activateLicense, clearLicense, LICENSE_PUBLIC_KEY_PEM, licenseView } from "../src/license.js";
import { testApp } from "./helpers.js";

const NOW = 1_700_000_000_000;

describe("license", () => {
  it("embeds an Ed25519 public key", () => {
    expect(createPublicKey(LICENSE_PUBLIC_KEY_PEM).asymmetricKeyType).toBe("ed25519");
  });

  it("activates, reports grace, and clears", () => {
    const keys = generateLicenseKeyPair();
    const app = testApp({ publicKeyPem: keys.publicKeyPem, now: () => NOW });
    const sign = (installId: string, expiresAt: number) => signLicense({ plan: "pro", installId, issuedAt: NOW, expiresAt }, keys.privateKeyPem);

    expect(licenseView(app)).toEqual({ installId: app.config.installId, status: "none" });
    expect(() => activateLicense(app, sign("someone-else", NOW + 1000))).toThrow("License rejected: wrong_install");
    expect(activateLicense(app, ` ${sign(app.config.installId, NOW + 1000)} `)).toEqual({
      installId: app.config.installId,
      status: "active",
      plan: "pro",
      expiresAt: NOW + 1000,
    });
    activateLicense(app, sign(app.config.installId, NOW - 1));
    expect(licenseView(app).status).toBe("grace");
    clearLicense(app);
    expect(licenseView(app).status).toBe("none");
    app.close();
  });

  it("reports a stored token that no longer verifies", () => {
    const app = testApp();
    app.store.setLicense({ token: "x.y", plan: "pro", installId: app.config.installId, expiresAt: 0, lastRefreshedAt: 0 });
    expect(licenseView(app)).toEqual({ installId: app.config.installId, status: "inactive", reason: "bad_signature" });
    app.close();
  });
});

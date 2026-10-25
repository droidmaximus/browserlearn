import { verifyLicense } from "@browserlearn/core/license";
import type { App } from "./app.js";

export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAS5SpLx4mekFzionLC0no2qMFr+ZKV84O1B2+kmTFOkw=
-----END PUBLIC KEY-----
`;

export type LicenseView =
  | { installId: string; status: "none" }
  | { installId: string; status: "active" | "grace"; plan: "pro"; expiresAt: number }
  | { installId: string; status: "inactive"; reason: string };

export function licenseView(app: App): LicenseView {
  const installId = app.config.installId;
  const stored = app.store.getLicense();
  if (!stored) return { installId, status: "none" };
  const s = verifyLicense(stored.token, app.publicKeyPem, installId, app.now());
  if (!s.active) return { installId, status: "inactive", reason: s.reason };
  return { installId, status: s.inGrace ? "grace" : "active", plan: s.plan, expiresAt: s.expiresAt };
}

export function activateLicense(app: App, token: string): LicenseView {
  const trimmed = token.trim();
  const s = verifyLicense(trimmed, app.publicKeyPem, app.config.installId, app.now());
  if (!s.active) throw new Error(`License rejected: ${s.reason}`);
  app.store.setLicense({ token: trimmed, plan: s.plan, installId: app.config.installId, expiresAt: s.expiresAt, lastRefreshedAt: app.now() });
  return licenseView(app);
}

export function clearLicense(app: App): void {
  app.store.clearLicense();
}

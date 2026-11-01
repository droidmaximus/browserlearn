import { signLicense, LICENSE_TTL_MS } from "@browserlearn/core/license";
import { describe, expect, it } from "vitest";
import { claimLicense, hostedLlmClient } from "../src/backend.js";
import { LICENSE_PUBLIC_KEY_PEM } from "../src/license.js";
import { testApp } from "./helpers.js";

const NOW = 1_700_000_000_000;
const PRIVATE = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIOtTbnUasEwTPxEQWvtMQeSOlLr9VAuWY6Bly6713Lhj
-----END PRIVATE KEY-----
`;

describe("backend client", () => {
  it("claims a code and activates the returned license", async () => {
    const app = testApp({ publicKeyPem: LICENSE_PUBLIC_KEY_PEM, now: () => NOW });
    app.saveConfig({ ...app.config, backendUrl: "https://backend.test" });
    const token = signLicense(
      { plan: "pro", installId: app.config.installId, issuedAt: NOW, expiresAt: NOW + LICENSE_TTL_MS },
      PRIVATE,
    );
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://backend.test/v1/claim");
      expect(JSON.parse(String(init?.body))).toEqual({ code: "ABC", installId: app.config.installId });
      return new Response(JSON.stringify({ token }), { status: 200 });
    };
    const view = await claimLicense(app, " ABC ", fetchImpl);
    expect(view).toMatchObject({ status: "active", plan: "pro" });
    app.close();
  });

  it("calls hosted compile with the stored license", async () => {
    const app = testApp({ publicKeyPem: LICENSE_PUBLIC_KEY_PEM, now: () => NOW });
    app.saveConfig({ ...app.config, backendUrl: "https://backend.test" });
    const token = signLicense(
      { plan: "pro", installId: app.config.installId, issuedAt: NOW, expiresAt: NOW + LICENSE_TTL_MS },
      PRIVATE,
    );
    app.store.setLicense({ token, plan: "pro", installId: app.config.installId, expiresAt: NOW + LICENSE_TTL_MS, lastRefreshedAt: NOW });
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://backend.test/v1/compile");
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${token}` });
      return new Response(JSON.stringify({ content: "ok" }), { status: 200 });
    };
    const client = hostedLlmClient(app, fetchImpl);
    expect(await client.complete("s", "u")).toBe("ok");
    app.close();
  });
});

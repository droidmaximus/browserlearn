import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      { test: { name: "node", environment: "node", include: ["test/**/*.test.ts"], exclude: ["test/capture.test.ts", "test/content.test.ts"] } },
      { test: { name: "dom", environment: "jsdom", include: ["test/capture.test.ts", "test/content.test.ts"] } },
    ],
  },
});

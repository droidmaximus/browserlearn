import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      { test: { name: "node", environment: "node", include: ["test/**/*.test.ts"], exclude: ["test/capture.test.ts", "test/content.test.ts"] } },
      // happy-dom avoids undici/jsdom fork crashes on GitHub Actions Node 22
      { test: { name: "dom", environment: "happy-dom", include: ["test/capture.test.ts", "test/content.test.ts"] } },
    ],
  },
});

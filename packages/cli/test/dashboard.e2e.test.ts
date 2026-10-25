import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { createDashboardHandler } from "../src/dashboard.js";
import { launchBrowser } from "../src/runner.js";
import { type RunningServer, startServer } from "../src/server.js";
import { seedRecording, testApp } from "./helpers.js";

const TOKEN = "e2e-dashboard-token";
const reply = {
  name: "Create a customer invoice",
  description: "Creates an invoice for a customer.",
  steps: [],
  params: [{ from: "param_1", name: "customer", description: "Customer name", required: true }],
};

describe("dashboard (real browser)", () => {
  let app: App;
  let server: RunningServer;
  let llm: Server;
  let browser: Browser;
  let page: Page;
  const llmBodies: string[] = [];

  beforeAll(async () => {
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        llmBodies.push(JSON.parse(body).messages[1].content);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
      });
    });
    await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", () => resolve()));
    app = testApp();
    seedRecording(app);
    app.saveConfig({ ...app.config, llm: { baseUrl: `http://127.0.0.1:${(llm.address() as AddressInfo).port}/v1`, model: "fake" } });
    server = await startServer(app, { port: 0, handler: (ingest) => createDashboardHandler(app, { dashboardToken: TOKEN, ingest }) });
    browser = await launchBrowser(true, { BROWSERLEARN_BROWSER: "chromium" });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    app?.close();
    llm?.close();
  });

  it("asks for the printed link when opened without a token", async () => {
    const fresh = await browser.newPage();
    await fresh.goto(server.url);
    await fresh.getByText("Open the dashboard from the link printed by npx browserlearn").waitFor();
    await fresh.close();
  });

  it("compiles a recording, previews the exact LLM payload, and names the workflow", async () => {
    await page.goto(`${server.url}/#token=${TOKEN}`);
    expect(page.url()).not.toContain(TOKEN);
    await page.getByRole("button", { name: "Compile" }).first().click();
    await page.getByLabel("Workflow name").waitFor();
    expect(await page.getByLabel("Workflow name").inputValue()).toBe("Create invoice");

    await page.getByRole("button", { name: "Preview LLM payload" }).click();
    const payload = await page.getByLabel("LLM payload").inputValue();
    expect(payload).toContain("param_1");
    expect(payload).not.toContain("Acme");

    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForFunction(
      () => (document.querySelector('[aria-label="Workflow name"]') as HTMLInputElement | null)?.value === "Create a customer invoice",
    );
    expect(llmBodies.at(-1)).toBe(payload);
  });

  it("saves LLM settings without showing the API key again", async () => {
    await page.goto(`${server.url}/#/settings`);
    await page.getByLabel("API key").fill("sk-dashboard-secret");
    await page.getByRole("button", { name: "Save LLM settings" }).click();
    await page.getByText("LLM settings saved.").waitFor();
    expect(app.config.llm?.apiKey).toBe("sk-dashboard-secret");
    expect(await page.content()).not.toContain("sk-dashboard-secret");
  });
});

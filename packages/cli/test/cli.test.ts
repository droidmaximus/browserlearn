import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openApp } from "../src/app.js";
import { main } from "../src/main.js";
import { compileAndSave } from "../src/workflows.js";
import { captureIo, seedRecording, tempHome } from "./helpers.js";

describe("browserlearn CLI", () => {
  it("creates a private config with a stable pairing code", async () => {
    const home = tempHome();
    const io = captureIo({ BROWSERLEARN_HOME: home });
    expect(await main(["pair"], io)).toBe(0);
    const code = io.out.join("").trim().split("\n").at(-1)!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);

    const again = captureIo({ BROWSERLEARN_HOME: home });
    await main(["pair"], again);
    expect(again.out.join("")).toContain(code);

    const reset = captureIo({ BROWSERLEARN_HOME: home });
    await main(["pair", "--reset"], reset);
    expect(reset.out.join("")).not.toContain(code);
  });

  it("lists and exports workflows", async () => {
    const home = tempHome();
    const app = openApp({ env: { BROWSERLEARN_HOME: home } });
    compileAndSave(app, seedRecording(app));
    app.close();
    const env = { BROWSERLEARN_HOME: home };

    const list = captureIo(env);
    expect(await main(["list"], list)).toBe(0);
    expect(list.out.join("")).toBe("Create invoice  v1  (param_1, param_2)\n");

    const exp = captureIo(env);
    expect(await main(["export", "Create invoice", "--format", "playwright"], exp)).toBe(0);
    expect(exp.out.join("")).toContain('page.getByRole("textbox", { name: "Customer", exact: true }).fill(params["param_1"])');

    const file = join(home, "w.mjs");
    expect(await main(["export", "Create invoice", "-f", "stagehand", "-o", file], captureIo(env))).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("stagehand.act(");
  });

  it("reports usage errors", async () => {
    const env = { BROWSERLEARN_HOME: tempHome() };
    const unknown = captureIo(env);
    expect(await main(["nope"], unknown)).toBe(2);
    expect(unknown.err.join("")).toContain("Unknown command: nope");

    const noFormat = captureIo(env);
    expect(await main(["export", "x"], noFormat)).toBe(1);
    expect(noFormat.err.join("")).toContain("Usage: browserlearn export");

    const missing = captureIo(env);
    expect(await main(["export", "x", "--format", "playwright"], missing)).toBe(1);
    expect(missing.err.join("")).toContain('No workflow named "x"');
  });

  it("rejects a corrupt config and names the file", async () => {
    const home = tempHome();
    writeFileSync(join(home, "config.json"), JSON.stringify({ installId: "" }));
    const io = captureIo({ BROWSERLEARN_HOME: home });
    expect(await main(["list"], io)).toBe(1);
    expect(io.err.join("")).toContain(`${join(home, "config.json")}: invalid installId`);
  });

  it("prints the package version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const io = captureIo({ BROWSERLEARN_HOME: tempHome() });
    expect(await main(["--version"], io)).toBe(0);
    expect(io.out.join("")).toBe(`${pkg.version}\n`);
  });
});

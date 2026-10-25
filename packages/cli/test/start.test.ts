import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { captureIo, tempHome } from "./helpers.js";

describe("browserlearn start", () => {
  it("serves the dashboard until stopped", async () => {
    const io = captureIo({ BROWSERLEARN_HOME: tempHome() });
    const done = main(["start", "--port", "0"], io);
    await vi.waitFor(() => expect(io.out.join("")).toContain("Dashboard: "), { timeout: 10_000 });
    const [, url, token] = /Dashboard: (http:\/\/127\.0\.0\.1:\d+)\/#token=(\S+)/.exec(io.out.join(""))!;
    expect((await fetch(`${url}/api/status`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${url}/api/status`)).status).toBe(401);
    const home = await fetch(`${url}/`);
    expect(home.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(await home.text()).toContain("<title>BrowserLearn</title>");
    io.stop();
    expect(await done).toBe(0);
  });

  it("explains a busy port", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
    const port = (blocker.address() as AddressInfo).port;
    const io = captureIo({ BROWSERLEARN_HOME: tempHome() });
    expect(await main(["start", "--port", String(port)], io)).toBe(1);
    expect(io.err.join("")).toContain(`Port ${port} is already in use`);
    blocker.close();
  });
});

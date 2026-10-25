import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openApp } from "../app.js";
import type { Io } from "../io.js";
import { createMcpServer } from "../mcp.js";

export async function mcpCmd(_args: string[], io: Io): Promise<number> {
  const app = openApp({ env: io.env });
  const server = createMcpServer(app);
  await server.connect(new StdioServerTransport());
  await Promise.race([
    io.untilStopped(),
    new Promise<void>((resolve) => {
      process.stdin.once("end", () => resolve());
      process.stdin.once("close", () => resolve());
    }),
    new Promise<void>((resolve) => {
      server.server.onclose = () => resolve();
    }),
  ]);
  await server.close();
  app.close();
  return 0;
}

import { parseArgs } from "node:util";
import { openApp } from "../app.js";
import { newToken } from "../config.js";
import { createDashboardHandler } from "../dashboard.js";
import type { Io } from "../io.js";
import { type RunningServer, startServer } from "../server.js";
import { VERSION } from "../version.js";

export async function startCmd(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" } } });
  const app = openApp({ env: io.env });
  const port = values.port === undefined ? app.config.port : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    app.close();
    throw new Error("--port must be a port number");
  }
  const dashboardToken = newToken();
  let server: RunningServer;
  try {
    server = await startServer(app, {
      port,
      handler: (ingest) => createDashboardHandler(app, { dashboardToken, ingest }),
      log: (m) => io.stderr(`${m}\n`),
    });
  } catch (err) {
    app.close();
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use. Is BrowserLearn already running? Use --port to choose another.`);
    }
    throw err;
  }
  io.stdout(
    [
      `BrowserLearn ${VERSION} is running.`,
      ``,
      `Dashboard: ${server.url}/#token=${dashboardToken}`,
      `Data:      ${app.paths.home}`,
      ``,
      `Press Ctrl+C to stop.`,
      ``,
    ].join("\n"),
  );
  await io.untilStopped();
  await server.close();
  app.close();
  return 0;
}

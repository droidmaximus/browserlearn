import { type ApiDeps, createApiHandler } from "./api.js";
import type { App } from "./app.js";
import type { HttpHandler } from "./server.js";
import { serveStatic } from "./static.js";

export function createDashboardHandler(app: App, deps: ApiDeps): HttpHandler {
  const api = createApiHandler(app, deps);
  return async (req, res) => {
    if (await api(req, res)) return;
    if (serveStatic(req, res)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  };
}

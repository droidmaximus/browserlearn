import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type { App } from "./app.js";
import { errorMessage } from "./errors.js";
import { IngestHub } from "./ingest.js";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface ServerOptions {
  port: number;
  handler?: (ingest: IngestHub) => HttpHandler;
  helloTimeoutMs?: number;
  log?: (message: string) => void;
}

export interface RunningServer {
  port: number;
  url: string;
  ingest: IngestHub;
  close(): Promise<void>;
}

const notFound: HttpHandler = (_req, res) => {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
};

export async function startServer(app: App, opts: ServerOptions): Promise<RunningServer> {
  const ingest = new IngestHub(app, opts.helloTimeoutMs ? { helloTimeoutMs: opts.helloTimeoutMs } : {});
  const handler = opts.handler?.(ingest) ?? notFound;
  const log = opts.log ?? ((m: string) => console.error(m));
  let port = opts.port;
  const hostAllowed = (host: string | undefined): boolean => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

  const server = createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err: unknown) => {
        log(`Request failed: ${errorMessage(err)}`);
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Internal error" }));
      });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin ?? "";
    if (req.url !== "/ingest" || !hostAllowed(req.headers.host) || !origin.startsWith("chrome-extension://")) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => ingest.accept(ws));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    ingest,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

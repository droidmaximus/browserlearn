import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
};

export const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export function serveStatic(req: IncomingMessage, res: ServerResponse, dir = PUBLIC_DIR): boolean {
  const entry = FILES[new URL(req.url ?? "/", "http://localhost").pathname];
  if (!entry || (req.method !== "GET" && req.method !== "HEAD")) return false;
  const body = readFileSync(join(dir, entry.file));
  res.writeHead(200, { ...SECURITY_HEADERS, "content-type": entry.type, "content-length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

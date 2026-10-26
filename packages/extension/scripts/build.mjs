import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const shared = { absWorkingDir: root, bundle: true, platform: "browser", target: "chrome114" };

await esbuild.build({ ...shared, format: "esm", entryPoints: ["src/background.ts"], outfile: "dist/background.js" });
await esbuild.build({ ...shared, format: "iife", entryPoints: ["src/content.ts"], outfile: "dist/content.js" });
await esbuild.build({ ...shared, format: "iife", entryPoints: ["src/popup.ts"], outfile: "dist/popup.js" });

for (const f of ["manifest.json", "popup.html", "popup.css"]) cpSync(join(root, f), join(dist, f));

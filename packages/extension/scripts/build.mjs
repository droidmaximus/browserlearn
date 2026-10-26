import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
for (const f of ["manifest.json"]) cpSync(join(root, f), join(dist, f));
writeFileSync(join(dist, ".gitkeep"), "");

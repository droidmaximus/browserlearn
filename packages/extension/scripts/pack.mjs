import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const outDir = join(root, "release");
const zip = join(outDir, "browserlearn-extension.zip");

execFileSync(process.execPath, [join(root, "scripts/build.mjs")], { cwd: root, stdio: "inherit" });
mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true });
execFileSync("zip", ["-r", zip, "."], { cwd: dist, stdio: "inherit" });
console.log(zip);

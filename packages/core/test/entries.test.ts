import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
};

const SUBPATHS = [".", "./types", "./schema", "./redact", "./compile", "./enrich", "./llm", "./license", "./export", "./store", "./public", "./resolve", "./protocol"];

const sourceOf = (distFile: string): string => join(root, distFile.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"));

/** Every builtin module reached through runtime (non-type) imports starting at a source file. */
function builtinsReachedFrom(entry: string): Set<string> {
  const builtins = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, kind, spec] of source.matchAll(/^(?:import|export)(\s+type)?[^;]*?from\s+"([^"]+)";/gms)) {
      if (kind) continue;
      if (spec!.startsWith(".")) visit(resolve(dirname(file), spec!.replace(/\.js$/, ".ts")));
      else builtins.add(spec!);
    }
  };
  visit(entry);
  return builtins;
}

describe("package entry points", () => {
  it("declares every subpath, each backed by a source file", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([...SUBPATHS].sort());
    for (const target of Object.values(pkg.exports)) {
      expect(existsSync(sourceOf(target.default)), target.default).toBe(true);
      expect(target.types).toBe(target.default.replace(/\.js$/, ".d.ts"));
    }
  });

  it("keeps node:sqlite out of every entry except ./store", () => {
    for (const subpath of SUBPATHS) {
      const reached = builtinsReachedFrom(sourceOf(pkg.exports[subpath]!.default));
      expect(reached.has("node:sqlite"), subpath).toBe(subpath === "./store");
    }
  });

  it("loads only node:crypto from Node builtins in the root entry, and only via license", () => {
    expect([...builtinsReachedFrom(sourceOf(pkg.exports["."]!.default))]).toEqual(["node:crypto"]);
    for (const subpath of ["./redact", "./compile", "./enrich", "./llm", "./schema", "./export", "./types"]) {
      expect([...builtinsReachedFrom(sourceOf(pkg.exports[subpath]!.default))], subpath).toEqual([]);
    }
  });
});

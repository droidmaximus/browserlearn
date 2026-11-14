#!/usr/bin/env bash
# Build a desktop-only OpenAI plugin ZIP with a vendored local MCP server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/skills/openai/browserlearn"
SERVER="$PLUGIN/server"
STAGE="$SERVER/.stage"
ZIP="$ROOT/skills/browserlearn-openai.zip"

cd "$ROOT"
npm run build --workspace @browserlearn/core
npm run build --workspace browserlearn

rm -rf "$STAGE" "$SERVER/node_modules" "$SERVER/package-lock.json"
mkdir -p "$STAGE"
npm pack --workspace @browserlearn/core --pack-destination "$STAGE"
npm pack --workspace browserlearn --pack-destination "$STAGE"

CORE_TGZ="$(ls "$STAGE"/browserlearn-core-*.tgz | head -1)"
CLI_TGZ="$(ls "$STAGE"/browserlearn-*.tgz | grep -v browserlearn-core | head -1)"

cd "$SERVER"
npm install --omit=dev --no-fund --no-audit "$CORE_TGZ" "$CLI_TGZ"
rm -rf "$STAGE"

# Rewrite deps to version pins (node_modules already materialised; avoid file:.stage paths in the ZIP)
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const p = JSON.parse(readFileSync("package.json", "utf8"));
p.dependencies = { "@browserlearn/core": "0.1.0", browserlearn: "0.1.0" };
writeFileSync("package.json", `${JSON.stringify(p, null, 2)}\n`);
NODE

node --input-type=module -e "import('browserlearn/dist/main.js').then(() => console.log('server deps ok'))"

rm -f "$ZIP"
cd "$ROOT/skills/openai"
zip -r "$ZIP" browserlearn \
  -x '*/.DS_Store' -x '*__MACOSX*' -x '*/.git/*' -x '*/.stage/*'

echo "Wrote $ZIP ($(du -h "$ZIP" | cut -f1))"
unzip -l "$ZIP" | rg 'plugin\.json|mcp\.json|server/mcp\.mjs|assets/logo\.png|server/node_modules/browserlearn/package\.json' || true

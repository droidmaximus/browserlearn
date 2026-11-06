# BrowserLearn

[![M8ven Score](https://m8ven.ai/badge/mcp/droidmaximus-browserlearn-ujmalj?v=796d65fec529bbdea401fd2e1689571d)](https://m8ven.ai/mcp/droidmaximus-browserlearn-ujmalj?s=readme)

**Browser agent training for developers** — record a real Chrome workflow once, compile it into a reusable parameterized skill, and run it from **MCP** clients (Claude Code, Cursor) or export **Playwright** / **Stagehand** scripts.

Free and open source (**MIT**). **Local-first** and **privacy-preserving**: recordings stay on your machine and are redacted before they are saved. No cloud account required.

| | |
| --- | --- |
| Record | Chrome MV3 extension captures clicks, types, selects, navigates |
| Compile | Deterministic local compiler turns a recording into a workflow (optional LLM naming via BYOK / Ollama) |
| Run | MCP tools, CLI runner, or exported automation code |

## Why BrowserLearn

- **Train browser agents by demonstration** — no hand-written selectors for every step
- **Works with AI coding tools** — MCP server for Claude, Cursor, and other Model Context Protocol hosts
- **Exports** — Playwright and Stagehand for teams that want code in git
- **Private by default** — typed values and recordings never leave your machine; optional LLM enrichment sends only an anonymized skeleton you can preview

## Requirements

- Node.js **22.13** or newer
- Google Chrome (recording + runs). Without Chrome: `npx playwright install chromium` once for the runner

## Quick start

```bash
git clone https://github.com/droidmaximus/browserlearn.git
cd browserlearn
npm install
npm run build --workspace @browserlearn/core
npm run build --workspace browserlearn
npm run build --workspace @browserlearn/extension
node packages/cli/dist/bin.js
```

Extension zip (Load unpacked): [v0.1.0 release](https://github.com/droidmaximus/browserlearn/releases/tag/v0.1.0).

1. Open the dashboard URL printed in the terminal.
2. Load the unpacked extension from [`packages/extension/dist`](packages/extension/dist) — see [packages/extension/README.md](packages/extension/README.md).
3. **Settings** → copy the pairing code into the extension popup.
4. Open a normal website → **Record** → do the task → **Stop**.

MCP setup, CLI, and optional LLM naming: [packages/cli/README.md](packages/cli/README.md).

## MCP (Claude Code / Cursor)

```json
{
  "mcpServers": {
    "browserlearn": { "command": "npx", "args": ["-y", "browserlearn", "mcp"] }
  }
}
```

Tools: `list_workflows`, `get_workflow`, `run_workflow`, `search_recordings`.

## Packages

- [`packages/cli`](packages/cli) — local app: dashboard, MCP server, runner (`browserlearn`)
- [`packages/core`](packages/core) — redaction, compiler, exporters, SQLite storage
- [`packages/extension`](packages/extension) — Chrome MV3 recorder (load unpacked from `dist`)

## Releases

- **CLI / core:** after `npm login`, publish `@browserlearn/core` then `browserlearn` so `npx browserlearn` works.
- **Extension:** `npm run pack --workspace @browserlearn/extension` → `packages/extension/release/browserlearn-extension.zip`, or use the [GitHub Release](https://github.com/droidmaximus/browserlearn/releases) asset.

## Keywords

browser automation, browser agent, MCP, Model Context Protocol, Playwright, Stagehand, Chrome extension, AI agents, local-first, privacy, TypeScript, Claude, Cursor

## License

[MIT](LICENSE)

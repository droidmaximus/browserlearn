# BrowserLearn

Teach your AI agent a browser task by doing it once. Free and open source (MIT). Everything runs on your machine.

1. **Record** a task in Chrome with the BrowserLearn extension.
2. **Compile** it locally into a reusable workflow with parameters. No LLM is required.
3. **Run** it from Claude Code, Cursor, or any MCP client — or export Playwright / Stagehand scripts.

Recordings stay on your machine and are redacted before they are saved.

## Requirements

- Node.js **22.13** or newer
- Google Chrome (for recording and running workflows). Without Chrome, run `npx playwright install chromium` once for the runner.

## Quick start (from this repo)

```bash
cd browserlearn
npm install
npm run build --workspace @browserlearn/core
npm run build --workspace browserlearn
npm run build --workspace @browserlearn/extension
node packages/cli/dist/bin.js
```

Then:

1. Open the dashboard URL printed in the terminal.
2. Load the unpacked extension from [`packages/extension/dist`](packages/extension/dist) (see [packages/extension/README.md](packages/extension/README.md)).
3. In **Settings**, copy the pairing code into the extension popup.
4. Open a normal website, press **Record**, do the task, press **Stop**.

Full MCP setup, CLI commands, and optional LLM naming: [packages/cli/README.md](packages/cli/README.md).

## Packages

- `packages/cli` — local app: dashboard, MCP server, runner (`npx browserlearn`)
- `packages/core` — redaction, compiler, exporters, storage
- `packages/extension` — Chrome MV3 extension (load unpacked from `dist`)

## License

MIT

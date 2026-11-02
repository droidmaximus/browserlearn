# BrowserLearn (local app)

Record a browser task once. Your AI agent can run it through MCP, or you can export Playwright or Stagehand scripts.

Everything runs on your machine. Recordings are redacted before they are saved; typed values never leave your computer unless you choose to send an anonymized outline to an LLM you configure.

## Start

```bash
npx browserlearn
```

From a git checkout of this monorepo (after `npm install` and building core + cli):

```bash
node packages/cli/dist/bin.js
```

Open the dashboard link it prints. Go to **Settings**, copy the pairing code, and paste it into the BrowserLearn Chrome extension. Load the unpacked extension from `packages/extension/dist` (see that package’s README). Then press **Record** in the extension, do the task, and press **Stop**. A workflow appears under **Workflows**.

Requires Node.js 22.13 or newer. Running workflows uses your installed Google Chrome; without Chrome, run `npx playwright install chromium` once.

## Use it from your AI agent (MCP)

Add BrowserLearn to your MCP client, for example Claude Code or Cursor:

```json
{
  "mcpServers": {
    "browserlearn": { "command": "npx", "args": ["-y", "browserlearn", "mcp"] }
  }
}
```

The agent gets four tools: `list_workflows`, `get_workflow`, `run_workflow`, and `search_recordings`. Values you typed while recording are never included, unless you turn on “Show recorded example values to AI agents” for a workflow.

## Command line

```bash
browserlearn list                                   # your workflows
browserlearn run "Create invoice" --params '{"customer":"Globex"}'
browserlearn export "Create invoice" --format playwright --out invoice.mjs
browserlearn pair                                   # show the extension pairing code
```

## Naming workflows with an LLM (optional)

In **Settings**, connect any OpenAI-compatible endpoint: your own API key, or a local model such as Ollama. Before anything is sent, the dashboard shows you the exact payload. It contains only the anonymized outline of the workflow, with every typed value replaced by a placeholder. You can edit it, or cancel.

## Data

Everything lives in `~/.browserlearn` (set `BROWSERLEARN_HOME` to change this).

## License

MIT

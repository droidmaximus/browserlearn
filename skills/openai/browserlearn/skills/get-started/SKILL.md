---
name: browserlearn-get-started
description: >-
  Onboarding for BrowserLearn in ChatGPT or Codex: install the local app, pair
  the Chrome extension, connect MCP, and run the first recorded workflow.
---

# Get started with BrowserLearn

BrowserLearn is a **local-first** MIT open-source tool: record a Chrome task once, then run it from MCP tools or export Playwright/Stagehand. Data stays on the user’s machine. Follow [references/privacy.md](../../references/privacy.md).

## Goal for this session

Leave the user with: local app running → extension paired → one workflow recorded → MCP tools available.

## Steps

1. Confirm Node.js ≥ 22.13 (`node -v`) and Google Chrome.
2. Start BrowserLearn:
   - Preferred: `npx browserlearn`
   - Or from git: clone https://github.com/droidmaximus/browserlearn , build, then `node packages/cli/dist/bin.js`
3. Open the dashboard URL printed in the terminal (`127.0.0.1`, default port 7420).
4. Load the Chrome MV3 extension (Load unpacked from `packages/extension/dist`, or the [v0.1.0 release zip](https://github.com/droidmaximus/browserlearn/releases/tag/v0.1.0)).
5. **Settings** → copy pairing code (or `browserlearn pair`) → paste into the extension → Save.
6. On a normal website: **Record** → do the task → **Stop**.
7. Confirm MCP is configured (this plugin’s `mcp.json` launches `npx -y browserlearn mcp`). See [references/mcp-config.md](../../references/mcp-config.md).
8. Call `list_workflows`. If empty, the recording did not land — re-check pairing and that the local app stayed running.

## Next skills

- **browserlearn-setup** — deeper install / pairing troubleshooting
- **browserlearn-workflows** — list / get / run via MCP
- **browserlearn-export** — Playwright or Stagehand export

## Privacy reminders

- Never upload `~/.browserlearn` or typed secrets.
- Do not enable “Show recorded example values to AI agents” unless the user asks.
- `run_workflow` drives a real browser and can change live sites — confirm before running.

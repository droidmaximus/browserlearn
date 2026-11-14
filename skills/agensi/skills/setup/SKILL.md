---
name: browserlearn-setup
description: >-
  Use when the user wants to install BrowserLearn, pair the Chrome extension,
  start the local dashboard, or record a browser task for AI agent workflows.
summary: Install and pair BrowserLearn; record a Chrome task into a local workflow.
version: 0.1.0
tags:
  - browser-agent
  - chrome-extension
  - mcp
  - local-first
  - setup
keywords:
  - BrowserLearn
  - record Chrome workflow
  - pair extension
  - browser agent training
  - npx browserlearn
use_cases:
  - First-time BrowserLearn install on a developer machine
  - Pairing the MV3 extension to the local app
  - Recording a click/type/navigate task for later MCP runs
docs_url: https://github.com/droidmaximus/browserlearn
---

# BrowserLearn setup

Teach the user (and yourself) how to get BrowserLearn recording on this machine. Core product is MIT OSS; everything stays local. Follow [shared/privacy.md](../../shared/privacy.md).

## Prerequisites

- Node.js **22.13** or newer (`node -v`)
- Google Chrome (recording + runs). If Chrome is missing for the runner only: `npx playwright install chromium`
- This skill does **not** replace installing BrowserLearn — guide the user through install

## Install options

### A. From git (works today)

```bash
git clone https://github.com/droidmaximus/browserlearn.git
cd browserlearn
npm install
npm run build --workspace @browserlearn/core
npm run build --workspace browserlearn
npm run build --workspace @browserlearn/extension
node packages/cli/dist/bin.js
```

### B. Via npm (when `browserlearn` is published)

```bash
npx browserlearn
```

Leave the process running. It prints a **dashboard URL** on `127.0.0.1` (default port **7420**).

## Pair the Chrome extension

1. Build or download the extension:
   - From git: use `packages/extension/dist` after the build above
   - Or download the zip from [v0.1.0 release](https://github.com/droidmaximus/browserlearn/releases/tag/v0.1.0) and unpack
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the extension `dist` folder
3. Open the dashboard → **Settings** → copy the pairing code  
   Or CLI: `browserlearn pair` / `node packages/cli/dist/bin.js pair`
4. Extension popup → paste code → **Save pairing**
5. If the icon shows **!**, the local app is not running — start it again

## Record a workflow

1. Open a normal website (not only `chrome://` pages)
2. Extension: enter a short name → **Record**
3. Chrome may ask for permission to the current site — allow it
4. Perform the task (clicks, types, selects, navigates)
5. **Stop** — a workflow appears under **Workflows** in the dashboard

Typed values are redacted before save. Do not ask the user to paste passwords into the chat.

## Wire MCP (after first recording)

Add the MCP server from [shared/mcp-config.md](../../shared/mcp-config.md) so Claude Code / Cursor can call `list_workflows`, `get_workflow`, `run_workflow`, and `search_recordings`.

## Checklist output (return this to the user)

```text
- [ ] Node ≥ 22.13
- [ ] Local app running (dashboard URL)
- [ ] Extension loaded unpacked
- [ ] Pairing code saved in extension
- [ ] At least one recording stopped → workflow listed
- [ ] MCP config added (optional until they want agent runs)
```

## Failure modes

| Problem | What to do |
| --- | --- |
| `npx browserlearn` not found / old Node | Upgrade Node; or use git checkout + `node packages/cli/dist/bin.js` |
| Extension cannot pair | Confirm app is on `127.0.0.1`; reset with `browserlearn pair --reset` and re-paste |
| No workflow after Stop | Confirm pairing; check dashboard **Workflows**; ensure site permission was granted |
| Port in use | Stop the other process or set config port via Settings / `~/.browserlearn` |

## Data location

Default home: `~/.browserlearn`. Override with `BROWSERLEARN_HOME`. Never commit this directory.

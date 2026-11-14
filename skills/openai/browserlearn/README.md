# BrowserLearn — OpenAI desktop-only MCP plugin

Local stdio MCP plugin for ChatGPT / Codex desktop. Skills + bundled BrowserLearn MCP runtime (no public HTTPS server).

## Layout

```text
browserlearn/
├── plugin.json
├── mcp.json              # stdio → node ${PLUGIN_ROOT}/server/mcp.mjs
├── server/               # vendored browserlearn + node_modules
├── assets/
├── references/
└── skills/
```

## Build the ZIP

From the repo root (requires Node ≥ 22.13):

```bash
bash scripts/pack-openai-plugin.sh
```

Output: `skills/browserlearn-openai.zip` (includes `server/node_modules` so reviewers can launch offline).

## Pre-submit checklist

### 1. Listing URLs (on `master`)

- Privacy: https://github.com/droidmaximus/browserlearn/blob/master/docs/privacy.md
- Terms: https://github.com/droidmaximus/browserlearn/blob/master/docs/terms.md

### 2. OpenAI partner allowlisting (required)

Local MCP listings need org allowlisting ([desktop-only guide](https://developers.openai.com/plugins/deploy/desktop-only)):

1. Copy **Organization ID** from [org settings](https://platform.openai.com/settings/organization).
2. Email your OpenAI representative:

```text
Subject: Allowlist org for local MCP plugin submission — BrowserLearn

Please allowlist our organization for local (stdio) MCP / desktop-only
plugin directory submissions.

Organization ID: <PASTE_ORG_ID>
Plugin name: browserlearn
Repository: https://github.com/droidmaximus/browserlearn
Contact: bhojanapalliavinash@gmail.com

Package uses stdio MCP at ${PLUGIN_ROOT}/server/mcp.mjs and
requires_local_executor: true.

Thank you,
droidmaximus
```

3. After confirmation, upload the ZIP per OpenAI’s local MCP instructions (documented as Skills only + Upload ZIP for approved local MCP orgs).

### 3. Runtime on the reviewer machine

- Node.js ≥ 22.13 on PATH (the `node` command in `mcp.json`)
- Google Chrome for `run_workflow` (or `npx playwright install chromium` once)
- Recordings stay in `~/.browserlearn`

### 4. Tool hints

The MCP server declares all four annotation hints on every tool.

## Notes

- Not a remote “With MCP” HTTPS plugin — there is no cloud BrowserLearn endpoint.
- Do not put secrets in the ZIP.
- Agensi pack (separate): `skills/agensi` · https://www.agensi.io/r/MAXIMUS

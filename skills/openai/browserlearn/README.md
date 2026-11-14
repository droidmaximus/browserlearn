# BrowserLearn — OpenAI Plugin package

Portable [Agent Plugins](https://developers.openai.com/plugins/build/plugins) package for ChatGPT / Codex: skills + local stdio MCP (`npx -y browserlearn mcp`).

## Layout

```text
browserlearn/
├── plugin.json
├── mcp.json
├── references/
└── skills/
    ├── get-started/
    ├── setup/
    ├── workflows/
    └── export/
```

## Build the ZIP

From the repo root:

```bash
cd skills/openai
zip -r ../browserlearn-openai.zip browserlearn \
  -x '*/.DS_Store' -x '*__MACOSX*' -x '*/.git/*'
```

Upload `skills/browserlearn-openai.zip` in the [OpenAI plugin submission portal](https://developers.openai.com/plugins/deploy/submission).

## Pre-submit checklist

### 1. Listing URLs (done on `master`)

- Privacy: https://github.com/droidmaximus/browserlearn/blob/master/docs/privacy.md
- Terms: https://github.com/droidmaximus/browserlearn/blob/master/docs/terms.md

### 2. OpenAI partner allowlisting (required for local MCP)

Local stdio MCP directory listings need org allowlisting ([desktop-only guide](https://developers.openai.com/plugins/deploy/desktop-only)):

1. Open [OpenAI org settings](https://platform.openai.com/settings/organization) and copy the **Organization ID**.
2. Email your OpenAI representative (or Apps / plugin support) with:

```text
Subject: Allowlist org for local MCP plugin submission — BrowserLearn

Hello,

Please allowlist our OpenAI organization for local (stdio) MCP / desktop-only
plugin directory submissions.

Organization ID: <PASTE_ORG_ID>
Plugin name: browserlearn
Repository: https://github.com/droidmaximus/browserlearn
Contact: bhojanapalliavinash@gmail.com

We will submit via Skills only + Upload ZIP with root mcp.json (stdio:
npx -y browserlearn mcp) and requires_local_executor: true.

Thank you,
droidmaximus
```

3. Wait for confirmation, then in the portal choose **Create plugin → Skills only → Upload ZIP**.

### 3. `npx browserlearn` for reviewers

Preferred (after npm publish):

```bash
npx -y browserlearn mcp
```

Reviewer local install (if npm is not published yet):

```bash
git clone https://github.com/droidmaximus/browserlearn.git
cd browserlearn
npm install
npm run build --workspace @browserlearn/core
npm run build --workspace browserlearn
npm link --workspace browserlearn
browserlearn mcp
```

Point a temporary MCP config at the git binary if needed:

```json
{
  "mcpServers": {
    "browserlearn": {
      "command": "node",
      "args": ["/absolute/path/to/browserlearn/packages/cli/dist/bin.js", "mcp"]
    }
  }
}
```

### 4. Tool hints

The MCP server declares all four hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool — required for OpenAI directory scans.

## Submission notes

- BrowserLearn is **desktop-only** (`requires_local_executor: true`) because the MCP server is local stdio, not a public HTTPS endpoint.
- **Do not choose Skills only** — OpenAI is not accepting new skills-only submissions. Upload a normal plugin ZIP that includes `mcp.json`, then follow [desktop-only / local MCP](https://developers.openai.com/plugins/deploy/desktop-only) (org allowlisting required).
- App icons are in `assets/` (`logo` + `composerIcon`, with dark variants).
- Do not put `review.test_cases` in `plugin.json` or under `mcpServers` for this layout; add cases in portal Review details if asked.
- Do not put secrets in the ZIP.

## Other markets

Agensi pack (separate ZIP): `skills/agensi` · https://www.agensi.io/r/MAXIMUS

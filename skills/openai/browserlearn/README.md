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

## Submission notes

- BrowserLearn is **desktop-only** (`requires_local_executor: true`) because the MCP server is local stdio, not a public HTTPS endpoint.
- Local MCP directory listings may require [partner allowlisting](https://developers.openai.com/plugins/deploy/desktop-only). Choose **Skills only** in the portal if that is the approved path for your org, and keep this ZIP’s `mcp.json`.
- `npx -y browserlearn mcp` needs the `browserlearn` npm package published (or a local install on PATH). Until npm publish lands, reviewers need a git build on the machine.
- Privacy / terms URLs point at `docs/privacy.md` and `docs/terms.md` on GitHub — merge those to `master` before final submission.
- Tool annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are declared in the BrowserLearn MCP server itself.

## Affiliate / other markets

Agensi pack (separate ZIP): `skills/agensi` · https://www.agensi.io/r/MAXIMUS

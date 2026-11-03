# BrowserLearn Agent Skills

Free skill pack for [Agensi](https://www.agensi.io/r/MAXIMUS): teach Claude Code, Cursor, Copilot, and other agents how to install, run, and export **BrowserLearn** workflows.

BrowserLearn itself stays MIT and local-first. This pack is Markdown instructions only — it does **not** ship the daemon, extension binary, or your recordings.

| Skill | When the agent should load it |
| --- | --- |
| [setup](skills/setup/SKILL.md) | Install, pair the Chrome extension, start recording |
| [workflows](skills/workflows/SKILL.md) | List, inspect, or run workflows via MCP / CLI |
| [export](skills/export/SKILL.md) | Export Playwright or Stagehand scripts |

Shared refs (loaded with every skill): [privacy](shared/privacy.md), [MCP config](shared/mcp-config.md).

## Product

- Repo: https://github.com/droidmaximus/browserlearn
- Extension zip: https://github.com/droidmaximus/browserlearn/releases/tag/v0.1.0
- Requires Node.js ≥ 22.13 and Google Chrome

## Test locally (before Agensi upload)

1. Install BrowserLearn from git (or `npx browserlearn` once published to npm).
2. Copy this folder into your agent’s skills path, or point the agent at `skills/agensi`.
3. Ask: “Set up BrowserLearn and record a workflow” → expect the **setup** skill.
4. Ask: “List my BrowserLearn workflows and run one” → **workflows**.
5. Ask: “Export that workflow as Playwright” → **export**.

## Package for Agensi

```bash
cd skills
zip -r browserlearn-agensi.zip agensi \
  -x '*/.DS_Store' -x '*__MACOSX*' -x '*/.git/*'
```

Upload `browserlearn-agensi.zip` as a **free** skill pack. Listing SEO terms: browser agent, record Chrome workflow, MCP, Playwright, Stagehand, local-first.

## Creator checklist

- [x] Affiliate link: https://www.agensi.io/r/MAXIMUS
- [ ] Agensi creator account + reserved names (`browserlearn`, etc.)
- [ ] Local dry-run against a real BrowserLearn install
- [ ] ZIP uploaded; listing links GitHub + release extension zip
- [ ] Compatible agents marked: Claude Code, Cursor, Copilot, and others Agensi supports

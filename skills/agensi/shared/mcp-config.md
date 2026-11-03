# BrowserLearn MCP configuration

Add the BrowserLearn MCP server to the user’s agent host. The server speaks stdio and only binds local tooling; workflow data stays on disk under `~/.browserlearn`.

## Cursor / Claude Code / generic MCP JSON

```json
{
  "mcpServers": {
    "browserlearn": {
      "command": "npx",
      "args": ["-y", "browserlearn", "mcp"]
    }
  }
}
```

From a git checkout of the monorepo (after `npm install` and building `@browserlearn/core` + `browserlearn`):

```json
{
  "mcpServers": {
    "browserlearn": {
      "command": "node",
      "args": ["packages/cli/dist/bin.js", "mcp"]
    }
  }
}
```

Use an absolute path to `packages/cli/dist/bin.js` if the agent’s cwd is not the repo root.

## Tools

| Tool | Purpose | Inputs |
| --- | --- | --- |
| `list_workflows` | Names, descriptions, JSON Schema for params | _(none)_ |
| `get_workflow` | Full public definition (steps, locators, params) | `name` (string) |
| `run_workflow` | Headless local Chrome run; reports per-step success | `name`, optional `params` (`Record<string, string>`) |
| `search_recordings` | Find recordings by name, URL, or element label | `query`, optional `limit` (1–50) |

## Privacy note for agents

Public workflow payloads **omit recorded typed examples** unless the user turned on example exposure for that workflow. See [privacy.md](privacy.md).

## Failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| MCP server exits / tools missing | `browserlearn` not installed or Node &lt; 22.13 | Install Node ≥ 22.13; `npx -y browserlearn mcp` or build from git |
| `No workflow named "…"` | Wrong name or empty store | Call `list_workflows`; have user record via the extension |
| `run_workflow` isError | Step failed in browser | Read the run report; check Chrome/Chromium; retry headed via CLI: `browserlearn run "Name" --headed` |
| Empty `list_workflows` | Local app never received a recording | Start dashboard (`npx browserlearn`), pair extension, record + stop |

## CLI equivalents

```bash
browserlearn list
browserlearn run "Create invoice" --params '{"customer":"Globex"}'
browserlearn export "Create invoice" --format playwright --out invoice.mjs
browserlearn pair
```

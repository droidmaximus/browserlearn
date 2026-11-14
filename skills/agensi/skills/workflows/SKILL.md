---
name: browserlearn-workflows
description: >-
  Use when the user asks to list, inspect, search, or run a BrowserLearn
  recorded browser workflow via MCP, Claude, Cursor, or the browserlearn CLI.
summary: List, inspect, and run local BrowserLearn workflows through MCP or CLI.
version: 0.1.0
tags:
  - browser-agent
  - mcp
  - workflows
  - automation
  - local-first
keywords:
  - list_workflows
  - run_workflow
  - BrowserLearn MCP
  - browser agent workflow
  - Claude Cursor MCP
use_cases:
  - Discover which recorded workflows exist on the machine
  - Inspect steps and parameters before a run
  - Execute a parameterized workflow in local Chrome
docs_url: https://github.com/droidmaximus/browserlearn/blob/master/packages/cli/README.md
---

# BrowserLearn workflows (MCP / CLI)

Run recorded browser workflows that already live on the user’s machine. Prerequisites and MCP JSON: [shared/mcp-config.md](../../shared/mcp-config.md). Privacy: [shared/privacy.md](../../shared/privacy.md).

If BrowserLearn is not installed or no workflows exist, switch to **browserlearn-setup**.

## Preferred path: MCP tools

1. Call `list_workflows` — get `name`, `description`, `version`, `inputSchema`.
2. If the user is unsure which recording: `search_recordings` with a short `query` (name, URL fragment, or label).
3. Call `get_workflow` with the exact `name` when they need steps / locators / params.
4. Collect required string params from the user (do not invent secrets).
5. Call `run_workflow` with `{ "name": "…", "params": { "param_name": "value" } }`.
6. Report success/failure from the JSON run report. On failure, name the failed step and suggest a headed CLI retry.

### Tool contract (summary)

- **`list_workflows`** → `{ workflows: WorkflowSummary[] }`
- **`get_workflow`** `{ name }` → public workflow JSON, or error text if missing
- **`run_workflow`** `{ name, params? }` → run report; `isError` when any step fails
- **`search_recordings`** `{ query, limit? }` → `{ recordings: […] }`

Missing name message shape: `No workflow named "…". Call list_workflows to see the available names.`

## CLI path (same store)

```bash
browserlearn list
browserlearn run "Create invoice" --params '{"customer":"Globex"}'
browserlearn run "Create invoice" --params '{"customer":"Globex"}' --headed
```

From a git checkout: prefix with `node packages/cli/dist/bin.js` instead of `browserlearn`.

## Agent reply format

After a run, return a short JSON-friendly summary:

```json
{
  "workflow": "Create invoice",
  "status": "succeeded|failed",
  "paramsUsed": ["customer"],
  "failedStep": null,
  "next": "optional fix or export suggestion"
}
```

Do not dump full locator trees unless the user asks to debug.

## Failure modes

| Symptom | Fix |
| --- | --- |
| Empty workflow list | User must record via extension (setup skill) |
| MCP not connected | Add config from shared/mcp-config.md; restart agent host |
| Param validation / missing required | Show `inputSchema` from `list_workflows`; ask only for missing keys |
| Headless flake | Retry with `--headed`; confirm Chrome/Chromium installed |
| Wrong site / login session | Workflows use a fresh automation context — user may need to record with test credentials as params, not rely on their interactive Chrome profile cookies |

## Privacy reminders

- Do not print `secret: true` param values.
- Do not enable “Show recorded example values to AI agents” unless the user asks.
- Do not upload run reports that contain secrets.

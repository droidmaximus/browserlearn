---
name: browserlearn-export
description: >-
  Use when the user wants Playwright or Stagehand code exported from a
  BrowserLearn workflow, or to save a recorded browser agent flow as a script.
summary: Export a BrowserLearn workflow to Playwright or Stagehand (.mjs).
version: 0.1.0
tags:
  - playwright
  - stagehand
  - export
  - browser-agent
  - codegen
keywords:
  - export Playwright
  - Stagehand script
  - BrowserLearn export
  - browser workflow to code
use_cases:
  - Generate a Playwright script from a recorded workflow
  - Generate a Stagehand script for agent frameworks
  - Check exported code into a project repo (without secrets)
docs_url: https://github.com/droidmaximus/browserlearn/blob/master/packages/cli/README.md
---

# BrowserLearn export (Playwright / Stagehand)

Turn a local BrowserLearn workflow into runnable JavaScript the user can keep in git. Privacy: [shared/privacy.md](../../shared/privacy.md).

If the workflow does not exist yet, use **browserlearn-setup** then **browserlearn-workflows**.

## Choose a format

| Format | Flag | When to pick it |
| --- | --- | --- |
| Playwright | `--format playwright` | Standard browser tests / CI automation |
| Stagehand | `--format stagehand` | Agent stacks that use Stagehand |

Only these two formats are supported.

## Export via CLI

```bash
browserlearn list
browserlearn export "Create invoice" --format playwright --out invoice.mjs
browserlearn export "Create invoice" --format stagehand --out invoice.stagehand.mjs
```

Without `--out`, the script prints to stdout. From a git checkout:

```bash
node packages/cli/dist/bin.js export "Create invoice" --format playwright --out invoice.mjs
```

## Before writing files

1. Confirm the workflow name with `browserlearn list` or MCP `list_workflows`.
2. Ask where to write the file (default suggestion: project root or `scripts/`).
3. Remind the user: exported scripts use **parameters / placeholders**, not live passwords from the recording (unless they exposed examples). Fill secrets via env vars or CLI args in their project — do not hard-code them in the committed file.
4. After export, offer a one-line how-to-run using their package’s Playwright/Stagehand setup — do not invent BrowserLearn-specific runners beyond what the script itself requires.

## Dashboard alternative

The local dashboard can download an export (`/api/workflows/:id/export?format=playwright|stagehand`). Prefer CLI when the agent can write files directly.

## Agent checklist output

```text
- [ ] Workflow name confirmed
- [ ] Format: playwright | stagehand
- [ ] File path written
- [ ] Secrets not committed (params / env)
- [ ] User told how to install Playwright or Stagehand deps if missing
```

## Failure modes

| Problem | Fix |
| --- | --- |
| `Usage: browserlearn export …` | Must pass `--format playwright` or `--format stagehand` |
| `No workflow named "…"` | `browserlearn list`; fix spelling |
| Empty or tiny script | Workflow may have zero steps — re-record |
| User asks for “Agensi skill” from a workflow | Not supported by this CLI yet; export Playwright/Stagehand, or keep using BrowserLearn MCP |

## Out of scope

- Shipping BrowserLearn binaries inside an Agensi ZIP
- Training / fine-tuning browser models
- Changing MCP tool names

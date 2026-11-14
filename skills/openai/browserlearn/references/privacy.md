# BrowserLearn privacy rules (agents must follow)

BrowserLearn is **local-first**. Follow these rules on every tool call and every reply.

## Hard rules

1. **Data stays on the machine.** Recordings, workflows, and typed values live under `~/.browserlearn` (or `BROWSERLEARN_HOME`). Do not upload them to third-party hosts, paste them into remote chats, or commit secrets to git.
2. **Redaction is fail-closed.** The local app redacts before disk. If a step or value looks sensitive and you are unsure, treat it as secret: do not echo it, do not invent example values from memory of the recording.
3. **MCP never includes typed examples by default.** `list_workflows` / `get_workflow` omit recorded example values unless the user enabled **“Show recorded example values to AI agents”** for that workflow. Do not ask the user to enable that unless they explicitly need examples.
4. **Optional LLM enrichment is skeleton-only.** If the user connects an OpenAI-compatible endpoint (BYOK or Ollama), the dashboard shows a preview payload with typed values replaced by placeholders. Never send a payload that still contains raw typed secrets. Prefer fully offline local models when the user wants zero network.
5. **Params you supply at run time are the user’s choice.** When calling `run_workflow` or `browserlearn run`, only use parameter values the user provided in this session (or clearly marked test fixtures). Do not reuse guessed PII from earlier recordings.
6. **Secrets in params.** If a workflow param is marked `secret: true`, never print its value in logs, summaries, or commits. Prefer placeholders like `{password}` in written scripts.

## Safe agent output

When summarizing a workflow for the user, prefer:

- workflow **name**, **description**, **param names** / required flags
- step **kinds** (click, type, navigate) and **roles/labels** as returned by MCP (already scrubbed)
- run **status** and which step failed — without dumping full page HTML or cookies

## Never do

- Copy `~/.browserlearn` contents into the Agensi skill, a gist, or a PR
- Disable redaction or “work around” missing examples by scraping the live form again without consent
- Claim BrowserLearn sends recordings to a cloud unless the user configured their own LLM endpoint and approved the preview

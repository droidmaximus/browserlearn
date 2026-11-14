# Privacy Policy — BrowserLearn

**Last updated:** 2026-11-13

BrowserLearn is a free, open-source, **local-first** tool. This policy describes how the BrowserLearn software on your machine handles data.

## What stays on your computer

- Recordings, workflows, run logs, and configuration are stored under `~/.browserlearn` (or `BROWSERLEARN_HOME` if set).
- Typed values are **redacted before they are saved**. Redaction is fail-closed.
- The local HTTP dashboard and WebSocket endpoints bind only to `127.0.0.1`.
- The Chrome extension talks only to your local BrowserLearn app after you paste a pairing code.

## What we do not collect

The BrowserLearn project maintainers do **not** operate a cloud backend for BrowserLearn. We do not receive your recordings, typed values, cookies, or browsing history through this software.

## Optional LLM enrichment

If you connect an OpenAI-compatible endpoint (your own API key or a local model such as Ollama), the dashboard shows a **preview payload** first. That payload is an anonymized workflow outline with typed values replaced by placeholders. You can edit or cancel before anything is sent. Fully offline local models are supported.

## MCP / AI agents

When you connect BrowserLearn to an MCP host (Claude Code, Cursor, ChatGPT desktop, etc.), the host process on your machine can call local tools such as `list_workflows` and `run_workflow`. Recorded example values are **not** included unless you enable “Show recorded example values to AI agents” for a workflow. Do not paste secrets into chats or commit `~/.browserlearn`.

## Third-party directories

If you install BrowserLearn skills or plugins from a third-party marketplace (for example Agensi or the OpenAI Plugin Directory), that marketplace’s own privacy policy applies to their site and account data. BrowserLearn’s local data handling remains as described above.

## Contact

- GitHub: https://github.com/droidmaximus/browserlearn
- Issues: https://github.com/droidmaximus/browserlearn/issues

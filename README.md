# BrowserLearn

Teach your AI agent a browser task by doing it once.

- **Record** a task in Chrome with the BrowserLearn extension.
- **Compile** it locally into a reusable workflow with parameters. No LLM is needed.
- **Run** it from Claude Code, Cursor, or any MCP client, or export it as a Playwright or Stagehand script.

Your recordings stay on your machine and are redacted before they are saved.

```bash
npx browserlearn
```

See [packages/cli/README.md](packages/cli/README.md) for setup and MCP configuration.

## Packages

- `packages/cli`: the `browserlearn` local app: dashboard, MCP server, and runner
- `packages/core`: redaction, compiler, exporters, and storage
- `packages/extension`: Chrome MV3 extension (load unpacked from `packages/extension/dist`)

## License

MIT

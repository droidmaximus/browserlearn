#!/usr/bin/env node
/**
 * OpenAI desktop-only MCP entry (${PLUGIN_ROOT}/server/mcp.mjs).
 * Runs the same stdio MCP as `browserlearn mcp`, using deps installed next to this file.
 */
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) return;
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

const { main } = await import("browserlearn/dist/main.js");
process.exitCode = await main(["mcp"]);

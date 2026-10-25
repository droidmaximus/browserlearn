#!/usr/bin/env node
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) return;
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

const { main } = await import("./main.js");
process.exitCode = await main(process.argv.slice(2));

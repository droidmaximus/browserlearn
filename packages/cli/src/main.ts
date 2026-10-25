import { exportCmd, listCmd, pairCmd } from "./commands/basic.js";
import { runCmd } from "./commands/run.js";
import { errorMessage } from "./errors.js";
import { type Io, processIo } from "./io.js";
import { VERSION } from "./version.js";

export type Command = (args: string[], io: Io) => Promise<number>;

export const HELP = `Usage: browserlearn [command]

Commands:
  start                 Start the local app: extension connection and dashboard (default)
  mcp                   Run the MCP server over stdio (for Claude Code, Cursor, and other agents)
  run <workflow>        Run a workflow  [--params '{"name":"value"}'] [--headed]
  export <workflow>     Print a script  --format playwright|stagehand [--out file]
  list                  List workflows
  pair [--reset]        Show (or replace) the extension pairing code
  version               Print the version
`;

const COMMANDS: Record<string, Command> = {
  pair: pairCmd,
  list: listCmd,
  export: exportCmd,
  run: runCmd,
  version: async (_args, io) => {
    io.stdout(`${VERSION}\n`);
    return 0;
  },
  help: async (_args, io) => {
    io.stdout(HELP);
    return 0;
  },
};

const ALIASES: Record<string, string> = { "--version": "version", "-v": "version", "--help": "help", "-h": "help" };

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const [first = "start", ...rest] = argv;
  const command = COMMANDS[ALIASES[first] ?? first];
  if (!command) {
    io.stderr(`Unknown command: ${first}\n\n${HELP}`);
    return 2;
  }
  try {
    return await command(rest, io);
  } catch (err) {
    io.stderr(`${errorMessage(err)}\n`);
    return 1;
  }
}

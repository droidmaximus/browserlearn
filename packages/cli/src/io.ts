export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
  /** Resolves when a long-running command (start, mcp) should shut down. */
  untilStopped(): Promise<void>;
}

export function processIo(): Io {
  return {
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
    env: process.env,
    untilStopped: () =>
      new Promise((resolve) => {
        process.once("SIGINT", () => resolve());
        process.once("SIGTERM", () => resolve());
      }),
  };
}

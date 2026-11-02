import { Store } from "@browserlearn/core/store";
import { type Config, loadConfig, type Paths, resolvePaths, saveConfig } from "./config.js";

export interface App {
  paths: Paths;
  config: Config;
  store: Store;
  now(): number;
  saveConfig(next: Config): void;
  close(): void;
}

export interface OpenAppOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export function openApp(opts: OpenAppOptions = {}): App {
  const paths = resolvePaths(opts.env);
  const config = loadConfig(paths);
  const app: App = {
    paths,
    config,
    store: new Store(paths.db),
    now: opts.now ?? Date.now,
    saveConfig(next) {
      saveConfig(paths, next);
      app.config = next;
    },
    close() {
      app.store.close();
    },
  };
  return app;
}

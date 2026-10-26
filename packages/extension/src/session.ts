import type { Captured } from "./capture.js";
import { IngestClient, type Status } from "./client.js";
import { DEFAULT_PORT as PORT, type ClientMessage, type RawStep, type Recording } from "./protocol.js";
import { emptyQueue, enqueue, type Queue } from "./queue.js";

export interface ChromeLite {
  storage: {
    local: { get: (k?: string) => Promise<Record<string, unknown>>; set: (v: Record<string, unknown>) => Promise<void> };
    session: { get: () => Promise<Record<string, unknown>>; set: (v: Record<string, unknown>) => Promise<void> };
  };
  tabs: { query: (q: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>; get: (id: number) => Promise<chrome.tabs.Tab> };
  permissions: {
    request: (p: { origins: string[] }) => Promise<boolean>;
    contains: (p: { origins: string[] }) => Promise<boolean>;
  };
  scripting: { executeScript: (opts: { target: { tabId: number; allFrames?: boolean }; files?: string[]; func?: () => unknown }) => Promise<unknown> };
  alarmApi: { create: (name: string, info: chrome.alarms.AlarmCreateInfo) => Promise<void>; clear: (name: string) => Promise<boolean> };
  action: {
    setBadgeText: (d: { text: string }) => Promise<void>;
    setBadgeBackgroundColor: (d: { color: string }) => Promise<void>;
    setTitle: (d: { title: string }) => Promise<void>;
  };
}

export interface SessionState {
  status: Status | "recording";
  detail?: string;
  recordingId?: string;
  name?: string;
  port: number;
  hasToken: boolean;
  dropped: number;
}

interface Live {
  recording: Recording;
  tabId: number;
  origin: string;
  seq: number;
}

interface SessionClient {
  notify(): void;
  connect(): void;
  disconnect(): void;
}

const ALARM = "browserlearn.keepalive";
const originOf = (url: string): string => new URL(url).origin;

export function createSession(opts: {
  chrome: ChromeLite;
  uuid?: () => string;
  now?: () => number;
  client?: SessionClient;
  makeClient?: (hooks: {
    port: () => number;
    token: () => string;
    getQueue: () => Queue;
    setQueue: (q: Queue) => void;
    onStatus: (s: Status, d?: string) => void;
  }) => SessionClient;
}) {
  const chrome = opts.chrome;
  const uuid = opts.uuid ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  let token = "";
  let port = PORT;
  let queue: Queue = emptyQueue();
  let live: Live | undefined;
  let status: Status = "disconnected";
  let detail: string | undefined;

  const persist = () => void chrome.storage.session.set({ queue, live });
  const setQueue = (q: Queue) => {
    queue = q;
    void persist();
  };

  const badge = async () => {
    if (status === "disconnected") {
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
      await chrome.action.setTitle({ title: detail || "npx browserlearn" });
    } else if (live) {
      await chrome.action.setBadgeText({ text: "REC" });
      await chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
      await chrome.action.setTitle({ title: `Recording “${live.recording.name}”` });
    } else {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "BrowserLearn" });
    }
  };

  const onStatus = (s: Status, d?: string) => {
    status = s;
    detail = d;
    void badge();
  };

  const client =
    opts.client ??
    opts.makeClient?.({
      port: () => port,
      token: () => token,
      getQueue: () => queue,
      setQueue,
      onStatus,
    }) ??
    new IngestClient({
      port: () => port,
      token: () => token,
      getQueue: () => queue,
      setQueue,
      onStatus,
    });

  const push = (msg: ClientMessage) => {
    queue = enqueue(queue, msg);
    void persist();
    client.notify();
  };

  const inject = async (tabId: number) => {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
  };

  return {
    queue: () => queue,
    state: (): SessionState => ({
      status: live ? "recording" : status,
      ...(detail ? { detail } : {}),
      ...(live ? { recordingId: live.recording.id, name: live.recording.name } : {}),
      port,
      hasToken: Boolean(token),
      dropped: queue.dropped,
    }),
    async restore() {
      const loc = await chrome.storage.local.get();
      token = typeof loc.token === "string" ? loc.token : "";
      port = typeof loc.port === "number" ? loc.port : PORT;
      const ses = await chrome.storage.session.get();
      if (ses.queue && typeof ses.queue === "object") queue = ses.queue as Queue;
      if (ses.live && typeof ses.live === "object") live = ses.live as Live;
      if (token) client.connect();
    },
    async pair(nextToken: string, nextPort = PORT) {
      token = nextToken.trim();
      port = nextPort;
      await chrome.storage.local.set({ token, port });
      client.connect();
    },
    async start(name: string) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tab =
        tabs.find((t) => t.active && t.url && !t.url.startsWith("chrome-extension://")) ??
        [...tabs].reverse().find((t) => t.url?.startsWith("http"));
      if (!tab?.id || !tab.url) throw new Error("No active tab to record.");
      if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
        throw new Error("Open a regular web page, then press Record.");
      }
      const origin = originOf(tab.url);
      const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
      const injectable = granted || (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true }).then(() => true, () => false));
      if (!injectable) throw new Error("Permission to record this site was denied.");
      const recording: Recording = {
        id: uuid(),
        name: name.trim() || tab.title || "Untitled recording",
        startUrl: tab.url,
        startedAt: now(),
        status: "recording",
      };
      live = { recording, tabId: tab.id, origin, seq: 0 };
      queue = emptyQueue();
      push({ type: "recording.start", recording });
      await inject(tab.id);
      await chrome.alarmApi.create(ALARM, { periodInMinutes: 0.4 });
      void badge();
      return { recordingId: recording.id };
    },
    handleCaptured(captured: Captured) {
      if (!live) return;
      live.seq += 1;
      const step: RawStep = {
        seq: live.seq,
        action: captured.action,
        selectors: captured.selectors,
        axSnippet: captured.axSnippet,
        url: captured.url,
        framePath: captured.framePath,
        ts: captured.ts,
        ...(captured.isPassword ? { isPassword: true } : {}),
        ...(captured.value !== undefined && !captured.isPassword ? { value: captured.value } : {}),
      };
      push({ type: "step", recordingId: live.recording.id, step });
    },
    async onCommitted(details: { tabId: number; frameId: number; url: string }) {
      if (!live || details.tabId !== live.tabId || details.frameId !== 0) return;
      live.seq += 1;
      push({
        type: "step",
        recordingId: live.recording.id,
        step: {
          seq: live.seq,
          action: "navigate",
          selectors: {},
          axSnippet: "",
          url: details.url,
          framePath: [],
          ts: now(),
        },
      });
      try {
        await inject(details.tabId);
      } catch {
        /* origin may have changed; the next Record reports it */
      }
    },
    async stop() {
      if (!live) return;
      push({ type: "recording.stop", recordingId: live.recording.id, endedAt: now() });
      live = undefined;
      await chrome.alarmApi.clear(ALARM);
      void persist();
      void badge();
    },
    onAlarm(name: string) {
      if (name === ALARM) client.notify();
    },
  };
}

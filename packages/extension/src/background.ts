import { IngestClient } from "./client.js";
import { createSession } from "./session.js";

const chromeApi = chrome as unknown as Parameters<typeof createSession>[0]["chrome"] & {
  alarms: Parameters<typeof createSession>[0]["chrome"]["alarmApi"];
};

const session = createSession({
  chrome: Object.assign(chromeApi, { alarmApi: chromeApi.alarms }),
  makeClient: (hooks) => new IngestClient(hooks),
});

void session.restore();

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  void (async () => {
    try {
      if (msg?.type === "captured") session.handleCaptured(msg.captured);
      else if (msg?.type === "getState") reply(session.state());
      else if (msg?.type === "pair") {
        await session.pair(String(msg.token ?? ""), Number(msg.port) || undefined);
        reply(session.state());
      } else if (msg?.type === "start") {
        await session.start(typeof msg.name === "string" ? msg.name : "");
        reply(session.state());
      } else if (msg?.type === "stop") {
        await session.stop();
        reply(session.state());
      }
    } catch (err) {
      reply({ error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener((a) => session.onAlarm(a.name));
chrome.webNavigation.onCommitted.addListener((d) => void session.onCommitted(d));

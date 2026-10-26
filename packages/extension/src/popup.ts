const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $("status");
const nameEl = $<HTMLInputElement>("name");
const tokenEl = $<HTMLInputElement>("token");
const portEl = $<HTMLInputElement>("port");
const recordBtn = $<HTMLButtonElement>("record");
const stopBtn = $<HTMLButtonElement>("stop");
const saveBtn = $<HTMLButtonElement>("save");

async function send(msg: unknown): Promise<Record<string, unknown>> {
  return chrome.runtime.sendMessage(msg);
}

function render(state: Record<string, unknown>) {
  if (state.error) {
    statusEl.textContent = String(state.error);
    statusEl.dataset.kind = "error";
    return;
  }
  const recording = state.status === "recording";
  statusEl.dataset.kind = state.status === "disconnected" ? "error" : "ok";
  statusEl.textContent = recording
    ? `Recording “${state.name}”`
    : state.status === "ready"
      ? "Connected to local app"
      : state.status === "connecting"
        ? "Connecting…"
        : state.hasToken
          ? "Local app not running. Start it with npx browserlearn"
          : "Paste the pairing code from the BrowserLearn dashboard (Settings).";
  recordBtn.hidden = recording;
  stopBtn.hidden = !recording;
  if (typeof state.port === "number") portEl.value = String(state.port);
}

async function refresh() {
  render(await send({ type: "getState" }));
}

saveBtn.addEventListener("click", async () => {
  render(await send({ type: "pair", token: tokenEl.value, port: Number(portEl.value) }));
  tokenEl.value = "";
});
recordBtn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab =
    tabs.find((t) => t.active && t.url && !t.url.startsWith("chrome-extension://")) ??
    [...tabs].reverse().find((t) => t.url?.startsWith("http"));
  const origin = tab?.url ? new URL(tab.url).origin : "";
  if (origin.startsWith("http")) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      statusEl.dataset.kind = "error";
      statusEl.textContent = "Permission to record this site was denied.";
      return;
    }
  }
  render(await send({ type: "start", name: nameEl.value }));
});
stopBtn.addEventListener("click", async () => render(await send({ type: "stop" })));

void refresh();

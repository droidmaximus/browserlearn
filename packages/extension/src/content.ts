import { captureFromEvent } from "./capture.js";

if (!location.protocol.startsWith("chrome")) {
  const send = (ev: Event) => {
    const captured = captureFromEvent(ev, window);
    if (captured) void chrome.runtime.sendMessage({ type: "captured", captured });
  };
  window.addEventListener("click", send, true);
  window.addEventListener("change", send, true);
  window.addEventListener("submit", send, true);
}

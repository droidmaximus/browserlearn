import { captureFromEvent, microSettle } from "./capture.js";

if (!location.protocol.startsWith("chrome")) {
  const send = (ev: Event) => {
    void (async () => {
      const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
      const target = path.find((n): n is Element => n instanceof Element);
      if (target) await microSettle(ev, target);
      const captured = captureFromEvent(ev, window);
      if (captured) void chrome.runtime.sendMessage({ type: "captured", captured });
    })();
  };
  window.addEventListener("click", send, true);
  window.addEventListener("change", send, true);
  window.addEventListener("submit", send, true);
}

import { describe, expect, it } from "vitest";
import {
  atomicSnapshotFor,
  captureFromEvent,
  framePathOf,
  isPasswordField,
  microSettle,
  selectorsFor,
  valueOf,
} from "../src/capture.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function fire(el: Element, type: string): ReturnType<typeof captureFromEvent> {
  let captured: ReturnType<typeof captureFromEvent>;
  el.addEventListener(type, (ev) => {
    captured = captureFromEvent(ev, window, () => 1);
  });
  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  return captured;
}

describe("capture", () => {
  it("prefers test id, then role and accessible name, then css", () => {
    mount(`<label for="customer">Customer</label><input id="customer" data-testid="cust" />`);
    const el = document.getElementById("customer")!;
    const s = selectorsFor(el);
    expect(s.testId).toBe("cust");
    expect(s.role).toBe("textbox");
    expect(s.name).toBe("Customer");
    expect(s.css).toBe("#customer");
    expect(s.xpath).toContain("customer");
  });

  it("never captures password values", () => {
    mount(`<label for="pw">Password</label><input id="pw" type="password" value="hunter2" />`);
    const el = document.getElementById("pw")!;
    expect(isPasswordField(el)).toBe(true);
    expect(valueOf(el)).toBeUndefined();
    const captured = fire(el, "change")!;
    expect(captured.action).toBe("type");
    expect(captured.isPassword).toBe(true);
    expect(captured).not.toHaveProperty("value");
    expect(JSON.stringify(captured)).not.toContain("hunter2");
  });

  it("captures type, select, click, and submit", () => {
    mount(`
<form id="f" action="/saved">
  <label for="customer">Customer</label><input id="customer" value="Acme Corp" />
  <label for="plan">Plan</label><select id="plan"><option value="free">Free</option><option value="pro" selected>Pro</option></select>
  <input type="checkbox" id="rush" /><label for="rush">Rush</label>
  <button id="save" type="submit">Save</button>
</form>`);
    const type = fire(document.getElementById("customer")!, "change")!;
    expect(type).toMatchObject({ action: "type", value: "Acme Corp" });
    expect(type.selectors.name).toBe("Customer");
    const select = fire(document.getElementById("plan")!, "change")!;
    expect(select).toMatchObject({ action: "select", value: "pro" });
    const click = fire(document.getElementById("rush")!, "click")!;
    expect(click.action).toBe("click");
    expect(click.selectors.role).toBe("checkbox");
    const submit = fire(document.getElementById("f")!, "submit")!;
    expect(submit.action).toBe("submit");
  });

  it("settles 200ms for combobox change and 2 rAFs for click", async () => {
    const sleeps: number[] = [];
    const rafs: FrameRequestCallback[] = [];
    mount(`<select id="plan"><option>Pro</option></select><button id="go">Go</button>`);
    const sel = document.getElementById("plan")!;
    await microSettle(new Event("change"), sel, {
      sleep: async (ms) => void sleeps.push(ms),
      raf: (cb) => {
        rafs.push(cb);
        queueMicrotask(() => cb(0));
        return 0;
      },
    });
    expect(sleeps).toEqual([200]);
    const before = rafs.length;
    await microSettle(new Event("click"), document.getElementById("go")!, {
      sleep: async () => undefined,
      raf: (cb) => {
        rafs.push(cb);
        queueMicrotask(() => cb(0));
        return 0;
      },
    });
    expect(rafs.length - before).toBeGreaterThanOrEqual(2);
  });

  it("packs visible controls into axSnippet JSON without password values", () => {
    mount(`<main>
      <label for="pw">Password</label><input id="pw" type="password" value="hunter2" />
      <label for="customer">Customer</label><input id="customer" value="Acme" />
      <button id="save">Save</button>
    </main>`);
    const save = document.getElementById("save")!;
    const raw = atomicSnapshotFor(save);
    expect(raw.length).toBeLessThanOrEqual(4000);
    const snip = JSON.parse(raw) as { v: number; target: { name?: string }; controls: { name?: string }[] };
    expect(snip.v).toBe(1);
    expect(snip.target.name).toBe("Save");
    expect(JSON.stringify(snip)).not.toContain("hunter2");
    expect(snip.controls.some((c) => c.name === "Customer")).toBe(true);
  });

  it("captureFromEvent axSnippet is versioned JSON", () => {
    mount(`<button id="go">Go</button>`);
    const c = fire(document.getElementById("go")!, "click")!;
    expect(JSON.parse(c.axSnippet).v).toBe(1);
  });

  it("computes a frame path of iframe indexes from the top", () => {
    expect(framePathOf(window)).toEqual([]);
  });

  it("ignores keystrokes and non-element targets", () => {
    expect(captureFromEvent(new KeyboardEvent("keydown"), window)).toBeUndefined();
  });
});

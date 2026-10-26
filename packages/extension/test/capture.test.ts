import { describe, expect, it } from "vitest";
import { axSnippetFor, captureFromEvent, framePathOf, isPasswordField, selectorsFor, valueOf } from "../src/capture.js";

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

  it("builds a trimmed AX snippet around the target", () => {
    mount(`<main><form><button id="save">Save</button><button>Cancel</button></form></main>`);
    const snippet = axSnippetFor(document.getElementById("save")!);
    expect(snippet).toContain("Save");
    expect(snippet.length).toBeLessThanOrEqual(2000);
  });

  it("computes a frame path of iframe indexes from the top", () => {
    expect(framePathOf(window)).toEqual([]);
  });

  it("ignores keystrokes and non-element targets", () => {
    expect(captureFromEvent(new KeyboardEvent("keydown"), window)).toBeUndefined();
  });
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureServer {
  url: string;
  submissions: Record<string, string>[];
  notes: string[];
  layout: "normal" | "moved";
  close(): Promise<void>;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const NOTE_SCRIPT = `(function(){ var r = new XMLHttpRequest(); r.open('GET', '/note?text=' + encodeURIComponent(input.value), false); r.send(); })()`;

export async function startFixtureServer(): Promise<FixtureServer> {
  const fixture = { submissions: [], notes: [], layout: "normal" } as unknown as FixtureServer;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://fixture.local");
    const html = (title: string, body: string): void => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(title, body));
    };
    if (u.pathname === "/form") {
      const save =
        fixture.layout === "moved" ? `<button id="store" type="submit">Store</button>` : `<button id="save" type="submit">Save</button>`;
      return html(
        "Form",
        `<form action="/saved" method="get">
<label for="customer">Customer</label> <input id="customer" name="customer">
<label for="plan">Plan</label> <select id="plan" name="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
<input type="checkbox" id="rush" name="rush"> <label for="rush">Rush</label>
${save}
</form>`,
      );
    }
    if (u.pathname === "/saved") {
      fixture.submissions.push(Object.fromEntries(u.searchParams));
      const customer = u.searchParams.get("customer") ?? "";
      return html("Saved", `<p>Saved</p><a href="/customers/${encodeURIComponent(customer)}">${esc(customer)} details</a>`);
    }
    if (u.pathname.startsWith("/customers/")) {
      return html("Customer", `<h1>${esc(decodeURIComponent(u.pathname.slice("/customers/".length)))}</h1><button onclick="document.title = 'done'">Done</button>`);
    }
    if (u.pathname === "/note") {
      fixture.notes.push(u.searchParams.get("text") ?? "");
      res.writeHead(204).end();
      return;
    }
    if (u.pathname === "/frame") return html("Outer", `<h1>Outer</h1><iframe src="/widget"></iframe>`);
    if (u.pathname === "/widget") {
      return html(
        "Widget",
        `<label for="n">Note</label><input id="n"><button onclick="const input = document.getElementById('n'); ${NOTE_SCRIPT}">Add</button>`,
      );
    }
    if (u.pathname === "/shadow") {
      return html(
        "Shadow",
        `<note-box></note-box><script>
customElements.define("note-box", class extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = '<label for="n">Note</label><input id="n"><button>Add</button>';
    const input = root.querySelector("input");
    root.querySelector("button").onclick = () => ${NOTE_SCRIPT};
  }
});
</script>`,
      );
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  fixture.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fixture.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fixture;
}

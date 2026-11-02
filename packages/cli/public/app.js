const TOKEN_KEY = "browserlearn.dashboardToken";
if (location.hash.startsWith("#token=")) {
  sessionStorage.setItem(TOKEN_KEY, decodeURIComponent(location.hash.slice("#token=".length)));
  history.replaceState(null, "", "/#/recordings");
}
const token = sessionStorage.getItem(TOKEN_KEY);
const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const flashEl = document.getElementById("flash");

/** Builds DOM nodes; text is always set as text, never parsed as HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = Boolean(v);
    else if (typeof v === "boolean") el.toggleAttribute(k, v);
    else if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

const fmtTime = (ms) => new Date(ms).toLocaleString();
const notice = (text, kind = "info") => h("p", { class: `notice ${kind}` }, text);
const flash = (text, kind = "info") => flashEl.replaceChildren(notice(text, kind));
const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    flash(err.message, "error");
  }
};
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function table(headers, rows) {
  return h("table", {}, h("thead", {}, h("tr", {}, headers.map((t) => h("th", {}, t)))), h("tbody", {}, rows));
}

async function renderRecordings() {
  const recs = await api("GET", "/recordings");
  view.replaceChildren(
    h("h2", {}, "Recordings"),
    recs.length === 0
      ? notice("No recordings yet. Pair the extension in Settings, then press Record in the extension.")
      : table(
          ["Name", "Start page", "Steps", "Recorded", ""],
          recs.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, r.name),
              h("td", { class: "url" }, r.startUrl),
              h("td", {}, String(r.stepCount)),
              h("td", {}, fmtTime(r.startedAt)),
              h(
                "td",
                {},
                h("button", {
                  onclick: guard(async () => {
                    const w = await api("POST", `/recordings/${encodeURIComponent(r.id)}/compile`);
                    location.hash = `#/workflows/${encodeURIComponent(w.id)}`;
                  }),
                }, "Compile"),
                h("button", {
                  class: "danger",
                  onclick: guard(async () => {
                    if (!confirm(`Delete recording "${r.name}"?`)) return;
                    await api("DELETE", `/recordings/${encodeURIComponent(r.id)}`);
                    await renderRecordings();
                  }),
                }, "Delete"),
              ),
            ),
          ),
        ),
  );
}

async function renderWorkflows() {
  const list = await api("GET", "/workflows");
  view.replaceChildren(
    h("h2", {}, "Workflows"),
    list.length === 0
      ? notice("No workflows yet. Stop a recording in the extension, or compile one from Recordings.")
      : table(
          ["Name", "Version", "Parameters", "Updated"],
          list.map((w) =>
            h(
              "tr",
              {},
              h("td", {}, h("a", { href: `#/workflows/${encodeURIComponent(w.id)}` }, w.name)),
              h("td", {}, `v${w.version}`),
              h("td", {}, w.params.map((p) => p.name).join(", ") || "none"),
              h("td", {}, fmtTime(w.updatedAt)),
            ),
          ),
        ),
  );
}

function describeTarget(s) {
  if (s.action === "navigate") return s.url ?? "";
  const l = s.locator;
  if (!l) return "no target";
  if (l.kind === "role") return `${l.role} "${l.name}"`;
  if (l.kind === "testId") return `test id ${l.testId}`;
  return l.kind === "css" ? l.css : l.xpath;
}

async function renderWorkflow(id) {
  const { workflow: w, lockedRequired, unrunnable, runs } = await api("GET", `/workflows/${encodeURIComponent(id)}`);
  const path = `/workflows/${encodeURIComponent(w.id)}`;
  const nameInput = h("input", { value: w.name, "aria-label": "Workflow name" });
  const descInput = h("textarea", { "aria-label": "Description", rows: 2 }, w.description);
  const expose = h("input", { type: "checkbox", checked: Boolean(w.exposeExamples), id: "expose" });
  const paramRows = w.params.map((p) => ({
    p,
    name: h("input", { value: p.name, "aria-label": `Name of ${p.name}` }),
    description: h("input", { value: p.description, "aria-label": `Description of ${p.name}` }),
    required: h("input", { type: "checkbox", checked: p.required, disabled: p.secret || lockedRequired.includes(p.name), "aria-label": `${p.name} required` }),
  }));
  const stepRows = w.steps.map((s, i) => ({ s, name: h("input", { value: s.name, "aria-label": `Step ${i + 1} name` }) }));

  const save = guard(async () => {
    await api("PUT", path, {
      name: nameInput.value,
      description: descInput.value,
      exposeExamples: expose.checked,
      params: paramRows.map(({ p, name, description, required }) => ({ name: p.name, newName: name.value, description: description.value, required: required.checked })),
      steps: stepRows.map(({ s, name }) => ({ id: s.id, name: name.value })),
    });
    await renderWorkflow(w.id);
    flash("Saved.");
  });

  const llmBox = h("div", { class: "llm" });
  const preview = guard(async () => {
    const payload = await api("GET", `${path}/enrich/preview`);
    const userArea = h("textarea", { class: "payload", rows: 14, "aria-label": "LLM payload" }, payload.user);
    llmBox.replaceChildren(
      h("p", {}, "This is exactly what will be sent to your LLM. Typed values are replaced by placeholders. Edit it, or cancel to send nothing."),
      h("details", {}, h("summary", {}, "Instructions sent with it"), h("pre", {}, payload.system)),
      userArea,
      h("div", { class: "row" },
        h("button", {
          onclick: guard(async () => {
            const r = await api("POST", `${path}/enrich`, { user: userArea.value });
            await renderWorkflow(w.id);
            if (r.enriched) flash("Workflow named by your LLM.");
            else flash(`Naming failed; the workflow was kept as is. ${r.error ?? ""}`, "error");
          }),
        }, "Send"),
        h("button", { onclick: () => llmBox.replaceChildren() }, "Cancel"),
      ),
    );
  });

  const runInputs = w.params.map((p) => ({ p, input: h("input", { type: p.secret ? "password" : "text", "aria-label": `Value for ${p.name}`, placeholder: p.required ? "required" : "optional" }) }));
  const headed = h("input", { type: "checkbox", id: "headed" });
  const runOut = h("pre", { class: "run" });
  const runNow = guard(async () => {
    const params = Object.fromEntries(runInputs.filter(({ input }) => input.value !== "").map(({ p, input }) => [p.name, input.value]));
    runOut.textContent = "Running…";
    const report = await api("POST", `${path}/run`, { params, headed: headed.checked });
    runOut.textContent = JSON.stringify(report, null, 2);
  });

  const exportAs = (format) => guard(async () => download(`${slug(w.name)}.${format}.mjs`, await api("GET", `${path}/export?format=${format}`)));

  view.replaceChildren(
    h("h2", {}, w.name, h("small", {}, ` v${w.version}`)),
    unrunnable.length ? notice(`${unrunnable.length} step(s) have no element to target and can't be replayed. Re-record them.`, "warn") : null,
    h("section", {},
      h("label", {}, "Name", nameInput),
      h("label", {}, "Description", descInput),
      h("label", { class: "inline" }, expose, " Show recorded example values to AI agents (MCP)"),
    ),
    h("section", {},
      h("h3", {}, "Parameters"),
      w.params.length === 0
        ? h("p", {}, "This workflow takes no parameters.")
        : table(
            ["Name", "Description", "Required", "Recorded example"],
            paramRows.map(({ p, name, description, required }) =>
              h("tr", {}, h("td", {}, name), h("td", {}, description), h("td", {}, required), h("td", {}, p.secret ? "secret" : p.example ?? "hidden")),
            ),
          ),
    ),
    h("section", {},
      h("h3", {}, "Steps"),
      table(["#", "Name", "Action", "Target"], stepRows.map(({ s, name }, i) => h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, name), h("td", {}, s.action), h("td", { class: "url" }, describeTarget(s))))),
    ),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "Save changes")),
    h("section", {}, h("h3", {}, "Name it with an LLM"), h("button", { onclick: preview }, "Preview LLM payload"), llmBox),
    h("section", {},
      h("h3", {}, "Export"),
      h("div", { class: "row" }, h("button", { onclick: exportAs("playwright") }, "Playwright script"), h("button", { onclick: exportAs("stagehand") }, "Stagehand script")),
    ),
    h("section", {},
      h("h3", {}, "Run"),
      runInputs.map(({ p, input }) => h("label", {}, p.name, input)),
      h("label", { class: "inline" }, headed, " Show the browser window"),
      h("div", { class: "row" }, h("button", { onclick: runNow }, "Run now")),
      runOut,
      runs.length
        ? table(["Started", "Status", "Failed step"], runs.map((r) => h("tr", {}, h("td", {}, fmtTime(r.startedAt)), h("td", {}, r.status), h("td", {}, r.failedStep === undefined ? "" : String(r.failedStep + 1)))))
        : null,
    ),
    h("section", {},
      h("button", {
        class: "danger",
        onclick: guard(async () => {
          if (!confirm(`Delete workflow "${w.name}"?`)) return;
          await api("DELETE", path);
          location.hash = "#/workflows";
        }),
      }, "Delete workflow"),
    ),
  );
}

async function renderSettings() {
  const s = await api("GET", "/settings");

  const baseUrl = h("input", { value: s.llm?.baseUrl ?? "", placeholder: "https://api.openai.com/v1", "aria-label": "LLM base URL" });
  const model = h("input", { value: s.llm?.model ?? "", placeholder: "gpt-4o-mini", "aria-label": "Model" });
  const apiKey = h("input", { type: "password", autocomplete: "off", placeholder: s.llm?.hasApiKey ? "Saved (leave blank to keep it)" : "Not needed for local models", "aria-label": "API key" });
  const preset = (u, m) => () => {
    baseUrl.value = u;
    model.value = m;
  };
  const saveLlm = guard(async () => {
    await api("PUT", "/settings", { llm: { baseUrl: baseUrl.value.trim(), model: model.value.trim(), ...(apiKey.value ? { apiKey: apiKey.value } : {}) } });
    await renderSettings();
    flash("LLM settings saved.");
  });
  const removeLlm = guard(async () => {
    await api("PUT", "/settings", { llm: null });
    await renderSettings();
    flash("LLM settings removed.");
  });

  const rules = s.fieldRules.map((r) => ({ ...r }));
  const rulesBox = h("div");
  const drawRules = () =>
    rulesBox.replaceChildren(
      ...rules.map((r, i) =>
        h("div", { class: "row" },
          h("input", { value: r.domain, placeholder: "example.com", "aria-label": "Domain", oninput: (e) => (r.domain = e.target.value) }),
          h("input", { value: r.field, placeholder: "field label, test id or CSS", "aria-label": "Field", oninput: (e) => (r.field = e.target.value) }),
          h("button", { onclick: () => { rules.splice(i, 1); drawRules(); } }, "Remove"),
        ),
      ),
      h("button", { onclick: () => { rules.push({ domain: "", field: "" }); drawRules(); } }, "Add rule"),
    );
  drawRules();
  const saveRules = guard(async () => {
    await api("PUT", "/settings", { fieldRules: rules.filter((r) => r.domain.trim() && r.field.trim()) });
    flash("Redaction rules saved.");
  });

  view.replaceChildren(
    h("h2", {}, "Settings"),
    h("section", {},
      h("h3", {}, "Pair the extension"),
      h("p", {}, "Paste this code into the BrowserLearn extension popup. Keep it private."),
      h("code", { class: "secret" }, s.pairToken),
      h("div", { class: "row" },
        h("button", { onclick: guard(async () => { await navigator.clipboard.writeText(s.pairToken); flash("Copied."); }) }, "Copy"),
        h("button", {
          onclick: guard(async () => {
            if (!confirm("Unpair the extension and create a new code?")) return;
            await api("POST", "/pair/reset");
            await renderSettings();
          }),
        }, "New code"),
      ),
    ),
    h("section", {},
      h("h3", {}, "LLM for naming workflows"),
      h("p", {}, "Optional. Only the anonymized outline shown in the preview is ever sent. Use a local model to keep everything on this machine."),
      h("div", { class: "row" },
        h("button", { onclick: preset("https://api.openai.com/v1", "gpt-4o-mini") }, "OpenAI"),
        h("button", { onclick: preset("http://127.0.0.1:11434/v1", "llama3.1") }, "Ollama (local)"),
      ),
      h("label", {}, "Base URL", baseUrl),
      h("label", {}, "Model", model),
      h("label", {}, "API key", apiKey),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: saveLlm }, "Save LLM settings"), s.llm ? h("button", { onclick: removeLlm }, "Remove") : null),
    ),
    h("section", {},
      h("h3", {}, "Redaction rules"),
      h("p", {}, "Values typed into matching fields are masked before anything is saved. Emails, phone numbers, cards, keys and passwords are always masked."),
      rulesBox,
      h("div", { class: "row" }, h("button", { class: "primary", onclick: saveRules }, "Save rules")),
    ),
  );
}

let poll;
async function route() {
  clearInterval(poll);
  flashEl.replaceChildren();
  if (!token) {
    view.replaceChildren(notice("Open the dashboard from the link printed by npx browserlearn.", "error"));
    return;
  }
  const [, section = "recordings", id] = location.hash.split("/");
  try {
    if (section === "workflows" && id) await renderWorkflow(decodeURIComponent(id));
    else if (section === "workflows") await renderWorkflows();
    else if (section === "settings") await renderSettings();
    else {
      await renderRecordings();
      poll = setInterval(() => renderRecordings().catch(() => undefined), 3000);
    }
  } catch (err) {
    view.replaceChildren(notice(err.message, "error"));
  }
}

async function refreshStatus() {
  if (!token) return;
  try {
    const s = await api("GET", "/status");
    statusEl.textContent = s.extensionConnected ? "Extension connected" : "Extension not connected";
    statusEl.className = s.extensionConnected ? "ok" : "warn";
  } catch {
    statusEl.textContent = "Local app not reachable";
    statusEl.className = "warn";
  }
}

window.addEventListener("hashchange", route);
setInterval(refreshStatus, 3000);
refreshStatus();
route();

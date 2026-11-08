// apps — everything the OS can open. Native apps (files, editor, terminal, git,
// email, calendar, connections) are drawn here; web apps are <webview>s the
// agent can drive through RPA. Each app mounts once into its own element; the
// layout moves that element between the left, center and right areas.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const os = window.os;
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; else if (v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const APPS = {
  files:       { title: "Files", icon: "🗂", group: "dev", mount: mountFiles },
  editor:      { title: "Editor", icon: "⌨", group: "dev", mount: mountEditor },
  terminal:    { title: "Terminal", icon: "▶", group: "dev", mount: mountTerminal },
  git:         { title: "Git", icon: "⎇", group: "dev", mount: mountGit },
  browser:     { title: "Browser", icon: "◎", group: "dev", web: "https://www.google.com" },
  email:       { title: "Email", icon: "✉", group: "work", mount: (el, c) => mountConnector(el, c, "email") },
  calendar:    { title: "Calendar", icon: "📅", group: "work", mount: (el, c) => mountConnector(el, c, "calendar") },
  connections: { title: "Connections", icon: "⛓", group: "work", mount: mountConnections },
  slack:       { title: "Slack", icon: "#", group: "social", web: "https://app.slack.com/client", brief: "my unread Slack messages and mentions" },
  x:           { title: "X", icon: "𝕏", group: "social", web: "https://x.com/i/account_analytics", brief: "my X account analytics: impressions, engagement, followers and top posts" },
  instagram:   { title: "Instagram", icon: "◉", group: "social", web: "https://www.instagram.com/accounts/insights/", brief: "my Instagram insights: reach, engagement, followers and top posts" },
  youtube:     { title: "YouTube", icon: "▷", group: "social", web: "https://studio.youtube.com/channel/UC/analytics", brief: "my YouTube channel analytics: views, watch time, subscribers and top videos" },
};

/** The user's own apps (Apps → Add app): a name, a url, an icon. */
export function registerCustom(list = []) {
  for (const k of Object.keys(APPS)) if (APPS[k].custom) delete APPS[k];
  for (const a of list) APPS[a.id] = { title: a.name, icon: a.icon || "◌", web: a.url, custom: true, area: a.area, brief: a.brief || undefined };
}
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";

/** A url opened as its own app gets an id from its host. */
export function webAppFor(url) {
  const u = new URL(/^https?:/.test(url) ? url : "https://" + url);
  const id = "web-" + u.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  if (!APPS[id]) APPS[id] = { title: u.hostname.replace(/^www\./, ""), icon: "◌", web: u.href, adhoc: true };
  return id;
}

export function mountApp(id, el, ctx) {
  const def = APPS[id];
  if (!def) throw new Error(`no app "${id}"`);
  return def.web ? mountWeb(el, ctx, id, def) : def.mount(el, ctx, id);
}

// ── web apps ──────────────────────────────────────────────────────────
function mountWeb(el, ctx, id, def) {
  const url = h("input", { value: ctx.url || def.web, spellcheck: "false" });
  const wv = h("webview", { src: ctx.url || def.web, partition: "persist:glyphh-os", allowpopups: "", webpreferences: "contextIsolation=yes" });
  const go = () => { let v = url.value.trim(); if (!v) return; if (!/^https?:\/\//.test(v)) v = /\s/.test(v) || !v.includes(".") ? "https://www.google.com/search?q=" + encodeURIComponent(v) : "https://" + v; wv.loadURL(v); };
  url.addEventListener("keydown", (e) => e.key === "Enter" && go());
  const bar = h("div", { class: "toolbar" },
    h("button", { class: "tb", title: "Back", onclick: () => wv.canGoBack() && wv.goBack() }, "‹"),
    h("button", { class: "tb", title: "Forward", onclick: () => wv.canGoForward() && wv.goForward() }, "›"),
    h("button", { class: "tb", title: "Reload", onclick: () => wv.reload() }, "↻"),
    url,
    def.brief ? h("button", { class: "tb primary", title: "Have Glyphh read this and brief you", onclick: () => ctx.ask(`Open ${def.title} if needed, read ${def.brief} with os_web_read on the "${id}" app, and brief me in three short spoken sentences.`) }, "Brief me") : null,
    h("button", { class: "tb", title: "Open in your browser", onclick: () => os.openExternal(wv.getURL()) }, "↗"));
  el.append(bar, wv);
  let wcId = null;
  wv.addEventListener("dom-ready", () => { wcId = wv.getWebContentsId(); os.rpa.register(id, wcId); });
  wv.addEventListener("did-navigate", (e) => { url.value = e.url; ctx.changed(); });
  wv.addEventListener("did-navigate-in-page", (e) => { if (e.isMainFrame) url.value = e.url; });
  wv.addEventListener("page-title-updated", (e) => ctx.setTitle?.(e.title));
  return {
    url: () => { try { return wv.getURL(); } catch { return url.value; } },
    goto: (u) => { url.value = u; go(); },
    unmount: () => os.rpa.unregister(id),
  };
}

// ── files ─────────────────────────────────────────────────────────────
function mountFiles(el, ctx) {
  let root = ctx.cwd;
  const rootInput = h("input", { value: root, spellcheck: "false" });
  const tree = h("div", { class: "scroll tree" });
  const open = new Set();
  async function render() {
    tree.innerHTML = "";
    await branch(root, tree, 0);
  }
  async function branch(dir, into, depth) {
    let items = [];
    try { items = await os.fs.list(dir); } catch (e) { into.append(h("div", { class: "empty-note" }, e.message)); return; }
    for (const it of items) {
      const row = h("div", { class: "node" + (it.dir ? " dir" : ""), style: `padding-left:${8 + depth * 14}px`, title: it.path },
        (it.dir ? (open.has(it.path) ? "▾ " : "▸ ") : "  ") + it.name);
      into.append(row);
      const kids = h("div");
      into.append(kids);
      row.addEventListener("click", async () => {
        if (!it.dir) return ctx.openFile(it.path);
        if (open.has(it.path)) { open.delete(it.path); kids.innerHTML = ""; row.textContent = "▸ " + it.name; }
        else { open.add(it.path); row.textContent = "▾ " + it.name; await branch(it.path, kids, depth + 1); }
      });
      if (it.dir && open.has(it.path)) await branch(it.path, kids, depth + 1);
    }
  }
  rootInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { root = rootInput.value.trim(); render(); } });
  el.append(h("div", { class: "toolbar" }, rootInput, h("button", { class: "tb", onclick: render, title: "Refresh" }, "↻")), tree);
  render();
  return { setRoot: (r) => { root = rootInput.value = r; render(); } };
}

// ── editor (Monaco) ───────────────────────────────────────────────────
let monacoReady = null;
function loadMonaco() {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise((resolve) => {
    window.require.config({ paths: { vs: "monaco/vs" } });
    window.require(["vs/editor/editor.main"], () => {
      const m = window.monaco;
      m.editor.defineTheme("glyphh", {
        base: "vs-dark", inherit: true,
        rules: [{ token: "keyword", foreground: "c98ffb" }, { token: "string", foreground: "a5e3b8" }, { token: "comment", foreground: "7d6f96", fontStyle: "italic" }, { token: "number", foreground: "f5c38b" }],
        colors: { "editor.background": "#00000000", "editor.lineHighlightBackground": "#ad5df812", "editorLineNumber.foreground": "#5e5078", "editorCursor.foreground": "#ad5df8", "editor.selectionBackground": "#ad5df840", "editorGutter.background": "#00000000", "minimap.background": "#00000010" },
      });
      resolve(m);
    });
  });
  return monacoReady;
}
const LANG = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", json: "json", md: "markdown", css: "css", html: "html", sh: "shell", zsh: "shell", yml: "yaml", yaml: "yaml", go: "go", rs: "rust", rb: "ruby", java: "java", swift: "swift", sql: "sql", toml: "ini", c: "c", h: "c", cpp: "cpp" };

function mountEditor(el, ctx) {
  const tabs = h("div", { class: "etabs" });
  const host = h("div", { class: "editor-host" });
  const note = h("div", { class: "empty-note" }, "Open a file from Files, or ask Glyphh to open one.");
  el.append(tabs, host, note);
  const files = new Map(); // path → { model, tab, saved }
  let editor = null, active = null;

  async function ensure() {
    if (editor) return editor;
    const m = await loadMonaco();
    editor = m.editor.create(host, { theme: "glyphh", automaticLayout: true, fontFamily: "JetBrains Mono", fontSize: 13, minimap: { enabled: true }, smoothScrolling: true, padding: { top: 8 } });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, save);
    return editor;
  }
  async function save() {
    const f = files.get(active); if (!f) return;
    await os.fs.write(active, f.model.getValue());
    f.saved = f.model.getAlternativeVersionId(); f.tab.classList.remove("dirty");
    ctx.toast("Saved " + active.split("/").pop());
  }
  function show(p) {
    active = p; const f = files.get(p);
    editor.setModel(f.model);
    for (const [k, v] of files) v.tab.classList.toggle("active", k === p);
    note.hidden = true; ctx.changed();
  }
  async function openFile(p, line) {
    const m = await loadMonaco(); await ensure();
    if (!files.has(p)) {
      const text = await os.fs.read(p);
      const model = m.editor.createModel(text, LANG[p.split(".").pop()?.toLowerCase()] || "plaintext");
      const tab = h("div", { class: "etab", title: p }, p.split("/").pop());
      const close = h("span", { class: "x", onclick: (e) => { e.stopPropagation(); model.dispose(); tab.remove(); files.delete(p); const next = [...files.keys()].pop(); if (next) show(next); else { editor.setModel(null); note.hidden = false; active = null; } } }, " ✕");
      tab.append(close);
      tab.addEventListener("click", () => show(p));
      tabs.append(tab);
      const f = { model, tab, saved: model.getAlternativeVersionId() };
      model.onDidChangeContent(() => tab.classList.toggle("dirty", model.getAlternativeVersionId() !== f.saved));
      files.set(p, f);
    }
    show(p);
    if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
    editor.focus();
    return `opened ${p}`;
  }
  return { openFile, layout: () => editor?.layout(), files: () => [...files.keys()], active: () => active };
}

// ── terminal ──────────────────────────────────────────────────────────
let termSeq = 0;
function mountTerminal(el, ctx) {
  const id = "t" + ++termSeq;
  const host = h("div", { class: "term-host" });
  el.append(host);
  const term = new Terminal({
    fontFamily: "JetBrains Mono", fontSize: 12.5, cursorBlink: true, allowTransparency: true, scrollback: 10000,
    theme: { background: "#00000000", foreground: "#e9e2f5", cursor: "#ad5df8", selectionBackground: "#ad5df855", black: "#1b1029", magenta: "#c98ffb", brightMagenta: "#d6b4ff", blue: "#8fa8ff", cyan: "#7fd4ff", green: "#7ee2a8", yellow: "#f5c38b", red: "#ff7a90" },
  });
  const fit = new FitAddon(); term.loadAddon(fit);
  term.open(host);
  const refit = () => { try { fit.fit(); os.term.resize(id, term.cols, term.rows); } catch { /* hidden */ } };
  new ResizeObserver(refit).observe(host);
  os.term.open(id, ctx.cwd).then(refit);
  term.onData((d) => os.term.write(id, d));
  const offData = os.term.onData((tid, d) => tid === id && term.write(d));
  const offExit = os.term.onExit((tid) => tid === id && term.write("\r\n\x1b[35m[process exited — reopen the terminal]\x1b[0m\r\n"));
  return { termId: id, focus: () => term.focus(), layout: refit, unmount: () => { offData(); offExit(); os.term.kill(id); term.dispose(); } };
}

// ── git ───────────────────────────────────────────────────────────────
function mountGit(el, ctx) {
  let cwd = ctx.cwd;
  const where = h("input", { value: cwd, spellcheck: "false" });
  const body = h("div", { class: "scroll" });
  const diff = h("div", { class: "scroll diff", style: "flex:0 0 40%;border-top:1px solid var(--line)" });
  const msg = h("input", { placeholder: "Commit message", spellcheck: "true" });
  async function render() {
    body.innerHTML = "";
    let s;
    try { s = await os.git.status(cwd); } catch { body.append(h("div", { class: "empty-note" }, `${cwd} isn't a git repository — type a repo folder above.`)); return; }
    body.append(h("div", { class: "section-h" }, `⎇ ${s.branch}`));
    const staged = s.files.filter((f) => f.x !== " " && f.x !== "?");
    const changed = s.files.filter((f) => f.y !== " " || f.x === "?");
    const row = (f, isStaged) => h("div", { class: "git-file" + (isStaged ? " staged" : ""), onclick: () => showDiff(s.root, f.path, isStaged) },
      h("span", { class: "st" }, isStaged ? f.x : f.y === " " ? f.x : f.y), h("span", {}, f.path),
      h("button", { class: "tb act", onclick: async (e) => { e.stopPropagation(); await (isStaged ? os.git.unstage(s.root, f.path) : os.git.stage(s.root, f.path)); render(); } }, isStaged ? "−" : "+"));
    body.append(h("div", { class: "section-h" }, `Staged (${staged.length})`), ...staged.map((f) => row(f, true)));
    body.append(h("div", { class: "section-h" }, `Changes (${changed.length})`), ...changed.map((f) => row(f, false)));
    body.append(h("div", { class: "git-commit" }, msg, h("button", { class: "tb primary", onclick: commit }, "Commit")));
    body.append(h("div", { class: "section-h" }, "History"), ...s.log.map((l) => h("div", { class: "git-file" }, h("span", { style: "color:var(--accent-2)" }, l.slice(0, 7)), h("span", {}, l.slice(8)))));
  }
  async function showDiff(root, f, staged) {
    const d = await os.git.diff(root, f, staged).catch((e) => e.message);
    diff.innerHTML = (d || "(no diff — untracked or binary)").split("\n").map((l) => `<span class="${l.startsWith("+") ? "a" : l.startsWith("-") ? "d" : l.startsWith("@@") ? "h" : ""}">${esc(l)}</span>`).join("\n");
  }
  async function commit() {
    if (!msg.value.trim()) return ctx.toast("Write a commit message first", true);
    try { await os.git.commit(cwd, msg.value.trim()); msg.value = ""; ctx.toast("Committed"); render(); } catch (e) { ctx.toast(e.message, true); }
  }
  where.addEventListener("keydown", (e) => { if (e.key === "Enter") { cwd = where.value.trim(); render(); } });
  el.append(h("div", { class: "toolbar" }, where, h("button", { class: "tb", onclick: render, title: "Refresh" }, "↻"),
    h("button", { class: "tb", onclick: () => ctx.ask("Look at the uncommitted changes in " + cwd + " and write me a commit message.") }, "✦ message")), body, diff);
  render();
  const timer = setInterval(() => el.closest(".panel.active, .slide") && document.hasFocus() && render(), 15000);
  return { refresh: render, unmount: () => clearInterval(timer) };
}

// ── email + calendar from the user's Claude connectors ────────────────
function mountConnector(el, ctx, kind) {
  const body = h("div", { class: "scroll list" });
  const status = h("span", { style: "color:var(--text-3);font-size:11px;flex:1" });
  const web = kind === "email" ? "https://mail.google.com" : "https://calendar.google.com";
  async function load() {
    status.textContent = "Asking your Claude connectors…";
    body.innerHTML = "";
    const res = await os.connectors.ask(kind).catch((e) => ({ error: e.message }));
    if (!Array.isArray(res)) { status.textContent = ""; body.append(h("div", { class: "empty-note" }, "Couldn't read your " + kind + ": " + res.error)); return; }
    status.textContent = `${res.length} ${kind === "email" ? "threads" : "events"} · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    if (!res.length) {
      body.append(h("div", { class: "empty-note", html: `No ${kind} connector is connected to Claude.<br>Connect Gmail / Google Calendar (or Outlook) at <b>claude.ai → Settings → Connectors</b>, then refresh.` }));
      return;
    }
    if (kind === "email") {
      for (const m of res) body.append(h("div", { class: "item" + (m.unread ? " unread" : ""), onclick: () => ctx.ask(`Read the email thread "${m.subject}" from ${m.from} (id ${m.id}) and tell me what it says and what I should do.`) },
        h("div", { class: "t" }, m.from || "?", h("span", { style: "float:right;color:var(--text-3);font-weight:400;font-size:11px" }, fmtDate(m.date))),
        h("div", { class: "s", style: "color:var(--text-2)" }, m.subject || "(no subject)"), h("div", { class: "s" }, m.snippet || "")));
    } else {
      let day = "";
      for (const ev of res.sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
        const d = new Date(ev.start); const label = isNaN(d) ? "" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
        if (label !== day) { day = label; body.append(h("div", { class: "day" }, label)); }
        body.append(h("div", { class: "item", onclick: () => ctx.ask(`Tell me about my event "${ev.title}" at ${ev.start} and anything I should prepare.`) },
          h("div", { class: "t" }, ev.title || "(untitled)"),
          h("div", { class: "s" }, `${fmtTime(ev.start)} – ${fmtTime(ev.end)}${ev.location ? " · " + ev.location : ""}${ev.attendees ? " · " + ev.attendees + " people" : ""}`)));
      }
    }
  }
  el.append(h("div", { class: "toolbar" }, status,
    h("button", { class: "tb", onclick: () => ctx.ask(kind === "email" ? "Go through my inbox and brief me on what needs me today." : "Walk me through my day and the rest of the week.") }, "✦ brief"),
    h("button", { class: "tb", onclick: () => ctx.open(webAppFor(web), "center", web), title: "Open the web app" }, "web"),
    h("button", { class: "tb", onclick: load, title: "Refresh" }, "↻")), body);
  load();
  return { refresh: load };
}
const fmtDate = (s) => { const d = new Date(s); if (isNaN(d)) return ""; return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
const fmtTime = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };

// ── connections: what the user's Claude can reach ────────────────────
function mountConnections(el, ctx) {
  const body = h("div", { class: "scroll" });
  async function load() {
    body.innerHTML = "";
    const list = await os.agent.connections().catch(() => []);
    if (!list.length) { body.append(h("div", { class: "empty-note" }, "Waiting for Claude to start…")); setTimeout(load, 2500); return; }
    for (const c of list) {
      const st = c.status || "unknown";
      body.append(h("div", { class: "conn" }, h("span", { class: "dot " + (st === "connected" ? "ok" : st === "pending" ? "busy" : "bad") }),
        h("span", { class: "n" }, c.name), h("span", { class: "st" }, st)));
    }
    body.append(h("div", { class: "empty-note", html: "These come from your Claude login: claude.ai connectors and your <code>claude mcp</code> servers.<br>Add email, calendar, Slack and more at claude.ai → Settings → Connectors; fix one that needs auth with <code>claude</code> → <code>/mcp</code>." }));
    ctx.connections(list);
  }
  el.append(h("div", { class: "toolbar" }, h("span", { style: "flex:1;color:var(--text-3);font-size:11px" }, "Claude connections"), h("button", { class: "tb", onclick: load }, "↻")), body);
  load();
  return { refresh: load };
}

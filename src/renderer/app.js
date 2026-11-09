// Glyphh OS — the renderer: layout manager, center carousel, composer, voice,
// and the agent's hands on the UI (os:cmd).
//
// The screen: a left rail (areas "left" + "left-bottom"), a right rail ("right"
// + "right-bottom"), each collapsible, and the center: a carousel whose first
// slide is the face, then one slide per app or per layout (a grid of apps,
// like the desktop's layouts: cols × rows, column widths, cells that span).
// Every app is one live instance; moving it moves its element.
import { createFace } from "./face.js";
import { PRESETS, PARAMS, PARTS, STYLES } from "./character.js";
import { createVoice } from "./voice.js";
import { APPS, mountApp, webAppFor, registerCustom, slugify, iconHTML, onIconChange } from "./apps.js";
import { initBots, fillVoices } from "./bots.js";

const os = window.os;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RAIL_AREAS = ["left", "left-bottom", "right", "right-bottom"];
const AREA_NAMES = [...RAIL_AREAS, "center"];
const railOf = (area) => area.split("-")[0];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let settings = await os.settings.get();
let customApps = (await os.store.get("apps")) || [];
registerCustom(customApps);

// ── toasts ────────────────────────────────────────────────────────────
function toast(msg, bad) {
  const t = Object.assign(document.createElement("div"), { className: "toast" + (bad ? " bad" : ""), textContent: msg });
  $("#toasts").append(t); setTimeout(() => t.remove(), 3800);
  return "shown";
}

// ── layouts (center grids) ────────────────────────────────────────────
const cell = (app, col, row, rowSpan = 1, colSpan = 1) => ({ app, col, row, colSpan, rowSpan });
const BUILTIN_LAYOUTS = {
  split: { name: "Split", cols: 2, rows: 1, cells: [cell(null, 0, 0), cell(null, 1, 0)] },
  "main-side": { name: "Main + side", cols: 2, rows: 1, colWidths: [0.65, 0.35], cells: [cell(null, 0, 0), cell(null, 1, 0)] },
  thirds: { name: "Thirds", cols: 3, rows: 1, cells: [cell(null, 0, 0), cell(null, 1, 0), cell(null, 2, 0)] },
  stack: { name: "Stack", cols: 1, rows: 2, cells: [cell(null, 0, 0), cell(null, 0, 1)] },
  grid: { name: "Grid 2×2", cols: 2, rows: 2, cells: [cell(null, 0, 0), cell(null, 1, 0), cell(null, 0, 1), cell(null, 1, 1)] },
  "main-two": { name: "Main + two", cols: 2, rows: 2, colWidths: [0.6, 0.4], cells: [cell(null, 0, 0, 2), cell(null, 1, 0), cell(null, 1, 1)] },
  dev: { name: "Dev", cols: 3, rows: 1, colWidths: [0.24, 0.46, 0.3], cells: [cell("files", 0, 0), cell("editor", 1, 0), cell("browser", 2, 0)] },
  social: { name: "Social", cols: 2, rows: 2, cells: [cell("x", 0, 0), cell("instagram", 1, 0), cell("youtube", 0, 1), cell("slack", 1, 1)] },
  comms: { name: "Comms", cols: 2, rows: 1, cells: [cell("email", 0, 0), cell("calendar", 1, 0)] },
  swarm: { name: "Swarm", cols: 2, rows: 2, colWidths: [0.6, 0.4], cells: [cell("swarm", 0, 0, 2), cell("plan", 1, 0), cell("browser", 1, 1)] },
};
let savedLayouts = (await os.store.get("layouts")) || {};
const allLayouts = () => ({ ...BUILTIN_LAYOUTS, ...savedLayouts });

// ── state ─────────────────────────────────────────────────────────────
const DEFAULT_LAYOUT = {
  areas: {
    left: { apps: ["files", "email"], active: "files" },
    "left-bottom": { apps: ["git"], active: "git" },
    right: { apps: ["browser", "calendar"], active: "browser" },
    "right-bottom": { apps: ["terminal"], active: "terminal" },
  },
  center: { slides: [], index: 0 },
  rails: { left: { open: true, w: 360, split: 0.58 }, right: { open: true, w: 440, split: 0.5 } },
  composer: { open: true },
  urls: {},
};
const DEFAULT_DIPS = {
  dev: { areas: { left: { apps: ["files"], active: "files" }, "left-bottom": { apps: ["git"], active: "git" }, right: { apps: ["browser"], active: "browser" }, "right-bottom": { apps: ["terminal"], active: "terminal" } }, center: { slides: [{ id: "s-editor", kind: "app", app: "editor" }], index: 1 } },
  social: { areas: { left: { apps: [], active: null }, "left-bottom": { apps: ["git"], active: "git" }, right: { apps: ["slack"], active: "slack" }, "right-bottom": { apps: ["terminal"], active: "terminal" } }, center: { slides: [{ id: "s-social", kind: "layout", ...structuredClone(BUILTIN_LAYOUTS.social), cells: BUILTIN_LAYOUTS.social.cells.filter((c) => c.app !== "slack").concat([cell(null, 1, 1)]) }], index: 1 } },
  comms: { areas: { left: { apps: ["email"], active: "email" }, "left-bottom": { apps: ["git"], active: "git" }, right: { apps: ["calendar", "connections"], active: "calendar" }, "right-bottom": { apps: ["terminal"], active: "terminal" } }, center: { slides: [], index: 0 } },
  focus: { rails: { left: { open: false, w: 360, split: 0.58 }, right: { open: false, w: 440, split: 0.5 } } },
};

function normalize(l) {
  const d = structuredClone(DEFAULT_LAYOUT);
  if (!l || !l.center?.slides) return d; // a layout from before rails: start fresh
  const out = { ...d, ...l, areas: { ...d.areas, ...(l.areas || {}) }, rails: { left: { ...d.rails.left, ...(l.rails?.left || {}) }, right: { ...d.rails.right, ...(l.rails?.right || {}) } }, composer: { ...d.composer, ...(l.composer || {}) }, urls: { ...(l.urls || {}) } };
  for (const a of RAIL_AREAS) out.areas[a] = { apps: [...(out.areas[a]?.apps || [])], active: out.areas[a]?.active ?? null };
  return out;
}

let L = normalize(await os.layout.get());
let dips = (await os.dips.get()) || structuredClone(DEFAULT_DIPS);
const inst = new Map(); // app id → { el, api }

let saveTimer;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {
  for (const [id, i] of inst) { try { if (i.api?.url) L.urls[id] = i.api.url(); } catch { /* gone */ } }
  os.layout.set(L);
}, 400); };

let slideSeq = Date.now();
const newSlideId = () => "s" + (slideSeq++).toString(36);

// where an app lives: { area } | { slide, cell? }
function whereIs(id) {
  for (const a of RAIL_AREAS) if (L.areas[a].apps.includes(id)) return { area: a };
  for (const s of L.center.slides) {
    if (s.kind === "app" && s.app === id) return { slide: s.id };
    if (s.kind === "layout") { const i = s.cells.findIndex((c) => c.app === id); if (i >= 0) return { slide: s.id, cell: i }; }
  }
  return null;
}
const isOpen = (id) => !!whereIs(id);

function removeFromState(id) {
  for (const a of RAIL_AREAS) {
    const st = L.areas[a];
    if (st.apps.includes(id)) { st.apps = st.apps.filter((x) => x !== id); if (st.active === id) st.active = st.apps[0] || null; }
  }
  const before = L.center.slides.length;
  const curId = L.center.slides[L.center.index - 1]?.id;
  L.center.slides = L.center.slides.filter((s) => !(s.kind === "app" && s.app === id));
  for (const s of L.center.slides) if (s.kind === "layout") for (const c of s.cells) if (c.app === id) c.app = null;
  if (L.center.slides.length !== before) {
    const i = L.center.slides.findIndex((s) => s.id === curId);
    L.center.index = i >= 0 ? i + 1 : Math.min(L.center.index, L.center.slides.length);
  }
}

/** Put an app at a place in the state. `to`: an area name, "center", or { slide, cell }. */
function addToState(id, to) {
  if (typeof to === "string" && RAIL_AREAS.includes(to)) {
    L.areas[to].apps.push(id); L.areas[to].active = id; L.rails[railOf(to)].open = true;
  } else if (to && typeof to === "object") {
    const s = L.center.slides.find((x) => x.id === to.slide);
    if (!s || s.kind !== "layout" || !s.cells[to.cell]) throw new Error("that layout cell is gone");
    const prev = s.cells[to.cell].app;
    if (prev && prev !== id) closeApp(prev, true);
    s.cells[to.cell].app = id;
    L.center.index = L.center.slides.indexOf(s) + 1;
  } else {
    L.center.slides.push({ id: newSlideId(), kind: "app", app: id });
    L.center.index = L.center.slides.length;
  }
}

function ctxFor(id) {
  return {
    cwd: settings.cwd, url: L.urls?.[id], toast,
    ask: (t) => send(t),
    open: (app, to, url) => openApp(app, to, url),
    openFile: (p) => openFile(p),
    changed: save,
    connections: setConnDots,
    resume: resumeSession,
  };
}

// ── sessions: pick a past one back up; the OS's folder ────────────────
async function resumeSession(id, title) {
  try {
    const turns = await os.agent.resume(id);
    log.innerHTML = "";
    for (const t of turns.slice(-40)) addMsg(t.role === "user" ? "user" : "bot", t.text);
    caption(""); toast("Back in: " + (title || "session").slice(0, 60));
  } catch (e) { toast(e.message, true); }
}
function showFolder() {
  const b = $("#btn-folder"); if (!b) return;
  b.textContent = "▸ " + (settings.cwd.split("/").pop() || settings.cwd);
  b.title = `Glyphh OS works in ${settings.cwd} (click to change)`;
}
async function pickFolder() {
  const next = await os.agent.pickFolder();
  if (!next) return;
  settings = next; showFolder();
  // everything that works in a folder follows: files, git, terminal, recents
  for (const id of ["files", "git", "terminal", "recents"]) inst.get(id)?.api?.setRoot?.(settings.cwd);
  log.innerHTML = ""; toast("Working in " + settings.cwd);
}

function instance(id) {
  let rec = inst.get(id);
  if (!rec) {
    const el = document.createElement("div");
    el.className = "panel"; el.dataset.app = id;
    rec = { el, api: null };
    inst.set(id, rec);
  }
  return rec;
}

/** Move an app's element under `parent` (only if it isn't there: moving a webview reloads it). */
function attach(id, parent) {
  const rec = instance(id);
  if (rec.el.parentElement !== parent) {
    const wv = rec.el.querySelector("webview");
    if (wv && rec.api?.url) { try { wv.setAttribute("src", rec.api.url()); } catch { /* not loaded */ } }
    parent.append(rec.el);
  }
  if (!rec.api) { try { rec.api = mountApp(id, rec.el, ctxFor(id)) || {}; } catch (e) { toast(e.message, true); rec.api = {}; } }
  return rec;
}

// ── rendering ─────────────────────────────────────────────────────────
const areaEl = (a) => $(`.area[data-area="${a}"]`);
const appDef = (id) => (id === "face" ? { title: "Glyphh" } : APPS[id] || { title: id });
onIconChange(() => { render(); if (!$("#launcher").hidden && LS.view === "grid") drawLauncher(); });

function render() {
  // rails
  const stage = $("#stage");
  for (const r of ["left", "right"]) {
    const R = L.rails[r], rail = $(`.rail[data-rail="${r}"]`);
    rail.classList.toggle("collapsed", !R.open);
    stage.style.setProperty("--" + r, (R.open ? R.w : 46) + "px");
    const top = L.areas[r], bottom = L.areas[r + "-bottom"];
    const both = top.apps.length && bottom.apps.length;
    areaEl(r).style.setProperty("--grow", both ? R.split : 1);
    areaEl(r + "-bottom").style.setProperty("--grow", both ? 1 - R.split : 1);
    rail.querySelector(".hsplit").style.display = both ? "" : "none";
    const mini = rail.querySelector(".rail-mini"); mini.innerHTML = "";
    mini.append(btn("⇤⇥".charAt(r === "left" ? 1 : 0), "Expand", () => setRail(r, true)));
    for (const a of [r, r + "-bottom"]) {
      if (L.areas[a].apps.length) mini.append(document.createElement("hr"));
      for (const id of L.areas[a].apps) { const b = btn("", appDef(id).title, () => { setRail(r, true); focusApp(id); }); b.innerHTML = iconHTML(id); mini.append(b); }
    }
  }
  stage.classList.toggle("composer-closed", !L.composer.open);
  $("#composer").hidden = !L.composer.open;
  $("#glyphh-pill").hidden = L.composer.open;

  // rail areas
  for (const a of RAIL_AREAS) {
    const st = L.areas[a], el = areaEl(a), nav = el.querySelector(".tabs"), body = el.querySelector(".area-body");
    el.classList.toggle("empty", !st.apps.length);
    nav.innerHTML = "";
    for (const id of st.apps) nav.append(tabChip(id, st.active === id));
    nav.append(spacer(), iconBtn("+", "Add a tab here", () => openLauncher({ to: a })));
    if (!a.endsWith("-bottom")) nav.append(iconBtn(a === "left" ? "⇤" : "⇥", "Collapse", () => setRail(a, false)));
    for (const id of st.apps) attach(id, body).el.classList.toggle("active", id === st.active);
  }

  // center slides
  const track = $(".track");
  const keep = new Set(["face"]);
  L.center.slides.forEach((s, i) => {
    keep.add(s.id);
    let slide = track.querySelector(`.slide[data-slide="${s.id}"]`);
    if (!slide) {
      slide = document.createElement("div"); slide.className = "slide"; slide.dataset.slide = s.id;
      track.append(slide);
    }
    slide.style.order = String(i + 1);
    if (s.kind === "app") {
      let inner = slide.querySelector(":scope > .slide-inner");
      if (!inner) { slide.innerHTML = ""; inner = document.createElement("div"); inner.className = "slide-inner"; slide.append(inner); }
      attach(s.app, inner).el.classList.add("active");
    } else renderLayoutSlide(slide, s);
  });
  for (const slide of $$(".track > .slide")) {
    const id = slide.dataset.slide || "face";
    if (!keep.has(id)) { for (const p of $$(".panel", slide)) if (!isOpen(p.dataset.app)) p.remove(); slide.remove(); }
  }
  $(".face-slide").style.order = "0";
  L.center.index = Math.max(0, Math.min(L.center.index, L.center.slides.length));
  track.style.transform = `translateX(${-L.center.index * 100}%)`;

  // center tabs + dots
  const nav = $(".center-tabs"); nav.innerHTML = "";
  const order = [{ id: "face", label: { ...appDef("face"), icon: iconHTML("face") } }, ...L.center.slides.map((s) => ({ id: s.id, label: s.kind === "app" ? { ...appDef(s.app), icon: iconHTML(s.app) } : { icon: iconHTML("layout"), title: s.name || "Layout" }, slide: s }))];
  order.forEach((o, i) => {
    const t = document.createElement("div");
    t.className = "tab" + (i === L.center.index ? " active" : "");
    t.innerHTML = `${o.label.icon}<span>${esc(o.label.title)}</span>`;
    t.onclick = () => go(i);
    if (o.slide) {
      if (o.slide.kind === "app") { t.draggable = true; t.ondragstart = (e) => dragApp(e, o.slide.app); }
      const x = document.createElement("span"); x.className = "x"; x.textContent = "✕";
      x.onclick = (e) => { e.stopPropagation(); closeSlide(o.slide.id); }; t.append(x);
    }
    nav.append(t);
  });
  nav.append(iconBtn("+", "Open an app or a layout in the center", () => openLauncher({ to: "center" })));
  const dots = $(".dots"); dots.innerHTML = "";
  order.forEach((o, i) => { const d = document.createElement("i"); d.className = i === L.center.index ? "on" : ""; d.title = o.label.title; d.onclick = () => go(i); dots.append(d); });

  for (const [, r] of inst) requestAnimationFrame(() => r.api?.layout?.());
  save();
}

function renderLayoutSlide(slide, s) {
  let grid = slide.querySelector(":scope > .slide-grid");
  if (!grid) { slide.innerHTML = ""; grid = document.createElement("div"); grid.className = "slide-grid"; slide.append(grid); }
  const widths = s.colWidths?.length === s.cols ? s.colWidths : Array(s.cols).fill(1);
  grid.style.gridTemplateColumns = widths.map((w) => w + "fr").join(" ");
  grid.style.gridTemplateRows = `repeat(${s.rows}, 1fr)`;
  const cells = $$(":scope > .cell", grid);
  for (const c of cells.slice(s.cells.length)) { for (const p of $$(".panel", c)) if (!isOpen(p.dataset.app)) p.remove(); c.remove(); }
  s.cells.forEach((c, i) => {
    let box = grid.querySelector(`:scope > .cell[data-i="${i}"]`);
    if (!box) {
      box = document.createElement("div"); box.className = "cell"; box.dataset.i = i;
      box.innerHTML = `<div class="cell-head"><span class="n"></span><button title="Remove">✕</button></div><div class="cell-body"></div><div class="cell-empty"><button>+ Add an app</button></div>`;
      box.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/os-app")) { e.preventDefault(); box.classList.add("drop"); } });
      box.addEventListener("dragleave", () => box.classList.remove("drop"));
      box.addEventListener("drop", (e) => { box.classList.remove("drop"); const id = e.dataTransfer.getData("text/os-app"); if (!id) return; e.preventDefault(); e.stopPropagation(); moveApp(id, { slide: s.id, cell: Number(box.dataset.i) }); });
      grid.append(box);
    }
    box.style.gridColumn = `${c.col + 1} / span ${c.colSpan || 1}`;
    box.style.gridRow = `${c.row + 1} / span ${c.rowSpan || 1}`;
    const head = box.querySelector(".cell-head"), body = box.querySelector(".cell-body"), empty = box.querySelector(".cell-empty");
    head.hidden = body.hidden = !c.app; empty.hidden = !!c.app;
    empty.querySelector("button").onclick = () => openLauncher({ to: { slide: s.id, cell: i } });
    if (c.app) {
      head.querySelector(".n").innerHTML = `${iconHTML(c.app)}<span>${esc(appDef(c.app).title)}</span>`;
      head.querySelector("button").onclick = () => closeApp(c.app);
      head.draggable = true; head.ondragstart = (e) => dragApp(e, c.app);
      const rec = attach(c.app, body); rec.el.classList.add("active");
    }
  });
}

function btn(label, title, onclick) { const b = document.createElement("button"); b.textContent = label; b.title = title; b.onclick = onclick; return b; }
function iconBtn(label, title, onclick) { const b = btn(label, title, onclick); b.className = "tb-icon"; return b; }
function spacer() { const s = document.createElement("span"); s.className = "spacer"; return s; }
function dragApp(e, id) { e.dataTransfer.setData("text/os-app", id); e.dataTransfer.effectAllowed = "move"; }

function tabChip(id, active) {
  const t = document.createElement("div");
  t.className = "tab" + (active ? " active" : "");
  t.draggable = true;
  t.innerHTML = `${iconHTML(id)}<span>${esc(appDef(id).title)}</span>`;
  const x = document.createElement("span"); x.className = "x"; x.textContent = "✕"; x.onclick = (e) => { e.stopPropagation(); closeApp(id); }; t.append(x);
  t.onclick = () => focusApp(id);
  t.ondragstart = (e) => dragApp(e, id);
  return t;
}

// ── actions ───────────────────────────────────────────────────────────
const appList = () => Object.keys(APPS).filter((k) => !APPS[k].adhoc && !APPS[k].hidden).join(", ");
function resolveApp(id, url) {
  if (/^https?:\/\/|^[\w-]+\.[a-z]{2,}(\/|$)/i.test(id)) return { id: webAppFor(id), url: url || id };
  if (!APPS[id]) { const byName = Object.keys(APPS).find((k) => APPS[k].title.toLowerCase() === String(id).toLowerCase()); if (byName) return { id: byName, url }; }
  if (!APPS[id]) throw new Error(`no app "${id}" — apps: ${appList()}`);
  return { id, url };
}
const toName = (to) => (typeof to === "object" ? "a layout cell" : to);

function openApp(appIn, to, urlIn) {
  const { id, url } = resolveApp(appIn, urlIn);
  if (isOpen(id) && !to) { focusApp(id); if (url) inst.get(id)?.api?.goto?.(url); return `${id} is already open`; }
  if (isOpen(id)) { const r = moveApp(id, to); if (url) setTimeout(() => inst.get(id)?.api?.goto?.(url), 300); return r; }
  to = to || APPS[id].area || (APPS[id].web ? "center" : "right");
  if (url) L.urls[id] = url;
  addToState(id, to);
  render();
  return `opened ${id} in ${toName(to)}`;
}

function closeApp(id, quiet) {
  if (!isOpen(id) && !inst.has(id)) return `${id} is not open`;
  removeFromState(id);
  const rec = inst.get(id);
  rec?.api?.unmount?.(); rec?.el.remove();
  inst.delete(id); delete L.urls[id];
  if (!quiet) render();
  return `closed ${id}`;
}

function closeSlide(slideId) {
  const s = L.center.slides.find((x) => x.id === slideId); if (!s) return "no such slide";
  const apps = s.kind === "app" ? [s.app] : s.cells.map((c) => c.app).filter(Boolean);
  L.center.slides = L.center.slides.filter((x) => x !== s);
  for (const id of apps) closeApp(id, true);
  render();
  return `closed ${s.kind === "app" ? s.app : s.name || "layout"}`;
}

function moveApp(appIn, to) {
  const { id } = resolveApp(appIn);
  if (!isOpen(id)) return openApp(id, to);
  if (to === "center" && whereIs(id).slide && whereIs(id).cell === undefined) return focusApp(id);
  if (typeof to === "string" && whereIs(id).area === to) return focusApp(id);
  instance(id).el.classList.remove("active");
  removeFromState(id);
  addToState(id, to);
  render();
  return `moved ${id} to ${toName(to)}`;
}

function focusApp(appIn) {
  if (appIn === "face") { go(0); return "showing the face"; }
  const { id } = resolveApp(appIn);
  const w = whereIs(id); if (!w) return openApp(id);
  if (w.area) { L.areas[w.area].active = id; L.rails[railOf(w.area)].open = true; render(); }
  else go(L.center.slides.findIndex((s) => s.id === w.slide) + 1);
  inst.get(id)?.api?.focus?.();
  return `focused ${id}`;
}

function setRail(r, open) { L.rails[railOf(r)].open = open; render(); return `${railOf(r)} rail ${open ? "open" : "collapsed"}`; }

function go(i) { L.center.index = i; render(); }
const step = (d) => go(Math.max(0, Math.min(L.center.slides.length, L.center.index + d)));

async function openFile(p, line) {
  if (!isOpen("editor")) openApp("editor", "center"); else focusApp("editor");
  return inst.get("editor").api.openFile(p, line);
}

/** Open a layout as a new center slide. Apps already open elsewhere move into it. */
function openLayout(spec) {
  const s = { id: newSlideId(), kind: "layout", name: spec.name || "Layout", cols: spec.cols, rows: spec.rows, colWidths: spec.colWidths, cells: spec.cells.map((c) => ({ ...c })) };
  for (const c of s.cells) {
    if (!c.app) continue;
    try { c.app = resolveApp(c.app).id; } catch { c.app = null; continue; }
    if (isOpen(c.app)) { instance(c.app).el.classList.remove("active"); removeFromState(c.app); }
  }
  L.center.slides.push(s);
  L.center.index = L.center.slides.length;
  render();
  return `opened the ${s.name} layout`;
}

function layoutFromArgs(a) {
  if (a.name === "list") return "layouts: " + Object.keys(allLayouts()).join(", ");
  if (a.name) {
    const key = Object.keys(allLayouts()).find((k) => k === slugify(a.name) || allLayouts()[k].name.toLowerCase() === a.name.toLowerCase());
    if (!key) throw new Error(`no layout "${a.name}" — layouts: ${Object.keys(allLayouts()).join(", ")}`);
    const t = structuredClone(allLayouts()[key]);
    if (a.apps?.length) t.cells.forEach((c, i) => { if (a.apps[i]) c.app = a.apps[i]; });
    return openLayout(t);
  }
  const apps = a.apps || [];
  const cols = a.cols || Math.min(3, Math.max(1, apps.length)), rows = a.rows || Math.max(1, Math.ceil(apps.length / cols));
  const cells = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(cell(apps[r * cols + c] || null, c, r));
  return openLayout({ name: "Layout", cols, rows, cells });
}

function applyLayout(next) {
  for (const id of [...inst.keys()]) closeApp(id, true);
  const n = normalize({ ...structuredClone(DEFAULT_LAYOUT), ...structuredClone(next), rails: next.rails || L.rails, composer: L.composer });
  L = n;
  for (const s of L.center.slides) s.id = newSlideId();
  for (const a of RAIL_AREAS) L.areas[a].apps = L.areas[a].apps.filter((id) => APPS[id]);
  render();
}

function dip(name, saveIt) {
  name = (name || "").trim().toLowerCase();
  if (!name || name === "list") return "dips: " + Object.keys(dips).join(", ");
  if (saveIt) {
    for (const [id, i] of inst) { try { if (i.api?.url) L.urls[id] = i.api.url(); } catch { /* gone */ } }
    dips[name] = structuredClone({ areas: L.areas, center: L.center, rails: L.rails, urls: L.urls });
    os.dips.set(dips); return `saved dip "${name}"`;
  }
  if (!dips[name]) return `no dip "${name}" — dips: ${Object.keys(dips).join(", ")}`;
  applyLayout(dips[name]);
  return `dipped into ${name}`;
}

// ── drag between areas ────────────────────────────────────────────────
for (const a of AREA_NAMES) {
  const el = a === "center" ? $(".area.center") : areaEl(a);
  // apps drop into any area; a layout dropped anywhere between the panels opens as a center slide
  const takes = (e) => e.dataTransfer.types.includes("text/os-app") || e.dataTransfer.types.includes("text/os-layout");
  el.addEventListener("dragover", (e) => { if (takes(e)) { e.preventDefault(); el.classList.add("drop"); } });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
  el.addEventListener("drop", (e) => {
    e.preventDefault(); el.classList.remove("drop");
    const lay = e.dataTransfer.getData("text/os-layout");
    if (lay) { try { layoutFromArgs({ name: lay }); } catch (err) { toast(err.message, true); } return; }
    const id = e.dataTransfer.getData("text/os-app");
    if (id) { try { moveApp(id, a); } catch (err) { toast(err.message, true); } }
  });
}
document.addEventListener("dragstart", () => document.body.classList.add("dragging-tab"));
document.addEventListener("dragend", () => { document.body.classList.remove("dragging-tab"); $$(".drop").forEach((x) => x.classList.remove("drop")); });
const dragStyle = document.createElement("style"); dragStyle.textContent = "body.dragging-tab webview, body.splitting webview { pointer-events: none; }"; document.head.append(dragStyle);

// ── splitters: rail widths and the top/bottom split ───────────────────
function dragger(el, onMove) {
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId); el.classList.add("drag"); document.body.classList.add("splitting");
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev) => onMove(ev, start);
    const up = () => { el.classList.remove("drag"); document.body.classList.remove("splitting"); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  });
}
for (const s of $$(".splitter")) {
  const side = s.dataset.split;
  let w0 = 0;
  s.addEventListener("pointerdown", () => { w0 = L.rails[side].open ? L.rails[side].w : 46; });
  dragger(s, (ev, st) => {
    const dx = ev.clientX - st.x, w = w0 + (side === "left" ? dx : -dx);
    if (w < 140) { L.rails[side].open = false; } else { L.rails[side].open = true; L.rails[side].w = Math.min(innerWidth * 0.55, w); }
    render();
  });
  s.addEventListener("dblclick", () => setRail(side, !L.rails[side].open));
}
for (const h of $$(".hsplit")) {
  const r = h.dataset.rail;
  dragger(h, (ev) => {
    const rail = $(`.rail[data-rail="${r}"]`).getBoundingClientRect();
    L.rails[r].split = Math.max(0.15, Math.min(0.85, (ev.clientY - rail.top) / rail.height));
    render();
  });
}

// ── carousel swipes: trackpad, drag, keys ─────────────────────────────
let wheelAcc = 0, wheelLock = 0;
$(".carousel").addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.2) return;
  const now = performance.now(); if (now < wheelLock) return;
  wheelAcc += e.deltaX;
  if (Math.abs(wheelAcc) > 90) { step(Math.sign(wheelAcc)); wheelAcc = 0; wheelLock = now + 600; }
}, { passive: true });
for (const grip of [$(".face-slide"), ...$$(".swipe-edge")]) {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, w = $(".carousel").clientWidth, base = -L.center.index * w;
    const track = $(".track"); let dx = 0;
    grip.setPointerCapture(e.pointerId); track.classList.add("dragging"); document.body.classList.add("splitting");
    const move = (ev) => { dx = ev.clientX - x0; track.style.transform = `translateX(${base + dx}px)`; };
    const up = () => {
      track.classList.remove("dragging"); document.body.classList.remove("splitting");
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      if (Math.abs(dx) > w * 0.15) step(dx < 0 ? 1 : -1); else render();
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
}
document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); step(e.key === "ArrowLeft" ? -1 : 1); }
  if (e.metaKey && e.key === ",") { e.preventDefault(); openSettings(); }
  if (e.metaKey && e.key.toLowerCase() === "k") { e.preventDefault(); setComposer(true); }
  if (e.metaKey && e.key.toLowerCase() === "b") { e.preventDefault(); setRail(e.shiftKey ? "right" : "left", !L.rails[e.shiftKey ? "right" : "left"].open); }
  if (e.key === "Escape") {
    const open = $$(".modal").filter((m) => !m.hidden && m.id !== "perm");
    if (open.length) open.forEach((m) => (m.hidden = true)); else stopAgent();
  }
});

// ── face + voice ──────────────────────────────────────────────────────
const face = createFace($("#face"));
let busy = false, recording = false, continuous = false, speakReplies = settings.speakReplies;
const updateFace = () => face.setState(recording || (continuous && !voice.speaking && !busy) ? "listening" : voice.speaking ? "speaking" : busy ? "thinking" : "idle");
let botsUI = null;
const voice = createVoice({
  // whoever is speaking moves: a bot's own avatar, or Glyphh's face
  onMouth: (v) => {
    const who = voice?.speaker;
    if (who) { botsUI?.mouth(who, v); face.setMouth(0); } else face.setMouth(v);
    $("#pill-level").style.transform = `scaleX(${Math.max(0.05, v)})`;
  },
  onWho: (who) => botsUI?.onWho(who),
  onMic: (v) => { face.setMic(v); $("#mic-level i").style.width = v * 100 + "%"; },
  onUtterance: (t) => { send(t); },
  onSpeaking: () => updateFace(),
  onError: (m) => toast(m, true),
});
voice.setThreshold(settings.vadThreshold);
botsUI = await initBots({
  toast, voice, render,
  open: (app, area) => openApp(app, area),
  whereIs,
  settings: () => settings,
  models: () => models,
});
setInterval(() => { if (recording !== voice.recording) { recording = voice.recording; updateFace(); } }, 100);

// ── characters: the Glyphh cat, its bot variants, and your own ────────
let chars = (await os.store.get("characters")) || { active: "glyphh", custom: {} };
const allChars = () => ({ ...PRESETS, ...chars.custom });
const charOf = (key) => structuredClone(allChars()[key] || PRESETS.glyphh);
let draft = charOf(chars.active), draftKey = chars.active;
face.setCharacter(draft);

function useCharacter(key) {
  draftKey = key; draft = charOf(key);
  chars.active = key; os.store.set("characters", chars);
  face.setCharacter(draft);
  return `now ${draft.name}`;
}

function drawCharacter() {
  const P = $("#char-presets"); P.innerHTML = "";
  for (const [k, c] of Object.entries(allChars())) {
    const b = btn(c.name, "", () => { useCharacter(k); drawCharacter(); });
    if (k === draftKey) b.className = "on";
    P.append(b);
  }
  $("#char-style").innerHTML = Object.entries(STYLES).map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
  $("#char-style").value = draft.style || "contour";
  $("#char-color").value = draft.color || "#ad5df8"; $("#char-density").value = draft.density || 26;
  $("#char-name").value = chars.custom[draftKey] ? draft.name : "";
  $("#char-delete").hidden = !chars.custom[draftKey];
  const Q = $("#char-parts"); Q.innerHTML = "";
  for (const [k, part] of Object.entries(PARTS)) {
    const l = document.createElement("label"); l.textContent = part.label;
    const s = document.createElement("select");
    s.innerHTML = Object.entries(part.options).map(([v, o]) => `<option value="${v}">${o.name}</option>`).join("");
    s.value = draft[k] || Object.keys(part.options)[0];
    s.onchange = () => { draft[k] = s.value; remesh(false); };
    l.append(s); Q.append(l);
  }
  const S = $("#char-sliders"); S.innerHTML = "";
  for (const [k, p] of Object.entries(PARAMS)) {
    const l = document.createElement("label"); l.textContent = p.label;
    const r = Object.assign(document.createElement("input"), { type: "range", min: p.min, max: p.max, step: p.step, value: draft[k] ?? 1 });
    r.oninput = () => { draft[k] = Number(r.value); remesh(true); };
    r.onchange = () => remesh(false);
    l.append(r); S.append(l);
  }
}
let remeshQueued = false;
function remesh(quick) {
  if (quick) { if (remeshQueued) return; remeshQueued = true; requestAnimationFrame(() => { remeshQueued = false; face.setCharacter(draft, true); }); }
  else face.setCharacter(draft);
}
$("#char-style").onchange = (e) => { draft.style = e.target.value; remesh(false); };
$("#char-color").oninput = (e) => { draft.color = e.target.value; remesh(false); };
$("#char-density").oninput = (e) => { draft.density = Number(e.target.value); remesh(false); };
$("#char-save").onclick = () => {
  const name = $("#char-name").value.trim() || (chars.custom[draftKey] ? draft.name : "");
  if (!name) return toast("Name your character to save it", true);
  const key = chars.custom[draftKey] && draft.name === name ? draftKey : "c-" + slugify(name);
  chars.custom[key] = { ...draft, name };
  useCharacter(key); drawCharacter(); toast(`Saved ${name}`);
};
$("#char-delete").onclick = () => { delete chars.custom[draftKey]; useCharacter("glyphh"); drawCharacter(); };
$("#btn-character").onclick = () => { if (L.center.index !== 0) go(0); drawCharacter(); $("#character").hidden = false; };

// ── composer ──────────────────────────────────────────────────────────
const input = $("#input"), log = $("#log");
const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, innerHeight * 0.4) + "px"; };
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
// While Claude works, send becomes stop (and Esc stops too); typing something new still sends it.
$("#btn-send").onclick = () => (busy && !input.value.trim() ? stopAgent() : submit());
$("#btn-log").onclick = () => log.classList.toggle("collapsed");
let stopped = false;
function stopAgent() {
  voice.stopSpeaking();
  if (!busy) return;
  busy = false; stopped = true; setStatus("bad", "stopping…"); updateFace();
  os.agent.interrupt().then(() => { if (!busy) setStatus("ok", "stopped"); });
  addMsg("tool", "stopped");
}
$("#btn-folder").onclick = pickFolder; showFolder();
$("#btn-recents").onclick = () => (isOpen("recents") ? focusApp("recents") : openApp("recents", "left"));
$("#btn-new").onclick =() => { os.agent.newChat(); log.innerHTML = ""; caption(""); toast("New conversation"); };
function setComposer(open) { L.composer.open = open; render(); if (open) setTimeout(() => input.focus(), 50); }
$("#btn-close-composer").onclick = () => setComposer(false);
$("#glyphh-pill").onclick = (e) => (e.target.id === "pill-stop" ? stopAgent() : setComposer(true));

const mic = $("#btn-mic");
let pttDown = 0;
mic.addEventListener("pointerdown", async () => { pttDown = performance.now(); if (voice.recording) return; try { await voice.pushStart(); mic.classList.add("rec"); } catch (e) { toast("Microphone: " + e.message, true); } });
mic.addEventListener("pointerup", () => { if (performance.now() - pttDown > 350 || mic.dataset.toggled) { voice.pushStop(); mic.classList.remove("rec"); delete mic.dataset.toggled; } else mic.dataset.toggled = "1"; });
$("#btn-loop").onclick = async () => {
  continuous = !continuous;
  try { await voice.setContinuous(continuous); } catch (e) { continuous = false; toast("Microphone: " + e.message, true); }
  $("#btn-loop").classList.toggle("on", continuous);
  if (continuous && !settings.elevenKeySet) toast("Add your ElevenLabs key in Settings for voice", true);
  updateFace();
};
const speakBtn = $("#btn-speak");
speakBtn.classList.toggle("on", speakReplies);
speakBtn.onclick = () => { speakReplies = !speakReplies; speakBtn.classList.toggle("on", speakReplies); if (!speakReplies) voice.stopSpeaking(); os.settings.set({ speakReplies }); };

function addMsg(cls, text) {
  const m = document.createElement("div"); m.className = "msg " + cls; m.textContent = text;
  log.append(m); log.scrollTop = log.scrollHeight;
  return m;
}
let capTimer;
function caption(t) {
  const c = $("#face-caption"); clearTimeout(capTimer);
  c.style.opacity = 1; c.textContent = t.length > 220 ? "…" + t.slice(-220) : t;
  capTimer = setTimeout(() => (c.style.opacity = 0), 6000);
}

function submit() {
  const t = input.value.trim(); if (!t) return;
  input.value = ""; autosize();
  send(t);
}

const areaArg = (a) => a.find((x) => AREA_NAMES.includes(x));
/** .dip / .open / .close / .move / .layout / .rail run here; everything else goes to Claude. */
function localCommand(t) {
  const m = t.match(/^[./](dip|open|close|move|face|new|settings|layout|rail|character)\b\s*(.*)$/i);
  if (!m) return null;
  const [, cmd, rest] = m; const a = rest.trim().split(/\s+/).filter(Boolean);
  switch (cmd.toLowerCase()) {
    case "dip": return a[0] === "save" ? dip(a[1] || "mine", true) : a[0] === "delete" ? (delete dips[a[1]], os.dips.set(dips), `deleted ${a[1]}`) : dip(a[0] || "list");
    case "open": return openApp(a[0], areaArg(a.slice(1)), a.slice(1).find((x) => /^https?:|\./.test(x)));
    case "close": return closeApp(resolveApp(a[0]).id);
    case "move": return moveApp(a[0], a[1]);
    case "face": return focusApp("face");
    case "new": $("#btn-new").click(); return "new conversation";
    case "settings": openSettings(); return "settings";
    case "layout": return a.length > 1 ? layoutFromArgs({ apps: a }) : layoutFromArgs({ name: a[0] || "list" });
    case "character": return handlers.character({ name: rest.trim() || "list" });
    case "rail": return setRail(a[0] || "left", a[1] ? a[1] !== "close" : !L.rails[a[0] || "left"].open);
  }
}

let botMsg = null, botText = "";
function send(t) {
  log.classList.remove("collapsed");
  addMsg("user", t);
  let local;
  try { local = localCommand(t); } catch (e) { local = "⚠ " + e.message; }
  if (local != null) { addMsg("tool", local); return; }
  voice.stopSpeaking();
  stopped = false; busy = true; botMsg = null; botText = ""; setStatus("busy", "thinking…"); updateFace();
  os.agent.send(t);
}

function setStatus(kind, text) {
  $("#agent-dot").className = "dot " + kind; $("#agent-status").textContent = text;
  const working = kind === "busy";
  const s = $("#btn-send"); s.textContent = working ? "■" : "↑"; s.title = working ? "Stop (Esc)" : "Send"; s.classList.toggle("stop", working);
  $("#pill-stop").hidden = !working;
}

os.agent.onEvent((e) => {
  switch (e.type) {
    case "init": setStatus("ok", `${e.model} · ${e.servers.length} connections`); setConnDots(e.servers); break;
    case "models": fillModels(e.models); break;
    case "turn": botMsg = null; botText = ""; break;
    case "delta":
      if (stopped) break;
      if (!botMsg) botMsg = addMsg("bot", "");
      botText += e.text; botMsg.textContent = botText; log.scrollTop = log.scrollHeight;
      caption(botText.split(/(?<=[.!?])\s+/).slice(-2).join(" "));
      // in a swarm with voices on, Glyphh's words are spoken from the swarm's stream, in turn
      if (speakReplies && settings.elevenKeySet && !botsUI?.swarmVoicesOn()) voice.feed(e.text);
      break;
    case "tool": {
      const short = e.name.replace(/^mcp__os__/, "").replace(/^mcp__/, "");
      const arg = e.input && (e.input.app || e.input.command || e.input.file_path || e.input.path || e.input.url || e.input.pattern || e.input.query || e.input.name || e.input.description || "");
      addMsg("tool", `${short}${arg ? " · " + String(arg).slice(0, 120) : ""}`);
      if (speakReplies) voice.flush();
      botMsg = null; botText = "";
      setStatus("busy", short + "…");
      break;
    }
    case "done":
      if (stopped) { stopped = false; busy = false; setStatus("ok", "stopped"); updateFace(); break; }
      busy = false; if (speakReplies) voice.flush();
      if (!e.ok && e.error) addMsg("err", e.error);
      setStatus(e.ok ? "ok" : "bad", e.ok ? "ready" + (e.cost ? ` · $${e.cost.toFixed(3)}` : "") : "stopped");
      updateFace(); break;
    case "error":
      busy = false; updateFace();
      addMsg("err", e.text);
      setStatus("bad", /login|auth|401/i.test(e.text) ? "sign in: run claude → /login" : "error");
      break;
    case "log": if (/error|login|auth/i.test(e.text)) console.warn("[claude]", e.text); break;
  }
});

function setConnDots(list = []) {
  const d = $("#conn-dots"); d.innerHTML = "";
  for (const s of list.filter((s) => s.name !== "os")) { const i = document.createElement("i"); i.className = s.status; i.title = `${s.name}: ${s.status}`; d.append(i); }
}
$("#conn-dots").onclick = () => openApp("connections", "right");

// ── permission prompts ────────────────────────────────────────────────
os.agent.onPermission(({ id, name, input: inp }) => {
  const m = $("#perm"); m.hidden = false;
  $("#perm-name").textContent = name.replace(/^mcp__/, "");
  $("#perm-input").textContent = JSON.stringify(inp, null, 2).slice(0, 4000);
  if (speakReplies && settings.elevenKeySet) { voice.feed(`I need your OK to use ${name.replace(/^mcp__\w+__/, "").replace(/_/g, " ")}. `); voice.flush(); }
  const done = (ok) => { m.hidden = true; os.agent.answerPermission(id, ok); $("#perm-yes").onclick = $("#perm-no").onclick = null; };
  $("#perm-yes").onclick = () => done(true);
  $("#perm-no").onclick = () => done(false);
});

// ── the agent's hands ─────────────────────────────────────────────────
const handlers = {
  state: () => ({
    rails: Object.fromEntries(["left", "right"].map((r) => [r, { open: L.rails[r].open, top: L.areas[r], bottom: L.areas[r + "-bottom"] }])),
    center: { slide: L.center.index === 0 ? "face" : L.center.slides[L.center.index - 1], slides: L.center.slides },
    available: Object.keys(APPS).filter((k) => !APPS[k].adhoc),
    layouts: Object.keys(allLayouts()),
    dips: Object.keys(dips),
    editor: inst.get("editor")?.api?.files?.() || [],
  }),
  open: (a) => openApp(a.app, a.area, a.url),
  close: (a) => closeApp(resolveApp(a.app).id),
  move: (a) => moveApp(a.app, a.area),
  focus: (a) => focusApp(a.app),
  layout: (a) => layoutFromArgs(a),
  rail: (a) => setRail(a.rail, a.open),
  character: (a) => {
    if (!a.name || a.name === "list") return "characters: " + Object.values(allChars()).map((c) => c.name).join(", ");
    const key = Object.keys(allChars()).find((k) => k === a.name.toLowerCase() || allChars()[k].name.toLowerCase() === a.name.toLowerCase());
    if (!key) throw new Error(`no character "${a.name}" — characters: ${Object.values(allChars()).map((c) => c.name).join(", ")}`);
    return useCharacter(key);
  },
  dip: (a) => dip(a.name, a.save),
  bot: (a) => botsUI.openBot(a.id, a.area),
  swarm: () => {
    if (!isOpen("bots")) openApp("bots", "left");
    const s = L.center.slides.find((x) => x.kind === "layout" && x.cells.some((c) => c.app === "swarm"));
    if (s) { go(L.center.slides.indexOf(s) + 1); return "swarm is open"; }
    return layoutFromArgs({ name: "swarm" });
  },
  terminal: async () => { if (!isOpen("terminal")) openApp("terminal", "right-bottom"); else focusApp("terminal"); await new Promise((r) => setTimeout(r, 600)); return inst.get("terminal").api.termId; },
  edit: (a) => openFile(a.path, a.line),
  screenshot: () => os.screenshot(),
  toast: (a) => toast(a.message),
};
os.onCmd(async ({ id, cmd, args }) => {
  try { os.cmdResult({ id, ok: true, value: await handlers[cmd](args || {}) }); }
  catch (e) { os.cmdResult({ id, ok: false, error: e.message }); }
});
os.onOpenUrl((url) => openApp("browser", undefined, url));

// ── launcher: apps (with your own), layouts, pages ────────────────────
const PER_PAGE = 12;
const LS = { tab: "apps", page: 0, to: null, view: "grid", edit: null, build: null };
function openLauncher(opts = {}) {
  Object.assign(LS, { page: 0, view: "grid", edit: null, build: null, to: opts.to ?? null, tab: opts.tab || "apps" });
  $("#launch-search").value = "";
  $("#launcher").hidden = false; drawLauncher();
  setTimeout(() => $("#launch-search").focus(), 0);
}
$("#btn-apps").onclick = () => openLauncher();
$$("#launcher .seg button").forEach((b) => (b.onclick = () => { LS.tab = b.dataset.tab; LS.page = 0; LS.view = "grid"; drawLauncher(); }));
$("#launch-search").addEventListener("input", () => { LS.page = 0; LS.view = "grid"; drawLauncher(); });
$("#launch-search").addEventListener("keydown", (e) => {
  // Enter opens the first match
  if (e.key === "Enter") { e.preventDefault(); $("#launch-body .tile:not(.add)")?.click(); }
});
const searchQ = () => $("#launch-search").value.trim().toLowerCase();
const matches = (...texts) => { const q = searchQ(); return !q || texts.some((t) => String(t || "").toLowerCase().includes(q)); };
// dragging a tile out of the launcher: the sheet steps aside so the panels can take the drop
function dragOut(e, type, value) {
  e.dataTransfer.setData(type, value); e.dataTransfer.effectAllowed = "copyMove";
  setTimeout(() => ($("#launcher").hidden = true), 0);
}
$("#pg-prev").onclick = () => { LS.page--; drawLauncher(); };
$("#pg-next").onclick = () => { LS.page++; drawLauncher(); };

function searchPlaceholder() {
  const what = LS.tab === "apps" ? "Search apps" : "Search layouts";
  const to = LS.to;
  if (!to) return what;
  if (typeof to === "object") return what + " for this cell";
  return what + " · " + { left: "left rail", "left-bottom": "bottom left", right: "right rail", "right-bottom": "bottom right", center: "center" }[to];
}

function paged(items, render1, extra) {
  const all = extra ? [...items, extra] : items;
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  LS.page = Math.max(0, Math.min(LS.page, pages - 1));
  const g = document.createElement("div"); g.className = "grid";
  for (const it of all.slice(LS.page * PER_PAGE, (LS.page + 1) * PER_PAGE)) g.append(it === extra ? extra.render() : render1(it));
  $("#pg-prev").disabled = LS.page === 0; $("#pg-next").disabled = LS.page >= pages - 1;
  const dots = $("#pg-dots"); dots.innerHTML = "";
  for (let i = 0; i < pages; i++) { const d = document.createElement("i"); d.className = i === LS.page ? "on" : ""; d.onclick = () => { LS.page = i; drawLauncher(); }; dots.append(d); }
  $(".pager").style.visibility = pages > 1 ? "" : "hidden";
  return g;
}

function tile(icon, title, sub, onclick, cls = "") {
  const b = document.createElement("div"); b.className = "tile " + cls;
  b.innerHTML = `<span class="tile-ico">${icon}</span><div>${esc(title)}</div>${sub ? `<small>${esc(sub)}</small>` : ""}`;
  b.onclick = onclick; return b;
}
function miniGrid(l) {
  const g = document.createElement("div"); g.className = "mini-grid";
  g.style.gridTemplateColumns = (l.colWidths || Array(l.cols).fill(1)).map((w) => w + "fr").join(" ");
  g.style.gridTemplateRows = `repeat(${l.rows}, 1fr)`;
  for (const c of l.cells) { const i = document.createElement("i"); i.style.gridColumn = `${c.col + 1} / span ${c.colSpan || 1}`; i.style.gridRow = `${c.row + 1} / span ${c.rowSpan || 1}`; g.append(i); }
  return g;
}

function drawLauncher() {
  $$("#launcher .seg button").forEach((b) => b.classList.toggle("on", b.dataset.tab === LS.tab));
  $("#launch-search").placeholder = searchPlaceholder();
  const body = $("#launch-body"); body.innerHTML = "";
  if (LS.view === "edit") return body.append(appForm());
  if (LS.view === "build") return body.append(layoutBuilder());
  const none = (what) => { const n = document.createElement("div"); n.className = "launch-empty"; n.textContent = `No ${what} match “${searchQ()}”`; return n; };
  if (LS.tab === "apps") {
    const ids = Object.keys(APPS).filter((k) => !APPS[k].adhoc && !APPS[k].hidden && matches(APPS[k].title, k, APPS[k].web));
    if (!ids.length && searchQ()) return body.append(none("apps"));
    body.append(paged(ids, (id) => {
      const d = APPS[id];
      const t = tile(iconHTML(id), d.title, isOpen(id) ? "open" : d.custom ? new URL(d.web).hostname : "", () => {
        $("#launcher").hidden = true;
        try { isOpen(id) && !LS.to ? focusApp(id) : openApp(id, LS.to || undefined); } catch (e) { toast(e.message, true); }
      });
      t.draggable = true; t.title = "Click to open, or drag it into a panel";
      t.ondragstart = (e) => dragOut(e, "text/os-app", id);
      if (d.custom) { const e = document.createElement("span"); e.className = "edit"; e.textContent = "✎"; e.title = "Edit"; e.onclick = (ev) => { ev.stopPropagation(); LS.view = "edit"; LS.edit = customApps.find((a) => a.id === id); drawLauncher(); }; t.append(e); }
      return t;
    }, searchQ() ? null : { render: () => tile("+", "Add app", "name, url, icon", () => { LS.view = "edit"; LS.edit = null; drawLauncher(); }, "add") }));
  } else {
    const all = allLayouts();
    const keys = Object.keys(all).filter((k) => matches(all[k].name, k, ...all[k].cells.map((c) => c.app && APPS[c.app]?.title)));
    if (!keys.length && searchQ()) return body.append(none("layouts"));
    body.append(paged(keys, (key) => {
      const l = all[key];
      const t = tile("", l.name, l.cells.some((c) => c.app) ? l.cells.map((c) => c.app).filter(Boolean).join(" · ") : `${l.cols}×${l.rows}`, () => { LS.view = "build"; LS.build = { key, ...structuredClone(l) }; drawLauncher(); });
      t.draggable = true; t.title = "Click to edit, or drag it between the panels to open it";
      t.ondragstart = (e) => dragOut(e, "text/os-layout", key);
      t.querySelector("span").replaceWith(miniGrid(l));
      if (savedLayouts[key]) { const e = document.createElement("span"); e.className = "edit"; e.textContent = "✕"; e.title = "Delete"; e.onclick = (ev) => { ev.stopPropagation(); delete savedLayouts[key]; os.store.set("layouts", savedLayouts); drawLauncher(); }; t.append(e); }
      return t;
    }));
  }
}

function field(label, value, placeholder) {
  const l = document.createElement("label"); l.textContent = label;
  const i = document.createElement("input"); i.value = value || ""; i.placeholder = placeholder || ""; l.append(i);
  return [l, i];
}
function appForm() {
  const a = LS.edit || {};
  const f = document.createElement("div"); f.className = "form";
  const [ln, name] = field("Name", a.name, "Linear");
  const [lu, url] = field("Address", a.url, "https://linear.app");
  const [li, icon] = field("Icon image (optional: the site's favicon by default)", a.iconUrl, "https://…/icon.png");
  const [lb, brief] = field("“Brief me” reads… (optional)", a.brief, "my open issues and what's due this week");
  const la = document.createElement("label"); la.textContent = "Opens in";
  const area = document.createElement("select");
  area.innerHTML = [["center", "Center"], ["left", "Left rail"], ["left-bottom", "Bottom left"], ["right", "Right rail"], ["right-bottom", "Bottom right"]].map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
  area.value = a.area || "center"; la.append(area);
  const row = document.createElement("div"); row.className = "row"; row.append(li, la);
  const actions = document.createElement("div"); actions.className = "actions";
  const back = btn("Back", "", () => { LS.view = "grid"; drawLauncher(); }); back.className = "ghost";
  actions.append(back);
  if (a.id) { const del = btn("Delete", "", () => { closeApp(a.id, true); customApps = customApps.filter((x) => x.id !== a.id); os.store.set("apps", customApps); registerCustom(customApps); render(); LS.view = "grid"; drawLauncher(); }); del.className = "ghost"; actions.append(del); }
  const ok = btn(a.id ? "Save" : "Add app", "", () => {
    let u = url.value.trim(); if (!name.value.trim() || !u) return toast("Give it a name and an address", true);
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    try { new URL(u); } catch { return toast("That address isn't a url", true); }
    const rec = { id: a.id || "app-" + slugify(name.value), name: name.value.trim(), url: u, iconUrl: /^https?:\/\//.test(icon.value.trim()) ? icon.value.trim() : "", area: area.value, brief: brief.value.trim() };
    customApps = [...customApps.filter((x) => x.id !== rec.id), rec];
    os.store.set("apps", customApps); registerCustom(customApps);
    toast(`${rec.name} ${a.id ? "saved" : "added"}`);
    LS.view = "grid"; drawLauncher(); render();
  }); ok.className = "primary";
  actions.append(ok);
  const h = document.createElement("div"); h.className = "hint"; h.textContent = a.id ? "Edit your app" : "Add any web app; Glyphh can drive it with RPA like the built-in ones.";
  f.append(h, ln, lu, row, lb, actions);
  return f;
}

function layoutBuilder() {
  const l = LS.build;
  const f = document.createElement("div"); f.className = "form";
  const [ln, name] = field("Name", l.key in BUILTIN_LAYOUTS ? l.name : l.name, "My layout");
  const g = document.createElement("div"); g.className = "builder";
  g.style.gridTemplateColumns = (l.colWidths || Array(l.cols).fill(1)).map((w) => w + "fr").join(" ");
  g.style.gridTemplateRows = `repeat(${l.rows}, 1fr)`;
  const ids = Object.keys(APPS).filter((k) => !APPS[k].adhoc);
  l.cells.forEach((c) => {
    const b = document.createElement("div"); b.className = "bcell";
    b.style.gridColumn = `${c.col + 1} / span ${c.colSpan || 1}`; b.style.gridRow = `${c.row + 1} / span ${c.rowSpan || 1}`;
    const s = document.createElement("select");
    s.innerHTML = `<option value="">— empty —</option>` + ids.map((id) => `<option value="${id}">${esc(APPS[id].title)}</option>`).join("");
    s.value = c.app || ""; s.onchange = () => (c.app = s.value || null);
    b.append(s); g.append(b);
  });
  const actions = document.createElement("div"); actions.className = "actions";
  const back = btn("Back", "", () => { LS.view = "grid"; drawLauncher(); }); back.className = "ghost";
  const saveB = btn("Save layout", "", () => {
    const key = slugify(name.value || "layout");
    if (key in BUILTIN_LAYOUTS && name.value === BUILTIN_LAYOUTS[key].name) return toast("Give it a new name to save your own", true);
    savedLayouts[key] = { name: name.value || "Layout", cols: l.cols, rows: l.rows, colWidths: l.colWidths, cells: l.cells };
    os.store.set("layouts", savedLayouts); toast(`Saved ${name.value}`);
  }); saveB.className = "ghost";
  const openB = btn("Open in center", "", () => { $("#launcher").hidden = true; openLayout({ ...l, name: name.value || l.name }); }); openB.className = "primary";
  actions.append(back, saveB, openB);
  $(".pager").style.visibility = "hidden";
  f.append(ln, g, actions);
  return f;
}

// ── settings ──────────────────────────────────────────────────────────
let models = [];
function fillModels(list) {
  if (list?.length) models = list;
  const opts = [["default", "Default model"], ...models.map((m) => [m.value, m.displayName || m.value])];
  for (const sel of [$("#sel-model"), $("#set-model")]) {
    sel.innerHTML = opts.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join("");
    if (!opts.some(([v]) => v === settings.model)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(settings.model)}">${esc(settings.model)}</option>`);
    sel.value = settings.model;
  }
}
fillModels([]);
os.agent.models().then(fillModels);
$("#sel-effort").value = settings.effort;
// the voice chip: Glyphh's own ElevenLabs voice (each bot has its own chip)
fillVoices($("#sel-voice"), settings.voiceId);
$("#sel-voice").onchange = async (e) => { settings = await os.settings.set({ voiceId: e.target.value }); toast("Voice: " + e.target.selectedOptions[0].text.replace(/ voice$/, "")); };
$("#sel-model").onchange = async (e) => { settings = await os.settings.set({ model: e.target.value }); toast("Model: " + e.target.selectedOptions[0].text); };
$("#sel-effort").onchange = async (e) => { settings = await os.settings.set({ effort: e.target.value }); toast("Effort: " + e.target.value); };

async function openSettings() {
  settings = await os.settings.get();
  $("#set-eleven").value = ""; $("#set-eleven").placeholder = settings.elevenKeySet ? "•••••••• saved in your keychain (type to replace)" : "sk_…  (stored in your keychain)";
  $("#set-model").value = settings.model; $("#set-effort").value = settings.effort; $("#set-perm").value = settings.permissionMode;
  $("#set-cwd").value = settings.cwd; $("#set-claude-path").value = settings.claudePath; $("#set-tts").value = settings.ttsModel; $("#set-vad").value = settings.vadThreshold;
  const vs = $("#set-voice"); vs.innerHTML = `<option value="${esc(settings.voiceId)}">${settings.voiceId === "JBFqnCBsd6RMkjVDRZzb" ? "George (default)" : esc(settings.voiceId)}</option>`;
  if (settings.elevenKeySet) os.voice.voices().then((list) => { vs.innerHTML = list.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.labels.accent ? " · " + esc(v.labels.accent) : ""}</option>`).join(""); vs.value = settings.voiceId; }).catch((e) => toast(e.message, true));
  $("#settings").hidden = false;
}
$("#btn-settings").onclick = openSettings;
$("#set-save").onclick = async () => {
  const patch = { model: $("#set-model").value, effort: $("#set-effort").value, permissionMode: $("#set-perm").value, cwd: $("#set-cwd").value.trim(), claudePath: $("#set-claude-path").value.trim(), voiceId: $("#set-voice").value, ttsModel: $("#set-tts").value, vadThreshold: Number($("#set-vad").value) };
  const k = $("#set-eleven").value.trim(); if (k) patch.elevenKey = k;
  const cwdBefore = settings.cwd;
  settings = await os.settings.set(patch);
  voice.setThreshold(settings.vadThreshold);
  if (settings.cwd !== cwdBefore) { showFolder(); for (const id of ["files", "git", "terminal", "recents"]) inst.get(id)?.api?.setRoot?.(settings.cwd); }
  $("#sel-model").value = settings.model; $("#sel-effort").value = settings.effort;
  $("#settings").hidden = true; toast("Settings saved");
};
$$("[data-close]").forEach((b) => (b.onclick = () => (b.closest(".modal").hidden = true)));
$$(".modal").forEach((m) => m.addEventListener("pointerdown", (e) => { if (e.target === m && m.id !== "perm") m.hidden = true; }));

// ── boot ──────────────────────────────────────────────────────────────
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })), 1000);
L.center.index = 0; // every boot opens on the face
// the bots live in the left rail; once, put them there for a layout from before bots
if (!L.botsSeen) { L.botsSeen = true; if (!isOpen("bots")) { L.areas.left.apps.unshift("bots"); L.areas.left.active = "bots"; } }
for (const a of RAIL_AREAS) L.areas[a].apps = L.areas[a].apps.filter((id) => APPS[id]); // a deleted bot's panel
render();
os.agent.connections().then((list) => { setConnDots(list); if (list.length) setStatus("ok", `ready · ${list.filter((s) => s.status === "connected").length} connections`); }).catch(() => {});
if (!settings.elevenKeySet) setTimeout(() => toast("Add your ElevenLabs key in Settings (top right) to talk"), 1200);
caption("Hello. I'm Glyphh.");

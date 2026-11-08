// Glyphh OS — the renderer: layout manager, center carousel, composer, voice,
// and the agent's hands on the UI (os:cmd).
import { createFace } from "./face.js";
import { createVoice } from "./voice.js";
import { APPS, mountApp, webAppFor } from "./apps.js";

const os = window.os;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const AREAS = ["left", "center", "right"];

let settings = await os.settings.get();

// ── toasts ────────────────────────────────────────────────────────────
function toast(msg, bad) {
  const t = Object.assign(document.createElement("div"), { className: "toast" + (bad ? " bad" : ""), textContent: msg });
  $("#toasts").append(t); setTimeout(() => t.remove(), 3800);
  return "shown";
}

// ── layout ────────────────────────────────────────────────────────────
const DEFAULT_LAYOUT = {
  areas: { left: { apps: ["files", "git", "email"], active: "files" }, center: { apps: [], index: 0 }, right: { apps: ["terminal", "browser", "calendar"], active: "terminal" } },
  sizes: { left: 380, right: 440 },
  urls: {},
};
const DEFAULT_DIPS = {
  dev: { areas: { left: { apps: ["files", "git"], active: "files" }, center: { apps: ["editor"], index: 1 }, right: { apps: ["terminal", "browser"], active: "terminal" } } },
  social: { areas: { left: { apps: ["x", "instagram"], active: "x" }, center: { apps: ["youtube"], index: 1 }, right: { apps: ["slack"], active: "slack" } } },
  comms: { areas: { left: { apps: ["email"], active: "email" }, center: { apps: [], index: 0 }, right: { apps: ["calendar", "slack", "connections"], active: "calendar" } } },
  focus: { areas: { left: { apps: [], active: null }, center: { apps: [], index: 0 }, right: { apps: [], active: null } }, sizes: { left: 0, right: 0 } },
};

let L = (await os.layout.get()) || structuredClone(DEFAULT_LAYOUT);
let dips = (await os.dips.get()) || structuredClone(DEFAULT_DIPS);
const inst = new Map(); // app id → { el, api, area }

const areaEl = (a) => $(`.area[data-area="${a}"]`);
let saveTimer;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {
  for (const [id, i] of inst) if (i.api?.url) L.urls[id] = i.api.url();
  os.layout.set(L);
}, 400); };

function ctxFor(id) {
  return {
    cwd: settings.cwd, url: L.urls?.[id], toast,
    ask: (t) => send(t),
    open: (app, area, url) => openApp(app, area, url),
    openFile: (p) => openFile(p),
    changed: save,
    connections: setConnDots,
  };
}

function ensureInstance(id) {
  if (inst.has(id)) return inst.get(id);
  if (!APPS[id]) throw new Error(`no app "${id}" — apps: ${Object.keys(APPS).filter((k) => !APPS[k].adhoc).join(", ")}`);
  const el = document.createElement("div");
  el.className = "panel"; el.dataset.app = id;
  const rec = { el, api: null, area: null };
  inst.set(id, rec);
  return rec;
}

function place(id, area) {
  const rec = ensureInstance(id);
  const wv = rec.el.querySelector("webview");
  if (wv && rec.api?.url) { try { wv.setAttribute("src", rec.api.url()); } catch { /* not loaded */ } }
  if (area === "center") {
    const slide = document.createElement("div");
    slide.className = "slide"; slide.dataset.app = id;
    const inner = document.createElement("div"); inner.className = "slide-inner";
    slide.append(inner); inner.append(rec.el);
    rec.el.classList.add("active");
    $(".track").append(slide);
  } else {
    areaEl(area).querySelector(".area-body").append(rec.el);
  }
  rec.area = area;
  if (!rec.api) {
    try { rec.api = mountApp(id, rec.el, ctxFor(id)) || {}; } catch (e) { toast(e.message, true); rec.api = {}; }
  }
  requestAnimationFrame(() => rec.api.layout?.());
}

function render() {
  // tabs
  for (const a of AREAS) {
    const nav = areaEl(a).querySelector(".tabs");
    nav.innerHTML = "";
    const st = L.areas[a];
    if (a === "center") nav.append(tabChip("face", "center", st.index === 0));
    st.apps.forEach((id, i) => nav.append(tabChip(id, a, a === "center" ? st.index === i + 1 : st.active === id)));
    if (a !== "center") {
      areaEl(a).classList.toggle("empty", !st.apps.length);
      for (const id of st.apps) inst.get(id)?.el.classList.toggle("active", id === st.active);
    }
  }
  // carousel
  const slides = $$(".track > .slide");
  const order = ["face", ...L.areas.center.apps];
  for (const s of slides) s.style.order = String(order.indexOf(s.dataset.app));
  L.areas.center.index = Math.max(0, Math.min(L.areas.center.index, order.length - 1));
  $(".track").style.transform = `translateX(${-L.areas.center.index * 100}%)`;
  const dots = $(".dots"); dots.innerHTML = "";
  order.forEach((id, i) => { const d = document.createElement("i"); d.className = i === L.areas.center.index ? "on" : ""; d.title = id === "face" ? "Glyphh" : APPS[id]?.title; d.onclick = () => go(i); dots.append(d); });
  $("#composer").classList.toggle("over-app", L.areas.center.index > 0);
  // sizes
  $("#stage").style.setProperty("--left", (L.areas.left.apps.length ? L.sizes.left : 0) + "px");
  $("#stage").style.setProperty("--right", (L.areas.right.apps.length ? L.sizes.right : 0) + "px");
  for (const a of ["left", "right"]) areaEl(a).style.visibility = L.sizes[a] > 30 && L.areas[a].apps.length ? "" : "hidden";
  for (const [, r] of inst) requestAnimationFrame(() => r.api?.layout?.());
  save();
}

function tabChip(id, area, active) {
  const t = document.createElement("div");
  t.className = "tab" + (active ? " active" : "");
  t.draggable = id !== "face";
  const def = id === "face" ? { icon: "◈", title: "Glyphh" } : APPS[id];
  t.innerHTML = `<span>${def?.icon || "◌"}</span><span>${def?.title || id}</span>`;
  if (id !== "face") { const x = document.createElement("span"); x.className = "x"; x.textContent = "✕"; x.onclick = (e) => { e.stopPropagation(); closeApp(id); }; t.append(x); }
  t.onclick = () => focusApp(id);
  t.ondragstart = (e) => { e.dataTransfer.setData("text/os-app", id); e.dataTransfer.effectAllowed = "move"; };
  return t;
}

function areaOf(id) { return AREAS.find((a) => L.areas[a].apps.includes(id)); }

function openApp(id, area, url) {
  if (/^https?:\/\/|^[\w-]+\.[a-z]{2,}(\/|$)/i.test(id)) { url = url || id; id = webAppFor(id); }
  if (!APPS[id]) throw new Error(`no app "${id}" — apps: ${Object.keys(APPS).filter((k) => !APPS[k].adhoc).join(", ")}`);
  const cur = areaOf(id);
  if (cur && (!area || area === cur)) { focusApp(id); if (url) inst.get(id)?.api?.goto?.(url); return `${id} is open in ${cur}`; }
  if (cur) { const r = moveApp(id, area); if (url) setTimeout(() => inst.get(id)?.api?.goto?.(url), 300); return r; }
  area = area || (APPS[id].group === "social" || APPS[id].web ? "center" : "right");
  if (url) L.urls[id] = url;
  L.areas[area].apps.push(id);
  if (area === "center") L.areas.center.index = L.areas.center.apps.length; else L.areas[area].active = id;
  if (area === "center" && L.sizes) { /* nothing */ }
  if (area !== "center" && L.sizes[area] < 200) L.sizes[area] = area === "left" ? 380 : 440;
  place(id, area);
  render();
  return `opened ${id} in ${area}`;
}

function closeApp(id) {
  const a = areaOf(id); if (!a) return `${id} is not open`;
  const st = L.areas[a];
  st.apps = st.apps.filter((x) => x !== id);
  if (a !== "center" && st.active === id) st.active = st.apps[0] || null;
  if (a === "center") L.areas.center.index = Math.min(L.areas.center.index, st.apps.length);
  const rec = inst.get(id);
  rec?.api?.unmount?.();
  rec?.el.closest(".slide")?.remove(); rec?.el.remove();
  inst.delete(id);
  delete L.urls[id];
  render();
  return `closed ${id}`;
}

function moveApp(id, area) {
  const from = areaOf(id); if (!from) return openApp(id, area);
  if (from === area) return focusApp(id);
  const st = L.areas[from];
  st.apps = st.apps.filter((x) => x !== id);
  if (from !== "center" && st.active === id) st.active = st.apps[0] || null;
  const rec = inst.get(id);
  const oldSlide = rec.el.closest(".slide");
  rec.el.classList.remove("active");
  L.areas[area].apps.push(id);
  if (area === "center") L.areas.center.index = L.areas.center.apps.length; else { L.areas[area].active = id; if (L.sizes[area] < 200) L.sizes[area] = area === "left" ? 380 : 440; }
  place(id, area);
  oldSlide?.remove();
  render();
  return `moved ${id} to ${area}`;
}

function focusApp(id) {
  if (id === "face") { go(0); return "showing the face"; }
  const a = areaOf(id); if (!a) return openApp(id);
  if (a === "center") go(L.areas.center.apps.indexOf(id) + 1);
  else { L.areas[a].active = id; render(); }
  inst.get(id)?.api?.focus?.();
  return `focused ${id}`;
}

function go(i) { L.areas.center.index = i; render(); }
const step = (d) => go(Math.max(0, Math.min(L.areas.center.apps.length, L.areas.center.index + d)));

async function openFile(p, line) {
  if (!areaOf("editor")) openApp("editor", "center"); else focusApp("editor");
  return inst.get("editor").api.openFile(p, line);
}

function applyLayout(next) {
  for (const id of [...inst.keys()]) closeApp(id);
  L = { ...structuredClone(DEFAULT_LAYOUT), ...structuredClone(next), urls: { ...(next.urls || {}) } };
  L.sizes = { ...DEFAULT_LAYOUT.sizes, ...(next.sizes || {}) };
  for (const a of AREAS) for (const id of L.areas[a].apps) { try { place(id, a); } catch (e) { toast(e.message, true); } }
  for (const a of AREAS) L.areas[a].apps = L.areas[a].apps.filter((id) => inst.has(id));
  render();
}

function dip(name, saveIt) {
  name = (name || "").trim().toLowerCase();
  if (!name || name === "list") return "dips: " + Object.keys(dips).join(", ");
  if (saveIt) {
    for (const [id, i] of inst) if (i.api?.url) L.urls[id] = i.api.url();
    dips[name] = structuredClone({ areas: L.areas, sizes: L.sizes, urls: L.urls });
    os.dips.set(dips); return `saved dip "${name}"`;
  }
  if (!dips[name]) return `no dip "${name}" — dips: ${Object.keys(dips).join(", ")}`;
  applyLayout(dips[name]);
  return `dipped into ${name}`;
}

// ── drag between areas ────────────────────────────────────────────────
for (const a of AREAS) {
  const el = areaEl(a);
  el.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/os-app")) { e.preventDefault(); el.classList.add("drop"); } });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("drop"); const id = e.dataTransfer.getData("text/os-app"); if (id) moveApp(id, a); });
}
// webviews eat drag events; let the drag pass over them
document.addEventListener("dragstart", () => document.body.classList.add("dragging-tab"));
document.addEventListener("dragend", () => { document.body.classList.remove("dragging-tab"); $$(".area.drop").forEach((x) => x.classList.remove("drop")); });
const dragStyle = document.createElement("style"); dragStyle.textContent = "body.dragging-tab webview, body.splitting webview { pointer-events: none; }"; document.head.append(dragStyle);

// ── splitters ─────────────────────────────────────────────────────────
for (const s of $$(".splitter")) {
  s.addEventListener("pointerdown", (e) => {
    const side = s.dataset.split; const x0 = e.clientX; const w0 = L.areas[side].apps.length ? L.sizes[side] : 0;
    s.setPointerCapture(e.pointerId); s.classList.add("drag"); document.body.classList.add("splitting");
    const move = (ev) => {
      const dx = ev.clientX - x0;
      L.sizes[side] = Math.max(0, Math.min(innerWidth * 0.6, w0 + (side === "left" ? dx : -dx)));
      if (L.sizes[side] < 120) L.sizes[side] = 0;
      render();
    };
    const up = () => { s.classList.remove("drag"); document.body.classList.remove("splitting"); s.removeEventListener("pointermove", move); s.removeEventListener("pointerup", up); };
    s.addEventListener("pointermove", move); s.addEventListener("pointerup", up);
  });
  s.addEventListener("dblclick", () => { const side = s.dataset.split; L.sizes[side] = L.sizes[side] ? 0 : side === "left" ? 380 : 440; render(); });
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
    const x0 = e.clientX, w = $(".carousel").clientWidth, base = -L.areas.center.index * w;
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
  if (e.metaKey && e.key.toLowerCase() === "k") { e.preventDefault(); $("#input").focus(); }
  if (e.key === "Escape") { $$(".modal").forEach((m) => { if (m.id !== "perm") m.hidden = true; }); if (voice.speaking) voice.stopSpeaking(); }
});

// ── face + voice ──────────────────────────────────────────────────────
const face = createFace($("#face"));
let busy = false, recording = false, continuous = false, speakReplies = settings.speakReplies;
const updateFace = () => face.setState(recording || (continuous && !voice.speaking && !busy) ? "listening" : voice.speaking ? "speaking" : busy ? "thinking" : "idle");
const voice = createVoice({
  onMouth: (v) => face.setMouth(v),
  onMic: (v) => { face.setMic(v); $("#mic-level i").style.width = v * 100 + "%"; },
  onUtterance: (t) => { send(t); },
  onSpeaking: () => updateFace(),
  onError: (m) => toast(m, true),
});
voice.setThreshold(settings.vadThreshold);
setInterval(() => { if (recording !== voice.recording) { recording = voice.recording; updateFace(); } }, 100);

// ── composer ──────────────────────────────────────────────────────────
const input = $("#input"), log = $("#log");
const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, innerHeight * 0.4) + "px"; };
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
$("#btn-send").onclick = submit;
$("#btn-log").onclick = () => log.classList.toggle("collapsed");
$("#btn-stop").onclick = () => { os.agent.interrupt(); voice.stopSpeaking(); };
$("#btn-new").onclick = () => { os.agent.newChat(); log.innerHTML = ""; caption(""); toast("New conversation"); };

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

/** .dip / .open / .close / .move run here; everything else goes to Claude. */
function localCommand(t) {
  const m = t.match(/^[./](dip|open|close|move|face|new|settings)\b\s*(.*)$/i);
  if (!m) return null;
  const [, cmd, rest] = m; const a = rest.trim().split(/\s+/).filter(Boolean);
  switch (cmd.toLowerCase()) {
    case "dip": return a[0] === "save" ? dip(a[1] || "mine", true) : a[0] === "delete" ? (delete dips[a[1]], os.dips.set(dips), `deleted ${a[1]}`) : dip(a[0] || "list");
    case "open": return openApp(a[0], AREAS.includes(a[1]) ? a[1] : undefined, a.find((x) => /^https?:|\./.test(x) && x !== a[0]));
    case "close": return closeApp(a[0]);
    case "move": return moveApp(a[0], a[1]);
    case "face": return focusApp("face");
    case "new": $("#btn-new").click(); return "new conversation";
    case "settings": openSettings(); return "settings";
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
  busy = true; botMsg = null; botText = ""; setStatus("busy", "thinking…"); updateFace();
  os.agent.send(t);
}

function setStatus(kind, text) { $("#agent-dot").className = "dot " + kind; $("#agent-status").textContent = text; $("#btn-stop").hidden = kind !== "busy"; }

os.agent.onEvent((e) => {
  switch (e.type) {
    case "init": setStatus("ok", `${e.model} · ${e.servers.length} connections`); setConnDots(e.servers); break;
    case "models": fillModels(e.models); break;
    case "turn": botMsg = null; botText = ""; break;
    case "delta":
      if (!botMsg) botMsg = addMsg("bot", "");
      botText += e.text; botMsg.textContent = botText; log.scrollTop = log.scrollHeight;
      caption(botText.split(/(?<=[.!?])\s+/).slice(-2).join(" "));
      if (speakReplies && settings.elevenKeySet) voice.feed(e.text);
      break;
    case "tool": {
      const short = e.name.replace(/^mcp__os__/, "").replace(/^mcp__/, "");
      const arg = e.input && (e.input.app || e.input.command || e.input.file_path || e.input.path || e.input.url || e.input.pattern || e.input.query || e.input.description || "");
      addMsg("tool", `${short}${arg ? " · " + String(arg).slice(0, 120) : ""}`);
      if (speakReplies) voice.flush();
      botMsg = null; botText = "";
      setStatus("busy", short + "…");
      break;
    }
    case "done":
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
  if (speakReplies) voice.feed(`I need your OK to use ${name.replace(/^mcp__\w+__/, "").replace(/_/g, " ")}. `), voice.flush();
  const done = (ok) => { m.hidden = true; os.agent.answerPermission(id, ok); $("#perm-yes").onclick = $("#perm-no").onclick = null; };
  $("#perm-yes").onclick = () => done(true);
  $("#perm-no").onclick = () => done(false);
});

// ── the agent's hands ─────────────────────────────────────────────────
const handlers = {
  state: () => ({
    areas: Object.fromEntries(AREAS.map((a) => [a, { apps: L.areas[a].apps, ...(a === "center" ? { slide: ["face", ...L.areas.center.apps][L.areas.center.index] } : { active: L.areas[a].active }) }])),
    available: Object.keys(APPS).filter((k) => !APPS[k].adhoc),
    dips: Object.keys(dips),
    editor: inst.get("editor")?.api?.files?.() || [],
  }),
  open: (a) => openApp(a.app, a.area, a.url),
  close: (a) => closeApp(a.app),
  move: (a) => moveApp(a.app, a.area),
  focus: (a) => focusApp(a.app),
  dip: (a) => dip(a.name, a.save),
  terminal: async () => { if (!areaOf("terminal")) openApp("terminal", "right"); else focusApp("terminal"); await new Promise((r) => setTimeout(r, 600)); return inst.get("terminal").api.termId; },
  edit: (a) => openFile(a.path, a.line),
  screenshot: () => os.screenshot(),
  toast: (a) => toast(a.message),
};
os.onCmd(async ({ id, cmd, args }) => {
  try { os.cmdResult({ id, ok: true, value: await handlers[cmd](args || {}) }); }
  catch (e) { os.cmdResult({ id, ok: false, error: e.message }); }
});
os.onOpenUrl((url) => openApp("browser", areaOf("browser"), url));

// ── launcher ──────────────────────────────────────────────────────────
$("#btn-apps").onclick = () => {
  const g = $("#launcher .grid"); g.innerHTML = "";
  for (const [id, def] of Object.entries(APPS)) {
    if (def.adhoc) continue;
    const b = document.createElement("button"); b.innerHTML = `<span>${def.icon}</span>${def.title}`;
    b.onclick = () => { $("#launcher").hidden = true; openApp(id); };
    g.append(b);
  }
  $("#launcher").hidden = false;
};

// ── settings ──────────────────────────────────────────────────────────
let models = [];
function fillModels(list) {
  if (list?.length) models = list;
  const opts = [["default", "Default model"], ...models.map((m) => [m.value, m.displayName || m.value])];
  for (const sel of [$("#sel-model"), $("#set-model")]) {
    sel.innerHTML = opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
    if (!opts.some(([v]) => v === settings.model)) sel.insertAdjacentHTML("beforeend", `<option value="${settings.model}">${settings.model}</option>`);
    sel.value = settings.model;
  }
}
fillModels([]);
os.agent.models().then(fillModels);
$("#sel-effort").value = settings.effort;
$("#sel-model").onchange = async (e) => { settings = await os.settings.set({ model: e.target.value }); toast("Model: " + e.target.selectedOptions[0].text); };
$("#sel-effort").onchange = async (e) => { settings = await os.settings.set({ effort: e.target.value }); toast("Effort: " + e.target.value); };

async function openSettings() {
  settings = await os.settings.get();
  $("#set-eleven").value = ""; $("#set-eleven").placeholder = settings.elevenKeySet ? "•••••••• saved in your keychain (type to replace)" : "sk_…  (stored in your keychain)";
  $("#set-model").value = settings.model; $("#set-effort").value = settings.effort; $("#set-perm").value = settings.permissionMode;
  $("#set-cwd").value = settings.cwd; $("#set-claude-path").value = settings.claudePath; $("#set-tts").value = settings.ttsModel; $("#set-vad").value = settings.vadThreshold;
  const vs = $("#set-voice"); vs.innerHTML = `<option value="${settings.voiceId}">${settings.voiceId === "JBFqnCBsd6RMkjVDRZzb" ? "George (default)" : settings.voiceId}</option>`;
  if (settings.elevenKeySet) os.voice.voices().then((list) => { vs.innerHTML = list.map((v) => `<option value="${v.id}">${v.name}${v.labels.accent ? " · " + v.labels.accent : ""}</option>`).join(""); vs.value = settings.voiceId; }).catch((e) => toast(e.message, true));
  $("#settings").hidden = false;
}
$("#btn-settings").onclick = openSettings;
$("#set-save").onclick = async () => {
  const patch = { model: $("#set-model").value, effort: $("#set-effort").value, permissionMode: $("#set-perm").value, cwd: $("#set-cwd").value.trim(), claudePath: $("#set-claude-path").value.trim(), voiceId: $("#set-voice").value, ttsModel: $("#set-tts").value, vadThreshold: Number($("#set-vad").value) };
  const k = $("#set-eleven").value.trim(); if (k) patch.elevenKey = k;
  settings = await os.settings.set(patch);
  voice.setThreshold(settings.vadThreshold);
  $("#sel-model").value = settings.model; $("#sel-effort").value = settings.effort;
  $("#settings").hidden = true; toast("Settings saved");
};
$$("[data-close]").forEach((b) => (b.onclick = () => (b.closest(".modal").hidden = true)));
$$(".modal").forEach((m) => m.addEventListener("pointerdown", (e) => { if (e.target === m && m.id !== "perm") m.hidden = true; }));

// ── boot ──────────────────────────────────────────────────────────────
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })), 1000);
applyLayout(L);
go(0); // every boot opens on the face
os.agent.connections().then((list) => { setConnDots(list); if (list.length) setStatus("ok", `ready · ${list.filter((s) => s.status === "connected").length} connections`); }).catch(() => {});
if (!settings.elevenKeySet) setTimeout(() => toast("Add your ElevenLabs key in Settings (top right) to talk"), 1200);
caption("Hello. I'm Glyphh.");

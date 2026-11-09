// bots — the renderer side of the user's Glyphh bots and their swarm:
//   Bots   a searchable grid of the bots (each its cat and name), and the bot template form
//   bot-*  one bot's session: its 3D cat, its conversation, the caret input, and the same chips
//          as the main composer (model, effort, voice)
//   Swarm  the shared stream every bot in a working session talks into, orchestrated by
//          Glyphh; with voices on, each speaks in turn in its own ElevenLabs voice
//   Plan   the swarm's plan: each item, its bot, its status
import { APPS } from "./apps.js";
import { createFace } from "./face.js";
import { PRESETS, catSVG } from "./character.js";

const os = window.os;
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; else if (v !== undefined && v !== false && v !== null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const LOOKS = Object.entries(PRESETS).map(([k, v]) => [k, v.name]);
const lookOf = (b) => PRESETS[b?.look] || PRESETS.glyphh;
export const botSVG = (b) => catSVG(lookOf(b));

let bots = [], swarm = null, voices = null, ctx = null;
const busy = new Set(), talking = new Set();
const faces = new Map(); // bot id → its panel's 3D face
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };
const botById = (id) => bots.find((b) => b.id === id);

export function voiceList() {
  if (!voices) voices = os.voice.voices().catch(() => []);
  return voices;
}
/** Fill a <select> with the ElevenLabs voices, `value` chosen. */
export async function fillVoices(sel, value) {
  sel.innerHTML = `<option value="${esc(value)}">voice…</option>`;
  const list = await voiceList();
  if (!list.length) { sel.innerHTML = `<option value="${esc(value)}">voice (add ElevenLabs key)</option>`; return; }
  sel.innerHTML = list.map((v) => `<option value="${esc(v.id)}">${esc(v.name)} voice</option>`).join("");
  if (!list.some((v) => v.id === value)) sel.insertAdjacentHTML("afterbegin", `<option value="${esc(value)}">custom voice</option>`);
  sel.value = value;
}

const P = {
  swarm: "M5 6.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM15 6.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM10 16.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM8.5 8l2.5 6.6M15.5 8 13 14.6M9 6.5h6",
  plan: "M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4.5 18h1",
};
const line = (d) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const catIco = (b) => botSVG(b).replace('class="cat-svg"', 'class="ico cat-svg"');

function registerApps() {
  for (const k of Object.keys(APPS)) if (APPS[k].bot) delete APPS[k];
  APPS.bots = { title: "Bots", group: "bots", iconHTML: catIco(null), mount: mountBots, area: "left" };
  APPS.swarm = { title: "Swarm", group: "bots", iconHTML: line(P.swarm), mount: mountSwarm, area: "center" };
  APPS.plan = { title: "Plan", group: "bots", iconHTML: line(P.plan), mount: mountPlan, area: "right" };
  for (const b of bots) APPS["bot-" + b.id] = { title: b.name, bot: b.id, iconHTML: catIco(b), mount: (el) => mountBot(el, b.id), hidden: true };
}

/** Wire the bots into the OS. `c`: { toast, open(app, area), whereIs(app), voice, settings(), models(), render() }. */
export async function initBots(c) {
  ctx = c;
  bots = await os.bots.list();
  swarm = await os.swarm.get();
  registerApps();
  os.bots.onList((list) => { bots = list; registerApps(); changed(); ctx.render(); });
  os.bots.onEvent((e) => {
    if (e.type === "user" || e.type === "turn") busy.add(e.bot);
    if (e.type === "done" || e.type === "error") busy.delete(e.bot);
    changed();
  });
  os.swarm.onEvent((e) => {
    if (e.type === "state") { swarm = e.swarm; tapeForSwarm(); }
    if (e.type === "msg" && swarm) { swarm.stream.push(e.msg); speakMsg(e.msg); }
    changed();
  });
  tapeForSwarm();
  window.__saveRecording = saveTape;
  return {
    openBot,
    onWho: (who) => { talking.clear(); if (who) talking.add(who); changed(); },
    mouth: (who, v) => faces.get(who)?.setMouth(v),
    swarmVoicesOn: () => swarmVoices && swarm?.status === "running",
    svg: botSVG,
  };
}

function openBot(id, area) {
  const where = ctx.whereIs("bots")?.area || "left";
  return ctx.open("bot-" + id, area || (where.startsWith("left") ? "right" : "left"));
}

// ── recording: every swarm's conversation is taped, saved next to its repo when it ends ──
let recordOn = (() => { try { return localStorage.getItem("glyphh-os-swarm-record") !== "off"; } catch { return true; } })();
let tapeName = null;
function tapeForSwarm() {
  if (swarm?.status === "running" && recordOn && !ctx.voice.taping) { tapeName = swarm.id; ctx.voice.startTape(); changed(); }
  else if (swarm?.status !== "running" && ctx.voice.taping) saveTape();
}
async function saveTape() {
  if (!ctx.voice.taping) return null;
  // let the last lines finish (up to a minute) before cutting the tape
  for (let i = 0; i < 120 && ctx.voice.speaking; i++) await new Promise((r) => setTimeout(r, 500));
  const bytes = await ctx.voice.stopTape();
  changed();
  if (!bytes) return null;
  const file = await os.recording.save(tapeName || "swarm", bytes);
  ctx.toast("Recording saved: " + file.split("/").slice(-2).join("/"));
  return file;
}

// ── speaking ──────────────────────────────────────────────────────────
let swarmVoices = (() => { try { return localStorage.getItem("glyphh-os-swarm-voices") !== "off"; } catch { return true; } })();
function speakMsg(m) {
  if (!swarmVoices || m.from === "you" || !ctx.settings().elevenKeySet) return;
  const b = botById(m.from);
  // spoken, a line is a turn in a conversation: the first two sentences, never a read-out task spec
  const sentences = m.text.replace(/`/g, "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g) || [m.text];
  let line = sentences.slice(0, 2).join("").trim();
  if (line.length > 240) line = line.slice(0, 240).replace(/\s\S*$/, "") + "…";
  ctx.voice.say(line.replace(/^([\w ]{1,20}): /, "$1, "), b ? b.voiceId : ctx.settings().voiceId, b ? b.id : undefined);
}

// ── Bots: the grid, and the bot template ──────────────────────────────
function mountBots(el) {
  const search = h("input", { placeholder: "Search bots", spellcheck: "false" });
  const grid = h("div", { class: "scroll bot-grid" });
  let editing = null; // a bot being made or changed
  const draw = () => {
    grid.innerHTML = "";
    if (editing) return grid.append(botForm(editing, () => { editing = null; draw(); }));
    const q = search.value.trim().toLowerCase();
    for (const b of bots.filter((x) => !q || `${x.name} ${x.role} ${x.personality}`.toLowerCase().includes(q))) {
      const t = h("div", { class: "bot-tile" + (busy.has(b.id) ? " busy" : "") + (talking.has(b.id) ? " talking" : ""), title: `${b.name} · ${b.role}`, onclick: () => openBot(b.id) },
        h("div", { class: "cat", html: botSVG(b) }), h("div", { class: "n" }, b.name), h("small", {}, b.role));
      t.append(h("span", { class: "edit", title: "Edit", onclick: (e) => { e.stopPropagation(); editing = { ...b }; draw(); } }, "✎"));
      grid.append(t);
    }
    grid.append(h("div", { class: "bot-tile add", onclick: () => { editing = { name: "", role: "", look: "glyphh", personality: "", instructions: "", voiceId: ctx.settings().voiceId, model: "default", effort: "medium" }; draw(); } },
      h("div", { class: "cat plus" }, "+"), h("div", { class: "n" }, "New bot"), h("small", {}, "from the template")));
  };
  search.addEventListener("input", draw);
  el.append(h("div", { class: "toolbar" }, search,
    h("button", { class: "tb", title: "Open the swarm", onclick: () => ctx.open("swarm", "center") }, "Swarm")), grid);
  listeners.add(draw); draw();
  return { unmount: () => listeners.delete(draw) };
}

function botForm(b, done) {
  const f = h("div", { class: "form bot-form" });
  const prev = h("div", { class: "cat big", html: botSVG(b) });
  const inp = (label, key, ph, area) => {
    const i = h(area ? "textarea" : "input", { placeholder: ph || "", rows: area ? 3 : undefined }); i.value = b[key] || "";
    i.addEventListener("input", () => (b[key] = i.value));
    return h("label", {}, label, i);
  };
  const look = h("select", {}, ...LOOKS.map(([k, n]) => h("option", { value: k }, n)));
  look.value = b.look || "glyphh"; look.onchange = () => { b.look = look.value; prev.innerHTML = botSVG(b); };
  const voice = h("select"); fillVoices(voice, b.voiceId); voice.onchange = () => (b.voiceId = voice.value);
  const model = h("select"); fillModelSel(model, b.model); model.onchange = () => (b.model = model.value);
  const effort = h("select", {}, ...["low", "medium", "high", "xhigh", "max"].map((v) => h("option", { value: v }, v)));
  effort.value = b.effort || "medium"; effort.onchange = () => (b.effort = effort.value);
  const actions = h("div", { class: "actions" }, h("button", { class: "ghost", onclick: done }, "Back"));
  if (b.id) actions.append(h("button", { class: "ghost", onclick: async () => { if (!confirm(`Delete ${b.name}?`)) return; await os.bots.remove(b.id); ctx.toast(`Deleted ${b.name}`); done(); } }, "Delete"));
  actions.append(h("button", { class: "primary", onclick: async () => {
    if (!b.name?.trim()) return ctx.toast("Give your bot a name", true);
    try { b.id ? await os.bots.update(b.id, b) : await os.bots.create(b); ctx.toast(`${b.name} ${b.id ? "saved" : "made"}`); done(); } catch (e) { ctx.toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
  } }, b.id ? "Save" : "Make bot"));
  f.append(h("div", { class: "bot-form-head" }, prev, h("div", { class: "hint" }, "A Glyphh bot: a name, a cat, a role, a personality, its standing instructions and a voice. It remembers through your glyphh and learns its calls with Ada gates.")),
    h("div", { class: "row" }, inp("Name", "name", "Spiky"), inp("Role", "role", "Builder")),
    h("div", { class: "row" }, h("label", {}, "Cat", look), h("label", {}, "Voice", voice)),
    inp("Personality", "personality", "Quick, blunt, ships first…", true),
    inp("Instructions", "instructions", "What it always does, what it never does…", true),
    h("div", { class: "row" }, h("label", {}, "Model", model), h("label", {}, "Effort", effort)), actions);
  return f;
}

function fillModelSel(sel, value) {
  const list = ctx.models();
  sel.innerHTML = `<option value="default">default model</option>` + list.map((m) => `<option value="${esc(m.value)}">${esc(m.displayName || m.value)}</option>`).join("");
  if (value && ![...sel.options].some((o) => o.value === value)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(value)}">${esc(value)}</option>`);
  sel.value = value || "default";
}

// ── one bot's session: the main chat, small ───────────────────────────
function mountBot(el, id) {
  const b = () => botById(id) || { id, name: id };
  const canvas = h("canvas");
  const caption = h("div", { class: "bot-caption" });
  const stage = h("div", { class: "bot-stage" }, canvas, caption);
  const log = h("div", { class: "scroll bot-log" });
  const input = h("textarea", { rows: 1, placeholder: `Talk to ${b().name}…` });
  const sendB = h("button", { class: "send", title: "Send" }, "↑");
  const speak = h("button", { class: "icon-btn toggle on", title: "Speak replies in its voice" }, "🔊");
  const model = h("select", { title: "Model" }), effort = h("select", { title: "Effort" }, ...["low", "medium", "high", "xhigh", "max"].map((v) => h("option", { value: v }, v + " effort")));
  const voice = h("select", { title: "Voice" });
  const head = h("div", { class: "toolbar bot-head" });
  const drawHead = () => {
    head.innerHTML = "";
    head.append(h("span", { class: "who", html: `${catIco(b())}<b>${esc(b().name)}</b><small>${esc(b().role || "")}</small>` }),
      h("span", { style: "flex:1" }),
      h("button", { class: "tb", title: "New conversation", onclick: () => { os.bots.newChat(id); log.innerHTML = ""; } }, "new"),
      h("button", { class: "tb", title: "Open the swarm", onclick: () => ctx.open("swarm", "center") }, "swarm"));
  };
  drawHead();
  const chips = () => { fillModelSel(model, b().model); effort.value = b().effort || "medium"; fillVoices(voice, b().voiceId); };
  chips();
  model.onchange = () => os.bots.update(id, { model: model.value });
  effort.onchange = () => os.bots.update(id, { effort: effort.value });
  voice.onchange = () => os.bots.update(id, { voiceId: voice.value });
  speak.onclick = () => speak.classList.toggle("on");
  el.append(head, stage, log, h("div", { class: "bot-composer" }, h("div", { class: "bar" }, input, speak, sendB), h("div", { class: "chips" }, model, effort, voice)));

  const face = createFace(canvas, { compact: true });
  face.setCharacter({ ...lookOf(b()) });
  faces.set(id, face);

  const add = (cls, t) => { const m = h("div", { class: "msg " + cls }, t); log.append(m); log.scrollTop = log.scrollHeight; return m; };
  let cur = null, curText = "", isBusy = false;
  const setBusy = (v) => { isBusy = v; sendB.textContent = v ? "■" : "↑"; sendB.classList.toggle("stop", v); face.setState(talking.has(id) ? "speaking" : v ? "thinking" : "idle"); };
  const submit = () => { const t = input.value.trim(); if (!t) return; input.value = ""; os.bots.send(id, t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  sendB.onclick = () => (isBusy && !input.value.trim() ? os.bots.interrupt(id) : submit());
  const off = os.bots.onEvent((e) => {
    if (e.bot !== id) return;
    if (e.type === "user") { add("user", e.text); setBusy(true); cur = null; curText = ""; }
    else if (e.type === "turn") { cur = null; curText = ""; setBusy(true); }
    else if (e.type === "delta") { if (!cur) cur = add("bot", ""); curText += e.text; cur.textContent = curText; log.scrollTop = log.scrollHeight; caption.textContent = curText.split(/(?<=[.!?])\s+/).slice(-1)[0].slice(-140); }
    else if (e.type === "tool") { add("tool", e.name.replace(/^mcp__\w+__/, "") + (e.input?.command ? " · " + String(e.input.command).slice(0, 90) : e.input?.file_path ? " · " + e.input.file_path : "")); cur = null; curText = ""; }
    else if (e.type === "done") {
      setBusy(false);
      if (!e.ok && e.error) add("err", e.error);
      // in a swarm with voices on, the swarm speaks it in turn; otherwise this panel does
      const inSwarm = swarm?.status === "running" && swarm.bots.some((m) => m.id === id);
      if (e.ok && e.text && speak.classList.contains("on") && !(inSwarm && swarmVoices) && ctx.settings().elevenKeySet) ctx.voice.say(e.text, b().voiceId, id);
    } else if (e.type === "error") { setBusy(false); add("err", e.text); }
  });
  const sync = () => { drawHead(); face.setState(talking.has(id) ? "speaking" : isBusy ? "thinking" : "idle"); };
  listeners.add(sync);
  let lastLook = b().look;
  const offList = os.bots.onList(() => { if (b().look !== lastLook) { lastLook = b().look; face.setCharacter({ ...lookOf(b()) }); } chips(); });
  os.bots.busy(id).then(setBusy);
  return { unmount: () => { off(); offList(); listeners.delete(sync); faces.delete(id); face.dispose(); }, focus: () => input.focus() };
}

// ── the swarm: one stream, every bot, orchestrated by Glyphh ──────────
function mountSwarm(el) {
  const top = h("div", { class: "swarm-top" });
  const team = h("div", { class: "swarm-team" });
  const stream = h("div", { class: "scroll swarm-stream" });
  const input = h("textarea", { rows: 1, placeholder: "Talk to the team (Glyphh orchestrates)…" });
  const say = () => { const t = input.value.trim(); if (!t) return; input.value = ""; os.swarm.say(t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(); } });
  const composer = h("div", { class: "bot-composer" }, h("div", { class: "bar" }, input, h("button", { class: "send", onclick: say }, "↑")));
  let shown = 0;
  const who = (from) => {
    if (from === "you") return { name: "You", html: `<span class="you">you</span>` };
    const b = botById(from);
    return b ? { name: b.name, html: botSVG(b) } : { name: "Glyphh", html: `<img src="brand/glyphh-mark-purple.png" alt="">` };
  };
  const msgEl = (m) => {
    const w = who(m.from), to = m.to && botById(m.to);
    return h("div", { class: "smsg" + (m.from === "you" ? " you" : m.from === "glyphh" ? " glyphh" : "") + (talking.has(m.from) || (m.from === "glyphh" && ctx.voice.speaking && !ctx.voice.speaker) ? " talking" : ""), "data-from": m.from },
      h("div", { class: "cat", html: w.html }),
      h("div", { class: "b" }, h("div", { class: "n" }, w.name, to ? h("span", { class: "to" }, " → " + to.name) : null, h("time", {}, new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))), h("div", { class: "t" }, m.text)));
  };
  async function drawStart() {
    top.innerHTML = ""; team.innerHTML = ""; stream.innerHTML = ""; shown = 0; composer.hidden = true;
    const req = await os.swarm.check();
    const ok = (v, yes, no) => h("div", { class: "req " + (v ? "ok" : "bad") }, v ? "✓ " + yes : "✕ " + no);
    const goal = h("input", { placeholder: "What should the team do?" });
    const repo = h("input", { value: req.repo || ctx.settings().cwd, spellcheck: "false" });
    const picks = h("div", { class: "swarm-picks" }, ...bots.map((b) => h("label", { class: "pick" }, h("input", { type: "checkbox", checked: "", value: b.id }), h("span", { class: "cat", html: botSVG(b) }), b.name)));
    const go = h("button", { class: "primary", onclick: async () => {
      if (!goal.value.trim()) return ctx.toast("Give the swarm a goal", true);
      const ids = [...picks.querySelectorAll("input:checked")].map((i) => i.value);
      go.disabled = true; go.textContent = "Starting…";
      try { await os.swarm.start({ goal: goal.value.trim(), repo: repo.value.trim(), bots: ids }); ctx.open("plan", "right"); os.agent.send(`[swarm, from the user] The swarm "${goal.value.trim()}" has started. Make the plan and assign the first tasks.`); }
      catch (e) { ctx.toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); go.disabled = false; go.textContent = "Start swarm"; }
    } }, "Start swarm");
    const reqs = (r) => h("div", { class: "reqs" }, ok(r.gh, `GitHub connected to Claude through gh (${r.ghUser || "signed in"})`, "GitHub: run gh auth login in the terminal"), ok(!!r.repo, r.github ? `${r.repo.split("/").pop()} is a GitHub repo` : "a git repo (no GitHub remote: the pull request step needs one)", "the repo folder below isn't a git repo"));
    let reqBox = reqs(req);
    repo.addEventListener("change", async () => { const r = await os.swarm.check(repo.value.trim()); const n = reqs(r); reqBox.replaceWith(n); reqBox = n; });
    top.append(h("div", { class: "form swarm-start" },
      h("div", { class: "hint" }, "A swarm is a team of your bots on one goal. Everything goes through git: each bot works on its own branch, Glyphh merges, and it ends as a pull request."),
      reqBox,
      h("label", {}, "Goal", goal), h("label", {}, "Repo", repo), h("label", {}, "Team"), picks, h("div", { class: "actions" }, go)));
    if (swarm?.status === "done") top.append(h("div", { class: "hint" }, `Last swarm: ${swarm.goal} — ${String(swarm.result || "finished").split("\n")[0].replace(/ index\.\S+ \|.*$/, "").slice(0, 160)}`));
  }
  function drawRunning() {
    composer.hidden = false;
    if (!top.dataset.on) {
      top.innerHTML = ""; top.dataset.on = "1";
      const voicesB = h("button", { class: "tb" + (swarmVoices ? " on" : ""), title: "Each bot speaks in its own voice, one at a time", onclick: () => { swarmVoices = !swarmVoices; try { localStorage.setItem("glyphh-os-swarm-voices", swarmVoices ? "on" : "off"); } catch { /* */ } voicesB.classList.toggle("on", swarmVoices); if (!swarmVoices) ctx.voice.stopSpeaking(); } }, "🔊 voices");
      const pause = h("button", { class: "tb", onclick: async () => { ctx.toast(swarm.autopilot === false ? await os.swarm.resume() : await os.swarm.stop()); } });
      const finish = h("button", { class: "tb primary", onclick: async () => { try { ctx.toast(await os.swarm.finish({ into: "pr" })); } catch (e) { ctx.toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); } } }, "Finish → PR");
      const rec = h("button", { class: "tb rec", title: "Record the team's voices; saved next to the repo when the swarm ends", onclick: async () => {
        recordOn = !ctx.voice.taping;
        try { localStorage.setItem("glyphh-os-swarm-record", recordOn ? "on" : "off"); } catch { /* */ }
        if (recordOn) tapeForSwarm(); else await saveTape();
        changed();
      } });
      top.append(h("div", { class: "swarm-goal" }, h("b", {}, swarm.goal), h("small", {}, `${swarm.repo.split("/").pop()} · ${swarm.main}`)), rec, voicesB, pause, finish);
      top._pause = pause; top._rec = rec;
    }
    top._pause.textContent = swarm.autopilot === false ? "▶ resume" : "■ stop";
    top._rec.textContent = ctx.voice.taping ? "● rec" : "○ rec";
    top._rec.classList.toggle("on", ctx.voice.taping);
    team.innerHTML = "";
    for (const m of swarm.bots) {
      const b = botById(m.id); if (!b) continue;
      team.append(h("div", { class: "bot-tile mini" + (busy.has(b.id) ? " busy" : "") + (talking.has(b.id) ? " talking" : ""), title: `${b.name} · ${m.branch}`, onclick: () => openBot(b.id) },
        h("div", { class: "cat", html: botSVG(b) }), h("div", { class: "n" }, b.name)));
    }
    if (shown > swarm.stream.length) { stream.innerHTML = ""; shown = 0; }
    const atEnd = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60;
    for (const m of swarm.stream.slice(shown)) stream.append(msgEl(m));
    shown = swarm.stream.length;
    for (const e of stream.querySelectorAll(".smsg")) e.classList.toggle("talking", talking.has(e.dataset.from) || (e.dataset.from === "glyphh" && ctx.voice.speaking && !ctx.voice.speaker && e === stream.lastElementChild));
    if (atEnd) stream.scrollTop = stream.scrollHeight;
  }
  let mode = null;
  const draw = () => {
    const m = swarm?.status === "running" ? "run" : "start";
    // the start form stacks (form, then the last swarm's note); running, the top is one row of controls
    top.classList.toggle("start", m === "start");    if (m === "run") { if (mode !== "run") { top.innerHTML = ""; delete top.dataset.on; stream.innerHTML = ""; shown = 0; } drawRunning(); }
    else if (mode !== "start") drawStart();
    mode = m;
  };
  el.append(top, team, stream, composer);
  listeners.add(draw); draw();
  return { unmount: () => listeners.delete(draw), refresh: () => { mode = null; draw(); } };
}

// ── the plan ──────────────────────────────────────────────────────────
function mountPlan(el) {
  const body = h("div", { class: "scroll plan" });
  const draw = () => {
    body.innerHTML = "";
    if (!swarm?.plan?.length) return body.append(h("div", { class: "empty-note" }, swarm?.status === "running" ? "Glyphh is making the plan…" : "Start a swarm and its plan shows here."));
    const done = swarm.plan.filter((p) => p.status === "done").length;
    body.append(h("div", { class: "section-h" }, `${swarm.goal} · ${done}/${swarm.plan.length}`));
    for (const p of swarm.plan) {
      const b = botById(p.bot);
      body.append(h("div", { class: "plan-item " + p.status },
        h("span", { class: "st" }, p.status === "done" ? "✓" : p.status === "doing" ? "◐" : "○"),
        h("span", { class: "t" }, p.text),
        b ? h("span", { class: "cat" + (busy.has(b.id) ? " busy" : ""), title: b.name, html: botSVG(b) }) : null));
    }
  };
  el.append(h("div", { class: "toolbar" }, h("span", { style: "flex:1;color:var(--text-3);font-size:11px" }, "The swarm's plan")), body);
  listeners.add(draw); draw();
  return { unmount: () => listeners.delete(draw) };
}

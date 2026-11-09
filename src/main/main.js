// Glyphh OS — main process.
import { app, BrowserWindow, ipcMain, session, systemPreferences, shell, webContents, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Agent, askConnectors, osServer, sessions, removeSession } from "./agent.js";
import { BotHub } from "./bots.js";
import * as rpa from "./rpa.js";
import * as sys from "./system.js";
import * as voice from "./voice.js";
import { getSettings, setSettings, readJson, writeJson, HOME } from "./store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
app.setName("Glyphh OS");

// Started from Finder/Dock the PATH is bare; take the login shell's so claude, git and node resolve.
try {
  const p = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", "printf %s \"$PATH\""], { encoding: "utf8", timeout: 4000 });
  if (p) process.env.PATH = p;
} catch { /* keep what we have */ }

let win = null;
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

// ── renderer round-trips (the agent's hands on the UI) ────────────────
const pending = new Map();
function ui(cmd, args) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`ui ${cmd} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, t });
    send("os:cmd", { id, cmd, args });
  });
}
ipcMain.on("os:cmd-result", (_e, { id, ok, value, error }) => {
  const p = pending.get(id); if (!p) return;
  clearTimeout(p.t); pending.delete(id);
  ok ? p.resolve(value) : p.reject(new Error(error));
});

function askPermission(name, input, signal) {
  return new Promise((resolve) => {
    const id = randomUUID();
    const done = (ok) => { ipcMain.removeAllListeners("perm:" + id); resolve(ok); };
    ipcMain.once("perm:" + id, (_e, ok) => done(!!ok));
    signal?.addEventListener("abort", () => done(false));
    send("agent:permission", { id, name, input });
  });
}

// Glyphh, the user's own agent, is also the swarm's orchestrator: its os server carries the bot and swarm tools.
let hub = null;
const agent = new Agent({
  emit: (e) => {
    send("agent:event", e);
    if (e.type === "done" && e.text && hub?.swarm?.status === "running") hub.post("glyphh", e.text);
  },
  ui, askPermission,
  profile: { mcp: () => ({ os: osServer(ui, hub.orchestratorTools()) }), env: { ENABLE_TOOL_SEARCH: "auto" } },
});
hub = new BotHub({ emit: send, ui, askPermission, main: agent });
// every bot gets a voice the ElevenLabs account really has (a missing id plays as the default voice)
voice.voices().then((v) => hub.fitVoices(v)).catch(() => {});

// ── IPC ───────────────────────────────────────────────────────────────
const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));

handle("settings:get", () => getSettings());
handle("settings:set", (patch) => {
  const before = getSettings();
  const next = setSettings(patch);
  if (["model", "effort", "permissionMode", "cwd"].some((k) => before[k] !== next[k])) agent.restart();
  return next;
});

handle("agent:send", (t) => agent.send(t));
handle("agent:interrupt", () => agent.interrupt());
handle("agent:new", () => agent.newChat());
handle("agent:sessions", (all) => sessions(all ? undefined : getSettings().cwd));
handle("agent:delete-session", async (id) => { if (id === agent.sessionId) agent.newChat(); await removeSession(id); return true; });
// a folder chosen for one panel (Git's repo); doesn't move the OS
handle("os:choose-folder", async (start) => {
  const r = await dialog.showOpenDialog(win, { title: "Choose a folder", defaultPath: start || getSettings().cwd, properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0] || null;
});
handle("agent:resume", (id) => agent.resume(id));
handle("agent:session", () => agent.sessionId);
// the OS's folder: Glyphh, the files, git and terminal all work here
handle("os:pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose the folder Glyphh OS works in", defaultPath: getSettings().cwd, properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  setSettings({ cwd: r.filePaths[0] });
  agent.newChat();
  return getSettings();
});
handle("agent:models", () => agent.models);
handle("agent:connections", () => agent.connections());
// sign a connection in: open the provider's page in the user's browser; the CLI catches the redirect
handle("conn:auth", async (name) => {
  const r = await agent.authConnection(name);
  if (r?.authUrl) shell.openExternal(r.authUrl);
  return r || {};
});
handle("conn:reconnect", (name) => agent.reconnectConnection(name));
handle("conn:toggle", (name, on) => agent.toggleConnection(name, on));
handle("conn:add", (spec) => agent.addConnection(spec));
handle("conn:remove", (name) => agent.removeConnection(name));
handle("agent:busy", () => agent.busy);
handle("connectors:ask", (kind) => askConnectors(kind));

handle("voice:speak", (t, voiceId) => voice.speak(t, voiceId));

handle("bots:list", () => hub.list);
handle("bots:create", (spec) => hub.create(spec));
handle("bots:update", (id, patch) => hub.update(id, patch));
handle("bots:remove", (id) => hub.remove(id));
handle("bot:send", (id, t) => hub.send(id, t));
handle("bot:interrupt", (id) => hub.interrupt(id));
handle("bot:new", (id) => hub.newChat(id));
handle("bot:busy", (id) => hub.busy(id));
handle("swarm:get", () => hub.swarm);
handle("swarm:check", (repo) => hub.requirements(repo || getSettings().cwd));
handle("swarm:start", (spec) => hub.start(spec));
handle("swarm:stop", () => hub.stop());
handle("swarm:resume", () => hub.resume());
handle("swarm:finish", (opts) => hub.finish(opts));
// a swarm's taped conversation: next to its repo (in recordings/), else under ~/.glyphh/os/recordings; an .m4a too when ffmpeg is there
handle("rec:save", async (name, bytes) => {
  const dir = hub.swarm?.repo ? path.join(path.dirname(hub.swarm.repo), "recordings") : path.join(HOME, "recordings");
  mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${String(name).replace(/[^\w.-]+/g, "-")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
  writeFileSync(base + ".webm", Buffer.from(bytes));
  try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", base + ".webm", "-c:a", "aac", "-b:a", "128k", base + ".m4a"], { timeout: 120000 }); return base + ".m4a"; } catch { return base + ".webm"; }
});
// the user talks to the team: it lands in the stream and goes to Glyphh, who orchestrates
handle("swarm:say", (t) => { hub.post("you", t); agent.send(`[swarm, from the user] ${t}`); });
handle("voice:transcribe", (bytes, mime) => voice.transcribe(Buffer.from(bytes), mime));
handle("voice:voices", () => voice.voices());

handle("fs:list", (d) => sys.listDir(d));
handle("fs:read", (p) => sys.readFile(p));
handle("fs:write", (p, t) => sys.writeFile(p, t));

handle("git:status", (cwd) => sys.gitStatus(cwd));
handle("git:diff", (cwd, f, staged) => sys.gitDiff(cwd, f, staged));
handle("git:stage", (cwd, f) => sys.gitStage(cwd, f));
handle("git:unstage", (cwd, f) => sys.gitUnstage(cwd, f));
handle("git:commit", (cwd, m) => sys.gitCommit(cwd, m));

handle("term:open", (id, cwd) => sys.termOpen(id, cwd, send));
ipcMain.on("term:write", (_e, id, d) => sys.termWrite(id, d));
ipcMain.on("term:resize", (_e, id, c, r) => sys.termResize(id, c, r));
handle("term:kill", (id) => sys.termKill(id));

handle("rpa:register", (appId, wcId) => rpa.register(appId, wcId));
handle("rpa:unregister", (appId) => rpa.unregister(appId));

handle("layout:get", () => readJson("layout.json", null));
handle("layout:set", (l) => writeJson("layout.json", l));
handle("dips:get", () => readJson("dips.json", null));
handle("dips:set", (d) => writeJson("dips.json", d));
// A site's own icon: read its <link rel=icon> tags (largest png/svg first), else /favicon.ico. No third-party icon service.
handle("favicon:resolve", async (pageUrl) => {
  const u = new URL(pageUrl);
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36";
  const ok = async (href) => { try { const r = await fetch(href, { headers: { "user-agent": ua } }); return r.ok && /image|octet/.test(r.headers.get("content-type") || "image"); } catch { return false; } };
  try {
    const html = await (await fetch(u.origin + "/", { headers: { "user-agent": ua, accept: "text/html" }, redirect: "follow" })).text();
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
      .filter((t) => /rel=["'][^"']*icon[^"']*["']/i.test(t))
      .map((t) => ({ href: t.match(/href=["']([^"']+)["']/i)?.[1], size: Number(t.match(/sizes=["'](\d+)/i)?.[1] || (/apple-touch/i.test(t) ? 180 : 16)) }))
      .filter((l) => l.href).sort((a, b) => (Math.abs(a.size - 64) - Math.abs(b.size - 64)));
    for (const l of links) { const href = new URL(l.href.replace(/&amp;/g, "&"), u.origin + "/").href; if (await ok(href)) return href; }
  } catch { /* offline or blocked */ }
  return (await ok(u.origin + "/favicon.ico")) ? u.origin + "/favicon.ico" : null;
});
const STORES = new Set(["apps", "layouts", "characters"]); // custom apps, saved center layouts, characters
handle("store:get", (name) => (STORES.has(name) ? readJson(name + ".json", null) : null));
handle("store:set", (name, v) => STORES.has(name) && writeJson(name + ".json", v));

handle("win:screenshot", async () => (await win.webContents.capturePage()).resize({ width: 1440 }).toPNG().toString("base64"));
handle("shell:open", (url) => /^https?:\/\//.test(url) && shell.openExternal(url));

// ── window ────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1100, minHeight: 700,
    title: "Glyphh OS",
    backgroundColor: "#00000000",
    transparent: process.platform === "darwin",
    vibrancy: "under-window",
    visualEffectState: "active",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(ROOT, "src/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
      autoplayPolicy: "no-user-gesture-required", // the bots speak without a click first
    },
  });
  win.loadFile(path.join(ROOT, "dist/index.html"));
  // GLYPHH_OS_SMOKE=<png>: boot, print the renderer console, screenshot, quit.
  if (process.env.GLYPHH_OS_SMOKE) {
    win.webContents.on("console-message", (e) => console.log("[renderer]", e.level, e.message));
    // GLYPHH_OS_SMOKE_SAY: lines to send, split on ";;"; "#sel" clicks that element instead.
    (process.env.GLYPHH_OS_SMOKE_SAY || "").split(";;").map((s) => s.trim()).filter(Boolean).forEach((line, i) =>
      setTimeout(() => win.webContents.executeJavaScript(line.startsWith("#")
        ? `document.querySelector(${JSON.stringify(line)}).click()`
        : `document.querySelector("#input").value = ${JSON.stringify(line)}; document.querySelector("#btn-send").click();`), 3000 + i * 800));
    // GLYPHH_OS_SHOTS=<dir>: also a screenshot every GLYPHH_OS_SHOTS_S seconds (watching a long run)
    if (process.env.GLYPHH_OS_SHOTS) {
      mkdirSync(process.env.GLYPHH_OS_SHOTS, { recursive: true });
      let n = 0;
      setInterval(async () => { if (win && !win.isDestroyed()) writeFileSync(path.join(process.env.GLYPHH_OS_SHOTS, `shot-${String(++n).padStart(3, "0")}.png`), (await win.webContents.capturePage()).toPNG()); }, Number(process.env.GLYPHH_OS_SHOTS_S || 60) * 1000);
    }
    setTimeout(async () => {
      writeFileSync(process.env.GLYPHH_OS_SMOKE, (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript("window.__saveRecording?.()").catch(() => {});
      app.quit();
    }, Number(process.env.GLYPHH_OS_SMOKE_MS || 9000));
  }
  win.on("closed", () => { win = null; });
}

app.whenReady().then(async () => {
  // The mic is for voice; web apps get camera/mic/notifications only through the panel session.
  const allow = new Set(["media", "microphone", "audioCapture", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]);
  for (const s of [session.defaultSession, session.fromPartition("persist:glyphh-os")]) {
    s.setPermissionRequestHandler((_wc, perm, cb) => cb(allow.has(perm)));
  }
  if (process.platform === "darwin") systemPreferences.askForMediaAccess("microphone").catch(() => {});

  app.on("web-contents-created", (_e, wc) => {
    if (wc.getType() !== "webview") return;
    // Links that open new windows stay in the OS's browser app.
    wc.setWindowOpenHandler(({ url }) => { send("os:open-url", url); return { action: "deny" }; });
  });

  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on("window-all-closed", () => { for (const id of sys.termIds()) sys.termKill(id); if (process.platform !== "darwin") app.quit(); });
void webContents;

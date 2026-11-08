// Glyphh OS — main process.
import { app, BrowserWindow, ipcMain, session, systemPreferences, shell, webContents } from "electron";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Agent, askConnectors } from "./agent.js";
import * as rpa from "./rpa.js";
import * as sys from "./system.js";
import * as voice from "./voice.js";
import { getSettings, setSettings, readJson, writeJson } from "./store.js";

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

const agent = new Agent({ emit: (e) => send("agent:event", e), ui, askPermission });

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
handle("agent:models", () => agent.models);
handle("agent:connections", () => agent.connections());
handle("agent:busy", () => agent.busy);
handle("connectors:ask", (kind) => askConnectors(kind));

handle("voice:speak", (t) => voice.speak(t));
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
    },
  });
  win.loadFile(path.join(ROOT, "dist/index.html"));
  // GLYPHH_OS_SMOKE=<png>: boot, print the renderer console, screenshot, quit.
  if (process.env.GLYPHH_OS_SMOKE) {
    win.webContents.on("console-message", (e) => console.log("[renderer]", e.level, e.message));
    if (process.env.GLYPHH_OS_SMOKE_SAY) setTimeout(() => win.webContents.executeJavaScript(`document.querySelector("#input").value = ${JSON.stringify(process.env.GLYPHH_OS_SMOKE_SAY)}; document.querySelector("#btn-send").click();`), 3000);
    setTimeout(async () => {
      writeFileSync(process.env.GLYPHH_OS_SMOKE, (await win.webContents.capturePage()).toPNG());
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

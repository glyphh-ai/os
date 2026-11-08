// The renderer's only door into the main process.
const { contextBridge, ipcRenderer } = require("electron");

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => { const h = (_e, ...a) => fn(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld("os", {
  platform: process.platform,
  settings: { get: inv("settings:get"), set: inv("settings:set") },
  agent: {
    send: inv("agent:send"), interrupt: inv("agent:interrupt"), newChat: inv("agent:new"),
    models: inv("agent:models"), connections: inv("agent:connections"), busy: inv("agent:busy"),
    onEvent: on("agent:event"),
    onPermission: on("agent:permission"),
    answerPermission: (id, ok) => ipcRenderer.send("perm:" + id, ok),
  },
  connectors: { ask: inv("connectors:ask") },
  voice: { speak: inv("voice:speak"), transcribe: inv("voice:transcribe"), voices: inv("voice:voices") },
  fs: { list: inv("fs:list"), read: inv("fs:read"), write: inv("fs:write") },
  git: { status: inv("git:status"), diff: inv("git:diff"), stage: inv("git:stage"), unstage: inv("git:unstage"), commit: inv("git:commit") },
  term: {
    open: inv("term:open"), kill: inv("term:kill"),
    write: (id, d) => ipcRenderer.send("term:write", id, d),
    resize: (id, c, r) => ipcRenderer.send("term:resize", id, c, r),
    onData: on("term:data"), onExit: on("term:exit"),
  },
  rpa: { register: inv("rpa:register"), unregister: inv("rpa:unregister") },
  layout: { get: inv("layout:get"), set: inv("layout:set") },
  dips: { get: inv("dips:get"), set: inv("dips:set") },
  screenshot: inv("win:screenshot"),
  openExternal: inv("shell:open"),
  onCmd: on("os:cmd"),
  cmdResult: (r) => ipcRenderer.send("os:cmd-result", r),
  onOpenUrl: on("os:open-url"),
});

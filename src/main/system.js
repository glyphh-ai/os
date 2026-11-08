// system — files, git and terminals for the OS's development surface.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

const expand = (p) => (p?.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

// ── files ─────────────────────────────────────────────────────────────
const HIDE = new Set([".git", "node_modules", ".DS_Store", "dist", ".next", "__pycache__", ".venv"]);

export async function listDir(dir) {
  dir = expand(dir);
  const ents = await fs.readdir(dir, { withFileTypes: true });
  return ents.filter((e) => !HIDE.has(e.name))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}
export async function readFile(p) {
  p = expand(p);
  const st = await fs.stat(p);
  if (st.size > 4 * 1024 * 1024) throw new Error("file is over 4 MB");
  return fs.readFile(p, "utf8");
}
export async function writeFile(p, text) { await fs.writeFile(expand(p), text, "utf8"); return true; }

// ── git ───────────────────────────────────────────────────────────────
function git(cwd, args) {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd: expand(cwd), maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
}

export async function gitStatus(cwd) {
  let root;
  try { root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim(); } catch { return { notRepo: true }; } // not an error: just not a repo
  if (!root) return { notRepo: true };
  const out = await git(root, ["status", "--porcelain=v1", "-b"]);
  const lines = out.split("\n").filter(Boolean);
  const branch = (lines.shift() || "").replace(/^## /, "");
  const files = lines.map((l) => ({ x: l[0], y: l[1], path: l.slice(3) }));
  const log = (await git(root, ["log", "--oneline", "-25", "--decorate"]).catch(() => "")).split("\n").filter(Boolean);
  return { root, branch, files, log };
}
export const gitDiff = (cwd, file, staged) => git(cwd, ["diff", ...(staged ? ["--cached"] : []), "--", file].filter(Boolean));
export const gitStage = (cwd, file) => git(cwd, ["add", "--", file]);
export const gitUnstage = (cwd, file) => git(cwd, ["restore", "--staged", "--", file]);
export const gitCommit = (cwd, message) => git(cwd, ["commit", "-m", message]);

// ── terminals ─────────────────────────────────────────────────────────
const terms = new Map(); // id → { p, buf }

export function termOpen(id, cwd, send) {
  if (terms.has(id)) return { reused: true };
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
  const p = pty.spawn(shell, process.platform === "win32" ? [] : ["-l"], {
    name: "xterm-256color", cols: 100, rows: 30, cwd: expand(cwd) || os.homedir(),
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  const t = { p, buf: "", total: 0 };
  p.onData((d) => { t.total += d.length; t.buf = (t.buf + d).slice(-200000); send("term:data", id, d); });
  p.onExit(() => { terms.delete(id); send("term:exit", id); });
  terms.set(id, t);
  return { reused: false };
}
export function termWrite(id, data) { terms.get(id)?.p.write(data); }
export function termResize(id, cols, rows) { try { terms.get(id)?.p.resize(cols, rows); } catch { /* closed */ } }
export function termKill(id) { terms.get(id)?.p.kill(); terms.delete(id); }
export function termIds() { return [...terms.keys()]; }

/** Run a line in a visible terminal and hand back what it printed. */
export async function termRun(id, command, waitMs = 2500) {
  const t = terms.get(id);
  if (!t) throw new Error(`terminal ${id} is not open`);
  const start = t.total;
  t.p.write(command + "\r");
  await new Promise((r) => setTimeout(r, waitMs));
  const got = t.total - start;
  // eslint-disable-next-line no-control-regex
  return t.buf.slice(-Math.min(got, t.buf.length) || t.buf.length).replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, "").slice(-20000);
}

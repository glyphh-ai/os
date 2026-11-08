// agent — the OS's one Claude. It runs through the Claude Agent SDK on the
// user's own Claude Code login (`claude` → /login), so there is no API key to
// paste: the same account, model list and claude.ai connectors (email,
// calendar, …) the CLI has. The OS hands it a tool server of its own, "os",
// for driving the UI: open/close/move apps, swipe the carousel, drive any web
// app, run lines in the terminal, open files, load .dip workspaces.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { z } from "zod";
import * as rpa from "./rpa.js";
import * as sys from "./system.js";
import { getSettings } from "./store.js";

const text = (t) => ({ content: [{ type: "text", text: String(t) }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return { ...text(`error: ${e.message}`), isError: true }; } };

const READ_ONLY = new Set(["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "TodoWrite", "ToolSearch", "NotebookRead", "Task", "Agent"]);
const AREAS = ["left", "left-bottom", "center", "right", "right-bottom"];

const SYSTEM = `You are the voice and hands of Glyphh OS, an AI operating system on the user's Mac.
The user sees you as a holographic face at the center of the screen and usually talks to you by voice; your text replies are read aloud.
Keep spoken replies short and natural: one to three sentences, no markdown tables, no code blocks unless asked. Put long output in a panel instead (open a file, the terminal, or the browser).
The screen has a left rail (areas "left" and "left-bottom", git by default at the bottom), a right rail ("right" and "right-bottom", the terminal by default at the bottom), and the center: a swipeable carousel whose first slide is your face, then one slide per app or per layout (a grid of apps). Apps: files, editor, terminal, browser, git, email, calendar, connections, instagram, x, slack, youtube, the user's custom apps, and any url.
Use the os_* tools to drive the UI: open, move, focus and close apps, navigate and operate web apps (outline first to find selectors, then click/type/read), run commands in the visible terminal, open files in the editor, and load .dip workspaces.
Email, calendar and other accounts come from the user's Claude connectors; use those tools for data and the web apps for anything they cannot do.
Never send, post, delete or buy anything without the user saying yes to that exact action first.`;

function claudeExecutable() {
  const s = getSettings();
  if (s.claudePath && fs.existsSync(s.claudePath)) return s.claudePath;
  try { return execFileSync("/bin/sh", ["-lc", "command -v claude"], { encoding: "utf8" }).trim() || undefined; } catch { return undefined; }
}

/** The "os" tool server. `ui(cmd, args)` round-trips to the renderer. */
function osServer(ui) {
  return createSdkMcpServer({
    name: "os",
    version: "0.1.0",
    tools: [
      tool("os_state", "What is on screen: every open app, where it is (left/center/right), which is focused, the carousel slide, and the url of each web app.", {},
        safe(async () => text(JSON.stringify({ layout: await ui("state"), web: rpa.liveApps() }, null, 2)))),
      tool("os_open", "Open an app (files, editor, terminal, browser, git, email, calendar, connections, instagram, x, slack, youtube) or any url as a web app, in an area. Center opens it as a carousel slide and swipes to it.",
        { app: z.string().describe("app id, or a url"), area: z.enum(AREAS).optional(), url: z.string().optional().describe("for browser/web apps: the page to load") },
        safe(async (a) => text(await ui("open", a)))),
      tool("os_close", "Close an app.", { app: z.string() }, safe(async (a) => text(await ui("close", a)))),
      tool("os_move", "Move an open app to another area.", { app: z.string(), area: z.enum(AREAS) }, safe(async (a) => text(await ui("move", a)))),
      tool("os_focus", "Bring an app to the front of its area (center: swipe the carousel to it). app 'face' swipes back to the face.", { app: z.string() }, safe(async (a) => text(await ui("focus", a)))),
      tool("os_layout", "Open a layout in the center as a new carousel slide: a saved or built-in layout by name (dev, social, comms, split, thirds, grid, main-side), or a grid of your own: cols, rows and the apps in reading order. Use name='list' to list them.",
        { name: z.string().optional(), cols: z.number().optional(), rows: z.number().optional(), apps: z.array(z.string()).optional() },
        safe(async (a) => text(await ui("layout", a)))),
      tool("os_rail", "Collapse or expand the left or right rail.", { rail: z.enum(["left", "right"]), open: z.boolean() }, safe(async (a) => text(await ui("rail", a)))),
      tool("os_dip", "Load a saved .dip workspace (a whole layout of apps), or save the current one with save=true, or list them with name='list'.",
        { name: z.string(), save: z.boolean().optional() }, safe(async (a) => text(await ui("dip", a)))),
      tool("os_web_goto", "Navigate an open web app (browser, x, youtube, …) to a url.", { app: z.string(), url: z.string() }, safe(async (a) => text(await rpa.goto(a.app, a.url)))),
      tool("os_web_outline", "List the clickable and typeable elements of a web app with a selector for each. Call this before clicking or typing.", { app: z.string() },
        safe(async (a) => text(await rpa.outline(a.app)))),
      tool("os_web_click", "Click an element in a web app by CSS selector, and/or the first clickable whose text contains `text`.", { app: z.string(), selector: z.string().optional(), text: z.string().optional() },
        safe(async (a) => text(await rpa.click(a.app, a.selector, a.text)))),
      tool("os_web_type", "Type text into an input, textarea or editable element of a web app. submit=true presses Enter after.", { app: z.string(), selector: z.string(), text: z.string(), submit: z.boolean().optional() },
        safe(async (a) => text(await rpa.type(a.app, a.selector, a.text, a.submit)))),
      tool("os_web_key", "Press a key in a web app (Return, Escape, Tab, Down, …) with optional modifiers (cmd, shift, alt, control).", { app: z.string(), key: z.string(), modifiers: z.array(z.string()).optional() },
        safe(async (a) => text(await rpa.key(a.app, a.key, a.modifiers)))),
      tool("os_web_read", "Read the visible text (or html=true for markup) of a web app, or of one element.", { app: z.string(), selector: z.string().optional(), html: z.boolean().optional() },
        safe(async (a) => text(await rpa.read(a.app, a.selector, a.html)))),
      tool("os_web_eval", "Run JavaScript in a web app's page and return the result.", { app: z.string(), script: z.string() }, safe(async (a) => text(await rpa.evaluate(a.app, a.script)))),
      tool("os_web_screenshot", "See a web app: a screenshot of it.", { app: z.string() },
        safe(async (a) => ({ content: [{ type: "image", data: await rpa.screenshot(a.app), mimeType: "image/png" }] }))),
      tool("os_terminal_run", "Run a command in the OS's visible terminal (opening it if needed) and return what it printed. Use for things the user should watch.", { command: z.string(), wait_ms: z.number().optional() },
        safe(async (a) => { const id = await ui("terminal", {}); return text(await sys.termRun(id, a.command, a.wait_ms ?? 2500)); })),
      tool("os_editor_open", "Open a file in the editor app, optionally at a line.", { path: z.string(), line: z.number().optional() }, safe(async (a) => text(await ui("edit", a)))),
      tool("os_screenshot", "See the whole Glyphh OS window.", {},
        safe(async () => ({ content: [{ type: "image", data: await ui("screenshot", {}), mimeType: "image/png" }] }))),
      tool("os_notify", "Show a short toast on screen.", { message: z.string() }, safe(async (a) => text(await ui("toast", a)))),
    ],
  });
}

/** An endless prompt stream the session reads from: continuous conversation. */
function inbox() {
  const queue = [];
  let wake = null;
  let closed = false;
  return {
    push(msg) { queue.push(msg); wake?.(); },
    close() { closed = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (!queue.length) await new Promise((r) => (wake = r));
        wake = null;
        while (queue.length) yield queue.shift();
      }
    },
  };
}

export class Agent {
  constructor({ emit, ui, askPermission }) {
    this.emit = emit; this.ui = ui; this.askPermission = askPermission;
    this.q = null; this.in = null; this.sessionId = null; this.busy = false; this.models = []; this.servers = [];
  }

  start() {
    const s = getSettings();
    this.in = inbox();
    const options = {
      cwd: fs.existsSync(s.cwd) ? s.cwd : process.env.HOME,
      model: s.model && s.model !== "default" ? s.model : undefined,
      effort: s.effort,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM },
      mcpServers: { os: osServer(this.ui) },
      pathToClaudeCodeExecutable: claudeExecutable(),
      resume: this.sessionId || undefined,
      stderr: (d) => this.emit({ type: "log", text: String(d) }),
    };
    if (s.permissionMode === "auto") {
      options.permissionMode = "bypassPermissions";
      options.allowDangerouslySkipPermissions = true;
    } else {
      options.canUseTool = async (name, input, { signal }) => {
        if (READ_ONLY.has(name) || name.startsWith("mcp__os__")) return { behavior: "allow", updatedInput: input };
        const ok = await this.askPermission(name, input, signal);
        return ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "The user said no." };
      };
    }
    const q = query({ prompt: this.in, options });
    this.q = q;
    this.pump(q);
    q.supportedModels().then((m) => { this.models = m; this.emit({ type: "models", models: m }); }).catch(() => {});
  }

  async pump(q) {
    try {
      for await (const m of q) {
        if (q !== this.q) break;
        if (m.type === "system" && m.subtype === "init") {
          this.sessionId = m.session_id;
          this.servers = m.mcp_servers || [];
          this.emit({ type: "init", model: m.model, servers: this.servers, tools: m.tools?.length ?? 0, session: m.session_id });
        } else if (m.type === "stream_event") {
          const e = m.event;
          if (e.type === "content_block_delta" && e.delta?.type === "text_delta") this.emit({ type: "delta", text: e.delta.text });
          if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta") this.emit({ type: "thinking" });
          if (e.type === "message_start") this.emit({ type: "turn" });
        } else if (m.type === "assistant") {
          for (const b of m.message.content || []) if (b.type === "tool_use") this.emit({ type: "tool", name: b.name, input: b.input });
        } else if (m.type === "result") {
          this.busy = false;
          this.emit({ type: "done", ok: m.subtype === "success", error: m.subtype !== "success" ? (m.errors?.join("\n") || m.subtype) : undefined, cost: m.total_cost_usd });
        }
      }
    } catch (e) {
      this.busy = false;
      this.emit({ type: "error", text: e.message });
    }
  }

  send(textIn) {
    if (!this.q) this.start();
    this.busy = true;
    this.in.push({ type: "user", session_id: this.sessionId || "", parent_tool_use_id: null, message: { role: "user", content: textIn } });
  }

  async interrupt() { try { await this.q?.interrupt(); } catch { /* idle */ } this.busy = false; }

  /** Model, effort or permissions changed: carry the conversation into a new session. */
  restart() {
    const old = this.q; this.in?.close();
    this.q = null;
    try { old?.close?.(); } catch { /* gone */ }
    this.start();
  }

  async connections() {
    if (!this.q) this.start();
    try { this.servers = await this.q.mcpServerStatus(); } catch { /* not ready */ }
    return this.servers;
  }

  newChat() { this.sessionId = null; this.restart(); }
}

/** One read-only question to the user's connectors (email, calendar), answered as JSON. */
export async function askConnectors(kind) {
  const s = getSettings();
  const prompts = {
    email: `Using the user's connected email tools (Gmail or Outlook), list the 25 most recent threads in their inbox. Reply with ONLY a JSON array, no prose: [{"id":"","from":"","subject":"","snippet":"","date":"ISO date","unread":true}]. If no email connector is available reply exactly []`,
    calendar: `Using the user's connected calendar tools (Google Calendar or Outlook), list their events from now through the next 7 days. Reply with ONLY a JSON array, no prose: [{"id":"","title":"","start":"ISO","end":"ISO","location":"","attendees":0}]. If no calendar connector is available reply exactly []`,
  };
  const q = query({
    prompt: prompts[kind],
    options: {
      cwd: process.env.HOME,
      model: "haiku",
      effort: "low",
      settingSources: ["user"],
      pathToClaudeCodeExecutable: claudeExecutable(),
      maxTurns: 12,
      canUseTool: async (name, input) =>
        name === "ToolSearch" || (name.startsWith("mcp__") && /(search|list|get|read|find|fetch)/i.test(name.split("__").pop()))
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "read-only: only list/search/get tools" },
    },
  });
  let out = "";
  for await (const m of q) if (m.type === "result") out = m.result || "";
  const json = out.slice(out.indexOf("["), out.lastIndexOf("]") + 1);
  try { return JSON.parse(json); } catch { return { error: out.slice(0, 500) || "no answer" }; }
}

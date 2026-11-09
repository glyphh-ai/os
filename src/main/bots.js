// bots — the user's Glyphh bots and the swarm they work in.
//
// A bot is a Glyphh bot template filled in: a name, a cat to look like, a role,
// a personality, standing instructions, an ElevenLabs voice, a model and an
// effort. Each one is its own Claude session (the Agent class with a bot
// profile). Its memory lives in the user's glyphh through the Glyphh connector
// (glyphh_orchestrator_recall / _remember, scoped to the bot), and its learned
// decisions in Ada gates of its own (glyphh_bot_model / _decide / _record).
//
// A swarm is a working session: a goal, a git repo, the bots on it and a plan.
// Everything they do goes through git: the swarm gets an integration branch
// (swarm/<slug>/main) and every bot a branch and worktree of its own
// (swarm/<slug>/<bot>), so they work side by side without stepping on each
// other; Glyphh, the user's own agent, orchestrates: it assigns work, merges
// each bot's branch when it's done, and finishes with a pull request on GitHub.
// Every bot's report streams into one shared conversation the user watches
// (and hears: each bot speaks in its own voice, one at a time).
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Agent, osServer, tool, text, safe, z } from "./agent.js";
import { HOME, readJson, writeJson, getSettings } from "./store.js";

const run = promisify(execFile);
const git = async (cwd, args) => (await run("git", args, { cwd, maxBuffer: 16 << 20 })).stdout.trim();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "bot";

// ElevenLabs premade voices, so a new bot speaks before anyone picks one
const VOICES = { george: "JBFqnCBsd6RMkjVDRZzb", adam: "pNInz6obpgDQGcFmaJgB", rachel: "21m00Tcm4TlvDq8ikWAM", antoni: "ErXwobaYiN019PkySvjV", josh: "TxGEqnHWrfWFTfGW9XjX", domi: "AZnzlk1XvdvUeBnXmlld" };

/** The Glyphh bot template, filled in for the starter team (each wears one of the brand's bot cats). */
const STARTERS = [
  { id: "spiky", name: "Spiky", look: "spiky", role: "Builder", voiceId: VOICES.adam, personality: "Quick, blunt, a little cocky; ships first and polishes after.", instructions: "Write the code. Small commits with clear messages. Run the tests before you say you're done." },
  { id: "big-eye", name: "Big eye", look: "big-eye", role: "Reviewer", voiceId: VOICES.rachel, personality: "Sharp-eyed and calm; notices everything, says only what matters.", instructions: "Review the team's branches: read the diffs, find the real bugs, say exactly where. Fix small things yourself on your branch." },
  { id: "antenna", name: "Antenna", look: "antenna", role: "Researcher", voiceId: VOICES.antoni, personality: "Curious and upbeat; always has a link.", instructions: "Find out what the team needs to know: docs, APIs, prior art. Drive the browser app with the os_web tools and report what you found in two sentences." },
  { id: "cape", name: "Cape", look: "cape", role: "Planner", voiceId: VOICES.george, personality: "Steady, organised, a little dramatic about deadlines.", instructions: "Break the goal into a short plan of concrete tasks, each for one bot. Keep the plan current with swarm_plan_mark." },
  { id: "bolt-tail", name: "Bolt tail", look: "bolt-tail", role: "Tester", voiceId: VOICES.josh, personality: "Energetic and suspicious of anything that hasn't been run.", instructions: "Write and run tests for what the team builds; report what passes and what fails, with the command you ran." },
  { id: "sleepy", name: "Sleepy", look: "sleepy", role: "Writer", voiceId: VOICES.domi, personality: "Dry and unhurried; writes the clearest sentences on the team.", instructions: "Write the README, docs and the pull request description from what the team actually did." },
];

export class BotHub {
  constructor({ emit, ui, askPermission, main }) {
    this.emit = emit; this.ui = ui; this.askPermission = askPermission; this.main = main;
    this.list = readJson("bots.json", null) || STARTERS.map((b) => ({ ...b, model: "default", effort: "medium" }));
    this.swarm = readJson("swarm.json", null);
    this.sessions = new Map();
  }

  save() { writeJson("bots.json", this.list); }
  saveSwarm() { if (this.swarm) writeJson("swarm.json", this.swarm); this.emit("swarm:event", { type: "state", swarm: this.swarm }); }
  bot(id) {
    const b = this.list.find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
    if (!b) throw new Error(`no bot "${id}" — bots: ${this.list.map((x) => x.name).join(", ")}`);
    return b;
  }

  // ── bots ────────────────────────────────────────────────────────────
  create(spec) {
    const id = slugify(spec.name);
    if (this.list.some((b) => b.id === id)) throw new Error(`there is a bot called ${spec.name} already`);
    const b = { id, name: spec.name, look: spec.look || "glyphh", role: spec.role || "Helper", personality: spec.personality || "", instructions: spec.instructions || "", voiceId: spec.voiceId || getSettings().voiceId, model: spec.model || "default", effort: spec.effort || "medium" };
    this.list.push(b); this.save(); this.emit("bot:list", this.list);
    return b;
  }
  update(id, patch) {
    const b = this.bot(id);
    const restart = ["model", "effort", "personality", "instructions", "role", "name"].some((k) => k in patch && patch[k] !== b[k]);
    for (const k of ["name", "look", "role", "personality", "instructions", "voiceId", "model", "effort"]) if (k in patch) b[k] = patch[k];
    this.save(); this.emit("bot:list", this.list);
    if (restart) this.sessions.get(b.id)?.restart();
    return b;
  }
  remove(id) {
    const b = this.bot(id);
    this.sessions.get(b.id)?.in?.close(); this.sessions.delete(b.id);
    this.list = this.list.filter((x) => x !== b); this.save(); this.emit("bot:list", this.list);
  }

  member(id) { return this.swarm?.status === "running" ? this.swarm.bots.find((m) => m.id === id) : null; }

  system(b) {
    const m = this.member(b.id);
    return [
      `You are ${b.name}, one of the user's Glyphh bots: an alien cat with one big eye, drawn in white light on Glyphh OS. Your role: ${b.role}.`,
      b.personality && `Your personality: ${b.personality}`,
      b.instructions && `Your standing instructions: ${b.instructions}`,
      `Your replies are spoken aloud in your own voice, so keep them short and in character: one to three plain sentences, no markdown, no code blocks. Put real output in files, commits and the team's panels.`,
      `Memory: if the Glyphh connector's tools are available, call glyphh_orchestrator_recall with about "${b.name}: <your task>" before you start, and glyphh_orchestrator_remember with when "bot ${b.name}" for what you learned after (what worked, what the user said). If a decision you make again and again should be learned, say so to Glyphh; it can give you an Ada gate (glyphh_bot_model) to decide it from precedent.`,
      m ? `You are working in a swarm with ${this.swarm.bots.filter((x) => x.id !== b.id).map((x) => this.bot(x.id).name).join(", ") || "no one else"}, orchestrated by Glyphh. The goal: ${this.swarm.goal}
Your working copy is ${m.worktree}, on your own branch ${m.branch}. Work only there: commit your work in small commits with clear messages; never push, never switch branches, never touch another bot's worktree. Glyphh merges your branch into ${this.swarm.main} when you say you're done.
Use swarm_post to tell the team something while you work, swarm_ask to ask another bot, swarm_plan_mark to tick the plan. When you finish a task, end with one or two sentences on what you did and the commit it's in.` : `Right now you are talking with the user one to one.`,
      `Never send, post, pay or delete anything outside your own working copy without the user's yes.`,
    ].filter(Boolean).join("\n");
  }

  session(id) {
    const b = this.bot(id);
    let s = this.sessions.get(b.id);
    if (s) return s;
    s = new Agent({
      emit: (e) => this.onBotEvent(b.id, e), ui: this.ui, askPermission: this.askPermission,
      profile: {
        label: b.name,
        system: () => this.system(this.bot(b.id)),
        cwd: () => this.member(b.id)?.worktree || getSettings().cwd,
        model: () => this.bot(b.id).model,
        effort: () => this.bot(b.id).effort,
        env: { ENABLE_TOOL_SEARCH: "auto" },
        mcp: () => ({ os: osServer(this.ui), swarm: this.botServer(b.id) }),
      },
    });
    this.sessions.set(b.id, s);
    return s;
  }
  send(id, msg) { const s = this.session(id); s.send(msg); this.emit("bot:event", { bot: this.bot(id).id, type: "user", text: msg }); return `sent to ${this.bot(id).name}`; }
  interrupt(id) { return this.sessions.get(this.bot(id).id)?.interrupt(); }
  newChat(id) { this.sessions.get(this.bot(id).id)?.newChat(); }
  busy(id) { return !!this.sessions.get(this.bot(id).id)?.busy; }

  onBotEvent(id, e) {
    this.emit("bot:event", { bot: id, ...e });
    if (e.type === "done" && e.text && this.member(id)) {
      this.post(id, e.text);
      // the orchestrator hears every report and decides what happens next
      if (this.swarm.autopilot !== false) this.main.send(`[swarm] ${this.bot(id).name} (${this.bot(id).role}) reports: ${e.text}`);
    }
  }

  // ── the swarm's shared conversation ─────────────────────────────────
  post(from, msg, to) {
    if (!this.swarm) return "no swarm";
    const m = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), from, to, text: String(msg).trim() };
    if (!m.text) return "empty";
    this.swarm.stream.push(m);
    if (this.swarm.stream.length > 400) this.swarm.stream.splice(0, this.swarm.stream.length - 400);
    writeJson("swarm.json", this.swarm);
    this.emit("swarm:event", { type: "msg", msg: m });
    return "posted";
  }

  async requirements(repo) {
    const out = { gh: false, ghUser: "", github: false, claudeGithub: false, repo: "" };
    try { const r = await run("gh", ["auth", "status", "--active"], { env: process.env }); out.gh = true; out.ghUser = (r.stdout + r.stderr).match(/account (\S+)/)?.[1] || ""; } catch { /* not signed in */ }
    if (repo) {
      try { out.repo = await git(repo, ["rev-parse", "--show-toplevel"]); } catch { /* not a repo */ }
      try { out.github = /github\.com/.test(await git(out.repo || repo, ["remote", "get-url", "origin"])); } catch { /* no origin */ }
    }
    let servers = this.main.servers || [];
    try { servers = await this.main.connections(); } catch { /* not started */ }
    out.claudeGithub = servers.some((s) => /github/i.test(s.name) && s.status === "connected");
    return out;
  }

  async start({ goal, repo, bots }) {
    if (this.swarm?.status === "running") throw new Error(`a swarm is running already ("${this.swarm.goal}"): finish or stop it first`);
    const req = await this.requirements(repo || getSettings().cwd);
    if (!req.repo) throw new Error(`${repo || getSettings().cwd} isn't a git repository: swarms work in git`);
    if (!req.gh) throw new Error("Sign in to GitHub first: run `gh auth login` in the terminal");
    if (!req.claudeGithub) throw new Error("Connect GitHub to Claude first: claude.ai → Settings → Connectors → GitHub, then try again");
    const members = (bots?.length ? bots : this.list.map((b) => b.id)).map((id) => this.bot(id));
    const slug = slugify(goal).slice(0, 24) + "-" + Date.now().toString(36).slice(-4);
    const root = req.repo, base = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const dir = path.join(HOME, "worktrees", path.basename(root), slug);
    fs.mkdirSync(dir, { recursive: true });
    const main = `swarm/${slug}/main`;
    await git(root, ["worktree", "add", "-b", main, path.join(dir, "_main"), "HEAD"]);
    const list = [];
    for (const b of members) {
      const wt = path.join(dir, b.id), branch = `swarm/${slug}/${b.id}`;
      await git(root, ["worktree", "add", "-b", branch, wt, main]);
      list.push({ id: b.id, branch, worktree: wt });
    }
    this.swarm = { id: slug, goal, repo: root, base, main, mainWorktree: path.join(dir, "_main"), dir, bots: list, plan: [], stream: [], status: "running", autopilot: true, github: req.github, started: new Date().toISOString() };
    for (const m of list) this.sessions.get(m.id)?.newChat(); // a fresh session in its own worktree
    this.saveSwarm();
    this.post("glyphh", `Swarm started on ${path.basename(root)}: ${goal}. Team: ${members.map((b) => b.name).join(", ")}. Each of you has your own branch off ${main}.`);
    return this.status();
  }

  status() {
    const s = this.swarm;
    if (!s) return { swarm: null, bots: this.list.map((b) => ({ id: b.id, name: b.name, role: b.role })) };
    return { goal: s.goal, status: s.status, repo: s.repo, base: s.base, main: s.main, bots: s.bots.map((m) => ({ ...m, name: this.bot(m.id).name, role: this.bot(m.id).role, busy: this.busy(m.id) })), plan: s.plan, recent: s.stream.slice(-12) };
  }

  assign(id, task) {
    if (!this.member(this.bot(id).id)) throw new Error(`${id} isn't in the running swarm`);
    const b = this.bot(id);
    const item = { id: "p" + (this.swarm.plan.length + 1), text: task, bot: b.id, status: "doing" };
    this.swarm.plan.push(item); this.saveSwarm();
    this.post("glyphh", `${b.name}: ${task}`, b.id);
    this.send(b.id, `[from Glyphh, plan item ${item.id}] ${task}`);
    return `assigned ${item.id} to ${b.name}`;
  }

  setPlan(items) {
    if (!this.swarm) throw new Error("no swarm");
    this.swarm.plan = items.map((it, i) => ({ id: it.id || "p" + (i + 1), text: it.text, bot: it.bot ? this.bot(it.bot).id : null, status: it.status || "todo" }));
    this.saveSwarm();
    return `plan has ${this.swarm.plan.length} items`;
  }
  mark(item, status) {
    const p = this.swarm?.plan.find((x) => x.id === item || x.text === item);
    if (!p) throw new Error(`no plan item ${item}`);
    p.status = status; this.saveSwarm();
    return `${p.id} ${status}`;
  }

  async merge(id) {
    const m = this.member(this.bot(id).id); if (!m) throw new Error(`${id} isn't in the running swarm`);
    const dirty = await git(m.worktree, ["status", "--porcelain"]);
    if (dirty) throw new Error(`${this.bot(id).name} has uncommitted changes; ask them to commit first`);
    try {
      const out = await git(this.swarm.mainWorktree, ["merge", "--no-ff", "-m", `Merge ${this.bot(id).name}'s work (${m.branch})`, m.branch]);
      this.post("glyphh", `Merged ${this.bot(id).name}'s branch into ${this.swarm.main}.`);
      return out || "merged";
    } catch (e) {
      const conflicts = await git(this.swarm.mainWorktree, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
      await git(this.swarm.mainWorktree, ["merge", "--abort"]).catch(() => {});
      throw new Error(`conflicts merging ${m.branch}: ${conflicts || e.message}. Ask ${this.bot(id).name} to merge ${this.swarm.main} into their branch and resolve them.`);
    }
  }

  /** Finish: open a pull request (pr), merge into the user's checkout (merge), or keep the branch (keep); then clear the worktrees and bot branches. */
  async finish({ into = "pr", title, body }) {
    const s = this.swarm; if (!s) throw new Error("no swarm");
    for (const m of s.bots) { await this.sessions.get(m.id)?.interrupt(); }
    let result = "";
    if (into === "pr") {
      const ok = await this.askPermission("swarm · push and open a pull request", { repo: s.repo, branch: s.main, base: s.base, title: title || s.goal });
      if (!ok) throw new Error("The user said no to the pull request.");
      await git(s.mainWorktree, ["push", "-u", "origin", s.main]);
      result = (await run("gh", ["pr", "create", "--base", s.base, "--head", s.main, "--title", title || s.goal, "--body", body || `Built by a Glyphh OS swarm: ${s.bots.map((m) => this.bot(m.id).name).join(", ")}.\n\n${s.plan.map((p) => `- [${p.status === "done" ? "x" : " "}] ${p.text}`).join("\n")}`], { cwd: s.mainWorktree })).stdout.trim();
    } else if (into === "merge") {
      const cur = await git(s.repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (cur !== s.base) throw new Error(`your checkout is on ${cur}, not ${s.base}; switch back first`);
      if (await git(s.repo, ["status", "--porcelain", "--untracked-files=no"])) throw new Error("your checkout has uncommitted changes; commit or stash them first");
      result = await git(s.repo, ["merge", "--no-ff", "-m", `Merge swarm: ${s.goal}`, s.main]);
    }
    for (const m of s.bots) {
      await git(s.repo, ["worktree", "remove", "--force", m.worktree]).catch(() => {});
      await git(s.repo, ["branch", "-D", m.branch]).catch(() => {});
    }
    await git(s.repo, ["worktree", "remove", "--force", s.mainWorktree]).catch(() => {});
    if (into === "merge") await git(s.repo, ["branch", "-D", s.main]).catch(() => {});
    await git(s.repo, ["worktree", "prune"]).catch(() => {});
    fs.rmSync(s.dir, { recursive: true, force: true });
    s.status = "done"; s.result = result; s.ended = new Date().toISOString();
    this.post("glyphh", into === "pr" ? `Pull request opened: ${result}` : into === "merge" ? `Merged into ${s.base}.` : `Kept the work on ${s.main}.`);
    this.saveSwarm();
    for (const m of s.bots) this.sessions.get(m.id)?.newChat();
    return result || "done";
  }

  async stop() {
    if (!this.swarm) return "no swarm";
    for (const m of this.swarm.bots) await this.sessions.get(m.id)?.interrupt();
    this.swarm.autopilot = false; this.saveSwarm();
    return "stopped every bot; the swarm's branches are kept until you finish it";
  }
  resume() { if (this.swarm) { this.swarm.autopilot = true; this.saveSwarm(); } return "autopilot on"; }

  // ── tools ───────────────────────────────────────────────────────────
  /** The orchestrator's tools: added to Glyphh's own "os" server. */
  orchestratorTools() {
    const B = z.string().describe("bot id or name");
    return [
      tool("bots_list", "The user's Glyphh bots: name, role, cat, voice, model, and whether each is busy.", {},
        safe(async () => text(JSON.stringify(this.list.map((b) => ({ ...b, busy: this.busy(b.id) })), null, 2)))),
      tool("bot_create", "Make a new Glyphh bot from the bot template: a name, a role, a personality, standing instructions, a cat to look like (glyphh, side-eye, big-eye, sleepy, wink, star-eye, tall-ears, folded-ear, spiky, round-ears, bolt-tail, curl-tail, long-tail, antenna, cape, bolt-mark) and optionally an ElevenLabs voice id. Ask the user before making one.",
        { name: z.string(), role: z.string(), personality: z.string().optional(), instructions: z.string().optional(), look: z.string().optional(), voiceId: z.string().optional(), model: z.string().optional() },
        safe(async (a) => text(JSON.stringify(this.create(a))))),
      tool("bot_update", "Change a bot: its role, personality, instructions, cat, voice, model or effort.", { bot: B, role: z.string().optional(), personality: z.string().optional(), instructions: z.string().optional(), look: z.string().optional(), voiceId: z.string().optional(), model: z.string().optional(), effort: z.string().optional() },
        safe(async ({ bot, ...p }) => text(JSON.stringify(this.update(bot, p))))),
      tool("bot_open", "Open a bot's session panel (its avatar and chat) on screen, in an area.", { bot: B, area: z.enum(["left", "left-bottom", "center", "right", "right-bottom"]).optional() },
        safe(async (a) => text(await this.ui("bot", { id: this.bot(a.bot).id, area: a.area })))),
      tool("bot_send", "Send a bot a message or task directly (outside a swarm, or a side question inside one). Its answer streams into its panel, and into the swarm if it's in one.", { bot: B, message: z.string() },
        safe(async (a) => text(this.send(a.bot, a.message)))),
      tool("swarm_start", "Start a swarm: a goal, a git repo (default: the working folder) and the bots on it (default: all). Needs GitHub (gh signed in) and GitHub connected to Claude. Makes an integration branch swarm/<slug>/main and a branch + worktree per bot, opens the swarm layout. Then make the plan (swarm_plan) and assign work (swarm_assign).",
        { goal: z.string(), repo: z.string().optional(), bots: z.array(z.string()).optional() },
        safe(async (a) => { const st = await this.start(a); await this.ui("swarm", {}).catch(() => {}); return text(JSON.stringify(st, null, 2)); })),
      tool("swarm_status", "The running swarm: goal, branches, each bot's worktree and whether it's busy, the plan, and the last messages.", {},
        safe(async () => text(JSON.stringify(this.status(), null, 2)))),
      tool("swarm_plan", "Set the swarm's plan: the whole list of items, each with text, the bot it's for and a status (todo, doing, done).", { items: z.array(z.object({ text: z.string(), bot: z.string().optional(), status: z.enum(["todo", "doing", "done"]).optional(), id: z.string().optional() })) },
        safe(async (a) => text(this.setPlan(a.items)))),
      tool("swarm_assign", "Give a bot in the swarm a task: it becomes a plan item and goes to the bot, who works on its own branch and reports back.", { bot: B, task: z.string() },
        safe(async (a) => text(this.assign(a.bot, a.task)))),
      tool("swarm_say", "Say something to the whole team in the swarm's conversation (spoken in your voice).", { text: z.string() },
        safe(async (a) => text(this.post("glyphh", a.text)))),
      tool("swarm_merge", "Merge a bot's branch into the swarm's integration branch (after it reports done and has committed). On conflicts it aborts and says which files.", { bot: B },
        safe(async (a) => text(await this.merge(a.bot)))),
      tool("swarm_finish", "Finish the swarm: into='pr' pushes the integration branch and opens a pull request on GitHub (asks the user first), 'merge' merges it into the user's checkout, 'keep' leaves the branch. Then removes every worktree and bot branch.",
        { into: z.enum(["pr", "merge", "keep"]), title: z.string().optional(), body: z.string().optional() },
        safe(async (a) => text(await this.finish(a)))),
      tool("swarm_stop", "Stop every bot in the swarm and pause autopilot (their branches stay until you finish).", {}, safe(async () => text(await this.stop()))),
    ];
  }

  /** A bot's own tools for working in the swarm. */
  botServer(id) {
    return createSdkMcpServer({
      name: "swarm", version: "0.1.0",
      tools: [
        tool("swarm_post", "Tell the team something while you work (spoken in your voice in the swarm's conversation).", { text: z.string() },
          safe(async (a) => text(this.post(id, a.text)))),
        tool("swarm_ask", "Ask another bot on the team something; their answer comes back in the swarm's conversation.", { bot: z.string(), question: z.string() },
          safe(async (a) => { const to = this.bot(a.bot); this.post(id, `${to.name}, ${a.question}`, to.id); return text(this.send(to.id, `[from ${this.bot(id).name}] ${a.question}`)); })),
        tool("swarm_plan_mark", "Mark an item of the swarm's plan todo, doing or done.", { item: z.string(), status: z.enum(["todo", "doing", "done"]) },
          safe(async (a) => text(this.mark(a.item, a.status)))),
        tool("swarm_status", "The swarm: goal, branches, who is on it, the plan and the last messages.", {},
          safe(async () => text(JSON.stringify(this.status(), null, 2)))),
      ],
    });
  }
}

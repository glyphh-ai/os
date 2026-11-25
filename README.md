# Glyphh OS

An AI operating system on Electron: a talking holographic Claude at the center, your tools around it.

- **Center**: Glyphh, the alien cat in black and white 3D (built from the mascot's own outline; ears, tail and eye alive), who speaks (ElevenLabs) and listens (push to talk, or continuous conversation), on a swipeable carousel of apps (trackpad swipe, drag the edges, ⌘⌥←/→, or the dots).
- **Bots**: your Glyphh bots in the left rail, searchable, each a cat from the brand set with a name, role, personality, instructions, ElevenLabs voice, model and effort (the bot template); click one for its own session panel (its 3D cat, chat, caret input, model/effort/voice chips). Bots remember through your glyphh and learn their calls with Ada gates via the Glyphh connector.
- **Swarm**: a team of bots on one goal in a git repo, orchestrated by Glyphh. Every bot works on its own branch and worktree (`swarm/<slug>/<bot>`), Glyphh merges into `swarm/<slug>/main`, and it finishes as a pull request. One shared stream shows every bot's report, the Plan panel tracks the work, and with voices on each bot speaks in turn. Needs GitHub signed in with `gh auth login`, which is how Claude reaches GitHub.
- **Left and right rails**: each has a top and a bottom area with tabs (git bottom left, the terminal bottom right by default); `+` adds a tab, drag tabs between areas, drag the splitters to resize, and collapse a rail to an icon strip (⇤ / ⇥, ⌘B, ⌘⇧B).
- **Prompt**: close it with ✕ and Glyphh stays as a pill at the bottom center (click it or ⌘K to reopen).
- **Apps modal (▦)**: paged; add your own apps (name, address, icon, where it opens), and open layouts — grids of apps like the desktop's (Split, Thirds, Grid 2×2, Main + two, Dev, Social, Comms, or your own) as a center slide.
- **Apps**: files, editor (Monaco), terminal, git, browser, email, calendar, connections, Slack, X, Instagram, YouTube analytics, and any url.
- **Agent**: the Claude Agent SDK on your own Claude Code login, so there is no API key: run `claude` then `/login` once. Pick the model and effort under the input. Email, calendar and the rest come from your Claude connectors (claude.ai → Settings → Connectors).
- **RPA**: the agent has an `os` tool server to open, move, focus and close apps, drive any web app (outline, click, type, read, keys, eval, screenshot), run commands in the visible terminal, open files and load workspaces.
- **.dip workspaces**: `.dip dev`, `.dip social`, `.dip comms`, `.dip focus`, `.dip save <name>`, `.dip list`; also `.open <app> [left|center|right] [url]`, `.close`, `.move`, `.face`, `.new`.

## Run

```bash
npm install
npm run dev
```

Set your ElevenLabs API key in Settings (⚙, top right); it is kept in your OS keychain. Everything else lives in `~/.glyphh/os/`.

## License

MIT


## License

Apache-2.0. See LICENSE and NOTICE. Copyright 2026 Chris Timmerman / Glyphh AI LLC. More about it: https://glyphh.ai/projects/glyphh-os

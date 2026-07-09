# cc-manager

A local web UI to see, understand, and tune everything that shapes how Claude Code behaves on your machine.

Plugins, agents, hooks, MCP servers, skills, slash commands, marketplaces, sessions, permissions, and settings — all in one place. Three clicks, one search box, full picture. Toggle plugins, install from the marketplace, edit permissions, see what your setup costs in tokens, and undo any change with automatic snapshots.

![cc-manager UI](demo-snapshot.png)

---

## Why a web UI for a terminal tool

Terminals are write-optimized. They reward speed, scripting, and automation. They are not built for browsing complex state.

Understanding your Claude Code setup is mostly a *read* job — what plugins do I have, which hooks fire on `PreToolUse`, which MCP servers are configured, in which scope? In a terminal that's `ls`, `cat`, `jq`, `grep`, repeated until you've reconstructed the picture in your head. In a browser it's one click.

And once the full picture is on screen, tuning it belongs next to it: the toggle goes on the plugin card, the price tag goes next to the toggle, the undo button goes next to the change. `cc-manager` is the control panel that pairs with Claude Code's terminal — the spanner for the robot.

---

## What you get

**Discovery** — every plugin, slash command, subagent, skill, hook (with health checks), MCP server, and marketplace catalog, cross-linked and searchable from one box.

**Insight** — a conflict banner when plugins collide or hooks break; session stats across every project; a **context budget** tab showing what your setup costs in tokens at the start of every session, aggregated per plugin so you know exactly what disabling something saves.

**Control** — enable/disable plugins from their cards; one-click marketplace install (two-click uninstall); a full **permissions editor** for the allow/ask/deny lists across user, project, and local scopes. No hand-editing settings.json.

**Safety** — every change is preceded by an automatic config snapshot; restore any snapshot from the Settings tab. Restores are themselves snapshotted, so undo is undoable. Plugin actions run through the official `claude plugin` CLI, never hand-edited state.

**Quality of life** — open/reveal any file path from its drawer; light/dark/system theme; refresh without restarting; `/cc-manager:open`, `/cc-manager:close`, `/cc-manager:doctor` slash commands.

Full tour: [docs/features.md](docs/features.md)

---

## Install

### As a Claude Code plugin (recommended)

```
/plugin marketplace add vamshisuram/cc
/plugin install cc-manager
```

Then:

- `/cc-manager:open` — start the server and open the UI in your browser
- `/cc-manager:close` — stop the server
- `/cc-manager:doctor` — terminal-only health summary (skip the browser when you only need the headline)

### Direct

```bash
git clone https://github.com/vamshisuram/cc-manager.git
cd cc-manager
node server.mjs
```

Auto-opens `http://localhost:4178`. Env vars: `PORT=4180`, `NO_OPEN=1`. No dependencies, no build step — plain `node` is enough.

---

## Safety model, in one paragraph

Everything is read straight from disk; no telemetry, no analytics, no network calls; the server binds to `localhost` only. Writes are narrow and guarded: plugin actions shell out to the official `claude plugin` CLI so results always match the terminal, permission edits refuse to touch a file that doesn't parse, and every change is preceded by a snapshot of the affected config files (kept under `~/.claude/cc-manager/snapshots/`, restorable from the UI). Changes apply to new Claude Code sessions, not running ones.

Details: [docs/architecture.md](docs/architecture.md) · API reference: [docs/api.md](docs/api.md)

---

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/features.md](docs/features.md) | Tab-by-tab tour: overview, sessions, context budget, marketplace, plugins, hooks, permissions editor, snapshots, search |
| [docs/api.md](docs/api.md) | HTTP API reference — every endpoint with request/response examples |
| [docs/architecture.md](docs/architecture.md) | The two-file design, every file it reads, how mutations and snapshots work, security boundaries |

---

## Roadmap

The goal is to be the spanner for the robot — the single place where you understand *and* tune your Claude Code. 0.2 added the first mutations (plugin toggles, marketplace install/uninstall, snapshot/undo). 0.3 added the permissions editor and the context budget tab. Coming next:

- Session detail drill-in with token cost and tool-call breakdown
- Hook manager — enable/disable, test-fire with sample payloads, execution log
- MCP server manager — add / edit / connect-test, tool inspection
- Settings diff and conflict resolver across the three sources
- Full setup export / profiles ("work", "personal", "minimal")

PRs welcome. Issues even more welcome.

---

## Architecture

Two files. No build step. No npm dependencies.

- `server.mjs` — plain Node http server: reads Claude Code's on-disk state, serves it as one JSON payload, hosts the guarded write endpoints
- `cc-manager.html` — single-page UI, hydrates from `/api/state`

If the disk layout changes, you fix one file. If the UI changes, you fix one file. The long version lives in [docs/architecture.md](docs/architecture.md).

---

## License

MIT. See [LICENSE](LICENSE).

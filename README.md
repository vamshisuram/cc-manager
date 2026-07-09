# cc-manager

A local web UI to see, understand, and tune everything that shapes how Claude Code behaves on your machine.

Plugins, agents, hooks, MCP servers, skills, slash commands, marketplaces, sessions, permissions, and settings — all in one place. Three clicks, one search box, full picture. Toggle plugins, install from the marketplace, and undo any change with automatic snapshots.

![cc-manager UI](demo-snapshot.png)

---

## Why a web UI for a terminal tool

Terminals are write-optimized. They reward speed, scripting, and automation. They are not built for browsing complex state.

Managing your Claude Code setup is mostly a *read* job. You want to know:

- What plugins do I have, and what does each one actually contribute?
- Which slash commands exist? Where do they come from?
- What hooks fire on `PreToolUse`? Are any of them broken?
- Which MCP servers are configured? In which scope?
- What's in the marketplace I haven't installed yet?

In a terminal that's `ls`, `cat`, `jq`, `grep`, repeated until you've reconstructed the picture in your head. In a browser it's one click.

Web is read-optimized. Visual layouts. Hover for detail. Click to drill in. Search across everything at once. Different tool for a different job.

`cc-manager` is the read interface that pairs with Claude Code's terminal. Both are needed.

---

## What you get

**Discovery**
- Every installed plugin with its commands, agents, hooks, skills, and MCP servers cross-linked
- Every slash command with the file that defines it and the agent it invokes
- Every subagent with its tool grants
- Every hook grouped by lifecycle event, with health checks against the scripts they reference
- Every MCP server with scope, transport, and configured/connected state
- Your full marketplace catalog — every plugin from every configured marketplace, filterable, marked installed or not

**Insight**
- Conflict banner on the overview if two plugins claim the same command, an agent collides, a hook references a missing script, or an MCP server is disconnected
- Sessions tab — total sessions, total messages, most-active projects, recent context across every project in `~/.claude/projects`
- Global search — type once, find any command, agent, hook, plugin, permission, marketplace plugin, anywhere

**Control** (new in 0.2)
- Enable / disable any plugin with the toggle on its card — applies to new sessions
- One-click install from the marketplace tab; uninstall with a two-click confirm
- Every change is preceded by an automatic config snapshot — restore any snapshot from the Settings tab (restores are themselves snapshotted, so undo is undoable)

**Quality of life**
- Click a file path in any drawer to open it in your editor or reveal in Finder
- Light / dark / system theme, persisted
- Refresh button — pulls fresh state without restarting
- Three slash commands: `/cc-manager:open`, `/cc-manager:close`, `/cc-manager:doctor`

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

Auto-opens `http://localhost:4178`. Env vars: `PORT=4180`, `NO_OPEN=1`.

---

## What it reads

| Tab | Source |
| --- | --- |
| Plugins | `~/.claude/plugins/installed_plugins.json` + each plugin's manifest |
| Slash commands | `~/.claude/commands/` + each plugin's `commands/` |
| Subagents | `~/.claude/agents/` + each plugin's `agents/` (frontmatter parsed) |
| Skills | `~/.claude/skills/*/SKILL.md` + each plugin's `skills/` |
| Hooks | `~/.claude/settings.json` + each plugin's `hooks/hooks.json`, with script-existence checks |
| MCP servers | `~/.claude.json` (`mcpServers` per scope) |
| Sessions | `~/.claude/projects/*/sessions-index.json` |
| Marketplace | `~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json` |
| Permissions | `~/.claude/settings.json` `permissions.allow / deny / ask` |
| CLAUDE.md | `./CLAUDE.md` and `~/.claude/CLAUDE.md` |
| Settings | All three `settings.json` files (user, project, project-local) shown side-by-side |

Everything is read straight from disk. No telemetry. No analytics. No network calls. Server binds to `localhost` only. The read endpoints that touch the filesystem (`/api/script`, `/api/open`) are sandboxed to `~/.claude` and the current working directory.

**How mutations work.** The write endpoints (`POST /api/plugin`, `POST /api/snapshots/restore`) never edit config files by hand — plugin actions shell out to the official `claude plugin` CLI (`enable`, `disable`, `install`, `uninstall`, `update`), so behavior always matches what the terminal would do. Before any change, the affected config files (`~/.claude/settings.json`, `installed_plugins.json`, and project `.claude/settings*.json`) are snapshotted to `~/.claude/cc-manager/snapshots/` (last 40 kept). Changes apply to new Claude Code sessions, not running ones.

---

## Roadmap

The goal is to be the spanner for the robot — the single place where you understand *and* tune your Claude Code. 0.2 added the first mutations (plugin toggles, marketplace install/uninstall, snapshot/undo). Coming next:

- Permissions editor — move rules between allow / deny / ask across scopes
- Context budget visualizer — what your setup costs in tokens per session
- Session detail drill-in with token cost and tool-call breakdown
- Hook manager — enable/disable, test-fire with sample payloads, execution log
- MCP server manager — add / edit / connect-test, tool inspection
- Settings diff and conflict resolver across the three sources
- Full setup export / profiles ("work", "personal", "minimal")

PRs welcome. Issues even more welcome — tell me what's missing from the read surface before we add mutations.

---

## Architecture

Two files. No build step. No npm dependencies.

- `server.mjs` — plain Node http server, ~600 lines, reads from disk and exposes `/api/state`, `/api/script`, `/api/open`
- `cc-manager.html` — single-page UI, ~2000 lines including styles, hydrates from `/api/state`

If the disk layout changes, you fix one file. If the UI changes, you fix one file. That's the whole pitch on the engineering side.

---

## License

MIT. See [LICENSE](LICENSE).

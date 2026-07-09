# Architecture

Two files. No build step. No npm dependencies.

- **`server.mjs`** — plain Node http server. Reads Claude Code's on-disk state, serves it as one JSON payload, and hosts the write endpoints. Run it with nothing but `node`.
- **`cc-manager.html`** — single-page UI including all styles and scripts. Hydrates from `/api/state`.

If the disk layout changes, you fix one file. If the UI changes, you fix one file.

## What it reads

| Data | Source |
| --- | --- |
| Plugins | `~/.claude/plugins/installed_plugins.json` + each plugin's `plugin.json` / `.claude-plugin/plugin.json` |
| Enabled state | `enabledPlugins` maps merged across user, project, and project-local `settings.json` (absent = enabled, explicit `false` = disabled) |
| Slash commands | `~/.claude/commands/` + each plugin's `commands/` (frontmatter parsed) |
| Subagents | `~/.claude/agents/` + each plugin's `agents/` |
| Skills | `~/.claude/skills/*/SKILL.md` + each plugin's `skills/` |
| Hooks | `~/.claude/settings.json` + each plugin's `hooks/hooks.json`, with script-existence and executable-bit checks |
| MCP servers | `~/.claude.json` (`mcpServers`, per user scope and per project) |
| Sessions | `~/.claude/projects/*/sessions-index.json` |
| Marketplaces | `~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json` |
| Permissions | `permissions.allow / deny / ask` in all three settings scopes |
| CLAUDE.md | `./CLAUDE.md` and `~/.claude/CLAUDE.md` |
| Context budget | Derived from the above: file contents for CLAUDE.md/memory, name+description lines for skills/commands/agents, ~4 chars per token |

Manifest quirk worth knowing: a plugin manifest's `commands` / `agents` fields can be either a directory path (string) or an explicit list of files (array) — both are handled.

## How mutations work

The design rule: **cc-manager never hand-edits state that an official CLI owns.**

- Plugin actions (`enable`, `disable`, `install`, `uninstall`, `update`) shell out to `claude plugin …` via `spawn` (no shell interpolation), so results are identical to the terminal and survive Claude Code version changes.
- Permission edits have no CLI, so cc-manager edits the settings JSON directly — with guardrails: a file that exists but doesn't parse is never written, and cross-scope moves add-then-remove so a failure can't lose a rule.

All changes apply to **new** Claude Code sessions. Running sessions keep the state they started with.

## Snapshots

Before any write, the files a mutation can touch are copied to:

```
~/.claude/cc-manager/snapshots/<ISO-timestamp>__<action>/
    manifest.json          # { id, action, createdAt, files: [{ original, stored, existed }] }
    0__settings.json       # numbered copies of each file that existed
    1__installed_plugins.json
    ...
```

Snapshotted files: `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, `~/.claude/plugins/config.json`, and the project's `.claude/settings.json` / `.claude/settings.local.json`.

Restoring copies the stored files back over the originals — after first snapshotting the *current* state (action `pre-restore`), which makes restore itself undoable. Files recorded as non-existent at snapshot time are never deleted on restore; they're reported as skipped. The newest 40 snapshots are kept.

## Security boundaries

- The server binds to `localhost` only. No telemetry, no analytics, no outbound network calls.
- Read endpoints that accept a path (`/api/script`, `/api/open`) resolve it and require it to be inside `~/.claude` or the server's working directory.
- `POST /api/plugin` validates the action against a whitelist and the plugin id against `[A-Za-z0-9@._/-]{1,200}`; arguments are passed as an argv array, never through a shell.
- `POST /api/permissions` validates list/scope against whitelists and rejects rules with control characters.
- Snapshot ids are validated against `[A-Za-z0-9_.-]` — no path traversal into or out of the snapshot store.
- Request bodies are capped at 64 KB.

## Process lifecycle

- Default port `4178` (`PORT` to override); auto-opens the browser unless `NO_OPEN=1`
- PID file at `/tmp/cc-manager.pid` — `/cc-manager:close` uses it to stop the server
- The HTML is read from disk per request, so UI edits show up on browser refresh with no restart; `/api/state` re-reads all sources on every call, so the Refresh button always reflects current disk state

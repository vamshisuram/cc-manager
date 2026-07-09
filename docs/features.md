# Features — tab by tab

A tour of every tab in the UI, what it shows, and what you can do from it.

## Overview

The landing page. Shows:

- **Issue banner** — appears when something needs attention: two plugins defining the same slash command, colliding subagent names, hooks pointing at scripts that no longer exist, or disconnected MCP servers.
- **Stat strip** — plugins enabled vs installed, active hooks, available subagents, MCP connections.
- **Hook lifecycle** — a visual timeline of the events Claude Code fires during a turn (`SessionStart` → `UserPromptSubmit` → `PreToolUse` → `PostToolUse` → … → `Stop`), with a dot per event showing how many hooks are attached. Click any event to jump to the Hooks tab.
- **Active plugins** — quick cards for your most relevant plugins.

## Sessions

Aggregates every project under `~/.claude/projects`:

- Total sessions and messages across all projects
- Most-active projects, sorted by last activity
- Recent sessions with their summary, message count, and git branch

## Context budget

What your setup costs in tokens at the start of every session, before you type a word. Categories:

| Category | What's counted |
| --- | --- |
| CLAUDE.md & memory | Full contents of `./CLAUDE.md`, `~/.claude/CLAUDE.md`, and the project memory index (`MEMORY.md`) — these are injected verbatim |
| Skill descriptions | Name + description of every available skill (announced to the model each session) |
| Slash command descriptions | Name + description of every command |
| Subagent descriptions | Name + description + tool list of every agent type |

Views:

- **Stat strip** — total per-session cost and what percentage of a 200k window it consumes
- **Where it goes** — stacked bar by category
- **Cost by source** — per-plugin totals. This is the actionable one: it tells you exactly what disabling a plugin (from the Plugins tab) saves on every future session.
- **Per-category breakdowns** — the individual line items, heaviest first

Estimates use the ~4 characters per token heuristic. MCP tool schemas are **not** included — they depend on which servers connect at runtime and whether their tools are deferred.

## Marketplace

Every plugin from every configured marketplace, filterable, with installed/not-installed state.

- **install** — one click. Runs `claude plugin install <name>@<marketplace>` under the hood, snapshots your config first.
- **uninstall** — two clicks. The first arms the button (`confirm uninstall?`), the second executes. Disarms itself after 4 seconds.

## Plugins

One card per installed plugin showing its command/agent/hook/skill/MCP counts.

- **Toggle** — enable or disable the plugin. Writes through `claude plugin enable|disable`, so the result is identical to doing it in the terminal. Applies to new sessions; running sessions are unaffected.
- **Card click** — opens a drawer with the plugin's description, content counts, its actual manifest (`plugin.json`), version, and scope.

## Slash commands / Subagents / Skills

Inventories with provenance — each item shows which plugin (or `user` directory) defines it. Command drawers show the defining file with open/reveal links and any agents the command references.

## Hooks

All hooks from `~/.claude/settings.json` and every plugin's `hooks/hooks.json`, grouped by lifecycle event.

Each hook that references a script file gets a health check: does the file exist, and is it executable? Broken references are flagged in red and surface on the Overview banner. The drawer shows a preview of the referenced script.

## MCP servers

Servers from `~/.claude.json`, per scope (user and per-project), with transport and command/URL.

## CLAUDE.md

The project and user memory files, shown as-is.

## Permissions

A real editor for the `permissions.allow / ask / deny` lists across all three scopes (user `~/.claude/settings.json`, project `.claude/settings.json`, project-local `.claude/settings.local.json`).

- **Add** — type a rule (e.g. `Bash(git status)`, `Read(**)`, `WebFetch(domain:docs.foo.com)`), pick the list and scope, press Enter. Adding to a scope whose file doesn't exist creates the file.
- **Move** — each rule has `→ allow` / `→ ask` / `→ deny` buttons to move it between lists within its scope.
- **Delete** — two-click confirm, same pattern as uninstall.

Every operation snapshots your config first, refuses to write a settings file that exists but doesn't parse, and removing the last rule in a list removes the empty key so files stay tidy.

## Settings

The three settings files side by side, as-is, no merging — plus the **Config snapshots** panel:

- One snapshot per mutation made from the UI, newest first, named after the action that triggered it
- **restore** — copies the snapshotted files back. The current state is snapshotted *before* restoring, so a restore is itself undoable.
- The last 40 snapshots are kept, under `~/.claude/cc-manager/snapshots/`

## Global search

The search box in the top bar matches across plugins, commands, agents, skills, hooks, MCP servers, permission rules, and marketplace plugins at once. Click a result to jump to its tab.

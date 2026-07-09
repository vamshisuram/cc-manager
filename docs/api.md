# HTTP API

The server binds to `localhost` only (default port `4178`, override with `PORT`). All responses are JSON. Errors come back as `{ "error": "<message>" }` with a 4xx/5xx status.

## Read endpoints

### `GET /api/state`

The entire UI state in one payload. Everything is read fresh from disk on each call.

Top-level keys:

| Key | Contents |
| --- | --- |
| `plugins` | Installed plugins with `id` (`name@marketplace`), version, scope, install path, real `enabled` state, content counts, and the parsed manifest |
| `commands` | Every slash command with provenance, description, defining file |
| `agents` | Every subagent with description, model, tool grants |
| `skills` | Every skill with provenance and description |
| `hooks` | Every hook with lifecycle event, matcher, command, source, and script health (`ok` / `broken`, executable bit) |
| `mcp` | MCP servers per scope with transport |
| `permissions` | Merged `allow` / `deny` / `ask` lists plus `sources` — the per-scope breakdown with file paths |
| `memory` | CLAUDE.md sources (project + user) with contents |
| `contextBudget` | Per-session token cost estimate: `total`, `groups` (per category, with sorted line items), `perPlugin` (cost by source), and a `note` on methodology |
| `settings` | The three settings files (user / project / project-local), as-is |
| `marketplaces` | Every configured marketplace with its full plugin catalog and installed flags |
| `sessions` | Session stats across `~/.claude/projects` |
| `snapshots` | Config snapshots, newest first |
| `conflicts` | Detected issues (duplicate commands/agents, broken hooks, disconnected MCP) |
| `meta` | Generation timestamp, `~/.claude` path, cwd |

### `GET /api/script?path=<abs-path>`

Preview a file's contents (truncated at 16 KB). Only paths inside `~/.claude` or the server's working directory are allowed.

### `GET /api/open?path=<abs-path>&action=open|reveal`

Open a file in the default app or reveal it in Finder / Explorer. Same path sandbox as `/api/script`.

### `GET /api/snapshots`

```json
{ "snapshots": [ { "id": "2026-07-09T07-08-18-953Z__perm-add-ask", "action": "perm-add-ask", "createdAt": "...", "fileCount": 2 } ] }
```

## Write endpoints

Every write snapshots the affected config files **before** touching anything. See [architecture.md](architecture.md#snapshots) for the on-disk layout.

### `POST /api/plugin`

Runs the official `claude plugin` CLI — cc-manager never edits plugin state by hand.

```json
{ "action": "enable | disable | install | uninstall | update", "plugin": "name@marketplace", "scope": "user | project | local" }
```

- `plugin` accepts a bare name or `name@marketplace`; validated against `[A-Za-z0-9@._/-]`
- `scope` is optional (CLI default applies: auto-detect for enable/disable, `user` for install/uninstall)
- The CLI call times out after 120 s

Response:

```json
{ "ok": true, "code": 0, "stdout": "✔ Successfully disabled plugin ...", "stderr": "", "snapshotId": "2026-...__disable-cc-caffeine_samber" }
```

On failure `ok` is `false`, the status is 500, and `error` carries the best available message. The snapshot is taken either way.

### `POST /api/permissions`

Edits `permissions.allow / ask / deny` in the settings file for a scope. Three operations:

```json
{ "op": "add",    "rule": "Bash(npm test)", "list": "allow", "scope": "project" }
{ "op": "remove", "rule": "Bash(npm test)", "list": "allow", "scope": "project" }
{ "op": "move",   "rule": "Bash(npm test)", "from": { "scope": "project", "list": "allow" }, "to": { "scope": "local", "list": "deny" } }
```

Rules of the road:

- `list` ∈ `allow | deny | ask`; `scope` ∈ `user | project | local`
- Rules are validated (1–500 chars, no control characters); duplicates in the same list are rejected; removing a rule that isn't there is an error
- A settings file that exists but doesn't parse is never written — you get an error telling you to fix it by hand
- Cross-scope moves add to the destination **before** removing from the source: a mid-operation failure can leave a duplicate, never a lost rule
- Removing the last rule in a list deletes the empty key (and an empty `permissions` object entirely)

Response includes the fresh permissions state:

```json
{ "ok": true, "permissions": { "allow": [...], "deny": [...], "ask": [...], "sources": [...] } }
```

### `POST /api/snapshots/restore`

```json
{ "id": "2026-07-09T07-08-18-953Z__perm-add-ask" }
```

Copies the snapshotted files back to their original locations. The current state is snapshotted first (action `pre-restore`), so restores are undoable. Files that didn't exist at snapshot time but exist now are left alone and reported in `skipped`.

```json
{ "ok": true, "restored": ["/Users/you/.claude/settings.json", "..."], "skipped": [] }
```

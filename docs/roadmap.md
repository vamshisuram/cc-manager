# Roadmap — working notes

Where we are and what's next, in priority order. Written as a resume-point for the next working session.

**Shipped so far:** 0.1 read-only inspector → 0.2 mutations (plugin toggles, marketplace install/uninstall, snapshot/undo) → 0.3 permissions editor + context budget tab.

**The thesis:** cc-manager is the spanner for the robot — the single place where you understand *and* tune your Claude Code. Terminal does the work; cc-manager tunes the worker.

---

## 1. Session drill-in (next up)

Today the Sessions tab shows aggregate counts. Drill into a single session:

- Click a session → drawer/page with per-session token cost, tool-call histogram, which skills/agents were actually invoked
- Data source: session `.jsonl` transcripts under `~/.claude/projects/<key>/` — parse message records for `usage` fields (input/output/cache tokens) and tool_use blocks
- Cross-reference with inventory: "you have 47 slash commands installed; here are the 5 you used in 90 days" — dead-weight detection that pairs with the context budget tab
- Watch out: transcripts can be large; parse lazily per-session on request (`GET /api/session?id=...`), not in `/api/state`

## 2. Hook manager

- Enable/disable a hook without deleting it (comment-out semantics: move to a `disabledHooks` key or wrap the entry)
- Test-fire a hook with a synthetic payload for its event type; show stdout/stderr/exit code in the drawer
- Execution log if feasible (hooks write no log today — may need a wrapper or to read Claude Code's debug output)
- Matcher editor with validation

## 3. MCP server manager

- Add / edit / remove servers per scope (edits `~/.claude.json` — snapshot first, add it to `mutationTargets()`)
- Connect-test button: actually spawn/connect the server, list its tools, report failure output
- Once connectable: include real tool-schema sizes in the context budget (currently excluded, noted in UI)

## 4. Settings diff & conflict resolver

- Side-by-side is there; add a computed "effective config" view — what Claude actually sees after precedence, each value annotated with its source (like `git config --show-origin`)
- "This key wins" action: move a value to a chosen scope and delete shadowed copies

## 5. Setup export / profiles

- Export full setup as a tarball/JSON (snapshot infrastructure already covers the file list)
- Named profiles ("work", "personal", "minimal") that swap plugin enabled-sets and permission lists
- Shareable diff-from-defaults for team standardization

## Later / ideas parking lot

- Memory manager — browse/edit/prune memory dirs and CLAUDE.md across projects, staleness hints
- Session full-text search across all transcripts (needs an index; first feature that might justify a dependency)
- Recommendation engine — "you manually approve `npm test` 30×/week, add an allow rule?"; "this hook failed its last 12 runs"; overlapping-plugin detection
- `claude plugin details` CLI exposes projected token cost — compare against our estimate, maybe use it as the budget source

## Engineering notes for whoever picks this up

- Keep the two-file/no-deps architecture until session search forces an index
- Every new write endpoint: snapshot first (`takeSnapshot`), validate inputs against whitelists, never route user input through a shell
- Never hand-edit state an official CLI owns (`claude plugin …`, maybe `claude mcp …` for #3)
- UI rows without a leading icon use `.row-flex`, not `.item-row` (which has a 28px icon grid column)
- New features get a section in `docs/features.md` and endpoints in `docs/api.md`

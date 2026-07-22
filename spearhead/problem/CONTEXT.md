# Recon: Spearhead Knowledge Base (A-1)

## Repo conventions

**Naming & layout:**
- Commands: `commands/<name>.md` (user-facing thin wrapper with YAML frontmatter + inline directive to dispatch skill)
- Skills: `skills/spearhead-<name>/SKILL.md` (backend, marked `user-invocable: false`, gate logic and real behavior)
- Hooks: `hooks/<name>.js` (three exist: remind.js, guard.js, validate-state.js; all dependency-free Node scripts)
- State: `scripts/state.js` (CLI, only writer of `spearhead/status.yml`, validates before writing)
- Scripts: Node.js, all dependency-free except MCP server (see risks)
- Tests: Node's built-in `test` module (`*.test.js`), `node:assert/strict`, spawned hook execution via `spawnSync`

**Plugin manifests:**
- `.claude-plugin/plugin.json` — Claude Code manifest (currently no `mcpServers` field declared yet)
- `.kimi-plugin/plugin.json` — kimi-code manifest (identical structure, same `skills/` and `commands/` pointers). Confirmed by the user: kimi-code DOES support MCP servers (corrects the scout's earlier inference from the README's agent-fallback section, which did not cover MCP explicitly)

**Wiring pattern (command → skill):**
1. User runs `/spearhead:foo`
2. `commands/foo.md` is a minimal wrapper with YAML frontmatter setting description and dispatching `Skill` tool to `spearhead-foo`
3. `skills/spearhead-foo/SKILL.md` defines the actual behavior (`user-invocable: false`)
4. Phase mutations via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"` only (never raw Write/Edit to status.yml)

**Dependency philosophy:**
- Zero npm dependencies currently (README line 39: "No npm installs, no network calls")
- All scripts use Node built-ins only (`node:fs`, `node:path`, `node:test`, `node:assert`, `node:child_process`)
- Custom YAML parser in `validate-state.js` (no YAML library), re-exported by `state.js` as the invariant-checker module
- Tests use built-in `test` and `assert/strict`, no jest/mocha/tape

**Hook I/O contract (all three):**
- stdin: JSON payload (hook-event specific)
- stdout: one message (injected into session or empty)
- stderr: violations or errors (exit 2 blocks tool call)
- Exit 0 = allow / silent
- Runs with 10s timeout (plugin.json `timeout` field)
- Handles both Claude Code and kimi-code path shapes (`file_path` vs `tool_input.path`)
- Project directory resolution: `cwd` field → tool input path → fallback hint file (never `process.cwd()`)

**Session state pattern (remind.js example):**
- Session ID key resolution with fallback to `'default'` if not provided (handles both runtimes gracefully)
- Persistent `.remind-state.json` in `spearhead/` tracking prompt counts per session
- Idle expiry (12h) treats sessions as new after silence, preventing starvation
- Cadence-managed injection: full rules on prompt 0 and every 30th; one-line anchor otherwise
- Atomic writes with `fs.writeFileSync()`; failures degrade gracefully (full message every prompt if state unwritable)

**Lint/build/test:**
- No build step documented
- Test: `node hooks/remind.test.js` (direct execution; Node's test runner auto-discovers `.test.js`)
- No CI config shown; verify with `find` if needed (budget permitting)

## Affected surface

**New directories to add:**
- `spearhead-knowledge/` (sibling to `spearhead/`) — storage root for knowledge base
  - `spearhead-knowledge/code/` — code documentation notes (one per source file)
  - `spearhead-knowledge/decisions/` — decision/architecture notes (ATK-scoped)
  - `spearhead-knowledge/architecture/` — cross-attack architecture notes
  - `spearhead-knowledge/index/` — embeddings and index metadata (flat files, no external DB)

**Plugin manifest modifications:**
- `.claude-plugin/plugin.json` — add `mcpServers` block declaring a bundled MCP server (exact schema TBD; reference: turnstile's `brain-mcp-server.js`)
- `.kimi-plugin/plugin.json` — add the equivalent `mcpServers` declaration; kimi-code supports MCP servers (confirmed by user), so both manifests can declare the same server, no fallback needed for this capability

**New hooks (or extend existing remind.js):**
- Hook to nudge code-doc-on-first-read (fires on Read tool, checks `spearhead-knowledge/code/*.md`, nudges if missing)
- Hook to nudge search-first-reminder (fires on UserPromptSubmit when spearhead active, nudges agent to use MCP search tool before reading source files)
- Hook to update code docs on task `done` (fires after task transitions to done, reads task diff, updates each touched file's documentation + changelog)

**New files/directories:**
- MCP server entry point (bundled, declared in plugin.json, loads/watches knowledge sources, serves search tool)
- `CONTEXT.md` for PROBLEM.md (this file)

**Files this feature must NOT modify:**
- `spearhead/status.yml` — must never write directly (only through `state.js`)
- Any existing `spearhead/` pipeline state files

## Risks and unknowns

1. **MCP server declaration in plugin.json**: Neither manifest currently has an `mcpServers` field. Confirm exact schema with Claude Code/kimi-code docs. Hypothesis: similar to turnstile's pattern (e.g. `"mcpServers": [{"name": "spearhead-knowledge", "command": "node ./mcp/server.js"}]`). Both manifests need the equivalent block — kimi-code supports MCP servers (confirmed by user), so no Claude-only fallback is needed here, just the correct schema for each.

2. **Embeddings API**: PROBLEM.md assumes an external embeddings API (API key config, network calls from MCP server). Design phase must specify which provider/model and whether it's configurable. Current risk: API key management, network failures, rate limiting — these are out-of-scope design decisions but block implementation.

3. **Hook timeout budget (10s)**: The nudge-on-first-read and search-first-reminder hooks are subject to the 10s timeout. Creating/writing doc files is fine (I/O-bound), but if a hook needs to query the embeddings API to fetch search results in-session, that adds network latency. Current design assumes nudges only *trigger* writing (they don't do the writing themselves), so this is likely safe. Verify in design phase.

4. **Frontmatter parsing**: New knowledge notes need YAML frontmatter parsing. Could reuse `validate-state.js`'s custom minimal YAML parser (only scalar values + lists, fixed schema), extend it to handle frontmatter (key-value), or add a lightweight dependency. Current design aims for dependency-free, so custom parser is likeliest. Frontmatter structure: `type`, `tags`, `related`, `source`, `updated` (all optional except `type`).

5. **Hook vs. MCP server division of labor**: Hooks nudge (write reminders); MCP server searches (reads index, queries API, returns ranked excerpts). If a nudge hook must read/write/check knowledge files while the server is running and watching them, potential race conditions or ordering issues. Design should clarify: (a) hooks never query the API (only nudge), (b) server handles all embeddings/indexing, (c) wikilink resolution (if any) happens at write time, not query time.

6. **First npm dependency**: This will be the first project to introduce an npm dependency (`@anthropic-ai/sdk` or similar for MCP server harness). Verify if plugin installer/loader expects `node_modules/` to exist, whether `npm install` is run on plugin clone, or whether the MCP server must be bundled/vendored instead. README says "no npm installs" — clarify if that means (a) the plugin *itself* has no deps, but (b) the MCP server may have its own package.json in a subdirectory, or (c) everything must remain zero-dependency (likely not feasible for MCP SDK + embeddings client).

7. **git worktree & file-watch interaction**: The MCP server watches `spearhead-knowledge/` via `fs.watch()`. If a task is executing in a git worktree (`spearhead/tasks/<T-id>.worktree/`), and that task updates code doc files in the main project tree (outside the worktree), the file-watch events should fire normally. Verify no filesystem isolation surprises.

8. **Cascade on attack abort/complete**: When an attack is aborted or completed (via `state.js abort` / `set-attack-complete`), should the knowledge base entries be tagged/archived, or remain searchable? PROBLEM.md doesn't specify retention; assume they remain searchable (immutable log). Design phase should confirm.

9. **Test framework for MCP server**: The MCP server will need its own tests (or integration tests). Current repo uses Node's built-in `test` module. Confirm whether to extend this or add a test framework for server-specific tests (startup, file-watch, embeddings API mocking, search accuracy).

## Prior art

1. **Cadence/session-state pattern (remind.js)**: The new nudge hooks should adopt remind.js's approach to session tracking and cadence-managed injection:
   - Session ID resolution with fallback to `'default'`
   - Persistent state file (`.spearhead-<hook-name>-state.json`) tracking per-session metadata (e.g., files already nudged for code-doc, timestamps)
   - Idle expiry to treat long-silent sessions as new
   - Graceful degradation on write failure (state-less fallback behavior)

2. **CLI-as-sole-writer pattern (state.js)**: The knowledge-base nudge logic must never directly write status.yml (guard.js blocks it anyway); instead, status mutations remain through state.js. For knowledge base writes (notes, metadata), direct writes are fine (new files, not pipeline state). Use the same atomic-write pattern: temp file + rename, never in-place edits.

3. **Thin-command-over-skill pattern**: If a user-facing `/spearhead:recall` command is added (PROBLEM.md line 72), follow the existing pattern: `commands/recall.md` wrapper → `skills/spearhead-recall/SKILL.md` backend. Command itself does nothing but dispatch.

4. **Hook matcher config (guard.js/validate-state.js)**: The plugins.json hooks list uses `matcher` field to filter events. Existing matchers: `Bash|PowerShell|Read|Edit|Write|NotebookEdit|Grep|Glob` (guard.js PreToolUse), `Write|Edit` (validate-state.js PostToolUse). New nudge hooks may need similar matchers (e.g., Read-triggered nudge might matcher on `Read`). Confirm the matcher syntax and whether composition with OR/AND is supported.

5. **Wikilink format**: Use `[[spearhead-knowledge/<type>/<slug>.md]]` as the canonical wikilink path (consistent with PROBLEM.md's naming scheme). Obsidian and other graph tools should recognize this format.

## Budget

- **Reads used**: 13 file reads
  - PROBLEM.md, plugin.json (Claude + kimi), hooks/remind.js, guard.js, validate-state.js (partial), state.js (partial), commands/recon.md, skills/spearhead-recon/SKILL.md, README.md (2 sections), remind.test.js header, plugin structure via bash
- **Characters used**: ~35k (well under 60k limit)
- **Skipped**: No full reads of test files beyond headers; CI/CD config (if any); detailed agent implementations; full scripts/state.js command reference (read only 150 lines of 400+).

**Verdict**: Budget healthy; no hard gates hit. Full context gathered on conventions, wiring, dependency philosophy, hook I/O, and manifest schemas. Ready for design phase.

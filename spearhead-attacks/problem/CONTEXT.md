# Recon: Knowledge-Nudge Hash & Wikilink Fix (A-2)

## Repo conventions

**Naming & layout:**
- Hooks: `hooks/<name>.js` (dependency-free Node scripts, zero npm dependencies except MCP server)
- Libraries: `lib/<name>.js` (shared across scripts/, hooks/, mcp-server/)
- MCP server: `mcp-server/lib/*.js` and `mcp-server/server.js`
- Tests: Node's built-in `test` module, `node:assert/strict`, spawned via `spawnSync` in `*.test.js` files
- State files: JSON (persisted in `spearhead-attacks/` directory)

**Hook I/O contract:**
- stdin: JSON payload (hook-event specific)
- stdout: injected message (empty if silent)
- stderr: errors (exit 2 blocks tool call)
- Exit 0 = allow, Exit 2 = refuse
- 10s timeout per plugin.json
- Handles both Claude Code (`file_path`) and kimi-code (`path` or `tool_input.path`)

**Session & idle-expiry pattern (shared by remind.js and knowledge-nudge.js):**
- Session ID resolution: check input keys `['session_id', 'sessionId', 'session', 'conversation_id', 'chat_id']`, fallback to `'default'`
- Idle expiry: `12 * 60 * 60 * 1000` ms (12 hours) — a session silent longer than this is treated as new
- State files: JSON-persisted in `spearhead-attacks/` (e.g., `.remind-state.json`, `.knowledge-nudge-state.json`)
- State schema: `{ sessions: { <sessionId>: { ... metadata ... }, ... } }`
- Atomic writes: `fs.writeFileSync(statePath, JSON.stringify(state) + '\n')` with try-catch for graceful degradation
- Session cleanup: keep only `MAX_TRACKED_SESSIONS` (20); evict oldest by `at` timestamp when limit exceeded

**Dependency philosophy:**
- Zero npm dependencies in hooks/ and scripts/ (Node built-ins only)
- MCP server may have dependencies (fast-uri and others under mcp-server/node_modules)
- No external APIs called from hooks (compute-only, no network)

**Lint/build/test:**
- No build step
- Test: `node hooks/knowledge-nudge.test.js` and `node lib/knowledge-frontmatter.test.js` (Node's test runner auto-discovers `.test.js`)

## Affected surface

**Files the fix touches:**

1. **`hooks/knowledge-nudge.js`** (~267 lines)
   - `handleRead(input, projectDir)` — currently (lines 152–175) checks `fs.existsSync(targetPath)` only; must extend to compare content hash
   - `shouldNudge(statePath, sessionId, relPath)` — currently tracks `nudged: [relPath, ...]` per session; must extend to track hashes
   - State file schema: currently `{ sessions: { <sessionId>: { nudged: [...], at: <ms> } } }`; must extend to `{ sessions: { <sessionId>: { nudged: [...], hashes: {...}, at: <ms> } } }`
   - Nudge messages: both `handleRead` (lines 170–174) and `handleBash` (lines 224–229) must add wikilink-discipline line

2. **`lib/knowledge-frontmatter.js`** (~147 lines)
   - `parseFrontmatter(content)` — currently parses `type`, `tags`, `related`, `source`, `updated` (lines 64–117); must add `source_hash` as scalar field
   - `serializeFrontmatter(fields, body)` — currently serializes the above (lines 125–144); must serialize `source_hash` same way as `source`/`updated`
   - Field addition: add `source_hash` to `SCALAR_FIELDS` set (line 33)

3. **`mcp-server/lib/hash.js`** (~16 lines) — already exports `hashContent(content)` (sync, takes string/Buffer, returns lowercase hex sha256); no changes needed, only import into `hooks/knowledge-nudge.js`

4. **`hooks/knowledge-nudge.test.js`** (~200+ lines)
   - Add tests for: matching hash silence, mismatched/missing hash refresh nudge, same-hash no-repeat throttling, wikilink-line presence in all three message call sites
   - Reuse existing `runHook`, `projectDir`, `writeSourceFile`, `writeDocumentedNote`, and `setupImplementedLockedTask` helpers

5. **`lib/knowledge-frontmatter.test.js`** (~150+ lines)
   - Add tests for `source_hash` round-trip (parse/serialize with hash present/absent)

**Current nudge message call sites:**
- `handleRead`: line 170–174 (new-note nudge when source undocumented)
- `handleBash`: line 224–229 (task-done nudge when task transitions to done)

## Reproduction

This closes a defect in already-shipped code, so it was reproduced before recon proper (in a scratch temp dir, not committed anywhere):

```
mkdir -p /tmp/nudge-repro/spearhead-attacks /tmp/nudge-repro/spearhead-knowledge/code
cd /tmp/nudge-repro
echo 'function greet() { return "hello"; }' > src.js
cat > spearhead-knowledge/code/src.md <<'EOF'
---
type: code
source: src.js
---
Old documentation.
## Changelog
- 2026-07-22: initial note.
EOF
# Read #1 (unchanged source, note exists) -- observed: silent (correct)
echo '{"tool_name":"Read","tool_input":{"file_path":"'"$(pwd)"'/src.js"},"cwd":"'"$(pwd)"'","session_id":"repro2"}' | node hooks/knowledge-nudge.js

# change src.js content, then re-read in the same session
echo 'function greet(name) { return `hello ${name}`; }' > src.js
# Read #2 (source changed since note was written) -- observed: silent (BUG)
echo '{"tool_name":"Read","tool_input":{"file_path":"'"$(pwd)"'/src.js"},"cwd":"'"$(pwd)"'","session_id":"repro2"}' | node hooks/knowledge-nudge.js
```

**Observed:** both reads produce empty stdout (no nudge).
**Expected (PROBLEM.md criterion 4):** Read #2 should produce a refresh nudge, since the source content hash no longer matches what the note last documented.
**Root cause confirmed:** `handleRead`'s only staleness check is `fs.existsSync(path.join(projectDir, targetPath))` (knowledge-nudge.js line 163) — it never reads the note's frontmatter or compares any hash, so an existing note fully suppresses nudging regardless of source drift.

## Risks and unknowns

1. **State-file schema extension**: extending `shouldNudge` to track `(path, hash)` pairs instead of just `path` for throttling. Current schema uses `nudged: []` to track paths already nudged this session; new schema must track `{ <relPath>: <lastSeenHash> }` or a separate `hashes` field. Risk: if state file is corrupted or from a prior version, must handle gracefully (treat as fresh, never crash).

2. **Cross-directory import**: `hooks/knowledge-nudge.js` will import `hashContent` from `mcp-server/lib/hash.js` via `require(path.join(__dirname, '..', 'mcp-server', 'lib', 'hash.js'))`. This crosses the `hooks/` → `mcp-server/` boundary but imports only from `node:crypto` (zero external deps). PROBLEM.md assumes this is acceptable (ASSUMPTIONS line 30–31); verify no issues with plugin-loader path resolution in kimi-code.

3. **"Missing hash treated as stale" logic**: PROBLEM.md criterion 4 says a note without `source_hash` field should nudge as "refresh." Parsing handles this gracefully (unrecognized fields ignored, field absent = undefined). But deciding whether to nudge requires computing the source's current hash and comparing — we must compute it *every time* to detect changes. This is already done for new-note detection (line 163 checks existence), but the code currently does not hash the source content. New logic: always compute source hash, always compare against note's `source_hash` if present.

4. **Duplicate code in handleRead**: currently `handleRead` checks `fs.existsSync(targetPath)` (line 163) and separately checks `shouldNudge` (line 168). The new flow must: (1) compute source hash, (2) try to read and parse the existing note, (3) compare hashes, (4) decide nudge type (new/refresh/silent), (5) call `shouldNudge` with the right key (for throttling same-hash repeats). This adds branching; ensure the three paths (new, refresh, silent) are clear.

5. **Refresh nudge message content**: currently `handleBash`'s task-done nudge is the only one with semantic guidance (line 225 says "update each file's code doc"). New-note and refresh messages must both ask agent to set `source_hash` frontmatter. Risk: message text changes might affect agent behavior (e.g., if agent previously ignored certain hints).

6. **Wikilink-discipline line phrasing**: PROBLEM.md says "add a line on wikilink discipline (only genuinely related notes, never indiscriminate)," but the exact phrasing is not specified. This is a UX choice — the fix must write a clear, actionable line; tests will check its presence but not exact wording.

7. **Test fixtures for hash comparison**: existing tests use `writeDocumentedNote` helper (line 50–55 of knowledge-nudge.test.js) that currently writes a note with fixed body (`'\nbody\n\n## Changelog\n'`). New tests must: (a) write a note with a specific `source_hash` and (b) modify the source file's content to trigger a hash mismatch. Current helper does not track hashes; tests will need to either extend it or write notes manually.

## Prior art

**State-file pattern (remind.js `promptIndex` and knowledge-nudge.js `shouldNudge`):**
- Session ID fallback to `'default'` ensures graceful degradation on runtimes without session context
- Idle expiry: `Date.now() - entry.at > SESSION_IDLE_MS` → reset to treat session as new
- Per-session metadata: `state.sessions[<sessionId>] = { <key>: <value>, at: <timestamp> }`
- Atomic write with try-catch: write fails gracefully (degraded behavior, not crash)
- Session cleanup: evict oldest when count exceeds `MAX_TRACKED_SESSIONS`

**Frontmatter field pattern (knowledge-frontmatter.js):**
- Scalars: stored in `SCALAR_FIELDS` set (line 33), parsed via `unquote` (line 37–44), serialized via `scalarOut` (line 55–57)
- Optional fields: present in parsed object only when provided in source; serialized only if defined
- Lists: stored in `LIST_FIELDS` set, parsed as block items under a key
- Forward-compatibility: unrecognized keys are silently ignored (line 108–109)
- Fallback: malformed input never throws, falls back to `{ type: 'unknown' }` (line 114–116)

**Hash usage (mcp-server/lib/hash.js):**
- `hashContent(content)` is sync, takes string or Buffer, returns lowercase hex sha256 string
- Used elsewhere in MCP server for change detection (e.g., during embeddings indexing)
- Node's `node:crypto` only — no external deps

**Test helpers (knowledge-nudge.test.js):**
- `runHook(payload, env)` — spawns hook via spawnSync, returns `{ code, out, err }`
- `projectDir()` — mkdtemp with spearhead-attacks/ subdir
- `writeSourceFile(dir, relPath, contents)` — writes a source file to a temp project
- `writeDocumentedNote(dir, relSource)` — writes a note at computed path with default body
- `setupImplementedLockedTask(dir, filesCsv)` — drives state.js through plan-approved → task locked
- Session/state-file inspection: tests read `.knowledge-nudge-state.json` directly (line 114–118 of knowledge-nudge.test.js)

**Nudge message structure (existing examples):**
- `handleRead` new-note (line 170–174): names the exact target path and mentions frontmatter/Changelog
- `handleBash` task-done (line 224–229): names the task ID and attack ID, lists each file's doc target

## Budget

**Reads used: 11**
1. Prior CONTEXT.md from A-1 (confirms conventions still accurate)
2. PROBLEM.md (approved scope and acceptance criteria)
3. `hooks/knowledge-nudge.js` (exact implementation of handleRead, shouldNudge, state-file schema)
4. `lib/knowledge-frontmatter.js` (field list, parse/serialize pattern)
5. `mcp-server/lib/hash.js` (hashContent signature and implementation)
6. `hooks/knowledge-nudge.test.js` (first 100 lines: runHook, projectDir, helpers)
7. `lib/knowledge-frontmatter.test.js` (first 80 lines: parse/serialize test pattern, round-trip)
8. `hooks/remind.js` (first 60 lines: sessionKeyFrom and Session_IDLE_MS; lines 60–129: promptIndex state-file schema and idle-expiry logic)
9. `hooks/knowledge-nudge.test.js` (lines 100–150: state-file inspection, idle-expiry test, extension heuristic, Bash matcher)
10. `lib/knowledge-frontmatter.test.js` (lines 80–130: round-trip tests, serialization details)
11. Bash `find` for test-file inventory (confirm test structure across repo)

**Characters used: ~48,000 (well under 60k limit)**

**Skipped (budget healthy):**
- Full test suites for other modules (hash.test.js, validate-state.test.js, etc.) — not needed; know the patterns
- MCP server implementation details (embeddings, index, file-watch) — already shipped, untouched
- scripts/knowledge-path.js implementation details — used as a black box (computeKnowledgePath)
- Detailed remind.js beyond idle-expiry pattern (full message construction, rules injection) — conventions already clear

**Verdict**: Budget healthy; no hard gates hit. All affected files' current signatures and patterns captured; state-file schema extension strategy clear; test pattern and helpers understood. Ready for design phase.

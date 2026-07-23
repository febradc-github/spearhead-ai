# SHIP — A-2: Knowledge-nudge staleness detection + wikilink discipline

## What changed

**T-1 — `source_hash` scalar frontmatter field.** `lib/knowledge-frontmatter.js`'s `parseFrontmatter`/`serializeFrontmatter` gained a `source_hash` scalar field, added to the existing `SCALAR_FIELDS` set and parsed/serialized exactly like `source`/`updated`: present only when provided, round-trips exactly through `parse(serialize(x))`, and is not treated specially by the existing malformed-frontmatter fallback (`{type: 'unknown'}`).

**T-2 — `handleRead` staleness detection + wikilink guidance.** `hooks/knowledge-nudge.js`'s `handleRead` now computes the read source file's current content hash (`mcp-server/lib/hash.js`'s `hashContent`, imported directly — no new hashing logic) and derives a three-way state instead of the previous existence-only check: no note → `new` (unchanged new-note nudge, now also asking the agent to set `source_hash`); note with a matching `source_hash` → `current` (never nudges, regardless of session); note with a missing or mismatched `source_hash` → `stale` (a new refresh nudge, naming the existing note path and asking for an in-place update plus a new `## Changelog` entry, never a duplicate note). `shouldNudge`'s session-throttle schema changed from an array of nudged paths to a map of path → last-nudged-hash, so a file that changes again after being nudged once naturally re-nudges (its hash no longer matches the recorded one); old-format array state files are treated as empty on load rather than crashing. All three nudge message sites (`handleRead` new-note, `handleRead` refresh, `handleBash` task-done) gained a shared wikilink-discipline line instructing the agent to use `[[wikilinks]]` only for genuinely related notes. `handleBash`'s detection logic (which task, which files, when it fires) is unchanged — only its message text gained the wikilink line.

## Why

From `PROBLEM.md`'s real goal: A-1's retro found the shipped second-brain feature only partially satisfied its own acceptance criteria — `handleRead` could tell whether a note existed but not whether the source it documented had since drifted, so changed-but-documented files were silently never re-nudged; and the nudge text never gave the agent any guidance on wikilink discipline, risking indiscriminate cross-linking as notes accumulate. This attack closes both gaps without touching anything else in the already-shipped feature (MCP server, index, search, task-done detection logic, `remind.js`).

## How to verify

Per-task verification commands (all green in `spearhead-attacks/verify/V-1.1.md` and `V-2.1.md`):

- `node lib/knowledge-frontmatter.test.js` (T-1) — 16/16 pass.
- `node hooks/knowledge-nudge.test.js` (T-2) — 21/21 pass.

Full-repo integration check (run after each merge): `find . -name "*.test.js" -not -path "*/node_modules/*" -not -path "./spearhead-attacks/worktrees/*" | xargs node --test` — 182/182 pass after T-1's merge, 188/188 pass after T-2's merge, 0 fail.

Manual smoke test for a reviewer: write a source file and a documented note for it with a matching `source_hash`; `Read` it — confirm silence. Edit the source file's content; `Read` it again in the same session — confirm a refresh nudge fires naming the note path, asking for an in-place update plus a new `## Changelog` entry, and mentioning `source_hash` and `[[wikilinks]]`. Read it a second time without further changes — confirm the refresh nudge does not repeat.

## Tradeoffs

From `DESIGN.md`'s rejected alternatives:

- **Content hash in note frontmatter over filesystem mtime comparison** — mtime is not a reliable proxy for content change (git checkouts reset all file mtimes regardless of history, editors/formatters can touch a file without changing its meaning, CI/deploy pipelines normalize timestamps), so it would produce both false staleness and false freshness. Rejected despite being the simpler, no-frontmatter-change option, because `PROBLEM.md` criterion 4 requires detecting actual content drift.
- **Content hash in note frontmatter over hash tracked only in the hook's own session state** — the hook's session state file idle-expires (12h) and evicts old sessions by design, so it cannot durably answer "has this source changed since the note was last written" across sessions or machines, which the acceptance criteria require (a note written last week must still read as stale today, in a brand-new session). Only the note itself is a durable, cross-session source of truth.

## Rollout

Plain deploy — this ships as part of the spearhead plugin itself, inert until a project has both the second-brain feature enabled (`SPEARHEAD_EMBEDDINGS_API_KEY`) and existing documented notes on disk. No feature flag; no migration or backfill of `source_hash` into notes written before this fix (explicitly out of scope — such notes are simply treated as stale on next read, which is the correct, already-covered behavior).

## Monitor after release

From `DESIGN.md`'s failure-mode handling:

- **Source unreadable/deleted between the `Read` tool call and hook execution**: the hash computation is wrapped in try/catch and degrades to silent (no nudge) — watch for this masking a real staleness case if source reads are flaky in a given environment.
- **Malformed note frontmatter**: `parseFrontmatter` never throws; a malformed note simply reads `source_hash` as `undefined`, which correctly falls into the `stale` branch (safe default: nudge to fix it up) — no special monitoring needed beyond the existing malformed-frontmatter behavior.
- **Per-read hashing cost**: every `Read` of a source file now hashes its content, versus the previous `fs.existsSync`-only check — same cost profile already accepted for the embeddings pipeline's own hashing; the extension heuristic already excludes large binary files from this path, so this should stay well inside the existing 10s hook timeout, but worth watching if a project's source files are unusually large.
- **State file corruption or old-format array `nudged`**: `loadState`/`shouldNudge` treat anything that isn't the expected map shape as empty, degrading to "may nudge once more than strictly necessary," never crashing.

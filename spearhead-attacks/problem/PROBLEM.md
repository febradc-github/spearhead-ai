## Problem statement

A-1's retro (`spearhead-attacks/retro/RETRO.md`) found that `hooks/knowledge-nudge.js`'s `Read` matcher only partially satisfies two of the original second-brain feature's acceptance criteria:

1. **Criterion 6, second half**: re-reading a source file *after it changed* since its note was last written should re-nudge the agent to refresh the note with a new `## Changelog` entry. Currently `handleRead`'s only staleness check is `fs.existsSync(targetPath)` — it never compares the source's current content against what the note last documented, so a changed-but-already-documented file is silently never re-nudged.
2. **Criterion 8**: notes should only include `[[wikilinks]]` to genuinely related notes, never indiscriminately. The shipped nudge text never mentions wikilinks at all — no guidance is given to the agent authoring the note.

## Real goal

Make the code-doc-on-first-read nudge actually detect when a documented source has drifted from its note (not just whether a note exists at all), and give the agent explicit wikilink-discipline guidance when it's nudged to write or refresh a note — closing the two gaps without touching anything else in the already-shipped second-brain feature (MCP server, index, search, task-done nudge logic, `remind.js`).

## In scope

- `lib/knowledge-frontmatter.js`: add a `source_hash` scalar field to `parseFrontmatter`/`serializeFrontmatter`, alongside the existing `type`, `tags`, `related`, `source`, `updated` fields.
- `hooks/knowledge-nudge.js`'s `handleRead`: compute the source file's current content hash (reusing `mcp-server/lib/hash.js`'s `hashContent` — no new hashing logic) and compare it against the existing note's `source_hash` frontmatter to decide new-note vs. refresh vs. silent.
- Both the new-note and refresh nudge messages: instruct the agent to set `source_hash` in the note's frontmatter, and add a line on wikilink discipline (only genuinely related notes, never indiscriminate).
- `handleBash`'s task-done nudge message: also gets the wikilink-discipline line, for consistency (a note can be authored/refreshed via either trigger).
- Tests for all of the above, same `spawnSync`-fixture pattern as the existing suite.

## Out of scope

- The MCP server, index, or search logic (already shipped, untouched).
- `handleBash`'s existing detection/read logic for which files to nudge (only its message text changes, per above).
- `remind.js` / the search-first reminder (already shipped, untouched).
- Migrating or backfilling `source_hash` into any notes that already exist on disk from before this fix — a note without `source_hash` is simply treated as stale on next read (already covered by the acceptance criteria below), not proactively rewritten.
- Any change to how `scripts/knowledge-path.js` computes target paths.

## Assumptions

- **Hash reuse**: `mcp-server/lib/hash.js`'s `hashContent` is imported directly from `hooks/knowledge-nudge.js`. It has zero external dependencies (Node's built-in `node:crypto` only), so this doesn't violate hooks' dependency-free convention in practice, even though it crosses the `mcp-server/` directory boundary. No new hashing logic is written.
- **Wikilink guidance scope**: applies to all three nudge-message call sites (new-note, refresh, task-done), not just the `Read` matcher's messages, since any of the three can result in a note being authored or edited.
- **Refresh-nudge throttling**: to avoid nudging on every single read of a still-undocumented-refresh file within one session, the refresh nudge is throttled per `(relative source path, current source hash)` pair using the same session/idle-expiry state file `handleRead` already maintains — so a file whose content changed gets nudged once per distinct new hash per session (idle-expiry still applies as today), not once per every read.
- **Missing `source_hash` on an existing note** (i.e., a note written before this fix shipped, or otherwise missing the field): treated as stale — nudges once with refresh framing, same as a genuine hash mismatch.
- **Session state file format**: extending the existing `.knowledge-nudge-state.json` schema (adding hash-tracking alongside the existing `nudged`/`at` fields) rather than introducing a second state file.

## Acceptance criteria

1. `lib/knowledge-frontmatter.js`'s `parseFrontmatter`/`serializeFrontmatter` round-trip a `source_hash` field the same way they already round-trip `type`/`tags`/`related`/`source`/`updated`; a note lacking the field parses without error.
2. `handleRead`, on a read of a source file with no existing note at that target path: unchanged behavior (new-note nudge), and the nudge message now also asks the agent to set `source_hash` and includes the wikilink-discipline line.
3. `handleRead`, on a read of a source file whose note exists and whose `source_hash` matches the source's current content hash: no nudge, regardless of session (source unchanged since documented).
4. `handleRead`, on a read of a source file whose note exists but `source_hash` is missing or does not match the source's current content hash: nudges with refresh framing (names the existing note path, asks for an in-place update plus a new `## Changelog` entry, not a duplicate note), and this fires even within a session/idle window that would otherwise suppress a repeat nudge for the *same* hash — because a new hash is a distinct event from a repeat read at the same hash.
5. A refresh nudge for the same `(path, hash)` pair does not repeat within the same session/idle window (throttled the same way the existing no-repeat-nudge behavior works today).
6. Every nudge message that can lead to a note being authored or updated (new-note, refresh, and task-done) includes a line instructing the agent to use `[[wikilinks]]` only for genuinely related notes, never indiscriminately.
7. The `Bash|PowerShell` task-done matcher's detection logic (which task, which files, when it fires) is unchanged — verified by the existing task-done tests still passing unmodified in intent (message content may differ only by the added wikilink line).
8. `node hooks/knowledge-nudge.test.js` and `node lib/knowledge-frontmatter.test.js` both pass, including new tests for: matching-hash silence, mismatched/missing-hash refresh nudge, same-hash no-repeat throttling, and wikilink-line presence in all three message call sites.
9. No functional change to the MCP server, index/search logic, `scripts/knowledge-path.js`'s path computation, or `remind.js` (diff confined to `hooks/knowledge-nudge.js`, `hooks/knowledge-nudge.test.js`, `lib/knowledge-frontmatter.js`, `lib/knowledge-frontmatter.test.js`).

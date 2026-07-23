# RETRO — A-1: Second brain: plugin decision/design documentation system

## Criteria confirmation

Against `problem/PROBLEM.md`'s `## Acceptance criteria`, one by one, with evidence from `spearhead-attacks/verify/V-<n>.1.md`:

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Boot MCP server against a project with a completed attack + docs → local index of all three sources, no manual build step | met | `V-6.1.md`: "server starts the T-5 watch pipeline on boot" test — dirs created, fixture file reconciled into the index with no manual rebuild step. |
| 2 | `search` with a natural-language query → relevant excerpt with correct source pointer | met | `V-6.1.md`: fixture-index tests assert correct ranking, `{path, excerpt, score}` shape verified against real file content. |
| 3 | Creating/editing a watched note while the server runs → only that entry updates automatically, no manual rebuild | met | `V-5.1.md`: pipeline hash-gates each create/change event; skip-if-unchanged / re-embed-if-changed tests assert exact call counts. |
| 4 | First read of an undocumented source file → reminder → code doc created under `code/` with correct naming + populated `## Changelog` | met (nudge mechanism); doc creation is agent follow-through by design | `V-9.1.md`: nudge fires naming the exact `knowledge-path.js`-computed target, requests a populated Changelog section. Per DESIGN.md ADR-003, the hook nudges only — it never writes the note itself. |
| 5 | Same-basename, different-parent files disambiguated by parent-folder prefix, no renames | met | `V-7.1.md`: collision + double-collision tests, existing notes never renamed. |
| 6 | Re-read unchanged documented file → no duplicate; re-read after source changed → refresh existing note + new `## Changelog` entry | **partially met — gap** | First half met (`V-9.1.md`: existence check is source-of-truth, re-derived from disk). Second half not implemented: `handleRead`'s only staleness check is `fs.existsSync(targetPath)` — no comparison against the source's content since the note was last written, so a changed-but-already-documented file is never re-nudged via the Read path. See Follow-ups. |
| 7 | User inquiry → reminder to search before reading source | met | `V-8.1.md`: search-first line added to `remind.js`'s injected message (both variants), byte-identical-to-RULES.md test still green. |
| 8 | Notes carry `type`/`tags` frontmatter; only `[[wikilinks]]` to genuinely related notes, not indiscriminate | **partially met — gap** | Frontmatter mechanism met (`V-2.1.md`: `type`/`tags`/`related`/`source`/`updated` parse/serialize/round-trip). Wikilink discipline not met: the shipped nudge text never mentions wikilinks at all — no guidance, no enforcement. See Follow-ups. |
| 9 | None of the above requires raw Write/Edit to `status.yml` or alters phase state | met | `V-9.1.md`: dedicated test asserts the hook never writes `status.yml`; `pipeline.js`/`watch.js` never reference it. |
| 10 | Missing API key / embeddings failure → clear, named tool error, not silent/empty/corrupt | met | `V-6.1.md` (query time: `MissingApiKeyError`/`EmbeddingsRequestError` surfaced as named tool errors); `V-5.1.md` (index time: failed embeds marked `pending`, watcher doesn't crash). |
| 11 | Ships as part of the plugin (skills/commands/scripts/hooks/MCP server), declared in both manifests, installable by any project | met | `V-1.1.md` (both manifests gain `mcpServers` block), `V-9.1.md` (both manifests gain the `PostToolUse` hook registration). |
| 12 | Task transitions to `done` → every touched source file's doc updated (created if missing) with new `## Changelog` entry referencing task + attack | met (nudge mechanism); doc update is agent follow-through by design | `V-9.1.md`: `handleBash` matcher fires on successful `state.js transition <T-id> done`, reads the task's expected files read-only, nudges per-file with task/attack IDs. Same nudge-not-enforce nature as criterion 4. |

**10 of 12 fully met; 2 partially met** (criteria 6 and 8 — both isolated to `hooks/knowledge-nudge.js`'s `Read` matcher).

## Follow-ups

Both scoped for a new attack (A-2) — the state machine's phases-only-advance rule means A-1's plan cannot be reopened now that `ship: complete` is recorded (`state.js add-task` correctly refused with `execute-incomplete`/`phase-order` when attempted).

1. **Criterion 6 gap — source-change staleness detection in `handleRead`.** Currently `handleRead`'s only check is `fs.existsSync(targetPath)`; it never compares the source file's current content against what the note last documented. Fix: extend `lib/knowledge-frontmatter.js`'s `parseFrontmatter`/`serializeFrontmatter` with a `source_hash` scalar field (alongside `type`/`tags`/`related`/`source`/`updated`); `handleRead` computes the source's current hash (reuse `mcp-server/lib/hash.js`'s `hashContent`, no new hashing logic) and compares against the note's `source_hash`. Missing or mismatched → re-nudge with refresh framing (names the existing path, asks for an in-place update + new Changelog entry, not a duplicate); this should fire even within a session/idle window that would otherwise suppress a repeat nudge, since a content change is a distinct event from a repeat read. Both nudge messages should instruct the agent to set `source_hash` when writing/updating the note.
2. **Criterion 8 gap — wikilink-discipline guidance missing from nudge text.** Neither the new-note nor the (future) refresh nudge message mentions wikilinks at all. Fix: add a line to both nudge messages — use `[[wikilinks]]` only to genuinely related notes, never indiscriminately cross-link.

A full task draft for both (title, expected files, acceptance criteria, verification commands) was already written during this retro and can be reused near-verbatim when starting A-2 — see the retro discussion for the draft `T-11.md` content (not committed, since it belongs to the next attack's own plan, not A-1's).

3. **`npm audit` flag from T-1** (`spearhead-attacks/verify/V-1.1.md`): 2 moderate-severity transitive vulnerabilities in `@hono/node-server`, pulled in by the MCP SDK's optional HTTP/SSE transport, unused by this stdio-only server. Fixing requires `npm audit fix --force`, which downgrades the SDK. Worth a standalone look, not urgent (unused transport).
4. **CHANGELOG/manifest version mismatch from T-10**: `CHANGELOG.md`'s new entry is versioned `0.7.0`, but `.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json` are still `0.6.0`. This repo's convention is a separate `chore: bump plugin version to X.Y.0` commit outside any task branch (see `97377ec`, `55e35aa`) — needs one now to keep the manifests and CHANGELOG in sync.

## Lessons

- **Verify the task's expected-file assumptions against the actual repo convention before dispatching, not just after a scope-containment failure.** T-9 was blocked once and needed a replan cycle because its expected-file set named `.claude-plugin/plugin.json` for Claude Code hook registration, but this repo (and the upstream `turnstile` project it copied the convention from) registers hooks exclusively via `hooks/hooks.json`. The breakdown/plan phase could have caught this by checking the existing hook-registration pattern (`remind.js`, `guard.js`, `validate-state.js` are all in `hooks/hooks.json`) before writing T-9's file list, rather than the coder discovering it mid-implementation.
- **Retro's "reopen work" option is only real before `ship: complete` is recorded — the state machine enforces phases-only-advance, and there is no un-ship.** Once ship completes, any criteria gap found at retro time must become a new attack, not an amendment to the closed one. Future retros should treat this as the default expectation, not a surprise discovered by a refused `add-task` call.
- **Nudge-only mechanisms (ADR-003) mean some acceptance criteria are only ever "mechanism verified," not "outcome verified."** Criteria 4 and 12 ask for actual documentation to be created/updated; the shipped hooks correctly nudge for it but cannot mechanically guarantee an agent follows through. This is an intentional design tradeoff (documented in DESIGN.md), but retro should keep calling this out explicitly per-criterion rather than letting "the hook fires correctly" quietly stand in for "the outcome happened," so the gap stays visible for future attacks to reconsider if it ever matters enough to add stronger enforcement.

## Docs and runbooks updated

- `README.md` — new "Second-brain knowledge base" section (T-10).
- `CHANGELOG.md` — new `0.7.0` entry (T-10), pending version-bump follow-up (see Follow-ups #4).
- `rules/RULES.md` — search-first directive added (T-8).

## Dead code removed

None.

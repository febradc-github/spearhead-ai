# RETRO — A-2: Knowledge-nudge staleness detection + wikilink discipline

## Criteria confirmation

Against `problem/PROBLEM.md`'s `## Acceptance criteria`, one by one, with evidence from `spearhead-attacks/verify/V-1.1.md` and `V-2.1.md`:

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `source_hash` round-trips through `parseFrontmatter`/`serializeFrontmatter` like the existing fields; absent field parses without error | met | `V-1.1.md`: all 5 criteria pass — round-trip, presence-only-when-provided, `undefined` when absent, malformed fallback unaffected. |
| 2 | `handleRead` on an undocumented file: unchanged new-note nudge, now also asking the agent to set `source_hash` and including the wikilink line | met | `V-2.1.md`: new-note test asserts `source_hash` and `[[wikilinks]]` both present in the message; target-path naming behavior unchanged. |
| 3 | `handleRead` on a documented file whose `source_hash` matches the current content hash: no nudge, regardless of session | met | `V-2.1.md`: dedicated test confirms silence across two never-before-seen sessions (`fresh-1`, `fresh-2`). |
| 4 | `handleRead` on a documented file whose `source_hash` is missing or mismatched: refresh nudge naming the existing note path, asking for an in-place update plus a new `## Changelog` entry, firing even within an idle window that would suppress a same-hash repeat | met | `V-2.1.md`: missing-hash and mismatched-hash tests both assert refresh framing and `## Changelog`; changed-file-re-nudges test confirms a new hash fires even within the same session. |
| 5 | A refresh nudge for the same `(path, hash)` pair does not repeat within the same session/idle window | met | `V-2.1.md`: dedicated no-repeat-within-session test passes. |
| 6 | All three nudge sites (new-note, refresh, task-done) include a wikilink-discipline line | met | `V-2.1.md`: `WIKILINK_LINE` constant asserted present in all three message call sites' tests. |
| 7 | `handleBash`'s task-done detection logic (which task, which files, when it fires) unchanged — only message text gains the wikilink line | met | `V-2.1.md`: diff to `handleBash` is confined to the trailing message string; pre-existing REFUSED/non-match/PowerShell tests pass unmodified. |
| 8 | `node hooks/knowledge-nudge.test.js` and `node lib/knowledge-frontmatter.test.js` both pass, with new tests for matching-hash silence, missing/mismatched-hash refresh, same-hash throttle, and wikilink-line presence in all three sites | met | `V-1.1.md`: 16/16. `V-2.1.md`: 21/21, all named coverage categories present as distinct tests. |
| 9 | No functional change to the MCP server, index/search logic, `scripts/knowledge-path.js`'s path computation, or `remind.js` — diff confined to the four named files | met | `V-1.1.md` and `V-2.1.md` both confirm scope containment via `git diff --stat`; anti-reward-hacking check (d) passed on both. |

**9 of 9 fully met.** No gaps found at this retro — both criteria left unmet by A-1's retro (source-change staleness detection, wikilink guidance) are the ones this attack existed to close, and both are now confirmed.

## Follow-ups

No new gaps surfaced during this attack's execution or verification. Two items carried over from A-1's retro remain open — out of scope for A-2 (neither touches `hooks/knowledge-nudge.js`, `lib/knowledge-frontmatter.js`, or their tests) and still unaddressed:

1. **`npm audit` flag from A-1/T-1** (`spearhead-attacks/verify/V-1.1.md`, A-1's version, see git history): 2 moderate-severity transitive vulnerabilities in `@hono/node-server`, pulled in by the MCP SDK's optional HTTP/SSE transport, unused by this stdio-only server. Fixing requires `npm audit fix --force`, which downgrades the SDK. Still not urgent (unused transport), but still open.
2. **CHANGELOG/manifest version mismatch from A-1/T-10**: `CHANGELOG.md`'s `0.7.0` entry still has no matching version bump in `.claude-plugin/plugin.json` / `.kimi-plugin/plugin.json` (both still `0.6.0`, confirmed at this retro). This repo's convention is a separate `chore: bump plugin version to X.Y.0` commit outside any task branch (see `97377ec`, `55e35aa`) — still needs one.

Separately, the user has already indicated the next attack's problem statement: updating the env-file gate so `.env` file *creation* is allowed (for development templates/samples) while *reading* `.env` files stays strictly prohibited. That's new scope, not a follow-up from this attack — it belongs to `/spearhead:understand` for A-3.

## Lessons

- **When a retro-follow-up attack's scope is narrow and already has a near-complete task draft (written during the prior retro), the understand → recon → design phases can move fast without cutting corners** — A-2's `PROBLEM.md` was largely a restatement of A-1's `RETRO.md` Follow-ups #1/#2, and DESIGN.md's chosen approach (content hash in frontmatter, reusing the existing T-3/T-5 hash-compare idiom) was already implied by the follow-up text. Worth deliberately checking prior retros for reusable drafts before starting recon from scratch on a similarly-scoped attack.
- **The `nudged` array → path-to-hash-map schema change was a genuine backward-incompatibility risk** (old state files have a different shape) that the design phase caught up front via an explicit failure-mode entry ("old-format state files treated as empty, never crash"), and T-2 shipped a dedicated test for exactly that case. Deciding the degrade-gracefully behavior at design time — rather than discovering it during implementation — kept the fix from needing a second pass.
- **Confirms the pattern noted in A-1's retro**: reusing an established hash-compare idiom (already proven by the embeddings pipeline) rather than inventing a new staleness mechanism kept both tasks small (T-1 ~60 changed lines, T-2 ~175 changed lines) and let both pass verification on the first attempt with no repair cycles.

## Docs and runbooks updated

None — this attack fixes internal hook/library logic; no user-facing docs describe the previous (buggy) behavior that needed correcting.

## Dead code removed

None.

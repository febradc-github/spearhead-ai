# RETRO — A-3: MCP search minimum-score threshold

## Criteria confirmation

Against `problem/PROBLEM.md`'s `## Acceptance criteria`, one by one, with evidence from `spearhead-attacks/verify/V-2.1.md`, `V-2.2.md`, and `V-3.1.md`:

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `rankBySimilarity(index, queryEmbedding, limit, minScore?)` excludes any entry whose cosine similarity is below `minScore`, regardless of `limit` | met | `V-2.2.md`: verifier confirms `if (!(score >= minScore)) continue;` filters before sort/slice; dedicated test passes. |
| 2 | Entries at or above `minScore` still returned, sorted highest-first, truncated to `limit` — unchanged for passing entries | met | `V-2.2.md`: dedicated test asserts sorted, truncated result for passing entries. |
| 3 | A query where every entry scores below `minScore` returns an empty array, not an error | met | `V-2.2.md`: dedicated test confirms `deepEqual(ranked, [])`, no throw. |
| 4 | `runSearch` passes a threshold into `rankBySimilarity`, sourced from `SPEARHEAD_SEARCH_MIN_SCORE` (parsed as float) or a documented default (`0.5`); unset/unparseable falls back to default, never throws or disables the cutoff | met | `V-3.1.md`: verifier confirms `parseFloat`/`Number.isNaN` fallback logic; tests for unset and non-numeric (`'not-a-number'`) both pass. |
| 5 | `SEARCH_TOOL.description` documents the minimum-relevance filter and that an empty result means no sufficiently relevant match, not malfunction | met | `V-3.1.md`: verifier quotes the added description text verbatim; matches criterion. |
| 6 | No change to indexing, embedding, storage, or the existing error contract; diff confined to `similarity.js`, `similarity.test.js`, `server.js`, `server.test.js` | met | `V-2.2.md` and `V-3.1.md` both confirm scope containment via `git diff --name-only`; anti-reward-hacking check (d) passed on both. `embeddings.js`, `index-store.js`, `pipeline.js`, `watch.js` untouched throughout. |
| 7 | `node mcp-server/lib/similarity.test.js` and `node mcp-server/server.test.js` both pass, with new tests for below/at/above-threshold, all-below-empty-array, env override, unset/unparseable fallback | met | `V-2.2.md`: 18/18. `V-3.1.md`: 10/10, all five named coverage categories present as distinct tests. |

**7 of 7 fully met.** No gaps found at this retro.

## Follow-ups

1. **Search-before-read enforcement (explicitly deferred by this attack's `PROBLEM.md`)**: gate `Read` on the search tool having genuinely found nothing relevant (`results: []` or short), rather than only nudging as today. This attack's whole purpose was to make that signal detectable — the actual enforcement is a separate future attack, not yet scoped.
2. **README's `search(query, limit?)` description (README.md:208-213) is now stale**: it documents `{path, excerpt, score}` and the error contract but doesn't mention the new minimum-score filtering behavior or `SPEARHEAD_SEARCH_MIN_SCORE`. Same category as the direct (non-spearhead) README update done earlier in this session for A-2 — small, doc-only, likely worth doing the same way rather than as a full attack.
3. **`SPEARHEAD_SEARCH_MIN_SCORE`'s default (`0.5`) has no external ground truth** for this corpus/Voyage AI `voyage-3` embedding model (`DESIGN.md`'s explicit assumption). Once the second-brain feature sees real usage, watch for either false "nothing relevant found" (too strict) or still-noisy weak matches (too loose) and tune via the env var — no code change needed either way.
4. **`npm audit` flag, carried forward again from A-1/A-2's retros**: 2 moderate-severity transitive vulnerabilities in `@hono/node-server`, pulled in by the MCP SDK's optional HTTP/SSE transport, unused by this stdio-only server. Still not urgent, still open.

**Resolved by this attack's ship** (no longer a follow-up): the CHANGELOG/manifest version mismatch flagged in A-1's and A-2's retros — `.claude-plugin/plugin.json`, `.kimi-plugin/plugin.json`, and `.claude-plugin/marketplace.json` are now all `0.8.0`, matching a new `CHANGELOG.md` entry that also retroactively documents A-2 (which had shipped without its own changelog entry).

## Lessons

- **A task split where the "core function" task (T-2) changes a shared default and the "caller wiring" task (T-3) depends on it can break the core task's own full-suite mechanical gate**, even though the core task's own tests are green — because other, unrelated callers (here, `server.js`) pick up the new default implicitly. This wasn't anticipated at breakdown time even though `DESIGN.md` explicitly called out the default-on-omission behavior as intentional. Worth checking at breakdown time: "does this task's approved behavior change affect any caller outside this task's own files, via a default parameter or similar mechanism?" — if yes, either fold the minimal fallout-fix into the same task's expected-files up front, or accept and plan for a first-attempt verify failure.
- **`state.js add-task` doesn't validate flags it doesn't recognize** — passing `--help` by mistake was silently accepted as if it were real arguments, producing a task with an empty title and no files rather than an error. Always confirm with `state.js show` right after `add-task`, don't trust the `OK: added T-<n>` message alone.
- **The `SPEARHEAD_EMBEDDINGS_ENDPOINT`-style env-var-with-fallback pattern replicated cleanly a second time** (`SPEARHEAD_SEARCH_MIN_SCORE`, matching `embeddings.js`'s `parseFloat`/fallback shape) — reinforces that this repo's established prior-art patterns are worth deliberately checking for and reusing before inventing a new configuration mechanism.
- **Merging a task branch while `spearhead-attacks/` decision-record files have uncommitted local edits requires a stash/merge/pop cycle**, since the branch was cut before this attack's own `PROBLEM.md`/`PLAN.md`/etc. existed in git history (they're edited via `Write`, not committed until ship). This is expected given the flat, non-namespaced decision-record convention, but worth remembering as the standard merge sequence for any future attack: stash `spearhead-attacks/`, merge, pop.

## Docs and runbooks updated

None during this attack's execution — the `SEARCH_TOOL.description` update (a form of documentation) is in the shipped code diff itself, not a separate docs pass. README.md's search tool description is now stale (see Follow-ups #2).

## Dead code removed

None.

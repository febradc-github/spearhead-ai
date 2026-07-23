# SHIP — A-3: MCP search minimum-score threshold

## What changed

**T-2 — `rankBySimilarity` minimum-score cutoff.** `mcp-server/lib/similarity.js` now exports `DEFAULT_MIN_SCORE = 0.5` alongside the existing `DEFAULT_LIMIT`, and `rankBySimilarity(index, queryEmbedding, limit = DEFAULT_LIMIT, minScore = DEFAULT_MIN_SCORE)` excludes any entry scoring below `minScore` before sorting/truncating to `limit`. A query where every entry scores below the threshold now returns an empty array instead of the previous "always return the top N, however irrelevant" behavior. Since `server.js` calls `rankBySimilarity` without an explicit `minScore`, this task's own change had an immediate, correct effect on the live server — two pre-existing `server.test.js` tests whose fixtures scored near-zero (deliberately simple orthogonal test vectors) needed their fixtures repaired to clear the new default; this surfaced as a genuine mechanical-gate failure at first verify attempt (`V-2.1.md`), resolved via `/spearhead:replan` widening T-2's scope to include that narrow fixture fix, then a clean pass on the second attempt (`V-2.2.md`).

**T-3 — `server.js` env-var wiring + tool description.** `runSearch` now resolves the effective threshold from `SPEARHEAD_SEARCH_MIN_SCORE` (parsed as a float via `parseFloat`, falling back to the imported `DEFAULT_MIN_SCORE` on unset or `NaN`) and passes it into `rankBySimilarity` as its `minScore` argument. `SEARCH_TOOL.description` gained a sentence documenting that results are filtered by a minimum relevance score and that an empty result means no sufficiently relevant match was found, not a tool malfunction — so a caller reading only the tool's schema understands the new contract. The existing `MissingApiKeyError`/`EmbeddingsRequestError` error contract is untouched.

## Why

From `PROBLEM.md`'s real goal: the `search` tool could never distinguish "found a genuinely relevant match" from "found the least-bad junk in an index that doesn't cover this topic" — both looked like a normal, non-empty result list. This attack makes "nothing relevant found" a real, detectable outcome (an empty or short result list), which is an explicit prerequisite for a *future* attack (not this one): enforcing that an agent tries `search` before falling back to reading source files directly.

## How to verify

Per-task verification commands (all green in `spearhead-attacks/verify/V-2.1.md`, `V-2.2.md`, `V-3.1.md`):

- `node mcp-server/lib/similarity.test.js` (T-2) — 18/18 pass.
- `node mcp-server/server.test.js` (T-2's fixture repair + T-3) — 10/10 pass.

Full-repo integration check (run after each merge): `find . -name "*.test.js" -not -path "*/node_modules/*" -not -path "./spearhead-attacks/worktrees/*" | xargs node --test` — 194/194 pass after T-2's merge, 198/198 pass after T-3's merge, 0 fail.

Manual smoke test for a reviewer: call the `search` tool with a query that has no genuinely related content in the index — confirm `results: []` (a successful, non-error response) rather than several weak, unrelated matches. Set `SPEARHEAD_SEARCH_MIN_SCORE=0.9` in the environment and re-run the same search — confirm fewer or no results compared to the default `0.5` threshold. Unset the env var or set it to a non-numeric value (e.g. `abc`) — confirm the default `0.5` threshold still applies, no crash.

## Tradeoffs

From `DESIGN.md`'s rejected alternatives:

- **Cutoff inside `rankBySimilarity` over filtering in `server.js` after an unchanged `rankBySimilarity` call** — filtering downstream in `server.js` would split the rank-and-trim concern across two files and weaken the existing unit-test coverage of the "cutoff applied before limit truncation" guarantee, which `similarity.test.js` already tests at the unit level. Rejected in favor of keeping the concern in the one file that already owns it.
- **Fixed absolute threshold over a dynamic/relative one** (e.g. cutoff relative to the top score, or statistical outlier detection) — no ground truth exists yet to calibrate a fancier relative formula against this corpus/embedding model, and the acceptance criteria expect deterministic, predictable pass/fail per score. Rejected as over-engineering for unproven benefit; the fixed threshold is fully overridable via `SPEARHEAD_SEARCH_MIN_SCORE` once real usage data exists.

## Rollout

Plain deploy — this ships as part of the spearhead plugin itself. `rankBySimilarity`'s new default (`0.5`) takes effect immediately for any project using the second-brain feature; no feature flag, no migration. `SPEARHEAD_SEARCH_MIN_SCORE` is opt-in for tuning the threshold; unset it and the documented default applies with no behavior change beyond what T-2/T-3 already ship.

## Monitor after release

From `DESIGN.md`'s failure-mode handling:

- **Threshold miscalibration**: `0.5` has no external ground truth for this corpus/embedding model (Voyage AI `voyage-3`). If real usage shows too many false "nothing relevant found" results (too strict) or still-noisy weak matches (too loose), tune via `SPEARHEAD_SEARCH_MIN_SCORE` without a code change — watch for user reports of either failure mode once this is in regular use.
- **Bad input (`NaN`/non-numeric scores)**: fails closed — any `NaN` comparison against `minScore` is `false`, so such an entry is excluded rather than crashing or slipping through. No special monitoring needed beyond the existing test coverage.
- **Misconfigured env var**: `parseFloat` returns `NaN` for unset or non-numeric `SPEARHEAD_SEARCH_MIN_SCORE`, falling back to the default — never throws, never disables the cutoff. Covered by dedicated tests in both T-2's and T-3's suites.
- **Dependency down (embeddings API unavailable)**: unaffected — `MissingApiKeyError`/`EmbeddingsRequestError` are raised before `rankBySimilarity` is ever called, so the threshold logic never runs on that path.

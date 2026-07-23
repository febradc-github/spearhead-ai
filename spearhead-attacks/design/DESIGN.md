# DESIGN — A-3: MCP search minimum-score threshold

## Candidate approaches

### 1. Cutoff inside `rankBySimilarity`, threshold sourced by `server.js` (chosen)

`similarity.js` exports a `DEFAULT_MIN_SCORE = 0.5` constant alongside the
existing `DEFAULT_LIMIT`. `rankBySimilarity(index, queryEmbedding, limit =
DEFAULT_LIMIT, minScore = DEFAULT_MIN_SCORE)` filters out any entry whose
score is `< minScore` *before* sorting/slicing to `limit`. `server.js`'s
`runSearch` resolves the effective threshold the same way it could resolve
any other override — `parseFloat(process.env.SPEARHEAD_SEARCH_MIN_SCORE)`,
falling back to `DEFAULT_MIN_SCORE` (imported from `similarity.js`, not
re-declared) when unset or `NaN` — and passes it into `rankBySimilarity`.
`SEARCH_TOOL.description` gains a sentence documenting the filter and the
empty-result meaning.

- **Complexity**: one new parameter, one filter step, one env-var read —
  the same shape as the existing `limit`/`DEFAULT_LIMIT` handling already in
  the file. No new files, no new module.
- **Performance**: the filter is a single `O(n)` pass over the same
  already-computed score array, before the existing `O(n log n)` sort — no
  change in asymptotic cost, and for typical index sizes (tens to low
  hundreds of notes) unmeasurable.
- **Maintainability**: the threshold's default lives in exactly one place
  (`similarity.js`), so `server.js` and any future caller of
  `rankBySimilarity` share one source of truth rather than duplicating the
  literal `0.5`.
- **Reversibility**: fully reversible — deleting the `minScore` parameter
  and the filter line restores today's behavior exactly; the env var is
  additive and ignored by old code.

### 2. Cutoff applied in `server.js` after calling `rankBySimilarity` unchanged

Keep `rankBySimilarity`'s signature untouched; in `runSearch`, call it with
a very large `limit` (or `Infinity`) to get all scored entries, filter by
threshold in `server.js`, then slice to the real `limit` there.

- **Complexity**: similar line count, but now the limit/threshold/sort
  contract is split across two files — `similarity.js` still owns sorting,
  `server.js` re-implements truncation.
- **Performance**: equivalent — still one `O(n)` filter, one `O(n log n)`
  sort.
- **Maintainability**: worse. `similarity.test.js` already has a full suite
  of limit/ranking-order tests against `rankBySimilarity` directly (per
  CONTEXT.md's Prior art); splitting the cutoff into `server.js` means those
  guarantees ("cutoff applied before limit truncation" — PROBLEM.md
  criterion 4) can no longer be tested at the unit level where the existing
  ranking tests already live, only at the integration level via
  `server.test.js`'s heavier in-memory-client fixtures.
- **Reversibility**: fine, but not chosen — it fragments a single concern
  (rank-and-trim) across two modules for no benefit.

Rejected: no advantage over option 1, and it weakens unit-test coverage of
the exact ordering guarantee the acceptance criteria call out by name.

### 3. Dynamic/relative threshold (e.g., cutoff relative to the top score, or statistical outlier detection)

Instead of a fixed absolute cosine-similarity cutoff, exclude entries whose
score falls too far below the top result's score, or below some computed
statistical bound (mean/stddev of the batch).

- **Complexity**: meaningfully higher — requires deciding a relative-gap
  formula or a statistics computation, with its own edge cases (single
  result, all-identical scores, empty index).
- **Performance**: still `O(n)`, no real difference.
- **Maintainability**: worse — behavior becomes query-dependent and harder
  to reason about or test deterministically; the acceptance criteria
  (PROBLEM.md #1-3) expect a fixed, predictable pass/fail per score.
- **Reversibility**: fine, but not chosen.

Rejected: PROBLEM.md's Assumptions already settled on a fixed, overridable
absolute threshold precisely because there is no ground truth to calibrate
a fancier relative formula against yet (CONTEXT.md risk #1). Adding
statistical machinery now would be solving a problem this attack doesn't
have evidence for.

## Chosen approach

**Option 1.** It is the simplest change that satisfies every PROBLEM.md
acceptance criterion, keeps the rank-and-trim concern in the one file that
already owns it and is already unit-tested for it, and introduces no new
literal duplication of the default threshold value.

## Failure-mode handling

- **Bad input — a score that is `NaN` or `undefined`** (e.g. a corrupt
  embedding vector managed to produce a non-numeric similarity): the filter
  condition is `score >= minScore`; any `NaN` comparison is `false`, so the
  entry is silently excluded rather than crashing or slipping through.
  Fail-closed, consistent with `cosineSimilarity`'s existing zero-magnitude
  guard (returns `0`, which is always `< minScore` and excluded too).
- **Dependency down (embeddings API unavailable)**: unrelated to this
  change — `MissingApiKeyError`/`EmbeddingsRequestError` are raised before
  `rankBySimilarity` is ever called (embedding happens first in
  `runSearch`), so the threshold logic never runs on that path. Error
  contract is untouched, per PROBLEM.md's explicit assumption.
- **Load / scale**: no new failure mode — the filter is a single linear
  pass over data already held in memory for the sort step; no additional
  I/O, no additional allocation beyond the filtered array itself.
- **Partial failure — every entry scores below threshold**: returns an
  empty array. This is the intended new success case (PROBLEM.md criterion
  3), not a failure — `runSearch`/the tool handler must return it as a
  normal, non-error `results: []` response, exactly like a legitimately
  empty index would today.
- **Misconfigured env var** (`SPEARHEAD_SEARCH_MIN_SCORE` unset, empty, or
  non-numeric, e.g. `"abc"`): `parseFloat` returns `NaN` in the unset/
  non-numeric case; the resolution falls back to `DEFAULT_MIN_SCORE`
  rather than disabling the cutoff or throwing — same pattern already
  proven by `SPEARHEAD_EMBEDDINGS_ENDPOINT` in `embeddings.js`.

## Open questions resolved during design

- **Where does the default value live?** In `similarity.js`, exported as
  `DEFAULT_MIN_SCORE`, so `server.js` imports it instead of hardcoding `0.5`
  a second time.
- **Does `rankBySimilarity` get a default `minScore` even when called
  without one?** Yes — defaulting to `DEFAULT_MIN_SCORE` makes the function
  safe-by-default for any future caller (not just `server.js`), matching
  how `limit` already defaults to `DEFAULT_LIMIT`.

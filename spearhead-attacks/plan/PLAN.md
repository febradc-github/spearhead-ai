## Task list

1. **T-2** — `rankBySimilarity` minimum-score cutoff in
   `mcp-server/lib/similarity.js` (the core logic change, riskiest and most
   uncertain piece — behavior change to an already-tested function with an
   existing suite of ranking/limit tests to reconcile). Task ID starts at
   T-2, not T-1, because the per-attack task counter had already advanced
   by one before this task was added. **Amended after V-2.1's mechanical
   gate failure**: T-2's expected files now also include
   `mcp-server/server.test.js`, narrowly scoped to repairing the two
   pre-existing tests whose fixtures broke when `server.js`'s
   parameter-less `rankBySimilarity` call started inheriting the new
   `DEFAULT_MIN_SCORE` default — an approved, intended side effect of this
   task's own change, not new functionality.
2. **T-3** — `mcp-server/server.js`'s `runSearch` env-var wiring
   (`SPEARHEAD_SEARCH_MIN_SCORE`) and `SEARCH_TOOL.description` update
   (depends on T-2's new signature/export existing first).

## Dependency graph

```
T-2 (none)
T-3 -> T-2
```

No parallel-eligible pairing exists in this attack — T-3 genuinely needs
T-2's `DEFAULT_MIN_SCORE` export and the new `rankBySimilarity` `minScore`
parameter to exist before it can wire the env var through to it.

## Testing strategy

- Framework: Node's built-in `node:test` + `node:assert/strict`, matching
  the repo's existing convention. Each test file is run directly:
  `node <file>.test.js`, or via `npm test` in `mcp-server/`.
- Test-first: both tasks' expected-file sets include their `.test.js`
  alongside the implementation file each covers.
- T-2's tests extend the existing `entry(embedding, type)` fixture-builder
  pattern in `similarity.test.js`; existing tests that implicitly relied on
  no cutoff (e.g. limit/ranking-order tests using low-magnitude vectors)
  are updated to pass an explicit low `minScore` (e.g. `-1`) so they keep
  isolating the behavior they were written to test, per T-2's acceptance
  criteria.
- T-2's amendment (fixing two pre-existing `server.test.js` tests) and
  T-3's new tests both use the existing `mkRoot`/`writeFile`/`setEntry`/
  `withInMemoryClient` fixture builders in `server.test.js`, with an
  injected `embed()` stub controlling the query embedding so scores are
  deterministic, matching the existing pattern (e.g. `embed = async () =>
  [1, 0, 0]`).
- No live network calls — this attack adds no network-calling code; the
  threshold is a pure in-memory filter on already-computed scores.
- Coverage expectation: every acceptance criterion in this attack's
  `PROBLEM.md` maps to at least one task's acceptance criteria above and is
  exercised by that task's verification command; the verifier checks this
  mapping. In particular: PROBLEM.md criteria 1-3 and the cutoff-before-
  limit ordering are unit-tested in T-2; criteria 4-5 (env var wiring,
  description text) and criterion 6 (scope containment) are exercised in
  T-3's live-server tests.

## Self-check (parallelism / lockfile / creation coverage)

- Lockfile routing: no dependency manifest or lockfile is touched by
  either task — not applicable to this attack.
- Both tasks' expected-file sets include the implementation file(s) they
  modify and the test file(s) they extend (test-first coverage; both are
  edits to existing files, not new-file creations, so no glob is needed).
- Pairwise overlap check: only two tasks total, with an explicit
  `depends_on` edge (T-3 → T-2). After the amendment, both tasks list
  `mcp-server/server.test.js` — T-2 touches only two named pre-existing
  tests in it (fixture repair), T-3 adds new tests alongside them; since
  T-3 depends on T-2 and this attack has no parallel dispatch, the overlap
  is a real ordering dependency, not a parallelism hazard — nothing to
  serialize beyond what the dependency edge already requires.

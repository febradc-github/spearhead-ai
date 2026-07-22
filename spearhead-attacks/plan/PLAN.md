## Task list

1. **T-1** — MCP server skeleton + dual-runtime manifest declaration
   (riskiest: validates the core architectural assumption first).
2. **T-2** — Shared frontmatter parser (`lib/knowledge-frontmatter.js`).
3. **T-3** — Content hashing + embeddings client module.
4. **T-4** — Index storage (atomic `embeddings.json`) + cosine similarity.
5. **T-5** — File-watch pipeline wiring hash + embeddings + index store.
6. **T-6** — Real `search` MCP tool, replacing the T-1 stub.
7. **T-7** — Deterministic naming script (`scripts/knowledge-path.js`).
8. **T-8** — Search-first reminder (extend `remind.js` + `RULES.md`).
9. **T-9** — `knowledge-nudge.js` hook: code-doc-on-first-read + task-done
   doc update.
10. **T-10** — README + CHANGELOG documentation.

## Dependency graph

```
T-1 (none)
T-2 (none)
T-3  -> T-1
T-4  -> T-1
T-5  -> T-2, T-3, T-4
T-6  -> T-1, T-5
T-7  -> T-2
T-8  (none)
T-9  -> T-1, T-7
T-10 -> T-6, T-8, T-9
```

Parallel-eligible pairs once their own deps are satisfied (disjoint file
sets, no dependency path between them): T-1 & T-2, T-3 & T-4, T-3/T-4 &
T-7, T-3/T-4/T-5 & T-8, T-6 & T-7, T-6 & T-9's-not-yet-eligible-siblings.
Any specific pairing still needs your explicit approval at execute time per
the parallelism rule — this is just what the file sets allow.

## Testing strategy

- Framework: Node's built-in `node:test` + `node:assert/strict`, matching
  the repo's existing convention (no jest/mocha/tape). Each test file is
  run directly: `node <file>.test.js`.
- Test-first: every task's expected-file set includes its `.test.js`
  alongside the implementation file it covers.
- No live network calls in any test — `fetch` (embeddings API) is always
  mocked or dependency-injected. Index-store and watch-pipeline tests use
  temp directories (`node:fs.mkdtempSync`), never the real
  `spearhead-knowledge/`.
- Hook tests (`remind.test.js`, `knowledge-nudge.test.js`) use `spawnSync`
  against fixture PostToolUse/UserPromptSubmit payloads, matching the
  existing hook-test pattern in the repo.
- `remind.test.js` continues to enforce that `remind.js`'s injected text
  stays byte-identical to `rules/RULES.md` — T-8 updates both files
  together specifically to keep that test green.
- Coverage expectation: every acceptance criterion in `PROBLEM.md` maps to
  at least one task's acceptance criteria above and is exercised by that
  task's verification command; the verifier checks this mapping.

## Self-check (parallelism / lockfile / creation coverage)

- Lockfile routing: `mcp-server/package.json` and `package-lock.json` are
  touched only by T-1 — one dedicated task, no other task modifies them.
- Every task's expected-file set includes both the implementation file(s)
  it creates and the test file(s) it creates (test-first coverage).
- Pairwise overlap check for tasks with no dependency path between them:
  no two such tasks share a file (verified path-by-path above); the one
  place two tasks touch the same files (`plugin.json`, touched by T-1 and
  T-9) has an explicit `depends_on` edge (T-9 → T-1), so it's sequential,
  not parallel.

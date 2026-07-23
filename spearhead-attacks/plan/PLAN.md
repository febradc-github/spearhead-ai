## Task list

1. **T-1** — `source_hash` scalar frontmatter field in
   `lib/knowledge-frontmatter.js` (small, low-risk prerequisite for T-2).
2. **T-2** — `hooks/knowledge-nudge.js`'s `handleRead` staleness detection
   (via T-1's `source_hash`) + wikilink-discipline guidance in all three
   nudge message sites (the substantive, riskier piece).

## Dependency graph

```
T-1 (none)
T-2 -> T-1
```

No parallel-eligible pairing exists in this attack — T-2 genuinely needs
T-1's `source_hash` field to exist before it can compare against it.

## Testing strategy

- Framework: Node's built-in `node:test` + `node:assert/strict`, matching
  the repo's existing convention. Each test file is run directly:
  `node <file>.test.js`.
- Test-first: both tasks' expected-file sets include their `.test.js`
  alongside the implementation file each covers.
- No live network calls — this attack adds no network-calling code;
  `hashContent` (reused from `mcp-server/lib/hash.js`) is `node:crypto`
  only.
- T-2's hook tests use `spawnSync` against fixture `PostToolUse` payloads,
  matching the existing pattern in `hooks/knowledge-nudge.test.js` and
  `hooks/remind.test.js`.
- T-2's tests must cover, at minimum: matching-hash silence (no nudge),
  missing/mismatched-hash refresh nudge, same-`(path, hash)` no-repeat
  throttling within a session, a changed file re-nudging after already
  being nudged once for a prior hash, and wikilink-line presence in all
  three nudge message call sites (`handleRead` new-note, `handleRead`
  refresh, `handleBash` task-done).
- Coverage expectation: every acceptance criterion in this attack's
  `PROBLEM.md` maps to at least one task's acceptance criteria above and
  is exercised by that task's verification command; the verifier checks
  this mapping.

## Self-check (parallelism / lockfile / creation coverage)

- Lockfile routing: no dependency manifest or lockfile is touched by
  either task — not applicable to this attack.
- Both tasks' expected-file sets include the implementation file(s) they
  modify and the test file(s) they extend (test-first coverage; both are
  edits to existing files, not new-file creations, so no glob is needed).
- Pairwise overlap check: only two tasks total, and they have an explicit
  `depends_on` edge (T-2 → T-1) with no file overlap between them anyway
  (`lib/knowledge-frontmatter.js`/`.test.js` vs. `hooks/knowledge-nudge.js`/
  `.test.js`) — nothing to serialize beyond the real ordering already
  required by the dependency.

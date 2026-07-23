## Task list

1. **T-1** — `agents/guru.md` (new sub-agent: search →
   staleness-cross-check → source-fallback → document). The riskiest,
   most novel piece — a whole new agent behavior spec with no direct
   precedent in this repo beyond the general agent-definition shape. No
   dependencies.
2. **T-2** — Relocate `mcp-server/lib/hash.js` to `lib/hash.js`, update
   `hooks/knowledge-nudge.js`'s import. No dependencies.
3. **T-3** — `lib/knowledge-frontmatter.js`: add `cssclasses` to
   `LIST_FIELDS`, document the expanded `type` taxonomy, ship an opt-in
   CSS snippet. No dependencies.
4. **T-4** — Rework `hooks/remind.js`'s and `rules/RULES.md`'s
   search-first nudge to point at dispatching `guru`. No dependencies.
5. **T-5** — Delete `mcp-server/` in full, remove `mcpServers` from both
   plugin manifests. Depends on T-2 (must not delete `hash.js`/`hash.test.js`
   before they're relocated out of `mcp-server/`).
6. **T-6** — `/spearhead:obsidian-graph`: `scripts/obsidian-graph.js` +
   command + skill. No dependencies.
7. **T-7** — `README.md` + `CHANGELOG.md`: rewrite the "Second-brain
   knowledge base" section for the `guru`-agent architecture, document
   Obsidian setup, add a CHANGELOG entry. Depends on T-1 through T-6
   (docs describe the final, fully-shipped behavior, not an intermediate
   state).

## Dependency graph

```
T-1 (none)
T-2 (none)
T-3 (none)
T-4 (none)
T-5 -> T-2
T-6 (none)
T-7 -> T-1, T-2, T-3, T-4, T-5, T-6
```

**T-1, T-2, T-3, T-4, and T-6 are all pairwise parallel-eligible**: no
dependency edges among them, and no file overlap (`agents/guru.md`;
`lib/hash.js`/`hash.test.js` + `hooks/knowledge-nudge.js`/`.test.js`;
`lib/knowledge-frontmatter.js`/`.test.js` + a new CSS file;
`hooks/remind.js`/`.test.js` + `rules/RULES.md`; `scripts/obsidian-graph.js`/
`.test.js` + `commands/obsidian-graph.md` + `skills/spearhead-obsidian-graph/SKILL.md`
— five entirely disjoint file sets). T-5 needs T-2 done first (can't
delete `mcp-server/` before `hash.js` is safely relocated out of it). T-7
needs everything else done first to document accurately.

## Testing strategy

- Framework: Node's built-in `node:test` + `node:assert/strict`, matching
  the repo's existing convention. Each test file is run directly:
  `node <file>.test.js`.
- Test-first: every task's expected-file set includes its `.test.js`
  alongside the implementation file(s) it covers, where a `.test.js` is
  applicable — T-1 (`agents/guru.md`) and T-7 (docs) are the two
  exceptions, since neither ships testable code (agent definitions are
  prompt specs, not unit-tested in this repo; docs have no automated test
  beyond a `git grep` sweep, same pattern as A-4's T-5).
- **No live subprocess execution, no live network call, and no real
  Obsidian/CLI invocation anywhere in the test suite.** T-6's
  `scripts/obsidian-graph.js` tests inject `options.exec` to replace the
  real `node:child_process` call, mirroring the exact pattern established
  in A-4's `mcp-server/lib/rank.js` (`options.exec`).
- T-2's tests confirm `lib/hash.js` behaves identically to the relocated
  `mcp-server/lib/hash.js` (same test file, moved) and that
  `hooks/knowledge-nudge.test.js` still passes with the updated import.
- T-3's tests confirm `cssclasses` round-trips through
  `parse(serialize(x))` as an array, matching `tags`/`related`'s existing
  round-trip tests.
- T-4's tests confirm the new dispatch-`guru` wording is present and the
  old "spearhead-knowledge search tool" phrasing is gone from both
  `remind.js`'s test fixtures.
- T-5's verification is largely mechanical: a `git grep` sweep for
  leftover `mcp-server`/`mcpServers` references, plus a full-suite run —
  the acceptance criteria are about absence, not new behavior.
- T-6's tests must cover: correct `obsidian://` URI construction (vault
  name = repo root directory basename, `commandid=graph:open`); correct
  platform-to-open-command mapping for all three platforms via the
  injected `options.exec` seam; the unsupported-platform fallback
  (prints URI, doesn't throw); a spawn-error case surfacing clearly.
- T-7 has no automated test in the traditional sense; verification is a
  `git grep` sweep for stale MCP-server/embeddings/CLI-ranking language
  plus a manual read-through against T-1 through T-6's actual shipped
  behavior.
- Coverage expectation: every PROBLEM.md acceptance criterion maps to at
  least one task's acceptance criteria and is exercised by that task's
  verification command; the verifier checks this mapping. In particular:
  criterion 1 (`mcp-server/` gone) is T-5; criteria 2/4 (`hash.js`
  relocated, no stray import) are T-2; criterion 3 (`guru.md` exists and
  matches the pattern) is T-1; criterion 5 (manifests clean) is T-5;
  criterion 6 (`remind.js` reworked) is T-4; criterion 7 (`type`
  taxonomy + `cssclasses`) is T-3; criterion 8 (CSS snippet) is T-3;
  criterion 9 (`obsidian-graph` command+skill) is T-6; criteria 10-11
  (README/CHANGELOG/ADR) are T-7 plus the ADR already written in design;
  criterion 12 (full suite green) is checked at every merge and finally
  by T-5/T-7.

## Self-check (parallelism / lockfile / creation coverage)

- Lockfile routing: no dependency manifest or lockfile is touched by any
  task — not applicable to this attack.
- Every task's expected-file set covers both modifications and creations:
  T-1 creates one new file (`agents/guru.md`); T-2 creates two
  (`lib/hash.js`, `lib/hash.test.js`) and deletes two
  (`mcp-server/lib/hash.js`, `mcp-server/lib/hash.test.js`); T-3 creates
  one new CSS file alongside modifying the frontmatter module; T-5 lists
  `mcp-server/**` for deletion plus two manifest modifications; T-6
  creates all four of its files; T-7 modifies two existing files only.
- Pairwise overlap check across tasks with no dependency path between
  them: T-1, T-2, T-3, T-4, T-6 — checked pairwise, zero file overlap
  among any pair (five entirely disjoint file sets, listed in the
  dependency graph section above) — all five correctly parallel-eligible
  with each other. T-5 (depends on T-2) and T-7 (depends on everything)
  each have a real dependency edge, so no further overlap check applies
  to them.
- **(Amendment, added after T-2's V-2.1 mechanical gate failure)** T-2's
  expected files now also include `mcp-server/lib/pipeline.js` (a single
  import-path line fix, since deleting `hash.js` from its old location
  broke `pipeline.js`'s only require of it). T-5's expected files already
  cover `mcp-server/**` (its full deletion) and already depends on T-2 —
  no new parallelism hazard, since T-5 was already serialized after T-2
  and now simply deletes a file T-2 briefly patched rather than one T-2
  left untouched.

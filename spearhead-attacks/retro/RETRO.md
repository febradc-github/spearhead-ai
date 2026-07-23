# RETRO — A-5: Replace MCP-server search with guru sub-agent + Obsidian-friendly knowledge base

## Criteria confirmation

Against `problem/PROBLEM.md`'s `## Acceptance criteria`, one by one, with evidence from `spearhead-attacks/verify/V-1.1.md` through `V-7.1.md`:

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `mcp-server/` no longer exists in the working tree | met | `V-5.1.md` (fail) → `V-5.2.md` (pass): full directory deleted, 3,077 lines across 12 files. |
| 2 | `lib/hash.js` exports `hashContent` (relocated), `knowledge-nudge.js` imports from new location, no stray import survives | met | `V-2.2.md`: byte-identical relocation confirmed, `git grep` sweep clean. |
| 3 | `agents/guru.md` exists, matches `spearhead-scout.md`'s pattern, documented behavior matches every specified detail | met | `V-1.1.md`: verifier confirmed content genuinely satisfies every criterion, not superficially — every cross-reference (`knowledge-nudge.js`'s comparison direction, `ADR-004`'s naming authority, frontmatter grammar) verified real and consistent. |
| 4 | `guru` dispatched only via Agent tool by an already-running session; no user-facing command | met | `V-1.1.md`: `description` states "never invoke directly"; no `commands/guru.md` exists anywhere in the diff history. |
| 5 | Both plugin manifests contain no `mcpServers` key | met | `V-5.2.md`: both manifests confirmed clean, kimi's `hooks` array intact. |
| 6 | `hooks/remind.js` no longer references an MCP search tool; nudges dispatching `guru` | met | `V-4.1.md`: both `remind.js` and `rules/RULES.md` reworked consistently; tests assert new wording present and old wording absent. |
| 7 | `type` accepts `code`/`decisions`/`design`/`architecture`; `cssclasses` field added | met | `V-3.1.md`: `LIST_FIELDS` gains `cssclasses`, round-trips correctly; four-way taxonomy documented, `design` newly formalized. |
| 8 | CSS snippet exists, opt-in, no `.obsidian/` config committed | met | `V-3.1.md`: `spearhead-knowledge/obsidian-css-snippet.css` styles all four types, header comment states opt-in nature explicitly. |
| 9 | `commands/obsidian-graph.md` + `skills/spearhead-obsidian-graph/SKILL.md` exist, follow the established pairing convention | met | `V-6.1.md`: thin wrapper + `user-invocable: false` skill, matching `commands/status.md`'s pattern exactly. |
| 10 | README describes `guru` mechanism, no stale MCP/embeddings/CLI-ranking references; CHANGELOG gains new entry | met | `V-7.1.md`: every specific claim cross-checked against actual shipped code and confirmed accurate; existing CHANGELOG entry byte-for-byte untouched. |
| 11 | New ADR records the reversal; ADR-001 through ADR-008 untouched | met | `adr-009-guru-agent-replaces-mcp-server.md` exists; `adr-001` through `adr-008` all present, none appear in any task's diff. |
| 12 | Full test suite passes with 0 failures | met | Integration checks across all seven merges: 195 → 195 → 200 → 200 → 210 → 137 → 137, 0 fail throughout. |

**12 of 12 fully met.** No gaps found at this retro.

## Follow-ups

1. **`guru`'s answer-quality is now unmeasurable by a structured contract.** Unlike A-3/A-4's `{path, excerpt, score}` API, there's no automated way to check whether `guru` found the genuinely best-matching notes — it depends entirely on the dispatching agent's own judgment. Worth watching in practice; not a defect, just a real tradeoff of this design (flagged explicitly in `SHIP.md`'s monitor section).
2. **`decisions/`/`design/`/`architecture/` notes have no automated writer**, same gap that's existed since A-1 — `guru` was deliberately scoped to `code/` notes only (confirmed by this attack's own understand-phase decision). Worth revisiting as a future attack if these categories prove important in practice and stay empty without one.
3. **Advanced URI's `commandid=graph:open` was never verified against a live Obsidian install or official docs** — implemented as designed, documented as an assumption at every stage (DESIGN.md, T-6's task file, its verify report), never silently asserted as confirmed fact. If `/spearhead:obsidian-graph` doesn't work as expected in practice, this is the first thing to check.
4. **`npm audit` flag, no longer applicable** — this follow-up was carried across A-1 through A-4's retros (moderate-severity transitive vulnerabilities in `@hono/node-server`, pulled in by the MCP SDK's optional HTTP/SSE transport). Since `mcp-server/` (and its only dependency, `@modelcontextprotocol/sdk`) is deleted entirely by this attack, this follow-up is now moot — closed, not carried forward.

## Lessons

- **Two verify failures this attack shared a root cause worth naming explicitly: deleting or relocating a file used by another, out-of-scope file breaks that file's own mechanical gate, even when the breaking task's own tests are green.** T-2 hit this twice in the same attempt (`pipeline.js`'s import, then `pipeline.test.js`'s own separate import of the same old path) — worth specifically checking, at breakdown time, whether a task that deletes/moves a shared utility has fully enumerated every file that imports it (`git grep` for the old path before finalizing a task's expected-files list), not just the files the task's own goal is about.
- **A task-file authoring inconsistency (an absolute acceptance criterion that contradicted its own "Out of scope" section's implied exceptions) caused T-5's verify failure** — a mistake in how I wrote the task at breakdown time, not in the coder's execution. Worth double-checking, when a task's out-of-scope list names files that are *expected* to still contain some stale/deferred content, that the acceptance criteria explicitly whitelist them rather than stating an unqualified absolute.
- **This attack was itself a full architectural reversal of three prior attacks' shipped work (A-1, A-3, A-4)**, decided through in-conversation dialogue before any code was touched — confirms the value of pushing hard on "is this really the right premise" during `understand`, even after multiple attacks have already built on an earlier premise. Verifying externally-sourced facts (Obsidian's actual color-coding mechanism, the confirmed `claude`/`kimi` fallback-behavior gap) before committing to a design, rather than assuming from training knowledge, caught real gaps (e.g., that kimi-code has no confirmed generic sub-agent primitive `guru` could map onto) before they became execution-time surprises.
- **The established recovery patterns from this entire session (mechanical-gate-failure → replan → narrow repair pass; stash/merge/pop for uncommitted `spearhead-attacks/` state) scaled cleanly to a 7-task attack with parallel dispatch and two separate replan cycles**, with zero lost work and zero silently-accepted scope violations throughout.

## Docs and runbooks updated

- `README.md`'s "Second-brain knowledge base" section (T-7) — fully rewritten for the `guru`-agent architecture, verified claim-by-claim against shipped code.
- `CHANGELOG.md` — new top entry (T-7).

## Dead code removed

- `mcp-server/` in full (T-5) — 3,077 lines across 12 files: the MCP server, its ranking module (A-4), file-watch pipeline, index store, and all their tests. Four generations of second-brain search infrastructure (A-1's embeddings client, A-3's threshold logic, A-4's CLI-ranking module, and the MCP server shell itself from A-1) — all superseded by `agents/guru.md`.

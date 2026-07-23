# SHIP — A-5: Replace MCP-server search with guru sub-agent + Obsidian-friendly knowledge base

## What changed

**T-1 — `agents/guru.md` (new sub-agent).** Replaces the MCP-server-based search entirely. `guru` is dispatched via the Agent tool by an already-running session (same pattern as `spearhead-scout`/`-coder`/`-verifier`, never invoked directly, no user-facing command): searches `spearhead-knowledge/**/*.md` via `Glob`/`Grep`/`Read`; cross-checks any match's `source_hash` frontmatter against a freshly-computed hash of its `source:` file (reusing `hooks/knowledge-nudge.js`'s exact staleness idiom, run in reverse); falls back to reading/grepping the real source when nothing relevant or only stale matches exist; documents a successful fallback by writing/refreshing a `code/` note (never `decisions/`/`design/`/`architecture/`); returns a grounded answer. Documents an inline kimi-code fallback since kimi-code doesn't support plugin-defined sub-agents.

**T-2 — Relocate `hash.js` to `lib/`.** Byte-for-byte relocation via `git mv`, `hooks/knowledge-nudge.js`'s import updated. Surfaced two mechanical-gate failures across two verify attempts, both the same class of issue: `mcp-server/lib/pipeline.js` and its own test file each had their own direct `require('./hash.js')` against the old location, broken by the relocation. Both were narrow, one-line bridge fixes (`pipeline.js` and `pipeline.test.js` were about to be deleted entirely by T-5 anyway), added to T-2's scope via `/spearhead:replan` each time.

**T-3 — `cssclasses` + expanded type taxonomy + CSS snippet.** `lib/knowledge-frontmatter.js`'s `LIST_FIELDS` gains `cssclasses`, round-tripping like `tags`/`related`. `type`'s valid values are documented as `code`/`decisions`/`design`/`architecture` — `design` was specified in A-1's original design as "opportunistic capture" but never actually built into the code until now. A new opt-in CSS snippet (`spearhead-knowledge/obsidian-css-snippet.css`) color-codes notes by type in Obsidian's reading view; never bundled into any committed `.obsidian/` config.

**T-4 — Rework `remind.js` + `RULES.md`'s search-first nudge.** Both files' identical "try the spearhead-knowledge search tool first" line reworded to "dispatch the guru agent... fall back to source only if guru finds nothing." Tests strengthened with both positive (new wording) and negative (old wording gone) assertions.

**T-5 — Delete `mcp-server/` in full + remove `mcpServers` from both manifests.** 3,077 lines deleted across 12 files (server, ranking, pipeline, watch, index-store, and their tests, plus `package.json`/`package-lock.json`). Kimi manifest's other hooks confirmed untouched. First verify attempt failed on a genuine task-file inconsistency I introduced at breakdown: an absolute acceptance criterion that didn't whitelist files my own "Out of scope" section had already excused (README.md, `knowledge-frontmatter.js`'s stale comments), plus one genuinely unowned `.gitignore` leftover line — fixed via `/spearhead:replan`, clean pass on the second attempt.

**T-6 — `/spearhead:obsidian-graph` command+skill+script.** A dependency-free `scripts/obsidian-graph.js` (matching this repo's `scripts/` convention, per `ADR-004`'s precedent for deterministic scripts over per-session LLM judgment) constructs an `obsidian://advanced-uri?vault=<repo-root-basename>&commandid=graph:open` URI and invokes the platform's URI-open command. Honest about its limitation: can only confirm the OS-level open command ran without a spawn error, never that Obsidian actually reached the graph view.

**T-7 — Docs.** README's "Second-brain knowledge base" section fully rewritten for the `guru`-agent mechanism, verified claim-by-claim against the actual shipped code (not written from memory); new CHANGELOG entry, added above the still-untouched entry from the prior (now-superseded) attack.

## Why

From `PROBLEM.md`'s real goal: A-4's CLI-subprocess-ranking architecture still had a real cost the second-brain feature didn't need — an MCP server can't invoke the host's own running LLM, so any reasoning it does means either a third-party API call (A-1's problem) or a brand-new, disconnected CLI session per search (A-4's problem: real added latency and cost for no benefit, since the calling agent was already a capable LLM session). This attack removes that indirection entirely: the calling agent's own `Glob`/`Grep`/`Read` tools, wrapped in a dedicated `guru` sub-agent, do the same job with zero subprocess spawns, zero CLI-detection logic, and zero per-search cost beyond the agent's own reasoning — while extending the knowledge base to be directly usable as an Obsidian vault, which the MCP-server layer was never actually providing any value toward.

## How to verify

Per-task verification commands (all green in `spearhead-attacks/verify/V-1.1.md`, `V-2.1.md`/`V-2.2.md`, `V-3.1.md`, `V-4.1.md`, `V-5.1.md`/`V-5.2.md`, `V-6.1.md`, `V-7.1.md`):

- Manual structural review of `agents/guru.md` (T-1) — no automated test, agent definitions are prompt specs in this repo.
- `node lib/hash.test.js` + `node hooks/knowledge-nudge.test.js` (T-2) — 5/5, 21/21 pass.
- `node lib/knowledge-frontmatter.test.js` (T-3) — 21/21 pass.
- `node hooks/remind.test.js` (T-4) — 15/15 pass.
- `git grep -il "mcp-server\|mcpServers"` sweep (T-5) — only whitelisted historical/deferred references remain.
- `node scripts/obsidian-graph.test.js` (T-6) — 10/10 pass.
- `git grep -il "mcp-server\|voyage\|SPEARHEAD_EMBEDDINGS\|SPEARHEAD_RANKING_CLI" -- README.md` (T-7) — no matches.

Full-repo integration check (run after each merge): 195 → 195 (T-1) → 195 (T-2) → 200 (T-3) → 200 (T-4) → 210 (T-6) → 137 (T-5, net -73 from the `mcp-server/` deletion) → 137 (T-7) pass across all seven merges, 0 fail throughout.

Manual smoke test for a reviewer: ask a question the calling agent would need to consult the knowledge base for — confirm it dispatches `guru`, gets a grounded answer, and (if nothing was found) `guru` writes a new `code/` note at the path `scripts/knowledge-path.js` would compute. Edit a documented source file, ask the same kind of question again — confirm `guru` detects the staleness (hash mismatch) and refreshes the note rather than trusting stale content. Run `/spearhead:obsidian-graph` with Obsidian and the Advanced URI plugin installed — confirm Obsidian opens to the graph view.

## Tradeoffs

From `DESIGN.md`'s rejected alternatives and `ADR-009`:

- **In-agent `guru` sub-agent over kimi-code's built-in generic sub-agent primitive** — no confirmed kimi-code primitive maps cleanly onto `guru`'s open-ended "search, judge relevance, maybe write a file" task (unlike `spearhead-execute`'s coder-role fallback or `spearhead-verify`'s judgment-role fallback); an inline, documented process for kimi-code satisfies every acceptance criterion without depending on unconfirmed internals.
- **`cssclasses` registered in `LIST_FIELDS` over leaving it unrecognized** — a one-line fix that removes a latent round-trip-loss trap, for zero cost.
- **A dependency-free `scripts/obsidian-graph.js` over inline shell prose in the skill** — this repo already made this exact tradeoff once (`ADR-004`, for note-path computation); the same "deterministic script beats per-session LLM re-derivation" reasoning applies identically here.
- **Deleting `mcp-server/` and four generations of its own shipped work (A-1's embeddings client, A-3's threshold logic, A-4's CLI-ranking module) over patching a fifth generation onto an architecture whose core premise no longer held** — a real, accepted cost of an honest design reversal, not a decision made lightly.

## Rollout

Plain deploy — ships as part of the spearhead plugin itself. No feature flag, no migration. The old `SPEARHEAD_EMBEDDINGS_API_KEY`/`SPEARHEAD_EMBEDDINGS_ENDPOINT`/`SPEARHEAD_SEARCH_MIN_SCORE`/`SPEARHEAD_RANKING_CLI` env vars have zero effect now (nothing reads them). Any existing `spearhead-knowledge/index/embeddings.json` file (if one exists in a project from before this attack) is simply orphaned — nothing reads or writes it anymore; safe to delete manually, not required to.

## Monitor after release

From `DESIGN.md`'s failure-mode handling:

- **`guru`'s judgment quality**: unlike the old CLI-ranking approach, there's no structured `{path, excerpt, score}` contract to test against — `guru`'s answer quality depends entirely on the dispatching agent's own reasoning. Watch for cases where `guru` fails to find genuinely relevant notes that exist, or writes low-quality notes on fallback.
- **Note-writing discipline**: `guru` is scoped to `code/` notes only; watch whether this proves too narrow in practice (i.e., whether `decisions/`/`design/`/`architecture/` notes stay meaningfully populated without an automated writer, or whether that gap becomes a real problem worth a future attack).
- **`.gitignore` cleanup**: this attack's second verify failure (T-5) came from an unowned leftover line — worth double-checking future deletions sweep `.gitignore` as part of their own scope, not as an afterthought.
- **Advanced URI `commandid` assumption**: `graph:open` was never verified against Obsidian's live command list or Advanced URI's official docs in either T-6's or this attack's environment — carried as an open item, not a confirmed fact.

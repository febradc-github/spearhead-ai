# Changelog

## Unreleased — 2026-07-23

- **MCP server replaced by the `guru` sub-agent.** `mcp-server/` is deleted
  entirely — the second-brain knowledge base is no longer a server, an
  index, or a third-party dependency of any kind. `agents/guru.md` is a
  normal sub-agent that searches `spearhead-knowledge/**/*.md` directly with
  `Glob`/`Grep`/`Read`, cross-checks each candidate note's `source_hash`
  frontmatter against a freshly-computed hash of its `source:` file to
  detect staleness, falls back to reading the actual source tree when
  nothing relevant or fresh is found, and documents a successful fallback as
  a `code/` note. `hash.js` moves from `mcp-server/lib/` to `lib/`, shared
  by `guru`, `hooks/knowledge-nudge.js`, and `scripts/`. `remind.js` /
  `rules/RULES.md` now nudge dispatching `guru` first, falling back to
  source only if it finds nothing — replacing the old "try the
  spearhead-knowledge search tool" wording. Note taxonomy expands from
  three types to four: `code`/`decisions`/`design`/`architecture` (`design`
  is new — opportunistic-capture notes not tied 1:1 to one source file).
- **Obsidian compatibility.** `spearhead-knowledge/` notes are usable
  directly as an Obsidian vault: a new `cssclasses` frontmatter field
  (`lib/knowledge-frontmatter.js`) pairs with an opt-in
  `spearhead-knowledge/obsidian-css-snippet.css` that color-codes notes by
  `type` once copied into a vault's `.obsidian/snippets/`. A new
  `/spearhead:obsidian-graph` command (`scripts/obsidian-graph.js`) opens
  Obsidian directly to the vault's graph view via the Advanced URI community
  plugin, when installed.
- **CLI-based ranking replaces embeddings.** The second-brain
  `search` tool no longer depends on a third-party embeddings API
  (Voyage AI): `mcp-server/lib/rank.js` now ranks candidate notes by
  invoking the runtime's already-installed, already-authenticated `claude`
  or `kimi` CLI in non-interactive mode, asking it to judge relevance
  directly instead of computing and comparing embedding vectors.
  `SPEARHEAD_EMBEDDINGS_API_KEY`, `SPEARHEAD_EMBEDDINGS_ENDPOINT`, and
  `SPEARHEAD_SEARCH_MIN_SCORE` are gone; a new `SPEARHEAD_RANKING_CLI`
  env var overrides the CLI auto-detection (`"claude"` or `"kimi"`).
  Indexing (`mcp-server/lib/pipeline.js`) is now purely local hashing with
  no network call at index time at all. `search` results no longer carry
  a numeric `score` field — relevance is conveyed by array order and by
  omission of non-matches instead.

## 0.8.0 — 2026-07-23

- **Knowledge-nudge staleness detection + wikilink discipline (A-2).**
  `hooks/knowledge-nudge.js`'s `handleRead` now detects source-content
  drift via a `source_hash` frontmatter field (`lib/knowledge-frontmatter.js`),
  not just note existence: unchanged documented files stay silent
  regardless of session, changed ones get a refresh nudge (in-place update
  + `## Changelog` entry) even within an idle window that would otherwise
  suppress a repeat. All three nudge sites now also remind the agent to use
  `[[wikilinks]]` only for genuinely related notes, not indiscriminately.
- **MCP search minimum-score threshold (A-3).** `rankBySimilarity`
  (`mcp-server/lib/similarity.js`) now excludes entries scoring below a
  minimum cosine-similarity threshold (`DEFAULT_MIN_SCORE = 0.5`,
  overridable via `SPEARHEAD_SEARCH_MIN_SCORE`) before truncating to
  `limit`, so "nothing relevant found" is a real, detectable outcome (an
  empty or short result list) instead of always returning the top N
  results however irrelevant. `SEARCH_TOOL.description` documents the new
  contract.
- Plugin manifest versions (`.claude-plugin/plugin.json`,
  `.kimi-plugin/plugin.json`) brought back in sync with this file — a
  standing gap since `0.7.0` where the manifests remained at `0.6.0`.

## 0.7.0 — 2026-07-23

- **Second-brain knowledge base (A-1), complete.** A searchable semantic
  index over spearhead's own decision record and the project's
  documentation, kept current with no separate "go write docs" step.
  - Three knowledge sources watched: `spearhead-knowledge/**/*.md`,
    `spearhead-attacks/**/*.md` (the decision record), and general docs
    (`README.md`, `docs/**/*.md`).
  - The bundled `spearhead-knowledge` MCP server (`mcp-server/`) now runs
    the real file-watch pipeline at boot (hash-gated embeddings queue,
    sequential to avoid rate-limit bursts, self-healing reconcile on
    restart) and exposes a real `search(query, limit?)` tool — ranks the
    on-disk index by cosine similarity and returns `{path, excerpt, score}`,
    replacing the T-1 stub. A missing `SPEARHEAD_EMBEDDINGS_API_KEY` or a
    failed embeddings call surfaces as a named tool error, never a silent
    empty result.
  - `remind.js` / `rules/RULES.md` nudge search-first before reading source
    files cold; the new `hooks/knowledge-nudge.js` nudges a code doc on a
    session's first read of an undocumented source file (naming computed by
    `scripts/knowledge-path.js`, never left to per-session judgment), and
    nudges a `## Changelog` update on each task's files when `state.js
    transition <T-id> done` succeeds. Hooks only ever nudge — writing notes,
    indexing, and calling the embeddings API stay inside the MCP server and
    the agent's own next turn, respectively.
  - `spearhead-knowledge/` layout: `code/` (one note per source file),
    `decisions/` (ATK-scoped), `architecture/` (cross-attack), `index/`
    (`embeddings.json`, the single atomically-written index file).
  - See the README's "Second-brain knowledge base" section for the full
    picture.

## 0.6.0 — 2026-07-22

- **Second-brain knowledge base (in progress, A-1), continued:**
  - `mcp-server/lib/hash.js`: stable sha256 content hashing for change
    detection.
  - `mcp-server/lib/embeddings.js`: fetch-based embeddings client (Voyage
    AI default, no HTTP client dependency), named errors on a missing key
    or failed call.
  - `mcp-server/lib/index-store.js`: atomically-written single-file index
    (`spearhead-knowledge/index/embeddings.json`), and
    `mcp-server/lib/similarity.js`: in-process cosine-similarity ranking.
  - `scripts/knowledge-path.js`: deterministic, collision-safe knowledge-note
    naming, escalating parent levels only on a genuine `source:` collision;
    existing notes are never renamed.
  - Real file-watch wiring, the `search` MCP tool, opportunistic-capture
    hooks, and documentation still land in follow-up tasks of the same
    attack.

## 0.5.0 — 2026-07-22

- **Second-brain knowledge base (in progress, A-1):** first landed pieces of
  a semantic-search knowledge base spanning spearhead's own decision
  record, general project docs, and opportunistically-generated notes.
  - Bundled MCP server skeleton (`mcp-server/`) declared in both
    `.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json` via an
    `mcpServers` block, exposing a stub `search` tool over stdio
    (`@modelcontextprotocol/sdk`, the plugin's first real npm dependency,
    isolated to `mcp-server/` with its own lockfile).
  - `lib/knowledge-frontmatter.js`: shared, dependency-free parser/serializer
    for the knowledge-note frontmatter schema (`type`, `tags`, `related`,
    `source`, `updated`), used by every future note-writing code path.
  - `remind.js` / `rules/RULES.md` now nudge agents to try the
    `spearhead-knowledge` search tool before reading source files directly.
  - Real index/search logic, naming conventions, and opportunistic capture
    hooks land in follow-up tasks of the same attack.

## 0.4.0 — 2026-07-22

- **New `/spearhead:git-master` skill** for full git lifecycle management
  (`commands/git-master.md`, `skills/spearhead-git-master/SKILL.md`).
- `argument-hint` on `attack`, `understand`, `git-master`, `pivot`, and
  `abort` (command + skill pairs) now nudges users toward well-structured
  input (what/why, expected vs actual, constraints) instead of a bare
  placeholder.
- `.kimi-plugin/plugin.json` version brought back in sync with
  `.claude-plugin/plugin.json`.

## 0.3.1 — 2026-07-21

- `remind.js`: inject `<important>` brevity + temperature directive on every
  prompt — "no extra commentary unless necessary, response temperature is 0.2,
  does not apply to code generated by AI." Appended to both the full rules
  refresh and the one-line anchor so it fires on every user message.

## 0.3.0 — 2026-07-20

- **New `/spearhead:pivot` command** for changing the idea mid-attack. A
  pivot is `abort` + a fresh `understand` wrapped in a single confirmation:
  it archives the current attack (history, not deletion — task branches
  survive) and starts `A-(n+1)` from the new problem statement, dropping
  the user at understand's normal approval gate. It never reopens an
  approved phase in place, so the monotonic phase invariant is untouched.
- Pivot is invocable two ways: the user types `/spearhead:pivot "<idea>"`,
  or the pipeline routes to it when it recognizes a "change the idea"
  request (`spearhead-understand` and `spearhead-attack` now hand off to
  `spearhead-pivot` instead of hitting a raw `phase-regression` refusal).
  Either path confirms before archiving anything.
- `spearhead-abort` gained a pre-confirmed invocation path so pivot's single
  up-front confirmation is not followed by a second abort prompt.

## 0.2.3 — 2026-07-20

- `remind.js` refresh interval back to every 30th user prompt (prompts 1,
  31, 61, …), reverting 0.2.1's change to 10. The 0.2.2 state-managed
  counter (which made the interval actually hold on runtimes that omit the
  session id) stays. Cadence tests now read `REFRESH_EVERY` from the hook,
  so they cannot drift from the constant.

## 0.2.2 — 2026-07-20

- `remind.js` cadence is now managed entirely by state: hook payloads
  without a session id (some runtimes omit it) previously made EVERY prompt
  look like prompt 1, injecting the full rules each time. Such prompts now
  share a `default` counter in `.remind-state.json`, alternate id field
  names (`sessionId`, `conversation_id`, …) are honored, and a counter idle
  for 12h is treated as a new session so fresh sessions still open with the
  full rules.

## 0.2.1 — 2026-07-20

- `remind.js` refreshes the full rules injection every 10th prompt instead
  of every 30th (prompts 1, 11, 21, …); the in-between anchor is unchanged.

## 0.2.0 — 2026-07-20

- **Renamed `/spearhead:plan` to `/spearhead:breakdown`** — `plan` collides
  with Claude Code's built-in plan mode. The internal gate is still
  `phases.plan` in status.yml; only the command and skill names changed.
- New commit message rule (in `rules/RULES.md`, the coder agent, and the
  execute skill): never tag Anthropic or Claude, never add a
  "Co-Authored-By:" trailer. `guard.js` now blocks ANY `Co-Authored-By:`
  trailer and "Generated with/by …Claude/Anthropic" tags, while commits that
  merely mention Claude in the description stay allowed.
- `guard.js` fix: the raw-write block for `status.yml` now checks what a
  shell writing construct actually targets. Reads with unrelated redirects
  (e.g. `cat spearhead/status.yml 2>/dev/null`) no longer trip it; `cp` FROM
  status.yml is a read, `cp`/`mv` ONTO it is still blocked.
- Important instructions across rules, agents, and command wrappers are now
  wrapped in `<important>` tags (skills already had them).
- Repo URLs point at the actual GitHub home
  (`github.com/febradc-github/spearhead-ai`).

## 0.1.0 — 2026-07-20

Initial release.

- Eight gated pipeline commands (`understand`, `recon`, `design`,
  `breakdown`, `execute`, `verify`, `ship`, `retro`) and five utilities (`attack`,
  `status`, `unblock`, `replan`, `abort`), each a thin command wrapper over a
  `user-invocable: false` skill.
- File-based state in `spearhead/status.yml`, mutated only through the
  validating CLI `scripts/state.js` (invariants + task transition matrix,
  atomic writes, named refusals). Execute completeness is derived from task
  states — no `phases.execute` exists.
- Per-task git worktrees and branches: the coder commits on its branch,
  verify merges with `--no-ff` and an integration check, reverting on
  failure so `base_branch` stays green.
- Parallel execution behind three checks: deps done, glob-aware disjoint
  expected-file sets, explicit per-pairing user approval.
- Independent verification: mechanical gates first, then a fresh-context
  verifier (opus) with the anti-reward-hacking checklist; versioned
  `V-<n>.<k>.md` reports preserve failure history; `implemented -> done` is
  reachable only under the verify lock.
- Hooks: `remind.js` (30-prompt rules cadence, byte-identical to
  `rules/RULES.md` by test), `guard.js` (best-effort PreToolUse speed bump:
  no `--no-verify`, no AI attribution, no env files, no raw status.yml
  writes), `validate-state.js` (PostToolUse detection net sharing the
  invariant implementation).
- Dual-runtime: Claude Code (`.claude-plugin/`, `hooks/hooks.json`) and
  kimi-code (`.kimi-plugin/plugin.json`), with documented fallbacks that
  preserve gate semantics; hooks handle both load paths and both tool-input
  shapes, and never resolve the project from `process.cwd()`.

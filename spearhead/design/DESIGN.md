## Chosen approach

Three components, each with a single job, following the plugin's existing
"one script, one authority" pattern (`state.js` is the sole writer of
`status.yml`; the same discipline applies here to new files):

1. **`mcp-server/`** — a bundled MCP server, declared in both
   `.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json`. Sole owner of
   the index and the only component that calls the embeddings API or
   computes similarity. Responsibilities:
   - File-watches (`fs.watch`, recursive) the three knowledge sources:
     `spearhead-knowledge/**/*.md`, `spearhead/**/*.md` (decision record),
     and configured general-doc paths (`README.md`, `docs/**/*.md`).
   - On a create/change event: reads the file, computes a `sha256` content
     hash (`node:crypto`, built-in). If the hash matches what's already in
     the index for that path, skip (no wasted API call). If not, calls the
     embeddings API via `fetch` and updates the index entry.
   - Exposes one MCP tool, `search(query, limit?)`: embeds the query, ranks
     every index entry by cosine similarity (plain JS loop, no vector-db
     dependency), returns the top `limit` (default 8) as `{path, excerpt,
     score}`.
   - Index storage: a single file, `spearhead-knowledge/index/embeddings.json`,
     written atomically (temp file + rename, same pattern as `state.js`).
     Keyed by relative path; each entry is `{hash, embedding, updated,
     type}`.
   - Isolated dependency footprint: `mcp-server/package.json` with its own
     `node_modules/`, so the rest of the plugin (`scripts/`, `hooks/`) stays
     dependency-free exactly as before. The MCP SDK is the only new
     dependency; embeddings calls use built-in `fetch`, so no HTTP client
     dependency is added. See `adr-005`.

2. **Three hook touch-points** (nudges only — they never call the embeddings
   API or write index files; that stays inside the server):
   - **Search-first**: extend `hooks/remind.js`'s existing injected message
     (both the full-rules and one-line-anchor variants) with one line:
     "Before reading source files to answer a question, try the
     `spearhead-knowledge` search tool first." No new hook file — this
     reuses `remind.js`'s proven cadence-management (session id resolution,
     idle expiry) instead of adding a second, competing cadence tracker.
   - **Code-doc-on-first-read**: new `hooks/knowledge-nudge.js`,
     `PostToolUse` matcher `Read`. On a read of a source file (extension
     heuristic, excludes `.md`/config/lockfiles), checks whether
     `spearhead-knowledge/code/` already has a note whose `source:`
     frontmatter matches the file. If not, injects a nudge naming the exact
     target path (computed via `scripts/knowledge-path.js`, see below) so
     the agent writes the doc as a natural next step. Session-scoped
     "already nudged this file" tracking (same idle-expiry pattern as
     `remind.js`) avoids re-nudging every single read.
   - **Task-done doc update**: same `hooks/knowledge-nudge.js` file, second
     matcher `Bash|PowerShell`, reusing `guard.js`'s existing pattern for
     recognizing `state.js transition <T-id> done` invocations. On a
     successful transition to `done`, reads the task's expected-file set
     from `status.yml` (read-only) and nudges the agent to update/create
     each touched file's code doc with a new `## Changelog` entry.

3. **`scripts/knowledge-path.js`** — a small, dependency-free, sole-authority
   helper (same spirit as `state.js`) that computes the canonical note path
   for a given source file: `spearhead-knowledge/code/<parent>-<basename>.md`,
   escalating one more parent level only if an existing note under that slug
   has a *different* `source:` frontmatter value. Both hook nudges and the
   agent call this script directly (`node scripts/knowledge-path.js
   <path>`) so naming is deterministic and never left to per-session LLM
   judgment — the actual prose content is still authored by the agent, but
   *where it goes* is not.

Frontmatter parsing reuses and extends `hooks/validate-state.js`'s existing
minimal custom YAML parser (already handles scalars and lists; frontmatter
needs the same subset: `type`, `tags`, `related`, `source`, `updated`).

## Rejected alternatives

**B — Static rules-file reminder instead of hook nudges.** Put the
search-first and code-doc directives only in `rules/RULES.md` prose, relying
on the agent to remember unprompted. Simpler (zero new hook code), but
`remind.js` already exists precisely because static prose reminders don't
reliably fire every session — that's the whole reason the plugin has a
cadence-managed injection mechanism at all. Rejected: would not reliably
satisfy the "automatic byproduct, no extra step" requirement from
`PROBLEM.md`.

**C — No MCP server; on-demand CLI search script instead.** A
`scripts/knowledge-search.js <query>` the agent shells out to, re-embedding
(or re-scanning) the knowledge base at query time rather than maintaining a
live index. Simpler (no persistent process, no MCP SDK dependency, no
file-watching). Rejected on two grounds: (1) re-embedding or re-scanning the
full knowledge base on every query is slow and costs an API call per
document per search rather than once per change — the opposite of the
token/cost-saving goal; (2) the user explicitly decided on an MCP server
(locked into `PROBLEM.md`'s "Query interface" section) specifically to get a
real semantic-search *tool* in the agent's palette rather than a
shell-out-and-grep-adjacent pattern.

**D (index storage) — one JSON file per note instead of a single
`embeddings.json`.** Would avoid rewriting one growing file on every change.
Rejected: a single file lets the server load the whole index into memory
once and do cosine similarity in a plain loop with no per-file I/O at query
time; at the scale of one project's documentation (hundreds, not millions,
of notes) the atomic-rewrite cost of one file is negligible, and it keeps
the "flat file, dependency-light" storage model `PROBLEM.md` assumed.

## Failure-mode handling

- **Bad input (malformed frontmatter)**: parse leniently; on parse failure,
  index the file with `type: unknown` and log a warning to the server's
  stderr rather than crashing the watcher or skipping the file entirely.
- **Embeddings API down or key missing**: the affected operation (index
  update or `search` call) fails with a clear, named error surfaced to
  whichever tool call triggered it (acceptance criterion 10); the server
  process itself does not crash — other file-watch events continue to be
  queued and processed once the API recovers. A note whose embedding call
  failed is marked `pending` in the index (not silently treated as
  up-to-date) so it retries on the next relevant event.
- **Load spike (many files change at once, e.g. after a large task
  completes)**: file-watch events are queued and processed sequentially in
  the server (simple in-memory queue), not fired as concurrent API calls,
  avoiding rate-limit bursts.
- **Partial failure (server crashes mid-index)**: index writes are atomic
  (temp + rename), so `embeddings.json` is never left corrupt. On restart,
  the server re-scans watched paths and compares content hashes against the
  index — anything already up to date is skipped, anything missing or
  `pending` is re-embedded. No separate resume/recovery logic needed; this
  is the same hash-comparison path used for normal incremental updates.
- **Naming collision race** (two files documented in quick succession
  compute overlapping slugs): `knowledge-path.js` checks existing notes'
  `source:` frontmatter synchronously before returning a path, so the
  escalation decision is made per-call against on-disk state, not cached.

## Open questions resolved during design

- **Embeddings provider**: not hardcoded to a single vendor. The server
  reads `SPEARHEAD_EMBEDDINGS_API_KEY` (and an optional
  `SPEARHEAD_EMBEDDINGS_ENDPOINT`, defaulting to Voyage AI's embeddings
  endpoint, Anthropic's recommended embeddings partner) from the
  environment; the actual `fetch` call is isolated in one small module
  (`mcp-server/lib/embeddings.js`) so swapping providers later is a
  one-file change.
- **kimi-code MCP support**: confirmed by the user — both manifests declare
  the same `mcpServers` block; no fallback path needed for this component
  (unlike sub-agents, which kimi-code does not support).
- **git worktree interaction**: task work happens in
  `spearhead/tasks/<T-id>.worktree/`, but code documentation and the
  task-done nudge operate on paths in the main project tree (post-merge),
  not inside the worktree — `fs.watch` on the main tree sees the merged
  result normally; no isolation issue.
- **Retention on attack abort/complete**: knowledge notes are not tied to
  attack lifecycle state — they remain on disk and searchable regardless of
  whether the attack that produced them is later aborted or completed. Only
  `decisions/ATK<n>-*.md` notes carry an attack reference in their name;
  nothing about them is deleted or archived by `state.js abort` /
  `set-attack-complete`.

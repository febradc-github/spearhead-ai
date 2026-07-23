## Problem statement

The `spearhead-knowledge` MCP server's `search` tool ranks every indexed
entry by cosine similarity and always returns the top `limit` (default 8)
results, however low their score. There is no cutoff, so the tool can never
distinguish "found a genuinely relevant match" from "found the least-bad
junk in an index that doesn't cover this topic at all." A caller (human or
agent) has no reliable, mechanical way to tell "nothing relevant exists for
this query" apart from "here are 8 weak matches" — both currently look like
a normal, non-empty result list.

## Real goal

Make "nothing relevant found" a real, detectable outcome of a `search`
call: entries below a minimum similarity score are excluded from the
result set, so an empty (or shorter-than-`limit`) result list becomes a
meaningful signal rather than an artifact of a small index. This is
explicitly a prerequisite for a *future* attack (not this one): using that
signal to gate whether an agent should fall back to reading source files
directly. This attack only builds the detectable signal itself.

## In scope

- `mcp-server/lib/similarity.js`: `rankBySimilarity` gains a minimum-score
  cutoff — entries scoring below the threshold are excluded from the
  returned array, rather than only being sorted lower.
- `mcp-server/server.js`: the `search` tool's `runSearch`/`SEARCH_TOOL`
  description and result construction reflect the cutoff (e.g., updated
  tool description text so a caller — human or agent — knows an empty or
  short result list means "below threshold," not "tool malfunction").
- A configurable threshold (env var, matching the existing
  `SPEARHEAD_EMBEDDINGS_ENDPOINT`-style override pattern in
  `mcp-server/lib/embeddings.js`), with a reasonable built-in default.
- Tests for: entries below threshold excluded, entries at/above threshold
  included, an all-below-threshold query returning an empty array (not an
  error), existing ranking/limit behavior unaffected for entries that pass
  the cutoff, threshold override via env var.

## Out of scope

- Any change to how entries are embedded, indexed, or stored
  (`mcp-server/lib/embeddings.js`, `mcp-server/lib/index-store.js`,
  `mcp-server/lib/pipeline.js`, `mcp-server/lib/watch.js` — untouched).
  The threshold is a search-time filter only.
- Enforcing that an agent tries `search` before `Read`, or gating `Read` on
  the search result being empty — that is explicitly the follow-up attack
  this one unblocks, not this one. No changes to `hooks/guard.js` or
  `hooks/knowledge-nudge.js`.
- Per-call threshold override (a `minScore` argument on the `search` tool
  call itself) — only a server-side configurable default, per the
  Assumptions below.
- Changing the embeddings model or provider, or any similarity metric
  other than cosine similarity.

## Assumptions

- **Threshold value**: no external ground truth exists for "the right"
  cosine-similarity cutoff for Voyage AI's `voyage-3` model against this
  corpus. A conservative default of `0.5` is used (well below typical
  same-topic similarity, comfortably above typical unrelated-text
  similarity for this embedding family), exposed as an overridable
  constant so it can be tuned without a code change once real usage data
  exists.
- **Configurability mechanism**: an environment variable,
  `SPEARHEAD_SEARCH_MIN_SCORE` (parsed as a float, falling back to the
  default if unset or unparseable), matching the existing
  `SPEARHEAD_EMBEDDINGS_ENDPOINT` override pattern already used in
  `mcp-server/lib/embeddings.js` — no new configuration mechanism
  introduced.
- **Below-threshold behavior**: excluded entries are dropped from the
  result array entirely (not returned with a "below threshold" flag) — an
  empty or short array is itself the "nothing relevant" signal, kept
  simple since no consumer needs per-entry threshold metadata yet.
- **`limit` interacts with the threshold, not around it**: the cutoff is
  applied before the `limit` truncation, so a caller may now legitimately
  get fewer than `limit` results (including zero) when fewer entries clear
  the threshold — this is the intended new behavior, not a bug.
- **No change to the tool's error contract**: `MissingApiKeyError` /
  `EmbeddingsRequestError` still surface as named `isError: true` tool
  errors exactly as today; an empty-due-to-threshold result is a distinct,
  successful (non-error) response with `results: []`.

## Acceptance criteria

1. `rankBySimilarity(index, queryEmbedding, limit, minScore?)` excludes any
   entry whose cosine similarity is below `minScore` from its returned
   array, regardless of `limit`.
2. Entries at or above `minScore` are still returned, sorted highest-score
   first, truncated to `limit` — unchanged from today's behavior for
   entries that pass the cutoff.
3. A query where every indexed entry scores below `minScore` returns an
   empty array, not an error and not a non-empty array of weak matches.
4. `mcp-server/server.js`'s `runSearch` passes a threshold into
   `rankBySimilarity`, sourced from `SPEARHEAD_SEARCH_MIN_SCORE` if set
   (parsed as a float) and a documented default (`0.5`) otherwise; an
   unset or unparseable env var falls back to the default rather than
   throwing or disabling the cutoff.
5. The `search` tool's description text (`SEARCH_TOOL.description` in
   `server.js`) documents that results are filtered by a minimum relevance
   score and that an empty result means no sufficiently relevant match was
   found — so a caller reading only the tool's own schema/description
   understands the new contract.
6. No change to indexing, embedding, storage, or the existing
   `MissingApiKeyError`/`EmbeddingsRequestError` error contract — diff
   confined to `mcp-server/lib/similarity.js`,
   `mcp-server/lib/similarity.test.js`, `mcp-server/server.js`,
   `mcp-server/server.test.js`.
7. `node mcp-server/lib/similarity.test.js` and `node mcp-server/server.test.js`
   both pass, including new tests for: below-threshold exclusion,
   at/above-threshold inclusion, all-below-threshold empty array, env var
   override, unset/unparseable env var falling back to the default.

# ADR-007: Minimum-score threshold on MCP search, filtered in `rankBySimilarity`

## Context

`spearhead-knowledge`'s `search` tool ranks every indexed entry by cosine
similarity and always returns the top `limit` (default 8) results,
however low their score. There is no way for a caller — human or agent —
to distinguish "found a genuinely relevant match" from "found the
least-bad junk in an index that doesn't cover this topic at all." This
blocks a planned future improvement: enforcing that an agent tries
`search` before falling back to reading source files directly, which
requires "nothing relevant found" to be a real, detectable outcome first.

## Decision

Add a minimum cosine-similarity cutoff to `rankBySimilarity` in
`mcp-server/lib/similarity.js`: entries scoring below `minScore` are
excluded from the returned array entirely, before the existing sort/limit
truncation. The default (`DEFAULT_MIN_SCORE = 0.5`) lives in
`similarity.js` as the single source of truth; `server.js`'s `runSearch`
resolves the effective threshold from `SPEARHEAD_SEARCH_MIN_SCORE` (parsed
as a float, falling back to the default on unset/unparseable), mirroring
the existing `SPEARHEAD_EMBEDDINGS_ENDPOINT` override pattern in
`embeddings.js`. `SEARCH_TOOL.description` is updated so a caller reading
only the tool's schema understands that an empty or short result list
means "below threshold," not a malfunction.

This is a search-time filter only — no change to how entries are
embedded, indexed, or stored, and no change to the existing
`MissingApiKeyError`/`EmbeddingsRequestError` error contract. Enforcing
search-before-read, or gating `Read` on an empty result, is explicitly out
of scope — this ADR only makes the signal that a future attack would gate
on exist.

## Consequences

- A `search` call can now legitimately return fewer than `limit` results,
  including zero, for a query the index has no good coverage for. Callers
  (including any future enforcement logic) can treat a short/empty result
  as a meaningful "not found" signal rather than an artifact of a small
  index.
- The threshold is tunable without a code change via
  `SPEARHEAD_SEARCH_MIN_SCORE`, since `0.5` has no external ground truth
  for this corpus/embedding model and may need adjustment once real usage
  data exists.
- `rankBySimilarity`'s signature gains a fourth parameter
  (`minScore = DEFAULT_MIN_SCORE`); any other caller besides `server.js`
  now also gets threshold filtering by default unless it explicitly passes
  `0` or a negative number to disable it.
- Sets up, but does not itself implement, the future search-before-read
  enforcement attack.

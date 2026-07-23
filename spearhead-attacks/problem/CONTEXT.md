# Recon: MCP Search Minimum-Score Threshold (A-3)

## Repo conventions

- **Test framework**: `node:test` (Node's built-in test runner).
- **Test execution**: direct `node <file>.test.js` (e.g., `node mcp-server/lib/similarity.test.js`), or via `npm test` in `mcp-server/` (runs `node server.test.js`).
- **Assertions**: `node:assert/strict`.
- **Lint/build**: none (repo is pure Node.js, no transpilation).
- **Conventions**: comments above tests state the scenario; simple, readable assertion chains; reusable fixture builders (e.g., `entry()` helper in similarity.test.js) to avoid embedding magic values inline.

## Affected surface

### `mcp-server/lib/similarity.js`

**Current `rankBySimilarity` signature (line 34):**
```javascript
function rankBySimilarity(index, queryEmbedding, limit = DEFAULT_LIMIT) {
```

**Current implementation (lines 34-42):** loops over index entries, computes cosine similarity, sorts by score descending, returns top `limit` entries. No cutoff — always returns up to `limit` results regardless of score magnitude.

**Current return format:** array of `{path, score}` objects, sorted highest-score first.

---

### `mcp-server/server.js`

**`runSearch` signature (line 81):**
```javascript
async function runSearch(root, { query, limit } = {}, options = {}) {
```

**Current call to `rankBySimilarity` (line 87):**
```javascript
const ranked = rankBySimilarity(index, queryEmbedding, effectiveLimit);
```

**`SEARCH_TOOL` description (lines 38-39):**
```
'Semantic search over the spearhead-knowledge base. Embeds the query, ranks indexed notes/docs by cosine similarity, and returns the top matches as {path, excerpt, score}.'
```

**Error handling (lines 125-134):** catches embed errors, returns named `isError: true` tool errors; no silent/empty fallback.

---

### Test files

**`mcp-server/lib/similarity.test.js`:**
- Uses `node:test` and `node:assert/strict`.
- Fixture builder (line 38-40): `entry(embedding, type = 'code')` returns `{ hash: 'h', embedding, updated: '2026-07-22', type }`.
- Tests already cover: identical vectors (score 1), orthogonal (score 0), opposite (score -1), symmetric property, mismatched lengths, zero-magnitude vectors, ranking order, result shape, default limit, custom limit, empty index, skipping missing/null embeddings.

**`mcp-server/server.test.js`:**
- Uses `node:test` and `node:assert/strict`.
- Fixture builders: `mkRoot()` (temp dir), `writeFile(root, relPath, content)`, `setEntry(root, relPath, {hash, embedding, updated, type})`.
- Fixture index entries use embeddings like `[1, 0, 0]`, `[0, 1, 0]`, `[1, i]` for easy score calculation.
- Tests use injected `embed()` stubs to control query embeddings and avoid live API calls.
- Helper `withInMemoryClient(options, fn)` connects an in-process server over linked transport with injected `options.embed`.
- Tests already cover: tool listing, fixture-based ranking, limit behavior, error surfacing.

---

## Risks and unknowns

1. **Default threshold value (0.5):** No external ground truth for "right" cutoff for Voyage AI's `voyage-3` model. PROBLEM.md #4 (Assumptions) already stakes 0.5 as conservative (below same-topic similarity, above unrelated-text). If real usage produces many false negatives (too-strict), the threshold needs tuning. Mitigation: fully overridable via env var.

2. **Order of operations**: Cutoff must apply *before* limit truncation (PROBLEM.md criterion 4 — "cutoff applied before limit truncation"). This is load-bearing for the contract: "fewer than limit results is the signal."

3. **No per-call override:** PROBLEM.md explicitly out-of-scope. Tests must not assume a `minScore` argument on the tool call itself. Threshold is server-side env var only.

4. **Empty result contract:** An all-below-threshold query returns `results: []` (successful, non-error), not an error. Must verify test assertions distinguish this from "embed API failed."

---

## Prior art

### Env-var override pattern (to replicate for `SPEARHEAD_SEARCH_MIN_SCORE`)

From `mcp-server/lib/embeddings.js` (lines 41, 47):
```javascript
const apiKey = process.env.SPEARHEAD_EMBEDDINGS_API_KEY;
if (!apiKey) {
  throw new MissingApiKeyError();
}

const endpoint = process.env.SPEARHEAD_EMBEDDINGS_ENDPOINT || DEFAULT_ENDPOINT;
```

**Pattern for `SPEARHEAD_SEARCH_MIN_SCORE`:**
- Read from `process.env.SPEARHEAD_SEARCH_MIN_SCORE`.
- Parse as float (e.g., `parseFloat(...)`).
- Fall back to a `DEFAULT_MIN_SCORE` constant (0.5 per PROBLEM.md) if unset or `parseFloat` returns `NaN`.
- No throwing on unparseable input — just silently use the default.

### Fixture-building patterns

**In `similarity.test.js`:**
- `entry(embedding, type = 'code')` helper — defines once, reused throughout for brevity.
- Embeddings are plain arrays: `[1, 0, 0]`, `[0, 1, 0]`, etc.
- Comments inline: `// identical to query -> score 1`.

**In `server.test.js`:**
- `setEntry(root, relPath, {hash, embedding, updated, type})` from index-store module.
- Fixture index entries: `hash: 'h1'`, `embedding: [1, 0, 0]`, `updated: '2026-07-22T00:00:00.000Z'`, `type: 'code'`.
- Injected `embed` stub returns a known vector to control similarity scores: `const embed = async () => [1, 0, 0];`.
- Both patterns already avoid magic strings; new tests should follow the same convention.

---

## Budget

- **Reads used**: 17 file reads (similarity.js, similarity.test.js, server.js, server.test.js, embeddings.js, index-store.js, PROBLEM.md, status.yml, DESIGN.md for a different attack, server.test.js focused reads, server.js focused reads, similarity.test.js focused reads, package.json, prior CONTEXT.md read to verify file existence).
- **Characters used**: ~21,200 (well under 60k limit).
- **Skipped**: None. Budget not hit. Full context gathered.

All prescribed reading order completed:
1. ✅ similarity.js — exact signatures, line numbers, no cutoff logic.
2. ✅ similarity.test.js — test patterns, `entry()` fixture builder.
3. ✅ server.js — `runSearch`, `SEARCH_TOOL` description, error handling.
4. ✅ server.test.js — test patterns, `setEntry`/`mkRoot`/`writeFile` fixture builders.
5. ✅ embeddings.js — env-var override pattern (read/parse/fallback).
6. ✅ index-store.js — index shape confirmed (relPath → `{hash, embedding, updated, type}`).
7. ✅ Test fixture-building patterns — documented from both test files.


'use strict';
// In-process cosine-similarity ranking over index entries (DESIGN.md /
// ADR-002: the whole index loads into memory once; similarity runs as a
// plain loop at query time, no vector-db dependency).
//
// Dependency-free: Node built-ins only.

const DEFAULT_LIMIT = 8;

// Minimum cosine similarity a match must reach to be considered relevant
// (DESIGN.md: excludes weak matches rather than always returning `limit`
// results regardless of how poor the match is).
const DEFAULT_MIN_SCORE = 0.5;

// Cosine similarity between two equal-length numeric vectors, in [-1, 1].
// Throws on mismatched lengths. Returns 0 (rather than NaN) when either
// vector has zero magnitude.
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Ranks `index` (same shape as index-store's loadIndex result: relative
// path -> {hash, embedding, updated, type}) by cosine similarity against
// `queryEmbedding`, returning the top `limit` (default 8) as
// `[{path, score}]`, highest score first. Entries without a usable
// (array) embedding are skipped rather than throwing. Entries scoring
// below `minScore` (default DEFAULT_MIN_SCORE) are excluded before the
// `limit` truncation, so fewer than `limit` results -- including zero --
// is expected when few/no entries clear the threshold. A NaN or other
// non-numeric score fails the `>= minScore` comparison and is excluded
// rather than thrown or included.
function rankBySimilarity(index, queryEmbedding, limit = DEFAULT_LIMIT, minScore = DEFAULT_MIN_SCORE) {
  const scored = [];
  for (const [notePath, entry] of Object.entries(index || {})) {
    if (!entry || !Array.isArray(entry.embedding)) continue;
    const score = cosineSimilarity(entry.embedding, queryEmbedding);
    if (!(score >= minScore)) continue;
    scored.push({ path: notePath, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit);
}

module.exports = { cosineSimilarity, rankBySimilarity, DEFAULT_LIMIT, DEFAULT_MIN_SCORE };

'use strict';
// Tests for similarity.js: in-process cosine-similarity ranking over index
// entries (DESIGN.md's single-flat-index consequence -- similarity runs as
// a plain loop over an in-memory index at query time, no vector-db
// dependency). All fixtures are plain objects/vectors; no dependency on a
// live embeddings API.
const test = require('node:test');
const assert = require('node:assert/strict');

const { cosineSimilarity, rankBySimilarity, DEFAULT_LIMIT, DEFAULT_MIN_SCORE } = require('./similarity.js');

test('cosineSimilarity of identical vectors is 1', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
});

test('cosineSimilarity of orthogonal vectors is 0', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('cosineSimilarity of opposite vectors is -1', () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test('cosineSimilarity is symmetric', () => {
  const a = [0.2, 0.5, -0.3];
  const b = [0.9, -0.1, 0.4];
  assert.equal(cosineSimilarity(a, b), cosineSimilarity(b, a));
});

test('cosineSimilarity throws on mismatched vector lengths', () => {
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), /length mismatch/);
});

test('cosineSimilarity is 0 when either vector is all zeros (no division by zero)', () => {
  assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
});

function entry(embedding, type = 'code') {
  return { hash: 'h', embedding, updated: '2026-07-22', type };
}

test('rankBySimilarity ranks index entries highest-score first', () => {
  const index = {
    'a.md': entry([1, 0, 0]), // identical to query -> score 1
    'b.md': entry([0, 1, 0]), // orthogonal -> score 0
    'c.md': entry([0.9, 0.1, 0]), // close to query
  };
  // Orthogonal entry (score 0) scores below the default cutoff, so an
  // explicit low minScore is passed to isolate ranking order from the
  // cutoff behavior covered separately below.
  const ranked = rankBySimilarity(index, [1, 0, 0], undefined, -1);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md', 'c.md', 'b.md'],
  );
  assert.equal(ranked[0].score, 1);
});

test('rankBySimilarity result entries are shaped {path, score}', () => {
  const index = { 'a.md': entry([1, 0]) };
  const ranked = rankBySimilarity(index, [1, 0]);
  assert.deepEqual(Object.keys(ranked[0]).sort(), ['path', 'score']);
  assert.equal(ranked[0].path, 'a.md');
  assert.equal(ranked[0].score, 1);
});

test('rankBySimilarity defaults to the top 8 results', () => {
  const index = {};
  for (let i = 0; i < 20; i++) {
    index[`note-${i}.md`] = entry([Math.random(), Math.random(), Math.random()]);
  }
  const ranked = rankBySimilarity(index, [1, 1, 1]);
  assert.equal(ranked.length, 8);
});

test('rankBySimilarity honors a custom limit', () => {
  const index = {
    'a.md': entry([1, 0]),
    'b.md': entry([0.8, 0.2]),
    'c.md': entry([0, 1]),
  };
  const ranked = rankBySimilarity(index, [1, 0], 2);
  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md', 'b.md'],
  );
});

test('rankBySimilarity returns [] for an empty index', () => {
  assert.deepEqual(rankBySimilarity({}, [1, 0]), []);
});

test('rankBySimilarity skips entries without a usable embedding', () => {
  const index = {
    'a.md': entry([1, 0]),
    'b.md': { hash: 'h', updated: '2026-07-22', type: 'code' }, // no embedding
    'c.md': { ...entry([0, 1]), embedding: null },
  };
  const ranked = rankBySimilarity(index, [1, 0]);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md'],
  );
});

test('DEFAULT_MIN_SCORE is exported and defaults to 0.5', () => {
  assert.equal(DEFAULT_MIN_SCORE, 0.5);
});

// PROBLEM.md criterion 1: entries below minScore are excluded regardless of limit.
test('rankBySimilarity excludes entries scoring below minScore', () => {
  const index = {
    'a.md': entry([1, 0]), // identical to query -> score 1
    'b.md': entry([0, 1]), // orthogonal -> score 0
  };
  const ranked = rankBySimilarity(index, [1, 0], DEFAULT_LIMIT, 0.5);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md'],
  );
});

// PROBLEM.md criterion 2: entries at/above minScore are unaffected -- still
// sorted highest first and truncated to limit.
test('rankBySimilarity includes entries at or above minScore, sorted and truncated', () => {
  const index = {
    'a.md': entry([1, 0]), // score 1
    'b.md': entry([0.8, 0.2]), // score ~0.970
    'c.md': entry([0.6, 0.4]), // score ~0.832, still above 0.5
  };
  const ranked = rankBySimilarity(index, [1, 0], 2, 0.5);
  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md', 'b.md'],
  );
});

// PROBLEM.md criterion 3: when every entry scores below minScore, the
// result is an empty array, not an error or weak matches.
test('rankBySimilarity returns [] when every entry scores below minScore', () => {
  const index = {
    'a.md': entry([0, 1]), // orthogonal -> score 0
    'b.md': entry([-1, 0]), // opposite -> score -1
  };
  const ranked = rankBySimilarity(index, [1, 0], DEFAULT_LIMIT, 0.5);
  assert.deepEqual(ranked, []);
});

// A NaN score (e.g. from a malformed embedding) must be excluded, never
// thrown or included -- NaN comparisons are always false, so `score >=
// minScore` correctly excludes it.
test('rankBySimilarity excludes entries with a NaN score', () => {
  const index = {
    'a.md': entry([1, 0]), // score 1
    'b.md': entry([NaN, NaN]), // score NaN (NaN propagates through the dot product / norms)
  };
  const ranked = rankBySimilarity(index, [1, 0], DEFAULT_LIMIT, -1);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md'],
  );
});

// Calls that omit minScore now apply the DEFAULT_MIN_SCORE cutoff -- an
// intentional behavior change from the old no-cutoff default.
test('rankBySimilarity applies DEFAULT_MIN_SCORE when minScore is omitted', () => {
  const index = {
    'a.md': entry([1, 0]), // score 1, passes default cutoff
    'b.md': entry([0, 1]), // score 0, fails default cutoff
  };
  const ranked = rankBySimilarity(index, [1, 0]);
  assert.deepEqual(
    ranked.map((r) => r.path),
    ['a.md'],
  );
});

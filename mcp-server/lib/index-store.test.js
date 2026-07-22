'use strict';
// Tests for index-store.js: the single-file, atomically-written index
// store (ADR-002). Every test works against a fresh mkdtempSync directory
// standing in for a project root -- never the real spearhead-knowledge/,
// and no dependency on a live embeddings API (entries here are plain
// fixture objects).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { indexDir, indexPath, loadIndex, saveIndex, setEntry, removeEntry } = require('./index-store.js');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-index-store-'));
}

const FIXTURE_ENTRY = { hash: 'deadbeef', embedding: [0.1, 0.2, 0.3], updated: '2026-07-22', type: 'code' };

test('loadIndex returns {} when no index file exists yet', () => {
  const root = mkRoot();
  assert.deepEqual(loadIndex(root), {});
});

test('saveIndex creates spearhead-knowledge/index/ if it does not exist', () => {
  const root = mkRoot();
  assert.equal(fs.existsSync(indexDir(root)), false);
  saveIndex(root, { 'code/foo.md': FIXTURE_ENTRY });
  assert.equal(fs.existsSync(indexDir(root)), true);
  assert.equal(fs.existsSync(indexPath(root)), true);
});

test('saveIndex then loadIndex round-trips entries keyed by relative path', () => {
  const root = mkRoot();
  const index = { 'code/foo.md': FIXTURE_ENTRY, 'decisions/ATK1-bar.md': { ...FIXTURE_ENTRY, type: 'decision' } };
  saveIndex(root, index);
  assert.deepEqual(loadIndex(root), index);
});

test('index file is written at spearhead-knowledge/index/embeddings.json', () => {
  const root = mkRoot();
  saveIndex(root, { 'code/foo.md': FIXTURE_ENTRY });
  const expected = path.join(root, 'spearhead-knowledge', 'index', 'embeddings.json');
  assert.equal(indexPath(root), expected);
  assert.equal(fs.existsSync(expected), true);
});

test('saveIndex writes atomically: no leftover temp files after a successful write', () => {
  const root = mkRoot();
  saveIndex(root, { 'code/foo.md': FIXTURE_ENTRY });
  const entries = fs.readdirSync(indexDir(root));
  assert.deepEqual(entries, ['embeddings.json']);
});

test('a failed write leaves the previously-saved index file untouched (no partial write)', () => {
  const root = mkRoot();
  saveIndex(root, { 'code/foo.md': FIXTURE_ENTRY });
  const before = fs.readFileSync(indexPath(root), 'utf8');

  const original = fs.writeFileSync;
  fs.writeFileSync = () => {
    throw new Error('simulated disk failure mid-write');
  };
  try {
    assert.throws(() => saveIndex(root, { 'code/other.md': FIXTURE_ENTRY }), /simulated disk failure/);
  } finally {
    fs.writeFileSync = original;
  }

  const after = fs.readFileSync(indexPath(root), 'utf8');
  assert.equal(after, before, 'index file must be unchanged after a failed write attempt');
  // No stray temp file left behind either.
  const entries = fs.readdirSync(indexDir(root));
  assert.deepEqual(entries, ['embeddings.json']);
});

test('setEntry adds/updates a single entry and persists it', () => {
  const root = mkRoot();
  setEntry(root, 'code/foo.md', FIXTURE_ENTRY);
  assert.deepEqual(loadIndex(root), { 'code/foo.md': FIXTURE_ENTRY });

  const updated = { ...FIXTURE_ENTRY, hash: 'newhash' };
  setEntry(root, 'code/foo.md', updated);
  assert.deepEqual(loadIndex(root), { 'code/foo.md': updated });
});

test('removeEntry deletes a single entry and persists the removal', () => {
  const root = mkRoot();
  saveIndex(root, { 'code/foo.md': FIXTURE_ENTRY, 'code/bar.md': FIXTURE_ENTRY });
  removeEntry(root, 'code/foo.md');
  assert.deepEqual(loadIndex(root), { 'code/bar.md': FIXTURE_ENTRY });
});

test('removeEntry on a missing path is a no-op', () => {
  const root = mkRoot();
  saveIndex(root, { 'code/foo.md': FIXTURE_ENTRY });
  removeEntry(root, 'code/does-not-exist.md');
  assert.deepEqual(loadIndex(root), { 'code/foo.md': FIXTURE_ENTRY });
});

test('loadIndex tolerates a corrupt/malformed index file by returning {}', () => {
  const root = mkRoot();
  fs.mkdirSync(indexDir(root), { recursive: true });
  fs.writeFileSync(indexPath(root), 'not valid json{{{');
  assert.deepEqual(loadIndex(root), {});
});

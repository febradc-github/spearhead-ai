'use strict';
// Tests for pipeline.js: wires hash.js and index-store.js to watch.js's
// file events (PROBLEM.md #1, #3; DESIGN.md "On a create/change event ...
// computes a sha256 content hash ... If the hash matches ... skip ...
// otherwise ... updates the index entry"). Indexing is purely local now --
// ranking moved to query time (rank.js) -- so there is no external call
// left for this module to make or guard against, and no test here mocks or
// imports anything from embeddings.js.
// Every test works against a fresh mkdtempSync directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { processFile, createPipeline, reconcile } = require('./pipeline.js');
const { hashContent } = require('./hash.js');
const { loadIndex, setEntry } = require('./index-store.js');
const { serializeFrontmatter } = require('../../lib/knowledge-frontmatter.js');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-pipeline-'));
}

function writeFile(root, relPath, content = 'hello') {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return content;
}

test('processFile indexes a brand-new file with a hash/updated/type entry and no embedding field', async () => {
  const root = mkRoot();
  const content = writeFile(root, 'spearhead-knowledge/code/foo.md', 'hello world');

  const result = await processFile(root, 'spearhead-knowledge/code/foo.md');

  assert.equal(result.status, 'updated');
  const entry = loadIndex(root)['spearhead-knowledge/code/foo.md'];
  assert.equal(entry.hash, hashContent(content));
  assert.ok(entry.updated);
  assert.ok(entry.type);
  assert.equal('embedding' in entry, false, 'stored entry must not carry an embedding field');
});

test('processFile skips re-processing when content is unchanged (hash matches)', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/foo.md', 'unchanged content');

  const first = await processFile(root, 'spearhead-knowledge/code/foo.md');
  const firstUpdated = loadIndex(root)['spearhead-knowledge/code/foo.md'].updated;
  const second = await processFile(root, 'spearhead-knowledge/code/foo.md', { now: () => 'later' });

  assert.equal(first.status, 'updated');
  assert.equal(second.status, 'skipped');
  assert.equal(loadIndex(root)['spearhead-knowledge/code/foo.md'].updated, firstUpdated, 'entry must not be rewritten on an unchanged file');
});

test('processFile re-processes when content changes (hash mismatch)', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-knowledge/code/foo.md';
  writeFile(root, relPath, 'version one');

  await processFile(root, relPath);
  writeFile(root, relPath, 'version two, longer');
  const result = await processFile(root, relPath);

  assert.equal(result.status, 'updated');
  const index = loadIndex(root);
  assert.equal(index[relPath].hash, hashContent('version two, longer'));
});

test('processFile treats a deleted file as a no-op skip, not an error', async () => {
  const root = mkRoot();

  const result = await processFile(root, 'spearhead-knowledge/code/gone.md');

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'deleted');
});

test('processFile infers type from frontmatter for spearhead-knowledge/ notes', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-knowledge/decisions/ATK1-foo.md';
  const content = serializeFrontmatter({ type: 'decision', source: 'lib/foo.js' }, '\nbody\n');
  writeFile(root, relPath, content);

  await processFile(root, relPath);

  assert.equal(loadIndex(root)[relPath].type, 'decision');
});

test('processFile types spearhead-attacks/ entries as decision-record', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-attacks/plan/tasks/T-5.md';
  writeFile(root, relPath, '## Goal\n\nSomething.\n');

  await processFile(root, relPath);

  assert.equal(loadIndex(root)[relPath].type, 'decision-record');
});

test('processFile types README.md/docs/ entries as general-doc', async () => {
  const root = mkRoot();
  writeFile(root, 'README.md', '# Project\n');
  writeFile(root, 'docs/guide.md', '# Guide\n');

  await processFile(root, 'README.md');
  await processFile(root, 'docs/guide.md');

  const index = loadIndex(root);
  assert.equal(index['README.md'].type, 'general-doc');
  assert.equal(index['docs/guide.md'].type, 'general-doc');
});

test('createPipeline processes enqueued events sequentially and updates the index for each one', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/a.md', 'aaa');
  writeFile(root, 'spearhead-knowledge/code/b.md', 'bbb');
  writeFile(root, 'spearhead-knowledge/code/c.md', 'ccc');

  const pipeline = createPipeline(root);
  pipeline.enqueue('spearhead-knowledge/code/a.md');
  pipeline.enqueue('spearhead-knowledge/code/b.md');
  pipeline.enqueue('spearhead-knowledge/code/c.md');
  await pipeline.idle();

  const index = loadIndex(root);
  assert.ok(index['spearhead-knowledge/code/a.md']);
  assert.ok(index['spearhead-knowledge/code/b.md']);
  assert.ok(index['spearhead-knowledge/code/c.md']);
});

test('reconcile on startup skips already up-to-date files and processes stale/missing ones', async () => {
  const root = mkRoot();
  const upToDateContent = writeFile(root, 'spearhead-knowledge/code/uptodate.md', 'unchanged');
  writeFile(root, 'spearhead-knowledge/code/stale.md', 'new content on disk');
  writeFile(root, 'spearhead-knowledge/code/new.md', 'never indexed before');

  setEntry(root, 'spearhead-knowledge/code/uptodate.md', {
    hash: hashContent(upToDateContent),
    updated: '2026-01-01T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/stale.md', {
    hash: hashContent('old content, no longer on disk'),
    updated: '2026-01-01T00:00:00.000Z',
    type: 'code',
  });

  const pipeline = createPipeline(root);
  await reconcile(root, pipeline);

  const index = loadIndex(root);
  assert.equal(index['spearhead-knowledge/code/uptodate.md'].updated, '2026-01-01T00:00:00.000Z', 'up-to-date file must not be reprocessed');
  assert.notEqual(index['spearhead-knowledge/code/stale.md'].updated, '2026-01-01T00:00:00.000Z');
  assert.ok(index['spearhead-knowledge/code/new.md']);
});

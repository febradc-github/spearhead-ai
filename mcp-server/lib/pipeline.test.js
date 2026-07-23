'use strict';
// Tests for pipeline.js: wires hash.js, embeddings.js, and index-store.js
// to watch.js's file events (PROBLEM.md #1, #3, #10; DESIGN.md "On a
// create/change event ... computes a sha256 content hash ... If the hash
// matches ... skip ... otherwise calls the embeddings API and updates the
// index entry" / failure-mode handling for load spikes and API failures).
// Every test works against a fresh mkdtempSync directory; the embeddings
// client is always injected as a plain async function -- no live network
// call is ever made by this suite.
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

// A trivial deterministic embed stub: returns a 1-vector derived from the
// text's length, and records every call (in call order) on `calls`.
function fakeEmbed(calls) {
  return async (text) => {
    calls.push(text);
    return [text.length];
  };
}

test('processFile embeds a brand-new file and writes an index entry', async () => {
  const root = mkRoot();
  const content = writeFile(root, 'spearhead-knowledge/code/foo.md', 'hello world');
  const calls = [];

  const result = await processFile(root, 'spearhead-knowledge/code/foo.md', { embed: fakeEmbed(calls) });

  assert.equal(result.status, 'updated');
  assert.deepEqual(calls, [content]);
  const index = loadIndex(root);
  assert.equal(index['spearhead-knowledge/code/foo.md'].hash, hashContent(content));
  assert.deepEqual(index['spearhead-knowledge/code/foo.md'].embedding, [content.length]);
});

test('processFile skips the embeddings call when content is unchanged (hash matches)', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/foo.md', 'unchanged content');
  const calls = [];
  const embed = fakeEmbed(calls);

  await processFile(root, 'spearhead-knowledge/code/foo.md', { embed });
  const result = await processFile(root, 'spearhead-knowledge/code/foo.md', { embed });

  assert.equal(result.status, 'skipped');
  assert.equal(calls.length, 1, 'embed must be called exactly once, not on the unchanged second pass');
});

test('processFile re-embeds when content changes (hash mismatch)', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-knowledge/code/foo.md';
  writeFile(root, relPath, 'version one');
  const calls = [];
  const embed = fakeEmbed(calls);

  await processFile(root, relPath, { embed });
  writeFile(root, relPath, 'version two, longer');
  const result = await processFile(root, relPath, { embed });

  assert.equal(result.status, 'updated');
  assert.equal(calls.length, 2);
  const index = loadIndex(root);
  assert.equal(index[relPath].hash, hashContent('version two, longer'));
});

test('processFile marks the entry pending (not up to date) on an embeddings failure, and does not throw', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-knowledge/code/foo.md';
  writeFile(root, relPath, 'will fail to embed');
  const failingEmbed = async () => {
    throw new Error('simulated embeddings outage');
  };

  const result = await processFile(root, relPath, { embed: failingEmbed });

  assert.equal(result.status, 'failed');
  const index = loadIndex(root);
  assert.equal(index[relPath].pending, true);
});

test('a pending entry is retried (re-embedded) on the next relevant event, even with unchanged content', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-knowledge/code/foo.md';
  const content = writeFile(root, relPath, 'retry me');
  const calls = [];
  let shouldFail = true;
  const flakyEmbed = async (text) => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error('simulated outage');
    }
    calls.push(text);
    return [1, 2, 3];
  };

  const first = await processFile(root, relPath, { embed: flakyEmbed });
  assert.equal(first.status, 'failed');
  assert.equal(loadIndex(root)[relPath].pending, true);

  // Same content, no fs change -- but the entry is pending, so it must
  // still be retried rather than treated as up to date.
  const second = await processFile(root, relPath, { embed: flakyEmbed });
  assert.equal(second.status, 'updated');
  assert.deepEqual(calls, [content]);
  const index = loadIndex(root);
  assert.equal(index[relPath].pending, undefined);
  assert.deepEqual(index[relPath].embedding, [1, 2, 3]);
});

test('processFile infers type from frontmatter for spearhead-knowledge/ notes', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-knowledge/decisions/ATK1-foo.md';
  const content = serializeFrontmatter({ type: 'decision', source: 'lib/foo.js' }, '\nbody\n');
  writeFile(root, relPath, content);

  await processFile(root, relPath, { embed: fakeEmbed([]) });

  assert.equal(loadIndex(root)[relPath].type, 'decision');
});

test('processFile types spearhead-attacks/ entries as decision-record', async () => {
  const root = mkRoot();
  const relPath = 'spearhead-attacks/plan/tasks/T-5.md';
  writeFile(root, relPath, '## Goal\n\nSomething.\n');

  await processFile(root, relPath, { embed: fakeEmbed([]) });

  assert.equal(loadIndex(root)[relPath].type, 'decision-record');
});

test('processFile types README.md/docs/ entries as general-doc', async () => {
  const root = mkRoot();
  writeFile(root, 'README.md', '# Project\n');
  writeFile(root, 'docs/guide.md', '# Guide\n');

  await processFile(root, 'README.md', { embed: fakeEmbed([]) });
  await processFile(root, 'docs/guide.md', { embed: fakeEmbed([]) });

  const index = loadIndex(root);
  assert.equal(index['README.md'].type, 'general-doc');
  assert.equal(index['docs/guide.md'].type, 'general-doc');
});

test('createPipeline processes enqueued events sequentially, never concurrently', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/a.md', 'aaa');
  writeFile(root, 'spearhead-knowledge/code/b.md', 'bbb');
  writeFile(root, 'spearhead-knowledge/code/c.md', 'ccc');

  let inFlight = 0;
  let maxInFlight = 0;
  const embed = async (text) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return [text.length];
  };

  const pipeline = createPipeline(root, { embed });
  pipeline.enqueue('spearhead-knowledge/code/a.md');
  pipeline.enqueue('spearhead-knowledge/code/b.md');
  pipeline.enqueue('spearhead-knowledge/code/c.md');
  await pipeline.idle();

  assert.equal(maxInFlight, 1, 'no two embeddings calls must be in flight at the same time');
  const index = loadIndex(root);
  assert.ok(index['spearhead-knowledge/code/a.md']);
  assert.ok(index['spearhead-knowledge/code/b.md']);
  assert.ok(index['spearhead-knowledge/code/c.md']);
});

test('createPipeline: a failure on one queued file does not stop later files from being processed', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/ok.md', 'ok content');
  writeFile(root, 'spearhead-knowledge/code/broken.md', 'broken content');

  const embed = async (text) => {
    if (text === 'broken content') throw new Error('simulated failure');
    return [text.length];
  };

  const pipeline = createPipeline(root, { embed });
  pipeline.enqueue('spearhead-knowledge/code/broken.md');
  pipeline.enqueue('spearhead-knowledge/code/ok.md');
  await pipeline.idle();

  const index = loadIndex(root);
  assert.equal(index['spearhead-knowledge/code/broken.md'].pending, true);
  assert.equal(index['spearhead-knowledge/code/ok.md'].pending, undefined);
  assert.ok(index['spearhead-knowledge/code/ok.md'].embedding);
});

test('reconcile on startup skips already up-to-date files and re-embeds stale/missing/pending ones', async () => {
  const root = mkRoot();
  const upToDateContent = writeFile(root, 'spearhead-knowledge/code/uptodate.md', 'unchanged');
  writeFile(root, 'spearhead-knowledge/code/stale.md', 'new content on disk');
  writeFile(root, 'spearhead-knowledge/code/new.md', 'never indexed before');
  writeFile(root, 'spearhead-knowledge/code/wascrashed.md', 'left pending by a crash');

  setEntry(root, 'spearhead-knowledge/code/uptodate.md', {
    hash: hashContent(upToDateContent),
    embedding: [1],
    updated: '2026-01-01T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/stale.md', {
    hash: hashContent('old content, no longer on disk'),
    embedding: [1],
    updated: '2026-01-01T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/wascrashed.md', {
    hash: null,
    pending: true,
    updated: '2026-01-01T00:00:00.000Z',
    type: 'code',
  });

  const calls = [];
  const pipeline = createPipeline(root, { embed: fakeEmbed(calls) });
  await reconcile(root, pipeline);

  assert.ok(!calls.includes('unchanged'), 'up-to-date file must not be re-embedded');
  assert.ok(calls.includes('new content on disk'));
  assert.ok(calls.includes('never indexed before'));
  assert.ok(calls.includes('left pending by a crash'));

  const index = loadIndex(root);
  assert.equal(index['spearhead-knowledge/code/wascrashed.md'].pending, undefined);
});

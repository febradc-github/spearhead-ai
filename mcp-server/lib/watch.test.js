'use strict';
// Tests for watch.js: the recursive fs.watch wrapper over the three
// knowledge sources (PROBLEM.md #1, #3; DESIGN.md "File-watches (fs.watch,
// recursive) ... spearhead-knowledge/**/*.md, spearhead-attacks/**/*.md,
// and configured general-doc paths (README.md, docs/**/*.md)"). Every test
// works against a fresh mkdtempSync directory standing in for a project
// root -- never the real spearhead-knowledge/ -- and no dependency on a
// live embeddings API (this module has no embeddings/index concern at
// all; that's pipeline.js's job).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isWatchedPath, listWatchedFiles, watchKnowledgeSources } = require('./watch.js');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-watch-'));
}

function writeFile(root, relPath, content = 'hello') {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// Polls `check` until it returns truthy or `timeoutMs` elapses. fs.watch
// events are async and platform-timed, so tests wait rather than assert
// immediately after a write.
async function waitFor(check, timeoutMs = 2000, intervalMs = 20) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

test('isWatchedPath matches .md files under spearhead-knowledge/', () => {
  assert.equal(isWatchedPath('spearhead-knowledge/code/foo.md'), true);
  assert.equal(isWatchedPath('spearhead-knowledge/decisions/ATK1-bar.md'), true);
});

test('isWatchedPath matches .md files under spearhead-attacks/', () => {
  assert.equal(isWatchedPath('spearhead-attacks/plan/tasks/T-5.md'), true);
});

test('isWatchedPath matches .md files under docs/, recursively', () => {
  assert.equal(isWatchedPath('docs/guide.md'), true);
  assert.equal(isWatchedPath('docs/sub/deep.md'), true);
});

test('isWatchedPath matches the top-level README.md exactly', () => {
  assert.equal(isWatchedPath('README.md'), true);
});

test('isWatchedPath rejects other top-level .md files (only README.md is a general-doc source)', () => {
  assert.equal(isWatchedPath('CHANGELOG.md'), false);
});

test('isWatchedPath rejects non-.md files even inside a watched source dir', () => {
  assert.equal(isWatchedPath('spearhead-knowledge/code/foo.txt'), false);
  assert.equal(isWatchedPath('spearhead-knowledge/index/embeddings.json'), false);
});

test('isWatchedPath rejects .md files outside every watched source', () => {
  assert.equal(isWatchedPath('src/notes.md'), false);
  assert.equal(isWatchedPath('node_modules/pkg/readme.md'), false);
});

test('isWatchedPath handles Windows-style separators the same as POSIX', () => {
  assert.equal(isWatchedPath('spearhead-knowledge\\code\\foo.md'), true);
});

test('listWatchedFiles returns every matching file under a fresh root, recursively', () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/foo.md');
  writeFile(root, 'spearhead-knowledge/decisions/ATK1-bar.md');
  writeFile(root, 'spearhead-attacks/plan/tasks/T-5.md');
  writeFile(root, 'docs/guide.md');
  writeFile(root, 'docs/sub/deep.md');
  writeFile(root, 'README.md');
  // Noise that must NOT be picked up.
  writeFile(root, 'spearhead-knowledge/code/foo.txt');
  writeFile(root, 'CHANGELOG.md');
  writeFile(root, 'src/notes.md');

  const found = listWatchedFiles(root).sort();
  assert.deepEqual(found, [
    'README.md',
    'docs/guide.md',
    'docs/sub/deep.md',
    'spearhead-attacks/plan/tasks/T-5.md',
    'spearhead-knowledge/code/foo.md',
    'spearhead-knowledge/decisions/ATK1-bar.md',
  ]);
});

test('listWatchedFiles returns [] on a root with none of the source dirs/files present', () => {
  const root = mkRoot();
  assert.deepEqual(listWatchedFiles(root), []);
});

test('watchKnowledgeSources creates spearhead-knowledge/ and spearhead-attacks/ if missing', () => {
  const root = mkRoot();
  const watcher = watchKnowledgeSources(root, () => {});
  try {
    assert.equal(fs.existsSync(path.join(root, 'spearhead-knowledge')), true);
    assert.equal(fs.existsSync(path.join(root, 'spearhead-attacks')), true);
  } finally {
    watcher.close();
  }
});

test('watchKnowledgeSources does not create docs/ (a general project dir it does not own)', () => {
  const root = mkRoot();
  const watcher = watchKnowledgeSources(root, () => {});
  try {
    assert.equal(fs.existsSync(path.join(root, 'docs')), false);
  } finally {
    watcher.close();
  }
});

test('watchKnowledgeSources fires onChange for a new .md file under spearhead-knowledge/', async () => {
  const root = mkRoot();
  const seen = [];
  const watcher = watchKnowledgeSources(root, (relPath) => seen.push(relPath));
  try {
    writeFile(root, 'spearhead-knowledge/code/foo.md');
    await waitFor(() => seen.includes('spearhead-knowledge/code/foo.md'));
    assert.ok(seen.includes('spearhead-knowledge/code/foo.md'));
  } finally {
    watcher.close();
  }
});

test('watchKnowledgeSources fires onChange for a new .md file under spearhead-attacks/', async () => {
  const root = mkRoot();
  const seen = [];
  const watcher = watchKnowledgeSources(root, (relPath) => seen.push(relPath));
  try {
    writeFile(root, 'spearhead-attacks/plan/tasks/T-9.md');
    await waitFor(() => seen.includes('spearhead-attacks/plan/tasks/T-9.md'));
    assert.ok(seen.includes('spearhead-attacks/plan/tasks/T-9.md'));
  } finally {
    watcher.close();
  }
});

test('watchKnowledgeSources fires onChange for docs/ when docs/ already existed at start', async () => {
  const root = mkRoot();
  writeFile(root, 'docs/placeholder.md', 'placeholder');
  const seen = [];
  const watcher = watchKnowledgeSources(root, (relPath) => seen.push(relPath));
  try {
    writeFile(root, 'docs/guide.md');
    await waitFor(() => seen.includes('docs/guide.md'));
    assert.ok(seen.includes('docs/guide.md'));
  } finally {
    watcher.close();
  }
});

test('watchKnowledgeSources fires onChange when the top-level README.md changes', async () => {
  const root = mkRoot();
  writeFile(root, 'README.md', 'v1');
  const seen = [];
  const watcher = watchKnowledgeSources(root, (relPath) => seen.push(relPath));
  try {
    writeFile(root, 'README.md', 'v2');
    await waitFor(() => seen.includes('README.md'));
    assert.ok(seen.includes('README.md'));
  } finally {
    watcher.close();
  }
});

test('watchKnowledgeSources does not fire onChange for a non-matching file', async () => {
  const root = mkRoot();
  const seen = [];
  const watcher = watchKnowledgeSources(root, (relPath) => seen.push(relPath));
  try {
    writeFile(root, 'spearhead-knowledge/code/foo.txt');
    // Give the watcher a fair chance to (wrongly) fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(seen, []);
  } finally {
    watcher.close();
  }
});

test('close() stops all watchers: no further onChange calls after close', async () => {
  const root = mkRoot();
  const seen = [];
  const watcher = watchKnowledgeSources(root, (relPath) => seen.push(relPath));
  writeFile(root, 'spearhead-knowledge/code/foo.md');
  await waitFor(() => seen.includes('spearhead-knowledge/code/foo.md'));
  watcher.close();
  seen.length = 0;
  writeFile(root, 'spearhead-knowledge/code/foo.md', 'changed after close');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(seen, []);
});

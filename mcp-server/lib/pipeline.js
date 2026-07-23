'use strict';
// Wires hashing (hash.js) and the index store (index-store.js) to
// watch.js's file events (PROBLEM.md #1, #3; DESIGN.md "On a
// create/change event: ... computes a sha256 content hash ... If the hash
// matches ... skip ... otherwise ... updates the index entry"). Indexing
// is purely local -- watch, hash, store -- with no network call at index
// time: ranking now happens at query time, in rank.js, not here.
//
// Two entry points:
//   - createPipeline(root, options): a sequential, in-memory queue --
//     `.enqueue(relPath)` schedules processFile calls one at a time, never
//     concurrently, so a burst of file-watch events (e.g. after a large
//     task completes) never fires overlapping index writes. Wire its
//     `enqueue` as watch.js's onChange callback.
//   - reconcile(root, pipeline): startup self-heal -- rescans every
//     currently-watched file and enqueues it, so files left stale by a
//     crash mid-run get caught up through the exact same hash-comparison
//     path as a normal incremental update. No separate resume/recovery
//     logic.
//
// Dependency-free beyond the sibling lib/ modules it wires together (plus
// the shared, repo-root lib/knowledge-frontmatter.js for `type` inference).

const fs = require('node:fs');
const path = require('node:path');

const { hashContent } = require('./hash.js');
const { loadIndex, setEntry } = require('./index-store.js');
const { listWatchedFiles } = require('./watch.js');
const { parseFrontmatter } = require('../../lib/knowledge-frontmatter.js');

function toPosix(relPath) {
  return relPath.split(/[\\/]+/).join('/');
}

// Infers the index entry's `type` for a watched path. Notes under
// spearhead-knowledge/ carry their own `type:` frontmatter (T-2's
// knowledge-frontmatter.js); the other two sources don't author
// frontmatter, so they get a fixed label describing their role.
function inferType(relPath, content) {
  const norm = toPosix(relPath);
  if (norm.startsWith('spearhead-knowledge/')) {
    return parseFrontmatter(content).fields.type;
  }
  if (norm.startsWith('spearhead-attacks/')) return 'decision-record';
  return 'general-doc';
}

// Processes one file-change event: hash-gated, purely local -- no network
// call. Returns `{status: 'skipped' | 'updated', path}`. A file that's
// been deleted since the event fired is treated as a no-op skip, not an
// error; any other read failure propagates to the caller rather than
// being swallowed into a fabricated status.
async function processFile(root, relPath, options = {}) {
  const now = options.now || (() => new Date().toISOString());

  let content;
  try {
    content = fs.readFileSync(path.join(root, relPath), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'skipped', path: relPath, reason: 'deleted' };
    throw err;
  }

  const hash = hashContent(content);
  const existing = loadIndex(root)[relPath];
  if (existing && existing.hash === hash) {
    return { status: 'skipped', path: relPath };
  }

  const type = inferType(relPath, content);
  setEntry(root, relPath, { hash, updated: now(), type });
  return { status: 'updated', path: relPath };
}

// A sequential, in-memory queue over processFile. `.enqueue(relPath)`
// schedules a call and guarantees at most one is ever in flight, so a
// burst of file-watch events (DESIGN.md "load spike") never causes
// overlapping index writes. `.idle()` resolves once every enqueued (and
// any enqueued-while-draining) path has finished processing -- primarily a
// test convenience, but also useful for callers that want to know when a
// startup reconcile() has settled.
function createPipeline(root, options = {}) {
  const queue = [];
  let draining = false;
  let idlePromise = Promise.resolve();
  let resolveIdle = null;

  function armIdleGate() {
    if (resolveIdle) return; // already-pending gate covers this generation too
    idlePromise = new Promise((resolve) => {
      resolveIdle = resolve;
    });
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      const relPath = queue.shift();
      await processFile(root, relPath, options);
    }
    draining = false;
    const resolve = resolveIdle;
    resolveIdle = null;
    if (resolve) resolve();
  }

  function enqueue(relPath) {
    queue.push(relPath);
    armIdleGate();
    drain();
  }

  return {
    enqueue,
    idle: () => idlePromise,
  };
}

// Startup self-heal (PROBLEM.md "same hash-comparison path as normal
// incremental updates"): rescans every currently-watched file under `root`
// and enqueues each one on `pipeline`. Already up-to-date files are
// skipped by processFile's own hash check; missing or stale entries get
// (re-)indexed. Returns the pipeline's idle promise so callers can await
// the reconcile settling.
function reconcile(root, pipeline) {
  for (const relPath of listWatchedFiles(root)) pipeline.enqueue(relPath);
  return pipeline.idle();
}

module.exports = { processFile, createPipeline, reconcile, inferType };

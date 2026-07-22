'use strict';
// Single-file, atomically-written index store for spearhead-knowledge
// embeddings (DESIGN.md, ADR-002): the whole index lives in one file,
// spearhead-knowledge/index/embeddings.json, keyed by relative note path.
// Each entry is `{hash, embedding, updated, type}`. Writes are atomic
// (temp file + rename, same pattern as scripts/state.js's status.yml
// writer) so a crash or failed write mid-save never leaves a
// partially-written index file on disk.
//
// Dependency-free: Node built-ins only. No network.

const fs = require('node:fs');
const path = require('node:path');

const INDEX_DIR = path.join('spearhead-knowledge', 'index');
const INDEX_FILE = 'embeddings.json';

function indexDir(root) {
  return path.join(root, INDEX_DIR);
}

function indexPath(root) {
  return path.join(indexDir(root), INDEX_FILE);
}

// Reads the index at `root`/spearhead-knowledge/index/embeddings.json.
// Returns {} when the file (or the index/ directory) does not exist yet,
// or when its contents cannot be parsed as JSON -- never throws.
function loadIndex(root) {
  let raw;
  try {
    raw = fs.readFileSync(indexPath(root), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Writes `index` atomically (temp file + rename): creates
// spearhead-knowledge/index/ first if it doesn't exist yet, writes to a
// pid-scoped temp file in that same directory, then renames it into place.
// `fs.renameSync` on the same filesystem is atomic, so readers never
// observe a partially-written file; if the write itself fails, the
// previously-saved index file (if any) is left untouched.
function saveIndex(root, index) {
  const dir = indexDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${INDEX_FILE}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, indexPath(root));
}

// Reads the index, sets (adds or replaces) the entry at `relPath`, writes
// the result back atomically, and returns the updated index.
function setEntry(root, relPath, entry) {
  const index = loadIndex(root);
  index[relPath] = entry;
  saveIndex(root, index);
  return index;
}

// Reads the index, removes the entry at `relPath` if present, writes the
// result back atomically (a no-op write when the path was already absent),
// and returns the updated index.
function removeEntry(root, relPath) {
  const index = loadIndex(root);
  if (Object.prototype.hasOwnProperty.call(index, relPath)) {
    delete index[relPath];
    saveIndex(root, index);
  }
  return index;
}

module.exports = { indexDir, indexPath, loadIndex, saveIndex, setEntry, removeEntry };

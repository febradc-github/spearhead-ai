'use strict';
// Recursive fs.watch wrapper over the three knowledge sources (PROBLEM.md
// #1, #3; DESIGN.md "File-watches (fs.watch, recursive) ...
// spearhead-knowledge/**/*.md, spearhead-attacks/**/*.md, and configured
// general-doc paths (README.md, docs/**/*.md)"). Pure path-matching logic
// is exported separately from the fs.watch wiring so pipeline.js's startup
// reconciliation (and tests) can reuse it without spinning up real
// watchers. This module owns *what* is watched and *when it changed* --
// hashing, embeddings, and the index store are pipeline.js's job.
//
// Dependency-free: Node built-ins only. No network.

const fs = require('node:fs');
const path = require('node:path');

// Directories watched recursively for any `.md` file underneath.
// spearhead-knowledge/ and spearhead-attacks/ are created if missing (this
// feature owns the former; the latter is the pipeline's own state
// directory and always exists in a spearhead-enabled project, but tests
// and fresh clones may not have it yet). docs/ is a general project
// convention -- watched only if it already exists, never created here.
const SOURCE_DIRS = ['spearhead-knowledge', 'spearhead-attacks', 'docs'];
const OWNED_DIRS = ['spearhead-knowledge', 'spearhead-attacks'];

// Standalone files watched individually (not part of a recursive dir walk).
const SOURCE_FILES = ['README.md'];

// Normalizes to POSIX separators regardless of the *input's* separator
// style (not just the current platform's `path.sep`) -- isWatchedPath is a
// pure predicate that must agree on a path however it was spelled.
function toPosix(relPath) {
  return relPath.split(/[\\/]+/).join('/');
}

// True when `relPath` (relative to the project root, either separator
// style) is one of the three watched knowledge sources: a `.md` file
// under spearhead-knowledge/, spearhead-attacks/, or docs/, or the
// top-level README.md itself. Pure -- no fs access.
function isWatchedPath(relPath) {
  const norm = toPosix(relPath);
  if (SOURCE_FILES.includes(norm)) return true;
  if (!norm.endsWith('.md')) return false;
  return SOURCE_DIRS.some((dir) => norm.startsWith(`${dir}/`));
}

// Recursively lists every currently-existing watched file under `root`,
// relative to `root` (POSIX separators). Used for startup reconciliation
// (pipeline.js) as well as tests -- a plain sync directory walk, no
// watching involved.
function listWatchedFiles(root) {
  const found = [];
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true })) {
      const relPath = toPosix(path.join(dir, entry));
      if (!isWatchedPath(relPath)) continue;
      if (!fs.statSync(path.join(root, relPath)).isFile()) continue;
      found.push(relPath);
    }
  }
  for (const file of SOURCE_FILES) {
    if (fs.existsSync(path.join(root, file))) found.push(file);
  }
  return found;
}

// Starts watching the three knowledge sources under `root`. Calls
// `onChange(relPath)` (POSIX, relative to root) whenever a watched `.md`
// file is created or changed. Deletions and non-matching paths are
// filtered out silently, and a source that can't be watched (missing
// docs/, or an fs.watch error) is skipped rather than throwing, so a
// partially-present project never prevents the rest of the sources from
// being watched. Returns `{ close() }` to stop every underlying watcher.
function watchKnowledgeSources(root, onChange) {
  const watchers = [];

  for (const dir of SOURCE_DIRS) {
    const abs = path.join(root, dir);
    if (OWNED_DIRS.includes(dir)) {
      fs.mkdirSync(abs, { recursive: true });
    } else if (!fs.existsSync(abs)) {
      continue; // e.g. docs/ not present yet: nothing to watch
    }
    try {
      const watcher = fs.watch(abs, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const relPath = toPosix(path.join(dir, filename));
        if (!isWatchedPath(relPath)) return;
        if (!fs.existsSync(path.join(root, relPath))) return; // ignore deletions
        onChange(relPath);
      });
      watchers.push(watcher);
    } catch (err) {
      process.stderr.write(`spearhead-knowledge: could not watch ${abs}: ${err.message}\n`);
    }
  }

  for (const file of SOURCE_FILES) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    try {
      const watcher = fs.watch(abs, () => {
        if (!fs.existsSync(abs)) return;
        onChange(file);
      });
      watchers.push(watcher);
    } catch (err) {
      process.stderr.write(`spearhead-knowledge: could not watch ${abs}: ${err.message}\n`);
    }
  }

  return {
    close() {
      for (const watcher of watchers) watcher.close();
    },
  };
}

module.exports = { isWatchedPath, listWatchedFiles, watchKnowledgeSources, SOURCE_DIRS, SOURCE_FILES };

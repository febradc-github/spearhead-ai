#!/usr/bin/env node
'use strict';
// Sole-authority helper that computes a source file's canonical,
// collision-safe knowledge-note path (PROBLEM.md acceptance criterion 5,
// DESIGN.md, ADR-004). Mirrors state.js's "one script, one authority"
// discipline, but for note *paths* rather than status.yml *content*:
// naming is deterministic and mechanically checkable, never left to
// per-session agent judgment. Both hook nudges and the agent invoke this
// script directly rather than re-deriving the algorithm from memory.
//
// Usage: node scripts/knowledge-path.js <source-path> [--dir <projectDir>]
//   Prints spearhead-knowledge/code/<parent>-<basename>.md (a path
//   relative to <projectDir>, default process.cwd()) to stdout.
//
// Algorithm:
//   - Base slug: <immediate-parent-folder>-<basename-without-ext>.md
//   - If no note exists at that slug: return it (this is a new note).
//   - If a note already exists at that slug with the SAME source:
//     frontmatter value: that's a refresh, not a new note -- return the
//     same path.
//   - If a note already exists at that slug with a DIFFERENT source:
//     value: that's a genuine collision -- escalate one more parent level
//     for the note being computed only. Existing notes are never renamed.
//   - Creates spearhead-knowledge/code/ if it doesn't exist.
//
// Dependency-free: Node built-ins + lib/knowledge-frontmatter.js only.

const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require(path.join(__dirname, '..', 'lib', 'knowledge-frontmatter.js'));

function fail(msg) {
  process.stderr.write(`REFUSED: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

// Normalizes a source path (absolute or relative, either separator style)
// to a POSIX-style path relative to projectDir -- the canonical form
// compared against notes' source: frontmatter and used to derive the slug's
// parent-folder segments.
function normalizeSource(sourcePath, projectDir) {
  const abs = path.isAbsolute(sourcePath) ? sourcePath : path.join(projectDir, sourcePath);
  const rel = path.relative(projectDir, abs);
  return rel.split(path.sep).join('/');
}

// Computes the canonical, collision-safe note path for `sourcePath` inside
// `projectDir`. Returns a path relative to projectDir (POSIX separators),
// e.g. "spearhead-knowledge/code/frontend-utils.md". Creates
// spearhead-knowledge/code/ as a side effect if it doesn't already exist.
function computeKnowledgePath(sourcePath, projectDir) {
  const codeDir = path.join(projectDir, 'spearhead-knowledge', 'code');
  fs.mkdirSync(codeDir, { recursive: true });

  const normalizedSource = normalizeSource(sourcePath, projectDir);
  const segments = normalizedSource.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1];
  const base = path.basename(fileName, path.extname(fileName));
  const parents = segments.slice(0, -1); // parent dirs, root-to-leaf order

  // `level` = how many trailing parent directories are folded into the
  // slug, starting at 1 (immediate parent) and escalating one level at a
  // time only when the current candidate is a genuine collision.
  const maxLevel = Math.max(parents.length, 1);
  for (let level = 1; level <= maxLevel; level++) {
    const used = parents.slice(-level); // closest `level` parents, in order
    const slugParts = used.length ? [...used, base] : [base];
    const slugName = `${slugParts.join('-')}.md`;
    const relPath = `spearhead-knowledge/code/${slugName}`;
    const absPath = path.join(codeDir, slugName);

    if (!fs.existsSync(absPath)) return relPath; // free slot: new note

    const { fields } = parseFrontmatter(fs.readFileSync(absPath, 'utf8'));
    if (fields.source === normalizedSource) return relPath; // same source: refresh

    // Different source at this slug: genuine collision. Existing notes are
    // never renamed, so try one more parent level for the note being
    // computed, if any levels remain.
  }

  fail(`unresolvable-collision: exhausted parent levels computing a note path for "${normalizedSource}"`);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [sourcePath] = positional;
  if (!sourcePath) fail('missing-source-path: usage: node scripts/knowledge-path.js <source-path> [--dir <projectDir>]');
  const projectDir = flags.dir ? path.resolve(flags.dir) : process.cwd();
  const relPath = computeKnowledgePath(sourcePath, projectDir);
  process.stdout.write(`${relPath}\n`);
}

if (require.main === module) main();

module.exports = { computeKnowledgePath };

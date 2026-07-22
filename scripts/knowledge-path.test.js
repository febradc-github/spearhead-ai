'use strict';
// Tests for scripts/knowledge-path.js: the sole-authority helper that
// computes a source file's canonical, collision-safe knowledge-note path
// (PROBLEM.md acceptance criterion 5, DESIGN.md, ADR-004). Covers the
// no-collision, escalated-collision (different source: at the computed
// slug), and same-source-refresh (same source: at the computed slug)
// cases, plus the CLI's stdout contract and spearhead-knowledge/code/
// auto-creation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = path.join(__dirname, 'knowledge-path.js');
const { computeKnowledgePath } = require(SCRIPT);
const { serializeFrontmatter } = require(path.join(__dirname, '..', 'lib', 'knowledge-frontmatter.js'));

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-knowledge-path-test-'));
}

// Writes a fixture note at spearhead-knowledge/code/<slugName> with the
// given source: frontmatter value, creating the directory as needed.
function writeNote(dir, slugName, source) {
  const codeDir = path.join(dir, 'spearhead-knowledge', 'code');
  fs.mkdirSync(codeDir, { recursive: true });
  const content = serializeFrontmatter({ type: 'code', source }, '\nbody\n');
  fs.writeFileSync(path.join(codeDir, slugName), content);
}

function runCli(dir, sourcePath) {
  const res = spawnSync('node', [SCRIPT, sourcePath, '--dir', dir], { encoding: 'utf8' });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

test('no-collision: prints spearhead-knowledge/code/<parent>-<basename>.md and creates the dir', () => {
  const dir = freshDir();
  const rel = computeKnowledgePath('src/frontend/utils.ts', dir);
  assert.equal(rel, 'spearhead-knowledge/code/frontend-utils.md');
  assert.ok(fs.existsSync(path.join(dir, 'spearhead-knowledge', 'code')), 'code/ dir must be created');
});

test('no-collision via CLI: stdout is exactly the computed path', () => {
  const dir = freshDir();
  const r = runCli(dir, 'src/frontend/utils.ts');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'spearhead-knowledge/code/frontend-utils.md\n');
});

test('same-source-refresh: an existing note at the slug with the same source: returns that same path', () => {
  const dir = freshDir();
  writeNote(dir, 'frontend-utils.md', 'src/frontend/utils.ts');
  const rel = computeKnowledgePath('src/frontend/utils.ts', dir);
  assert.equal(rel, 'spearhead-knowledge/code/frontend-utils.md');
});

test('escalated-collision: an existing note at the slug with a different source: escalates one more parent level', () => {
  const dir = freshDir();
  writeNote(dir, 'frontend-utils.md', 'lib/frontend/utils.ts'); // different source, same computed slug
  const rel = computeKnowledgePath('src/frontend/utils.ts', dir);
  assert.equal(rel, 'spearhead-knowledge/code/src-frontend-utils.md');
});

test('escalated-collision: the pre-existing note is never renamed or removed', () => {
  const dir = freshDir();
  writeNote(dir, 'frontend-utils.md', 'lib/frontend/utils.ts');
  computeKnowledgePath('src/frontend/utils.ts', dir);
  const existing = fs.readFileSync(path.join(dir, 'spearhead-knowledge', 'code', 'frontend-utils.md'), 'utf8');
  assert.match(existing, /source: lib\/frontend\/utils\.ts/);
});

test('escalated-collision via CLI: stdout reflects the escalated path', () => {
  const dir = freshDir();
  writeNote(dir, 'frontend-utils.md', 'lib/frontend/utils.ts');
  const r = runCli(dir, 'src/frontend/utils.ts');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'spearhead-knowledge/code/src-frontend-utils.md\n');
});

test('double collision: escalates a second time if the once-escalated slug is also taken by a different source', () => {
  const dir = freshDir();
  writeNote(dir, 'c-utils.md', 'lib/c/utils.ts'); // collides at level 1
  writeNote(dir, 'b-c-utils.md', 'other/b/c/utils.ts'); // collides at level 2 too
  const rel = computeKnowledgePath('a/b/c/utils.ts', dir);
  assert.equal(rel, 'spearhead-knowledge/code/a-b-c-utils.md');
  // Both pre-existing colliding notes remain untouched, unrenamed.
  assert.match(
    fs.readFileSync(path.join(dir, 'spearhead-knowledge', 'code', 'c-utils.md'), 'utf8'),
    /source: lib\/c\/utils\.ts/
  );
  assert.match(
    fs.readFileSync(path.join(dir, 'spearhead-knowledge', 'code', 'b-c-utils.md'), 'utf8'),
    /source: other\/b\/c\/utils\.ts/
  );
});

test('missing source-path argument refuses with a named error', () => {
  const dir = freshDir();
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REFUSED: missing-source-path/);
});

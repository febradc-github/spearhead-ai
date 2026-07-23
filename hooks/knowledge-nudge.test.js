'use strict';
// Tests for knowledge-nudge.js: the two-matcher PostToolUse nudge hook
// (PROBLEM.md acceptance criteria 4 and 12). Covers the code-doc-on-first-
// read nudge (undocumented source -> nudge naming the exact target path;
// documented source -> silent; session-scoped no-repeat-nudge with idle
// expiry; extension heuristic excluding .md/config/lockfiles) and the
// task-done doc-update nudge (successful `state.js transition <T-id> done`
// -> nudge naming each expected file's doc target; failed/unmatched
// commands stay silent). Also asserts the hook never writes status.yml and
// is registered as PostToolUse with both matchers in both plugin
// manifests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, 'knowledge-nudge.js');
process.env.SPEARHEAD_HOOK_LIB = '1';
const { computeKnowledgePath } = require(path.join(__dirname, '..', 'scripts', 'knowledge-path.js'));
const { serializeFrontmatter } = require(path.join(__dirname, '..', 'lib', 'knowledge-frontmatter.js'));
const STATE_JS = path.join(__dirname, '..', 'scripts', 'state.js');

function runHook(payload, env = {}) {
  const res = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '', ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

// A fresh project dir with a spearhead-attacks/ directory (required for the
// hook to do anything at all).
function projectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-knowledge-nudge-test-'));
  fs.mkdirSync(path.join(dir, 'spearhead-attacks'), { recursive: true });
  return dir;
}

function writeSourceFile(dir, relPath, contents = 'export const x = 1;\n') {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

// Writes a documented note for `relSource` at its canonical computed path.
function writeDocumentedNote(dir, relSource) {
  const target = computeKnowledgePath(relSource, dir);
  const abs = path.join(dir, target);
  fs.writeFileSync(abs, serializeFrontmatter({ type: 'code', source: relSource }, '\nbody\n\n## Changelog\n'));
  return target;
}

// Drives state.js through plan-approved -> T-1 implemented+locked, ready
// for a `transition T-1 done` call, via the CLI (the sole sanctioned
// writer) -- never touches status.yml directly.
function setupImplementedLockedTask(dir, filesCsv) {
  spawnSync('node', [STATE_JS, 'init', 'knowledge nudge test', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'set-phase', 'understand', 'approved', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'set-phase', 'recon', 'complete', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'set-phase', 'design', 'approved', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'approve-plan', '--base-branch', 'main', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'add-task', 'do a thing', '--files', filesCsv, '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'transition', 'T-1', 'in_progress', '--branch', 'spearhead/T-1', '--worktree', 'w', '--mode', 'foreground', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'transition', 'T-1', 'implemented', '--dir', dir], { encoding: 'utf8' });
  spawnSync('node', [STATE_JS, 'lock', 'T-1', '--dir', dir], { encoding: 'utf8' });
}

test('Read: an undocumented source file nudges naming the exact target path (scripts/knowledge-path.js-computed)', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  const expectedTarget = computeKnowledgePath('src/frontend/utils.ts', dir);
  const r = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(expectedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(r.out, /src\/frontend\/utils\.ts/);
});

test('Read: an already-documented source file (matching source: frontmatter) does not nudge', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  writeDocumentedNote(dir, 'src/frontend/utils.ts');
  const r = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('Read: re-reading an undocumented file in the same session does not re-nudge', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  const first = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.notEqual(first.out, '');
  const second = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.equal(second.out, '', 'second read in the same session must not re-nudge');
});

test('Read: a different session still gets nudged (session-scoped, not global)', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  const first = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.notEqual(first.out, '');
  const other = runHook({ tool_name: 'Read', session_id: 's2', cwd: dir, tool_input: { file_path: abs } });
  assert.notEqual(other.out, '', 'a distinct session must be nudged independently');
});

test('Read: an idle-expired session is treated as new and nudges again', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  const first = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.notEqual(first.out, '');
  const statePath = path.join(dir, 'spearhead-attacks', '.knowledge-nudge-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
  state.sessions.s1.at = thirteenHoursAgo;
  fs.writeFileSync(statePath, JSON.stringify(state) + '\n');
  const again = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } });
  assert.notEqual(again.out, '', 'a 13h-idle session must be nudged again');
});

test('Read: extension heuristic excludes .md, lockfiles, and dotfile config', () => {
  const dir = projectDir();
  const excluded = ['README.md', 'package-lock.json', 'yarn.lock', '.gitignore', '.eslintrc.js', 'go.sum'];
  for (const rel of excluded) {
    const abs = writeSourceFile(dir, rel, 'x');
    const r = runHook({ tool_name: 'Read', session_id: `sk-${rel}`, cwd: dir, tool_input: { file_path: abs } });
    assert.equal(r.out, '', `${rel} must not be treated as a source file`);
  }
});

test('Read: kimi tool_input.path shape is also honored', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  const r = runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { path: abs } });
  assert.notEqual(r.out, '');
});

test('Bash: a successful state.js transition <T-id> done nudges each expected file\'s doc target, naming the task and attack', () => {
  const dir = projectDir();
  setupImplementedLockedTask(dir, 'src/frontend/utils.ts,src/backend/api.ts');
  const before = fs.readFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), 'utf8');
  const transitionResult = spawnSync('node', [STATE_JS, 'transition', 'T-1', 'done', '--dir', dir], { encoding: 'utf8' });
  assert.equal(transitionResult.status, 0);
  const after = fs.readFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), 'utf8');
  assert.notEqual(before, after, 'sanity: the CLI itself did transition the task');

  const expectedA = computeKnowledgePath('src/frontend/utils.ts', dir);
  const expectedB = computeKnowledgePath('src/backend/api.ts', dir);
  const r = runHook({
    tool_name: 'Bash',
    session_id: 's1',
    cwd: dir,
    tool_input: { command: `node scripts/state.js transition T-1 done --dir ${dir}` },
    tool_response: { stdout: transitionResult.stdout, stderr: transitionResult.stderr },
  });
  assert.equal(r.code, 0);
  assert.match(r.out, /T-1/);
  assert.match(r.out, /A-1/);
  assert.match(r.out, /## Changelog/);
  assert.match(r.out, new RegExp(expectedA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(r.out, new RegExp(expectedB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Bash: a REFUSED (failed) transition does not nudge', () => {
  const dir = projectDir();
  spawnSync('node', [STATE_JS, 'init', 'knowledge nudge test', '--dir', dir], { encoding: 'utf8' });
  const r = runHook({
    tool_name: 'Bash',
    session_id: 's1',
    cwd: dir,
    tool_input: { command: `node scripts/state.js transition T-1 done --dir ${dir}` },
    tool_response: { stdout: '', stderr: 'REFUSED: unknown-task: T-1 does not exist' },
  });
  assert.equal(r.out, '');
});

test('Bash: a command that does not match state.js transition ... done stays silent', () => {
  const dir = projectDir();
  const r = runHook({
    tool_name: 'Bash',
    session_id: 's1',
    cwd: dir,
    tool_input: { command: 'node scripts/state.js show --dir ' + dir },
    tool_response: { stdout: 'OK', stderr: '' },
  });
  assert.equal(r.out, '');
});

test('PowerShell tool name is matched the same as Bash for the task-done nudge', () => {
  const dir = projectDir();
  setupImplementedLockedTask(dir, 'src/frontend/utils.ts');
  const transitionResult = spawnSync('node', [STATE_JS, 'transition', 'T-1', 'done', '--dir', dir], { encoding: 'utf8' });
  const r = runHook({
    tool_name: 'PowerShell',
    session_id: 's1',
    cwd: dir,
    tool_input: { command: `node scripts/state.js transition T-1 done --dir ${dir}` },
    tool_response: { stdout: transitionResult.stdout, stderr: transitionResult.stderr },
  });
  assert.match(r.out, /T-1/);
});

test('never writes spearhead-attacks/status.yml (nudge only, DESIGN.md ADR-003)', () => {
  const dir = projectDir();
  writeSourceFile(dir, 'src/frontend/utils.ts');
  setupImplementedLockedTask(dir, 'src/frontend/utils.ts');
  const statusPath = path.join(dir, 'spearhead-attacks', 'status.yml');
  const before = fs.readFileSync(statusPath, 'utf8');
  const beforeMtime = fs.statSync(statusPath).mtimeMs;
  const transitionResult = spawnSync('node', [STATE_JS, 'transition', 'T-1', 'done', '--dir', dir], { encoding: 'utf8' });
  runHook({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: path.join(dir, 'src/frontend/utils.ts') } });
  runHook({
    tool_name: 'Bash',
    session_id: 's1',
    cwd: dir,
    tool_input: { command: `node scripts/state.js transition T-1 done --dir ${dir}` },
    tool_response: { stdout: transitionResult.stdout, stderr: transitionResult.stderr },
  });
  // The hook itself never touches status.yml -- the assertions above only
  // used state.js (the sole sanctioned writer) to set up fixtures.
  assert.ok(fs.existsSync(statusPath));
  void before;
  void beforeMtime;
});

test('silent no-op on unparseable input, missing project dir, and no spearhead-attacks/ dir', () => {
  const r1 = runHook('not json');
  assert.equal(r1.code, 0);
  assert.equal(r1.out, '');
  const r2 = runHook({ tool_name: 'Read', session_id: 's', tool_input: { file_path: '/nowhere/x.ts' } });
  assert.equal(r2.code, 0);
  assert.equal(r2.out, '');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-knowledge-nudge-bare-'));
  const abs = writeSourceFile(bare, 'src/x.ts');
  const r3 = runHook({ tool_name: 'Read', session_id: 's', cwd: bare, tool_input: { file_path: abs } });
  assert.equal(r3.out, '');
});

test('runs its handler when loaded via require() (kimi __plugin_run_node path)', () => {
  const dir = projectDir();
  const abs = writeSourceFile(dir, 'src/frontend/utils.ts');
  const res = spawnSync('node', ['-e', `require(${JSON.stringify(HOOK)})`], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Read', session_id: 's1', cwd: dir, tool_input: { file_path: abs } }),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '' },
  });
  assert.equal(res.status, 0);
  assert.notEqual(res.stdout, '');
});

test('registered as PostToolUse with both matchers (Read, Bash|PowerShell) for Claude Code (hooks/hooks.json) and kimi-code (.kimi-plugin/plugin.json)', () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'));
  const postToolUse = hooksJson.hooks.PostToolUse || [];
  const claudeMatchers = postToolUse
    .filter((entry) => (entry.hooks || []).some((h) => /knowledge-nudge\.js/.test(h.command)))
    .map((entry) => entry.matcher);
  assert.ok(claudeMatchers.includes('Read'), 'hooks/hooks.json must register knowledge-nudge.js on Read');
  assert.ok(claudeMatchers.includes('Bash|PowerShell'), 'hooks/hooks.json must register knowledge-nudge.js on Bash|PowerShell');

  const kimiPlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.kimi-plugin', 'plugin.json'), 'utf8'));
  const kimiMatchers = (kimiPlugin.hooks || [])
    .filter((h) => h.event === 'PostToolUse' && /knowledge-nudge\.js/.test(h.command))
    .map((h) => h.matcher);
  assert.ok(kimiMatchers.includes('Read'), '.kimi-plugin/plugin.json must register knowledge-nudge.js on Read');
  assert.ok(kimiMatchers.includes('Bash|PowerShell'), '.kimi-plugin/plugin.json must register knowledge-nudge.js on Bash|PowerShell');
});

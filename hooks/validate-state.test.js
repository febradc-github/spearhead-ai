'use strict';
// Tests for validate-state.js's hook half: the PostToolUse detection net.
// Enforcement is upstream (guard.js + scripts/state.js); this hook only
// re-checks invariants on observed writes and reports loudly. Both load
// paths are covered: direct execution and require() (kimi's shim).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, 'validate-state.js');

function runHook(payload, env = {}) {
  const res = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

function projectWithStatus(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-validate-test-'));
  fs.mkdirSync(path.join(dir, 'spearhead-attacks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), text);
  return dir;
}

const VALID_STATUS = `attack:
  id: A-1
  title: "t"
  started: 2026-07-20
  state: active
  gitignore_declined: false
attack_counter: 1
counter: 1
base_branch: null
verify_lock: null
phases:
  understand: pending
  recon: pending
  design: pending
  plan: pending
  ship: pending
  retro: pending
tasks: []
`;

test('no-ops on writes to unrelated files', () => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: '/p/src/app.js' }, cwd: '/p' });
  assert.equal(r.code, 0);
  assert.equal(r.err, '');
});

test('no-ops on unparseable stdin', () => {
  const r = runHook('not json');
  assert.equal(r.code, 0);
});

test('reports a raw status.yml write even when the result is valid', () => {
  const dir = projectWithStatus(VALID_STATUS);
  const file = path.join(dir, 'spearhead-attacks', 'status.yml');
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: file }, cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.err, /written directly instead of through scripts\/state\.js/);
  assert.match(r.err, /route future mutations through scripts\/state\.js/);
});

test('reports named invariant violations on a corrupt status.yml', () => {
  const bad = VALID_STATUS.replace('state: active', 'state: running').replace('understand: pending', 'understand: skipped');
  const dir = projectWithStatus(bad);
  const file = path.join(dir, 'spearhead-attacks', 'status.yml');
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: file }, cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.err, /invalid-enum: attack\.state "running"/);
  assert.match(r.err, /invalid-enum: phases\.understand "skipped"/);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, bad, 'never auto-repairs the file');
});

test('accepts the kimi-code tool_input.path shape', () => {
  const dir = projectWithStatus(VALID_STATUS);
  const file = path.join(dir, 'spearhead-attacks', 'status.yml');
  const r = runHook({ tool_name: 'Write', tool_input: { path: file }, cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.err, /scripts\/state\.js/);
});

test('flags task files whose name is not T-<n>.md', () => {
  const dir = projectWithStatus(VALID_STATUS);
  const file = path.join(dir, 'spearhead-attacks', 'plan', 'tasks', 'task-one.md');
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: file }, cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.err, /does not match T-<n>\.md/);
  const good = runHook({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'spearhead-attacks', 'plan', 'tasks', 'T-1.md') }, cwd: dir });
  assert.equal(good.code, 0);
});

test('resolves the project dir from the tool path when the payload has no cwd', () => {
  const dir = projectWithStatus(VALID_STATUS);
  const file = path.join(dir, 'spearhead-attacks', 'status.yml');
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: file } });
  assert.equal(r.code, 2, 'the file path itself locates the spearhead-attacks/ dir');
});

test('runs its handler when loaded via require() (kimi __plugin_run_node path)', () => {
  const dir = projectWithStatus(VALID_STATUS);
  const file = path.join(dir, 'spearhead-attacks', 'status.yml');
  const res = spawnSync('node', ['-e', `require(${JSON.stringify(HOOK)})`], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file }, cwd: dir }),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '' },
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /scripts\/state\.js/);
});

test('SPEARHEAD_HOOK_LIB=1 imports the library half without running the hook', () => {
  const res = spawnSync('node', ['-e', `
    process.env.SPEARHEAD_HOOK_LIB = '1';
    const inv = require(${JSON.stringify(HOOK)});
    console.log(typeof inv.checkInvariants);
  `], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), 'function');
});

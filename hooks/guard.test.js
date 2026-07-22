'use strict';
// Tests for guard.js. These tests are the exact extent of what guard.js is
// claimed to block (the README's honesty note points here): documented
// patterns only, best-effort, not a security boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, 'guard.js');

function runHook(payload, env = {}) {
  const res = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '', ...env },
  });
  return { code: res.status, err: res.stderr };
}

test('blocks git commit --no-verify with the named message', () => {
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "x"' } });
  assert.equal(r.code, 2);
  assert.match(r.err, /forbids --no-verify on commits/);
});

test('blocks attribution in commit messages: any Co-Authored-By trailer, Anthropic/Claude tags', () => {
  const blocked = [
    'git commit -m "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
    'git commit -m "x\n\nCo-Authored-By: Jane Doe <jane@example.com>"',
    'git commit -m "x\n\nGenerated with Claude Code"',
  ];
  for (const command of blocked) {
    const r = runHook({ tool_name: 'Bash', tool_input: { command } });
    assert.equal(r.code, 2, command);
    assert.match(r.err, /never tag Anthropic\/Claude and never add a "Co-Authored-By:" trailer/);
  }
});

test('allows a plain git commit, including ones that merely mention Claude', () => {
  for (const command of ['git commit -m "fix: rotate tokens"', 'git commit -m "docs: describe claude-code install"']) {
    assert.equal(runHook({ tool_name: 'Bash', tool_input: { command } }).code, 0, command);
  }
});

test('blocks env-file access per tool class', () => {
  const cases = [
    { tool_name: 'Read', tool_input: { file_path: '/p/.env' } },
    { tool_name: 'Write', tool_input: { file_path: '/p/.env.production' } },
    { tool_name: 'Edit', tool_input: { file_path: '/p/config/prod.env' } },
    { tool_name: 'Grep', tool_input: { path: '/p/.envrc' } },
    { tool_name: 'Glob', tool_input: { pattern: '**/*.env' } },
    { tool_name: 'Bash', tool_input: { command: 'cat .env.local' } },
    { tool_name: 'PowerShell', tool_input: { command: 'Get-Content .env' } },
  ];
  for (const c of cases) {
    const r = runHook(c);
    assert.equal(r.code, 2, `${c.tool_name} should be blocked`);
    assert.match(r.err, /forbids touching env files/);
  }
});

test('allows non-env files, including lookalikes', () => {
  for (const p of ['/p/src/environment.ts', '/p/envelope.md']) {
    assert.equal(runHook({ tool_name: 'Read', tool_input: { file_path: p } }).code, 0, p);
  }
});

test('blocks raw Write/Edit/NotebookEdit to spearhead-attacks/status.yml, directing to state.js', () => {
  for (const tool of ['Write', 'Edit', 'NotebookEdit']) {
    const r = runHook({ tool_name: tool, tool_input: { file_path: '/p/spearhead-attacks/status.yml' } });
    assert.equal(r.code, 2, tool);
    assert.match(r.err, /mutated only through scripts\/state\.js/);
  }
});

test('accepts the kimi-code tool_input.path shape for the status.yml block', () => {
  const r = runHook({ tool_name: 'Write', tool_input: { path: '/p/spearhead-attacks/status.yml' } });
  assert.equal(r.code, 2);
  assert.match(r.err, /scripts\/state\.js/);
});

test('blocks shell writes to status.yml but allows reads', () => {
  const blocked = [
    'echo "x" > spearhead-attacks/status.yml',
    'sed -i s/todo/done/ spearhead-attacks/status.yml',
    'cat tmp | tee spearhead-attacks/status.yml',
    'Set-Content spearhead-attacks/status.yml "x"',
  ];
  for (const command of blocked) {
    const r = runHook({ tool_name: 'Bash', tool_input: { command } });
    assert.equal(r.code, 2, command);
    assert.match(r.err, /scripts\/state\.js/);
  }
  const allowed = [
    'cat spearhead-attacks/status.yml',
    'node scripts/state.js check --dir .',
    // reads with unrelated redirects must not trip the write detection
    'cat spearhead-attacks/status.yml 2>/dev/null || echo "NO_STATUS_FILE"',
    'ls spearhead-attacks 2>/dev/null; test -f spearhead-attacks/status.yml && echo EXISTS || echo MISSING',
    'grep verify_lock spearhead-attacks/status.yml > /tmp/out',
    'cp spearhead-attacks/status.yml /tmp/backup.yml', // copy FROM it is a read
  ];
  for (const command of allowed) {
    assert.equal(runHook({ tool_name: 'Bash', tool_input: { command } }).code, 0, command);
  }
  // but copy/move ONTO it is a write
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'cp /tmp/backup.yml spearhead-attacks/status.yml' } });
  assert.equal(r.code, 2);
  assert.match(r.err, /scripts\/state\.js/);
});

test('applies shell checks to PowerShell input', () => {
  const r = runHook({ tool_name: 'PowerShell', tool_input: { command: 'git commit --no-verify -m "x"' } });
  assert.equal(r.code, 2);
  assert.match(r.err, /forbids --no-verify/);
});

test('reading Read on status.yml is allowed (only writes are gated)', () => {
  assert.equal(runHook({ tool_name: 'Read', tool_input: { file_path: '/p/spearhead-attacks/status.yml' } }).code, 0);
});

test('safe anywhere: no-ops on benign tools in projects without spearhead-attacks/', () => {
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }).code, 0);
  assert.equal(runHook('not json').code, 0);
});

test('writes the project-hint JSON under KIMI_PLUGIN_ROOT from a tool path, failing soft', () => {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-guard-hint-'));
  const r = runHook(
    { tool_name: 'Read', tool_input: { path: '/proj/spearhead-attacks/plan/PLAN.md' } },
    { KIMI_PLUGIN_ROOT: pluginRoot }
  );
  assert.equal(r.code, 0);
  const hint = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.spearhead-project.json'), 'utf8'));
  assert.equal(hint.projectDir, '/proj');
  // unwritable plugin root must not break the guard
  const r2 = runHook(
    { tool_name: 'Read', tool_input: { path: '/proj/spearhead-attacks/plan/PLAN.md' } },
    { KIMI_PLUGIN_ROOT: path.join(pluginRoot, 'missing', 'nested') }
  );
  assert.equal(r2.code, 0);
});

test('runs its handler when loaded via require() (kimi __plugin_run_node path)', () => {
  const res = spawnSync('node', ['-e', `require(${JSON.stringify(HOOK)})`], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m x' } }),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '' },
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /forbids --no-verify/);
});

test('SPEARHEAD_HOOK_LIB=1 exposes the checkers without running the hook', () => {
  const res = spawnSync('node', ['-e', `
    process.env.SPEARHEAD_HOOK_LIB = '1';
    const g = require(${JSON.stringify(HOOK)});
    console.log(g.isEnvTarget('.env.local'), g.isStatusFile('a/spearhead-attacks/status.yml'));
  `], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), 'true true');
});

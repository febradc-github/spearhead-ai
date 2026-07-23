'use strict';
// Tests for remind.js: the sync guarantee (full injection is byte-identical
// to rules/RULES.md), the refresh cadence (REFRESH_EVERY), the sub-500-char anchor, every
// branch of the project-dir fallback chain (including the silent no-op), and
// both load paths.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, 'remind.js');
const RULES = fs.readFileSync(path.join(__dirname, '..', 'rules', 'RULES.md'), 'utf8');
process.env.SPEARHEAD_HOOK_LIB = '1';
const { REFRESH_EVERY } = require(HOOK); // tests follow the constant, so they cannot drift from it

function runHook(payload, env = {}) {
  const res = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '', ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

function projectDir(withStatus) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-remind-test-'));
  fs.mkdirSync(path.join(dir, 'spearhead-attacks'), { recursive: true });
  if (withStatus) {
    spawnSync('node', [path.join(__dirname, '..', 'scripts', 'state.js'), 'init', 'remind test', '--dir', dir], { encoding: 'utf8' });
  }
  return dir;
}

test('sync: the full injection contains rules/RULES.md byte-for-byte', () => {
  const dir = projectDir(false);
  const r = runHook({ session_id: 's1', cwd: dir });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(RULES), 'injection must contain the exact bytes of rules/RULES.md');
  assert.ok(r.out.endsWith('</important>\n'), 'injection must end with the important block');
  assert.match(r.out, /canonical rules and gate matrix follow/);
});

test('search-first: both the full-rules and anchor variants nudge dispatching the guru agent', () => {
  process.env.SPEARHEAD_HOOK_LIB = '1';
  const { fullMessage, anchor } = require(HOOK);
  assert.match(
    fullMessage(),
    /Before reading source files to answer a question, dispatch the `guru` agent .*to check the knowledge base first/,
    'full-rules variant must carry the guru-first directive'
  );
  assert.match(
    anchor('/nonexistent-project-dir'),
    /Before reading source files to answer a question, dispatch the guru agent .*to check the knowledge base first/,
    'anchor variant must carry the guru-first directive'
  );
  assert.doesNotMatch(fullMessage(), /spearhead-knowledge` search tool/, 'must not reference the old MCP search tool by name');
  assert.doesNotMatch(anchor('/nonexistent-project-dir'), /spearhead-knowledge search tool/, 'must not reference the old MCP search tool by name');
});

test(`cadence: full rules on prompts 1 and ${REFRESH_EVERY + 1}, anchor in between`, () => {
  const dir = projectDir(true);
  const first = runHook({ session_id: 'cad', cwd: dir });
  assert.ok(first.out.includes(RULES), 'prompt 1 gets the full rules');
  for (let i = 2; i <= REFRESH_EVERY; i++) {
    const r = runHook({ session_id: 'cad', cwd: dir });
    assert.ok(!r.out.includes('## Clarification gate rule'), `prompt ${i} gets the anchor`);
    assert.ok(r.out.length > 0 && r.out.length < 500, `anchor stays under 500 chars (was ${r.out.length})`);
  }
  const refresh = runHook({ session_id: 'cad', cwd: dir });
  assert.ok(refresh.out.includes(RULES), `prompt ${REFRESH_EVERY + 1} refreshes the full rules`);
});

test('anchor reflects phase, lock, background and blocked tasks from status.yml', () => {
  process.env.SPEARHEAD_HOOK_LIB = '1';
  const { describe } = require(HOOK);
  const s = {
    attack: { id: 'A-1', state: 'active' },
    verify_lock: 'T-2',
    phases: { understand: 'approved', recon: 'complete', design: 'approved', plan: 'approved', ship: 'pending', retro: 'pending' },
    tasks: [
      { id: 'T-1', status: 'in_progress', mode: 'background' },
      { id: 'T-2', status: 'implemented', mode: 'foreground' },
      { id: 'T-3', status: 'blocked', mode: null },
    ],
  };
  const line = describe(s);
  assert.match(line, /phase=execute\/verify/);
  assert.match(line, /verify_lock=T-2/);
  assert.match(line, /bg: T-1/);
  assert.match(line, /blocked: T-3 \(\/spearhead:unblock\)/);
});

test('without a session id the cadence is still managed by state, not full every prompt', () => {
  const dir = projectDir(true);
  const first = runHook({ cwd: dir }); // no session_id at all (some runtimes omit it)
  assert.ok(first.out.includes(RULES), 'first prompt gets the full rules');
  for (let i = 2; i <= REFRESH_EVERY; i++) {
    const r = runHook({ cwd: dir });
    assert.ok(!r.out.includes('## Clarification gate rule'), `prompt ${i} without a session id gets the anchor`);
  }
  const refresh = runHook({ cwd: dir });
  assert.ok(refresh.out.includes(RULES), `prompt ${REFRESH_EVERY + 1} refreshes the full rules`);
});

test('alternate session id field names are honored', () => {
  process.env.SPEARHEAD_HOOK_LIB = '1';
  const { sessionKeyFrom } = require(HOOK);
  assert.equal(sessionKeyFrom({ session_id: 'a' }), 'a');
  assert.equal(sessionKeyFrom({ sessionId: 'b' }), 'b');
  assert.equal(sessionKeyFrom({ conversation_id: 'c' }), 'c');
  assert.equal(sessionKeyFrom({}), 'default');
  assert.equal(sessionKeyFrom(null), 'default');
});

test('an idle session key is treated as new and gets the full rules again', () => {
  const dir = projectDir(true);
  const statePath = path.join(dir, 'spearhead-attacks', '.remind-state.json');
  const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
  fs.writeFileSync(statePath, JSON.stringify({ sessions: { default: { count: 5, at: thirteenHoursAgo } } }) + '\n');
  const r = runHook({ cwd: dir });
  assert.ok(r.out.includes(RULES), 'a 13h-idle counter resets to prompt 1');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.sessions.default.count, 1);
});

test('fallback chain: payload cwd wins', () => {
  const dir = projectDir(false);
  const r = runHook({ session_id: 's', cwd: dir });
  assert.notEqual(r.out, '');
});

test('fallback chain: tool-input path resolves the project when cwd is absent', () => {
  const dir = projectDir(false);
  const r = runHook({ session_id: 's', tool_input: { file_path: path.join(dir, 'spearhead-attacks', 'plan', 'PLAN.md') } });
  assert.notEqual(r.out, '');
});

test('fallback chain: kimi tool_input.path shape also resolves', () => {
  const dir = projectDir(false);
  const r = runHook({ session_id: 's', tool_input: { path: path.join(dir, 'spearhead-attacks', 'status.yml') } });
  assert.notEqual(r.out, '');
});

test('fallback chain: project-hint JSON in KIMI_PLUGIN_ROOT is the last resort', () => {
  const dir = projectDir(false);
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-remind-hint-'));
  fs.writeFileSync(path.join(pluginRoot, '.spearhead-project.json'), JSON.stringify({ projectDir: dir }) + '\n');
  const r = runHook({ session_id: 's' }, { KIMI_PLUGIN_ROOT: pluginRoot });
  assert.notEqual(r.out, '');
});

test('silent no-op when no source yields a project dir', () => {
  const r = runHook({ session_id: 's' });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  const r2 = runHook('not json');
  assert.equal(r2.code, 0);
  assert.equal(r2.out, '');
});

test('no-op when the resolved project has no spearhead-attacks/ directory', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-remind-bare-'));
  const r = runHook({ session_id: 's', cwd: bare });
  assert.equal(r.out, '');
});

test('never resolves from process.cwd()', () => {
  const dir = projectDir(false); // a valid spearhead project as cwd of the process
  const res = spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({ session_id: 's' }),
    cwd: dir,
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '' },
  });
  assert.equal(res.stdout, '', 'a spearhead-attacks/ dir in process.cwd() must not be picked up');
});

test('runs its handler when loaded via require() (kimi __plugin_run_node path)', () => {
  const dir = projectDir(false);
  const res = spawnSync('node', ['-e', `require(${JSON.stringify(HOOK)})`], {
    encoding: 'utf8',
    input: JSON.stringify({ session_id: 's', cwd: dir }),
    env: { ...process.env, SPEARHEAD_HOOK_LIB: '', KIMI_PLUGIN_ROOT: '' },
  });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes(RULES));
});

'use strict';
// Tests for scripts/state.js: every refusal named in section 9A.4, the happy
// path through the full task lifecycle, and atomicity basics. The CLI is
// exercised as a child process (its real entry path); the shared invariant
// module is exercised via require() with SPEARHEAD_HOOK_LIB=1 (the library
// load path).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.SPEARHEAD_HOOK_LIB = '1';
const inv = require(path.join(__dirname, '..', 'hooks', 'validate-state.js'));
const STATE = path.join(__dirname, 'state.js');

function run(dir, ...args) {
  const res = spawnSync('node', [STATE, ...args, '--dir', dir], { encoding: 'utf8' });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-state-test-'));
}

// Advances a fresh attack to plan-approved so tasks can exist.
function planApproved(dir) {
  assert.equal(run(dir, 'init', 'test attack').code, 0);
  assert.equal(run(dir, 'set-phase', 'understand', 'approved').code, 0);
  assert.equal(run(dir, 'set-phase', 'recon', 'complete').code, 0);
  assert.equal(run(dir, 'set-phase', 'design', 'approved').code, 0);
  assert.equal(run(dir, 'approve-plan', '--base-branch', 'main').code, 0);
}

function dispatch(dir, id) {
  return run(dir, 'transition', id, 'in_progress',
    '--branch', `spearhead/${id}`, '--worktree', `spearhead-attacks/worktrees/${id}`, '--mode', 'foreground');
}

test('init writes a valid status.yml and check passes', () => {
  const dir = freshDir();
  const r = run(dir, 'init', 'my attack');
  assert.equal(r.code, 0);
  assert.match(r.out, /initialized attack A-1/);
  assert.equal(run(dir, 'check').code, 0);
  const text = fs.readFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), 'utf8');
  assert.match(text, /state: active/);
  assert.match(text, /tasks: \[\]/);
  assert.doesNotMatch(text, /execute/, 'phases.execute must not exist anywhere');
});

test('init refuses while an attack is active', () => {
  const dir = freshDir();
  run(dir, 'init', 'one');
  const r = run(dir, 'init', 'two');
  assert.equal(r.code, 1);
  assert.match(r.err, /REFUSED: attack-active/);
});

test('phase skipping is refused by name', () => {
  const dir = freshDir();
  run(dir, 'init', 't');
  const r = run(dir, 'set-phase', 'design', 'approved');
  assert.equal(r.code, 1);
  assert.match(r.err, /phase-order: design is approved but recon is not complete/);
});

test('phase regression is refused', () => {
  const dir = freshDir();
  run(dir, 'init', 't');
  run(dir, 'set-phase', 'understand', 'approved');
  const r = run(dir, 'set-phase', 'understand', 'pending');
  assert.equal(r.code, 1);
  assert.match(r.err, /phase-regression/);
});

test('invalid phase enum is refused', () => {
  const dir = freshDir();
  run(dir, 'init', 't');
  const r = run(dir, 'set-phase', 'recon', 'approved');
  assert.equal(r.code, 1);
  assert.match(r.err, /invalid-enum: phases\.recon "approved"/);
});

test('plan approval must go through approve-plan (records base_branch)', () => {
  const dir = freshDir();
  run(dir, 'init', 't');
  run(dir, 'set-phase', 'understand', 'approved');
  run(dir, 'set-phase', 'recon', 'complete');
  run(dir, 'set-phase', 'design', 'approved');
  const r = run(dir, 'set-phase', 'plan', 'approved');
  assert.equal(r.code, 1);
  assert.match(r.err, /use-approve-plan/);
  assert.equal(run(dir, 'approve-plan', '--base-branch', 'main').code, 0);
});

test('tasks before plan approval are refused', () => {
  const dir = freshDir();
  run(dir, 'init', 't');
  const r = run(dir, 'add-task', 'too early');
  assert.equal(r.code, 1);
  assert.match(r.err, /tasks-before-plan/);
});

test('task ids come from the monotonic counter', () => {
  const dir = freshDir();
  planApproved(dir);
  assert.match(run(dir, 'add-task', 'first').out, /added T-1/);
  assert.match(run(dir, 'add-task', 'second').out, /added T-2/);
  run(dir, 'remove-task', 'T-2');
  assert.match(run(dir, 'add-task', 'third').out, /added T-3/, 'removed ids are never reused');
});

test('transition refuses moves not in the matrix', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  const r = run(dir, 'transition', 'T-1', 'done');
  assert.equal(r.code, 1);
  assert.match(r.err, /invalid-transition: T-1 todo -> done is not in the transition matrix/);
});

test('every from->to pair outside the matrix is refused (library)', () => {
  const statuses = ['todo', 'in_progress', 'implemented', 'blocked', 'done'];
  for (const from of statuses) {
    for (const to of statuses) {
      if (from === to) continue;
      const s = {
        attack: { id: 'A-1', state: 'active' }, attack_counter: 1, counter: 2,
        base_branch: 'main', verify_lock: to === 'done' || (from === 'implemented' && to === 'in_progress') ? 'T-1' : null,
        phases: { understand: 'approved', recon: 'complete', design: 'approved', plan: 'approved', ship: 'pending', retro: 'pending' },
        tasks: [{ id: 'T-1', status: from, depends_on: [], files: [], parallel_approved: false, attempts: 0, verify_attempts: 0 }],
      };
      const problem = inv.checkTransition(s, 'T-1', to);
      if (inv.TRANSITIONS[`${from}->${to}`]) {
        assert.equal(problem, null, `${from} -> ${to} should be allowed`);
      } else {
        assert.match(problem, /invalid-transition/, `${from} -> ${to} should be refused`);
      }
    }
  }
});

test('dispatch requires branch, worktree and mode', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  const r = run(dir, 'transition', 'T-1', 'in_progress');
  assert.equal(r.code, 1);
  assert.match(r.err, /dispatch-incomplete/);
  assert.equal(dispatch(dir, 'T-1').code, 0);
});

test('implemented -> done is unreachable without the verify lock', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  dispatch(dir, 'T-1');
  run(dir, 'transition', 'T-1', 'implemented');
  const r = run(dir, 'transition', 'T-1', 'done');
  assert.equal(r.code, 1);
  assert.match(r.err, /verify-lock-required/);
  run(dir, 'lock', 'T-1');
  const r2 = run(dir, 'transition', 'T-1', 'done');
  assert.equal(r2.code, 0);
  const text = fs.readFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), 'utf8');
  assert.match(text, /worktree: null/, 'done clears the worktree');
  assert.equal(run(dir, 'unlock').code, 0);
});

test('implemented -> in_progress (verify failure) also requires the lock', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  dispatch(dir, 'T-1');
  run(dir, 'transition', 'T-1', 'implemented');
  const r = run(dir, 'transition', 'T-1', 'in_progress');
  assert.equal(r.code, 1);
  assert.match(r.err, /verify-lock-required/);
});

test('taking the verify lock while held is refused', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  run(dir, 'add-task', 't2');
  dispatch(dir, 'T-1');
  run(dir, 'transition', 'T-1', 'implemented');
  run(dir, 'lock', 'T-1');
  const r = run(dir, 'lock', 'T-2');
  assert.equal(r.code, 1);
  assert.match(r.err, /lock-held: verify_lock is held by T-1/);
});

test('locking a task that is not implemented is refused', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  const r = run(dir, 'lock', 'T-1');
  assert.equal(r.code, 1);
  assert.match(r.err, /not-implemented/);
});

test('attempts beyond 2 are refused', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  assert.equal(run(dir, 'bump-attempts', 'T-1').code, 0);
  assert.equal(run(dir, 'bump-attempts', 'T-1').code, 0);
  const r = run(dir, 'bump-attempts', 'T-1');
  assert.equal(r.code, 1);
  assert.match(r.err, /attempts-exceeded/);
});

test('blocked -> todo resets attempts; --reset also clears the dispatch fields', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  dispatch(dir, 'T-1');
  run(dir, 'bump-attempts', 'T-1');
  run(dir, 'bump-attempts', 'T-1');
  run(dir, 'transition', 'T-1', 'blocked');
  assert.equal(run(dir, 'transition', 'T-1', 'todo', '--reset').code, 0);
  const text = fs.readFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), 'utf8');
  assert.match(text, /attempts: 0/);
  assert.match(text, /branch: null/);
});

test('a second in_progress task without parallel_approved is refused', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1', '--files', 'src/a.js');
  run(dir, 'add-task', 't2', '--files', 'src/b.js');
  dispatch(dir, 'T-1');
  const r = dispatch(dir, 'T-2');
  assert.equal(r.code, 1);
  assert.match(r.err, /parallel-unapproved/);
});

test('parallel dispatch with unmet depends_on is refused', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1', '--files', 'src/a.js');
  run(dir, 'add-task', 't2', '--files', 'src/b.js');
  run(dir, 'add-task', 't3', '--files', 'src/c.js', '--depends', 'T-2');
  dispatch(dir, 'T-1');
  run(dir, 'set-parallel', 'T-3');
  const r = dispatch(dir, 'T-3');
  assert.equal(r.code, 1);
  assert.match(r.err, /parallel-deps-unmet: T-3 .* depends on T-2/);
});

test('parallel dispatch with overlapping file sets is refused (glob case)', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1', '--files', 'src/auth/**');
  run(dir, 'add-task', 't2', '--files', 'src/auth/token.js');
  dispatch(dir, 'T-1');
  run(dir, 'set-parallel', 'T-2');
  const r = dispatch(dir, 'T-2');
  assert.equal(r.code, 1);
  assert.match(r.err, /parallel-files-overlap: T-1 and T-2 overlap on src\/auth\/\*\* ~ src\/auth\/token\.js/);
});

test('an approved disjoint parallel dispatch succeeds', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1', '--files', 'src/auth/**');
  run(dir, 'add-task', 't2', '--files', 'src/billing/**');
  dispatch(dir, 'T-1');
  run(dir, 'set-parallel', 'T-2');
  assert.equal(dispatch(dir, 'T-2').code, 0);
});

test('ship is refused until every task is done (derived, never stored)', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  const r = run(dir, 'set-phase', 'ship', 'complete');
  assert.equal(r.code, 1);
  assert.match(r.err, /execute-incomplete/);
  dispatch(dir, 'T-1');
  run(dir, 'transition', 'T-1', 'implemented');
  run(dir, 'lock', 'T-1');
  run(dir, 'transition', 'T-1', 'done');
  run(dir, 'unlock');
  assert.equal(run(dir, 'set-phase', 'ship', 'complete').code, 0);
});

test('replan commands refuse tasks that are not todo or blocked, and removals with dependents', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  run(dir, 'add-task', 't2', '--depends', 'T-1');
  dispatch(dir, 'T-1');
  const r1 = run(dir, 'edit-task', 'T-1', '--title', 'new');
  assert.equal(r1.code, 1);
  assert.match(r1.err, /replan-scope: T-1 is in_progress/);
  const r2 = run(dir, 'remove-task', 'T-1');
  assert.equal(r2.code, 1);
  assert.match(r2.err, /replan-scope/);
  const r3 = run(dir, 'remove-task', 'T-2');
  assert.equal(r3.code, 0);
});

test('remove-task refuses when other tasks depend on it', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  run(dir, 'add-task', 't2', '--depends', 'T-1');
  const r = run(dir, 'remove-task', 'T-1');
  assert.equal(r.code, 1);
  assert.match(r.err, /has-dependents: T-2/);
});

test('add-task with unknown or cyclic depends_on is refused', () => {
  const dir = freshDir();
  planApproved(dir);
  const r = run(dir, 'add-task', 't1', '--depends', 'T-9');
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown-dependency: T-1 depends on T-9/);
  run(dir, 'add-task', 't1');
  // self-dependency is the smallest cycle: the new task would be T-2
  const r2 = run(dir, 'add-task', 't2', '--depends', 'T-2');
  assert.equal(r2.code, 1);
  assert.match(r2.err, /depends-on-self/);
  const check = run(dir, 'check');
  assert.equal(check.code, 0, 'refusals must not have corrupted the file');
  // a two-task cycle via replan edits
  run(dir, 'add-task', 't2');
  run(dir, 'add-task', 't3');
  const r3 = run(dir, 'edit-task', 'T-1', '--depends', 'T-3');
  assert.equal(r3.code, 0);
  const r4 = run(dir, 'edit-task', 'T-3', '--depends', 'T-1');
  assert.equal(r4.code, 1);
  assert.match(r4.err, /dependency-cycle/);
});

test('abort records the reason and bumps attack_counter', () => {
  const dir = freshDir();
  run(dir, 'init', 't');
  const r = run(dir, 'abort', 'wrong problem');
  assert.equal(r.code, 0);
  assert.match(r.out, /next attack is A-2/);
  const text = fs.readFileSync(path.join(dir, 'spearhead-attacks', 'status.yml'), 'utf8');
  assert.match(text, /state: aborted/);
  assert.match(text, /reason: "wrong problem"/);
  assert.equal(run(dir, 'init', 'again', '--attack-counter', '2').code, 0);
});

test('show reports execute completeness as derived', () => {
  const dir = freshDir();
  planApproved(dir);
  run(dir, 'add-task', 't1');
  const shown = JSON.parse(run(dir, 'show').out);
  assert.equal(shown.execute_complete, false);
  assert.equal(shown.tasks[0].id, 'T-1');
});

// --- invariant module (library load path) ---

function validStatus() {
  return {
    attack: { id: 'A-1', title: 't', started: '2026-07-20', state: 'active', gitignore_declined: false },
    attack_counter: 1, counter: 3, base_branch: 'main', verify_lock: null,
    phases: { understand: 'approved', recon: 'complete', design: 'approved', plan: 'approved', ship: 'pending', retro: 'pending' },
    tasks: [
      { id: 'T-1', title: 'a', status: 'todo', mode: null, branch: null, worktree: null, dispatched_at: null, depends_on: [], files: ['src/a.js'], parallel_approved: false, attempts: 0, verify_attempts: 0 },
      { id: 'T-2', title: 'b', status: 'todo', mode: null, branch: null, worktree: null, dispatched_at: null, depends_on: ['T-1'], files: ['src/b.js'], parallel_approved: false, attempts: 0, verify_attempts: 0 },
    ],
  };
}

test('invariants: duplicate task ids are reported', () => {
  const s = validStatus();
  s.tasks[1].id = 'T-1';
  assert.ok(inv.checkInvariants(s).some((p) => p.startsWith('duplicate-task-id: T-1')));
});

test('invariants: dependency cycles are reported', () => {
  const s = validStatus();
  s.tasks[0].depends_on = ['T-2'];
  assert.ok(inv.checkInvariants(s).some((p) => p.startsWith('dependency-cycle')));
});

test('invariants: invalid task status enum is reported', () => {
  const s = validStatus();
  s.tasks[0].status = 'doing';
  assert.ok(inv.checkInvariants(s).some((p) => p.includes('T-1.status "doing"')));
});

test('invariants: task id at or above counter is reported', () => {
  const s = validStatus();
  s.tasks[1].id = 'T-7';
  assert.ok(inv.checkInvariants(s).some((p) => p.startsWith('id-counter: T-7')));
});

test('invariants: verify_lock naming a missing task is reported', () => {
  const s = validStatus();
  s.verify_lock = 'T-9';
  assert.ok(inv.checkInvariants(s).some((p) => p.startsWith('invalid-lock')));
});

test('globOverlap: literals, glob-vs-path, glob-vs-glob', () => {
  assert.equal(inv.globOverlap('src/a.js', 'src/a.js'), true);
  assert.equal(inv.globOverlap('src/a.js', 'src/b.js'), false);
  assert.equal(inv.globOverlap('src/auth/**', 'src/auth/token.js'), true);
  assert.equal(inv.globOverlap('src/auth/*.js', 'src/auth/deep/x.js'), false);
  assert.equal(inv.globOverlap('src/auth/**', 'src/auth/**/session.js'), true);
  assert.equal(inv.globOverlap('src/auth/**', 'src/billing/**'), false);
});

test('serialize/parse round-trips a full status', () => {
  const s = validStatus();
  const { status, errors } = inv.parseStatus(inv.serializeStatus(s));
  assert.deepEqual(errors, []);
  assert.deepEqual(status, s);
  assert.deepEqual(inv.checkInvariants(status), []);
});

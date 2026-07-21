#!/usr/bin/env node
'use strict';
// The ONLY sanctioned writer of spearhead/status.yml. Skills never hand-edit
// the status file; they run this CLI, which loads the current file, applies
// one mutation, validates the RESULT against the section 7 invariants and the
// task transition matrix, and only then writes atomically (temp + rename).
// On refusal it prints the violated invariant by name and exits 1.
//
// guard.js (PreToolUse) blocks raw Write/Edit to status.yml so this path
// cannot be bypassed accidentally; validate-state.js (PostToolUse) is the
// detection net behind both.
//
// Usage: node scripts/state.js <command> [args] [--dir <projectDir>]
//   init "<title>" [--attack-counter N]     create a fresh status.yml
//   set-phase <phase> <value>               advance a phase gate
//   approve-plan --base-branch <name>       plan: approved + record base_branch
//   add-task "<title>" [--depends a,b] [--files "x,y"]   (plan approved only)
//   edit-task T-n [--title t] [--depends a,b] [--files "x,y"]  (todo|blocked)
//   remove-task T-n                          (todo|blocked, not depended on)
//   transition T-n <status> [--branch B --worktree W --mode M] [--reset]
//   set-parallel T-n                        record explicit parallel approval
//   bump-attempts T-n                       refuse past 2
//   bump-verify T-n                         next verification attempt number
//   lock T-n / unlock                       verify_lock
//   set-gitignore-declined
//   abort "<reason>"                        attack aborted + bump attack_counter
//   set-attack-complete                     attack complete + bump attack_counter
//   check                                   validate the current file
//   show                                    derived summary as JSON
//
// Dependency-free: Node built-ins only. No network.

process.env.SPEARHEAD_HOOK_LIB = '1'; // import the invariant module without running its hook half
const fs = require('node:fs');
const path = require('node:path');
const inv = require(path.join(__dirname, '..', 'hooks', 'validate-state.js'));

function fail(msg) {
  process.stderr.write(`REFUSED: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  process.stdout.write(`OK: ${msg}\n`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'reset' || key === 'gitignore-declined') flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(a);
  }
  return { positional, flags };
}

function statusPath(dir) {
  return path.join(dir, 'spearhead', 'status.yml');
}

function load(dir) {
  const file = statusPath(dir);
  if (!fs.existsSync(file)) fail(`no-status-file: ${file} does not exist; run the understand phase (or \`state.js init\`) first`);
  const { status, errors } = inv.parseStatus(fs.readFileSync(file, 'utf8'));
  if (errors.length) fail(`corrupt-status-file: ${errors.join('; ')}`);
  return status;
}

// Validates the mutated status and writes it atomically, or refuses.
function save(dir, status, summary) {
  const problems = inv.checkInvariants(status);
  if (problems.length) fail(problems.join('; '));
  const file = statusPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, inv.serializeStatus(status));
  fs.renameSync(tmp, file);
  ok(summary);
}

function findTask(status, id) {
  const t = status.tasks.find((x) => x.id === id);
  if (!t) fail(`unknown-task: ${id} does not exist`);
  return t;
}

function splitList(v) {
  return v == null || v === '' ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const dir = flags.dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  switch (cmd) {
    case 'init': {
      const file = statusPath(dir);
      if (fs.existsSync(file)) {
        const { status: existing, errors } = inv.parseStatus(fs.readFileSync(file, 'utf8'));
        if (errors.length === 0 && existing.attack && existing.attack.state === 'active') {
          fail(`attack-active: ${existing.attack.id} is still active; finish it (/spearhead:retro) or abort it (/spearhead:abort) first`);
        }
      }
      const attackCounter = flags['attack-counter'] ? parseInt(flags['attack-counter'], 10) : 1;
      const status = {
        attack: {
          id: `A-${attackCounter}`,
          title: positional[1] || '',
          started: new Date().toISOString().slice(0, 10),
          state: 'active',
          gitignore_declined: false,
        },
        attack_counter: attackCounter,
        counter: 1,
        base_branch: null,
        verify_lock: null,
        phases: { understand: 'pending', recon: 'pending', design: 'pending', plan: 'pending', ship: 'pending', retro: 'pending' },
        tasks: [],
      };
      return save(dir, status, `initialized attack A-${attackCounter}`);
    }
    case 'set-phase': {
      const [, phase, value] = positional;
      const status = load(dir);
      if (!inv.PHASE_ORDER.includes(phase)) fail(`unknown-phase: "${phase}"`);
      const enums = inv.PHASE_ENUMS[phase];
      if (!enums.includes(value)) fail(`invalid-enum: phases.${phase} "${value}" (valid: ${enums.join(', ')})`);
      const from = status.phases[phase];
      if (enums.indexOf(value) < enums.indexOf(from)) fail(`phase-regression: phases.${phase} may only advance (${from} -> ${value})`);
      if (phase === 'plan' && value === 'approved') fail('use-approve-plan: plan approval must record base_branch; run `approve-plan --base-branch <name>`');
      if (phase === 'ship' && value === 'complete') {
        const allDone = status.tasks.length > 0 && status.tasks.every((t) => t.status === 'done');
        if (!allDone) fail('execute-incomplete: ship requires every task done (derived from task states, never stored)');
      }
      status.phases[phase] = value;
      return save(dir, status, `phases.${phase} = ${value}`);
    }
    case 'approve-plan': {
      const status = load(dir);
      if (!flags['base-branch']) fail('missing-base-branch: approve-plan requires --base-branch <name>');
      if (status.phases.plan === 'approved') fail('phase-regression: plan is already approved');
      status.phases.plan = 'approved';
      status.base_branch = flags['base-branch'];
      return save(dir, status, `plan approved; base_branch = ${status.base_branch}`);
    }
    case 'add-task': {
      const status = load(dir);
      if (status.phases.plan !== 'approved') fail('tasks-before-plan: tasks may exist only when plan is approved');
      const id = `T-${status.counter}`;
      status.counter += 1;
      status.tasks.push({
        id,
        title: positional[1] || '',
        status: 'todo',
        mode: null,
        branch: null,
        worktree: null,
        dispatched_at: null,
        depends_on: splitList(flags.depends),
        files: splitList(flags.files),
        parallel_approved: false,
        attempts: 0,
        verify_attempts: 0,
      });
      return save(dir, status, `added ${id} (todo)`);
    }
    case 'edit-task': {
      const status = load(dir);
      const t = findTask(status, positional[1]);
      if (t.status !== 'todo' && t.status !== 'blocked') fail(`replan-scope: ${t.id} is ${t.status}; replan may only amend todo or blocked tasks`);
      if (flags.title != null) t.title = flags.title;
      if (flags.depends != null) t.depends_on = splitList(flags.depends);
      if (flags.files != null) t.files = splitList(flags.files);
      return save(dir, status, `edited ${t.id}`);
    }
    case 'remove-task': {
      const status = load(dir);
      const t = findTask(status, positional[1]);
      if (t.status !== 'todo' && t.status !== 'blocked') fail(`replan-scope: ${t.id} is ${t.status}; replan may only remove todo or blocked tasks`);
      const dependents = status.tasks.filter((x) => (x.depends_on || []).includes(t.id));
      if (dependents.length) fail(`has-dependents: ${dependents.map((x) => x.id).join(', ')} depend on ${t.id}; amend them first`);
      status.tasks = status.tasks.filter((x) => x.id !== t.id);
      return save(dir, status, `removed ${t.id}`);
    }
    case 'transition': {
      const [, id, to] = positional;
      const status = load(dir);
      const t = findTask(status, id);
      const problem = inv.checkTransition(status, id, to);
      if (problem) fail(problem);
      if (to === 'in_progress' && t.status === 'todo') {
        if (!flags.branch || !flags.worktree || !flags.mode) {
          fail(`dispatch-incomplete: todo -> in_progress requires --branch, --worktree, and --mode (foreground|background)`);
        }
        t.branch = flags.branch;
        t.worktree = flags.worktree;
        t.mode = flags.mode;
        t.dispatched_at = new Date().toISOString();
      }
      if (to === 'done') t.worktree = null;
      if (to === 'todo') {
        t.attempts = 0;
        if (flags.reset) {
          t.branch = null;
          t.worktree = null;
          t.mode = null;
          t.dispatched_at = null;
          t.parallel_approved = false;
        }
      }
      t.status = to;
      return save(dir, status, `${id} -> ${to}`);
    }
    case 'set-parallel': {
      const status = load(dir);
      const t = findTask(status, positional[1]);
      t.parallel_approved = true;
      return save(dir, status, `${t.id} parallel_approved`);
    }
    case 'bump-attempts': {
      const status = load(dir);
      const t = findTask(status, positional[1]);
      if (t.attempts >= 2) fail(`attempts-exceeded: ${t.id} already used 2 repair attempts; the retry policy requires blocking the task, not retrying`);
      t.attempts += 1;
      return save(dir, status, `${t.id} attempts = ${t.attempts}`);
    }
    case 'bump-verify': {
      const status = load(dir);
      const t = findTask(status, positional[1]);
      t.verify_attempts += 1;
      return save(dir, status, `${t.id} verify attempt = ${t.verify_attempts}`);
    }
    case 'lock': {
      const status = load(dir);
      const t = findTask(status, positional[1]);
      if (status.verify_lock != null) fail(`lock-held: verify_lock is held by ${status.verify_lock}; verification is sequential (stale? /spearhead:unblock --lock)`);
      if (t.status !== 'implemented') fail(`not-implemented: ${t.id} is ${t.status}; only implemented tasks can be verified`);
      status.verify_lock = t.id;
      return save(dir, status, `verify_lock = ${t.id}`);
    }
    case 'unlock': {
      const status = load(dir);
      if (status.verify_lock == null) fail('lock-free: verify_lock is not held');
      const was = status.verify_lock;
      status.verify_lock = null;
      return save(dir, status, `verify_lock released (was ${was})`);
    }
    case 'set-gitignore-declined': {
      const status = load(dir);
      status.attack.gitignore_declined = true;
      return save(dir, status, 'gitignore_declined recorded');
    }
    case 'abort': {
      const status = load(dir);
      if (status.attack.state !== 'active') fail(`not-active: attack is ${status.attack.state}`);
      status.attack.state = 'aborted';
      status.attack.reason = positional[1] || 'no reason given';
      status.attack_counter += 1;
      return save(dir, status, `attack ${status.attack.id} aborted; next attack is A-${status.attack_counter}`);
    }
    case 'set-attack-complete': {
      const status = load(dir);
      if (status.phases.retro !== 'complete') fail('phase-order: attack completion requires retro complete');
      status.attack.state = 'complete';
      status.attack_counter += 1;
      return save(dir, status, `attack ${status.attack.id} complete; next attack is A-${status.attack_counter}`);
    }
    case 'check': {
      const status = load(dir);
      const problems = inv.checkInvariants(status);
      if (problems.length) fail(problems.join('; '));
      return ok('status.yml satisfies every invariant');
    }
    case 'show': {
      const status = load(dir);
      const allDone = status.tasks.length > 0 && status.tasks.every((t) => t.status === 'done');
      process.stdout.write(
        JSON.stringify(
          {
            attack: status.attack,
            phases: status.phases,
            execute_complete: allDone, // derived, never stored
            base_branch: status.base_branch,
            verify_lock: status.verify_lock,
            tasks: status.tasks.map((t) => ({
              id: t.id, title: t.title, status: t.status, mode: t.mode,
              depends_on: t.depends_on, files: t.files,
              parallel_approved: t.parallel_approved, attempts: t.attempts,
              verify_attempts: t.verify_attempts, dispatched_at: t.dispatched_at,
              branch: t.branch, worktree: t.worktree,
            })),
          },
          null,
          2
        ) + '\n'
      );
      return;
    }
    default:
      fail(`unknown-command: "${cmd}" (see the usage comment at the top of scripts/state.js)`);
  }
}

module.exports = { main };
if (require.main === module) main();

#!/usr/bin/env node
'use strict';
// Shared invariant module + PostToolUse detection net for spearhead/status.yml.
//
// Two roles in one file (rule: enforcement and detection share one
// implementation):
//   1. Library: exports the status.yml parser, serializer, invariant checker,
//      and transition matrix consumed by scripts/state.js (the only sanctioned
//      writer) and by remind.js.
//   2. Hook: as a PostToolUse hook it is a DETECTION NET, not enforcement --
//      raw writes to status.yml are blocked upstream by guard.js (PreToolUse)
//      and skills mutate only through scripts/state.js. If a raw write slips
//      through anyway, this hook re-checks every invariant and loudly reports
//      corruption into the session (exit 2). It never auto-repairs.
//
// Load paths: executed directly (Claude Code) and loaded via require() by
// kimi-code's __plugin_run_node shim, which bypasses require.main === module.
// The handler therefore runs on load UNLESS SPEARHEAD_HOOK_LIB=1 is set --
// that is how scripts/state.js and the tests import the library half without
// starting a stdin listener.
//
// Dependency-free: Node built-ins only. No network.

const fs = require('node:fs');
const path = require('node:path');

const ATTACK_STATES = ['active', 'aborted', 'complete'];
const PHASE_ENUMS = {
  understand: ['pending', 'in_dialogue', 'approved'],
  recon: ['pending', 'complete'],
  design: ['pending', 'approved'],
  plan: ['pending', 'approved'],
  ship: ['pending', 'complete'],
  retro: ['pending', 'complete'],
};
const PHASE_ORDER = ['understand', 'recon', 'design', 'plan', 'ship', 'retro'];
const TASK_STATUSES = ['todo', 'in_progress', 'implemented', 'blocked', 'done'];
const TASK_MODES = [null, 'foreground', 'background'];

// Task transition matrix (section 7 of the spec). Key: "<from>-><to>".
// `lock` means the transition is valid only while verify_lock names the task,
// which makes implemented->done reachable only through the verify skill.
const TRANSITIONS = {
  'todo->in_progress': {},
  'in_progress->implemented': {},
  'in_progress->blocked': {},
  'implemented->in_progress': { lock: true },
  'implemented->done': { lock: true },
  'blocked->todo': {},
};

// ---------------------------------------------------------------------------
// YAML subset parse/serialize. status.yml is machine-written with a fixed
// schema, so a tiny structural parser is enough -- no YAML dependency.

function parseScalar(raw) {
  const v = raw.trim();
  if (v === 'null' || v === '~' || v === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  const m = v.match(/^"(.*)"$/) || v.match(/^'(.*)'$/);
  return m ? m[1] : v;
}

// Parses the fixed status.yml shape. Returns { status, errors }; a non-empty
// errors array means the file is structurally corrupt.
function parseStatus(text) {
  const errors = [];
  const status = { attack: {}, phases: {}, tasks: [] };
  const lines = String(text).split(/\r?\n/);
  let section = null; // 'attack' | 'phases' | 'tasks' | null
  let task = null;
  let listField = null; // name of the task list field collecting block items
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    let m;
    if ((m = line.match(/^(\w+):\s*(.*)$/))) {
      task = null;
      listField = null;
      const [, key, rest] = m;
      if (key === 'attack' || key === 'phases') {
        section = key;
      } else if (key === 'tasks') {
        section = 'tasks';
        if (rest.trim() === '[]') section = null;
        else if (rest.trim() !== '') errors.push(`tasks: expected a block list, got "${rest.trim()}"`);
      } else {
        section = null;
        status[key] = parseScalar(rest);
      }
    } else if ((m = line.match(/^  - id:\s*(.*)$/)) && section === 'tasks') {
      task = { depends_on: [], files: [] };
      task.id = parseScalar(m[1]);
      status.tasks.push(task);
      listField = null;
    } else if ((m = line.match(/^    (\w+):\s*(.*)$/)) && section === 'tasks' && task) {
      const [, key, rest] = m;
      if (rest.trim() === '' || rest.trim() === '[]') {
        task[key] = [];
        listField = rest.trim() === '' ? key : null;
      } else {
        task[key] = parseScalar(rest);
        listField = null;
      }
    } else if ((m = line.match(/^      - (.*)$/)) && task && listField) {
      task[listField].push(parseScalar(m[1]));
    } else if ((m = line.match(/^  (\w+):\s*(.*)$/)) && (section === 'attack' || section === 'phases')) {
      status[section][m[1]] = parseScalar(m[2]);
    } else {
      errors.push(`line ${i + 1}: unrecognized structure: "${line.trim()}"`);
    }
  }
  return { status, errors };
}

function quote(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  // ids, branches, dates, enum values are safe bare; anything else quoted
  return /^[A-Za-z0-9_./:*?-]+$/.test(v) ? v : quote(v);
}

function serializeStatus(s) {
  const out = [];
  out.push('attack:');
  out.push(`  id: ${scalar(s.attack.id)}`);
  out.push(`  title: ${quote(s.attack.title == null ? '' : s.attack.title)}`);
  out.push(`  started: ${scalar(s.attack.started)}`);
  out.push(`  state: ${scalar(s.attack.state)}`);
  out.push(`  gitignore_declined: ${scalar(!!s.attack.gitignore_declined)}`);
  if (s.attack.reason != null) out.push(`  reason: ${quote(s.attack.reason)}`);
  out.push(`attack_counter: ${scalar(s.attack_counter)}`);
  out.push(`counter: ${scalar(s.counter)}`);
  out.push(`base_branch: ${scalar(s.base_branch)}`);
  out.push(`verify_lock: ${scalar(s.verify_lock)}`);
  out.push('phases:');
  for (const p of PHASE_ORDER) out.push(`  ${p}: ${scalar(s.phases[p])}`);
  if (!s.tasks || s.tasks.length === 0) {
    out.push('tasks: []');
  } else {
    out.push('tasks:');
    for (const t of s.tasks) {
      out.push(`  - id: ${scalar(t.id)}`);
      out.push(`    title: ${quote(t.title == null ? '' : t.title)}`);
      out.push(`    status: ${scalar(t.status)}`);
      out.push(`    mode: ${scalar(t.mode)}`);
      out.push(`    branch: ${scalar(t.branch)}`);
      out.push(`    worktree: ${scalar(t.worktree)}`);
      out.push(`    dispatched_at: ${scalar(t.dispatched_at)}`);
      out.push(t.depends_on.length ? '    depends_on:' : '    depends_on: []');
      for (const d of t.depends_on) out.push(`      - ${scalar(d)}`);
      out.push(t.files.length ? '    files:' : '    files: []');
      for (const f of t.files) out.push(`      - ${scalar(f)}`);
      out.push(`    parallel_approved: ${scalar(!!t.parallel_approved)}`);
      out.push(`    attempts: ${scalar(t.attempts)}`);
      out.push(`    verify_attempts: ${scalar(t.verify_attempts)}`);
    }
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Expected-file-set overlap (paths and globs). Conservative: prefers a false
// "overlap" over a missed collision, because the only cost of a false
// positive is a trip through /spearhead:replan.

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // `**/` also matches zero directories
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function isGlob(p) {
  return /[*?]/.test(p);
}

function staticPrefix(p) {
  const idx = p.search(/[*?]/);
  return idx === -1 ? p : p.slice(0, idx);
}

// True when the two patterns/paths could name a common file.
function globOverlap(a, b) {
  if (!isGlob(a) && !isGlob(b)) return a === b;
  if (isGlob(a) && !isGlob(b)) return globToRegExp(a).test(b);
  if (!isGlob(a) && isGlob(b)) return globToRegExp(b).test(a);
  // glob vs glob: overlap when either static prefix extends the other
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// Returns [pathA, pathB] pairs that overlap between two expected-file sets.
function filesOverlap(setA, setB) {
  const pairs = [];
  for (const a of setA || []) {
    for (const b of setB || []) {
      if (globOverlap(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Invariants (section 7). Returns an array of named problems; empty = valid.

function checkInvariants(s) {
  const problems = [];
  const say = (name, detail) => problems.push(`${name}: ${detail}`);

  if (!s || typeof s !== 'object') return ['invalid-structure: status is not an object'];
  const attack = s.attack || {};
  const phases = s.phases || {};
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];

  if (!/^A-\d+$/.test(String(attack.id))) say('invalid-enum', `attack.id "${attack.id}" is not A-<n>`);
  if (!ATTACK_STATES.includes(attack.state)) say('invalid-enum', `attack.state "${attack.state}"`);
  if (!Number.isInteger(s.attack_counter) || s.attack_counter < 1) say('invalid-enum', `attack_counter "${s.attack_counter}"`);
  if (!Number.isInteger(s.counter) || s.counter < 1) say('invalid-enum', `counter "${s.counter}"`);

  for (const p of PHASE_ORDER) {
    if (!PHASE_ENUMS[p].includes(phases[p])) say('invalid-enum', `phases.${p} "${phases[p]}"`);
  }

  // Phase values may only advance in pipeline order: a later phase may not be
  // past pending while an earlier gate is unmet.
  const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'done');
  if (phases.recon === 'complete' && phases.understand !== 'approved') say('phase-order', 'recon is complete but understand is not approved');
  if (phases.design === 'approved' && phases.recon !== 'complete') say('phase-order', 'design is approved but recon is not complete');
  if (phases.plan === 'approved' && phases.design !== 'approved') say('phase-order', 'plan is approved but design is not approved');
  if (phases.ship === 'complete' && phases.plan !== 'approved') say('phase-order', 'ship is complete but plan is not approved');
  if (phases.ship === 'complete' && !allDone) say('phase-order', 'ship is complete but not every task is done (execute completeness is derived from task states)');
  if (phases.retro === 'complete' && phases.ship !== 'complete') say('phase-order', 'retro is complete but ship is not complete');
  if (attack.state === 'complete' && phases.retro !== 'complete') say('phase-order', 'attack is complete but retro is not complete');

  if (tasks.length > 0 && phases.plan !== 'approved') say('tasks-before-plan', 'tasks exist but plan is not approved');
  if (phases.plan === 'approved' && (s.base_branch == null || s.base_branch === '')) say('missing-base-branch', 'plan is approved but base_branch is not recorded');

  const ids = new Set();
  for (const t of tasks) {
    const m = /^T-(\d+)$/.exec(String(t.id));
    if (!m) {
      say('invalid-task-id', `"${t.id}" is not T-<n>`);
      continue;
    }
    if (ids.has(t.id)) say('duplicate-task-id', t.id);
    ids.add(t.id);
    if (parseInt(m[1], 10) >= s.counter) say('id-counter', `${t.id} is not below counter ${s.counter} (ids come from the monotonic counter)`);
    if (!TASK_STATUSES.includes(t.status)) say('invalid-enum', `${t.id}.status "${t.status}"`);
    if (!TASK_MODES.includes(t.mode)) say('invalid-enum', `${t.id}.mode "${t.mode}"`);
    if (typeof t.parallel_approved !== 'boolean') say('invalid-enum', `${t.id}.parallel_approved "${t.parallel_approved}"`);
    if (!Number.isInteger(t.attempts) || t.attempts < 0) say('invalid-enum', `${t.id}.attempts "${t.attempts}"`);
    else if (t.attempts > 2) say('attempts-exceeded', `${t.id}.attempts ${t.attempts} > 2 (the retry policy allows at most 2 repair attempts)`);
    if (!Number.isInteger(t.verify_attempts) || t.verify_attempts < 0) say('invalid-enum', `${t.id}.verify_attempts "${t.verify_attempts}"`);
    if (t.status === 'in_progress' && (!t.branch || !t.worktree || !t.dispatched_at)) {
      say('dispatch-incomplete', `${t.id} is in_progress without branch, worktree, and dispatched_at`);
    }
    if (t.status === 'done' && t.worktree != null) say('worktree-not-cleared', `${t.id} is done but its worktree is still recorded`);
  }

  for (const t of tasks) {
    for (const d of t.depends_on || []) {
      if (d === t.id) say('depends-on-self', t.id);
      else if (!ids.has(d)) say('unknown-dependency', `${t.id} depends on ${d}, which does not exist`);
    }
  }
  // Cycle detection over depends_on.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Map(); // id -> 0 visiting, 1 done
  const visit = (id, trail) => {
    if (seen.get(id) === 1) return;
    if (seen.get(id) === 0) {
      say('dependency-cycle', trail.slice(trail.indexOf(id)).concat(id).join(' -> '));
      return;
    }
    seen.set(id, 0);
    for (const d of (byId.get(id) || {}).depends_on || []) if (byId.has(d)) visit(d, trail.concat(id));
    seen.set(id, 1);
  };
  for (const t of tasks) visit(t.id, []);

  if (s.verify_lock != null && !ids.has(s.verify_lock)) say('invalid-lock', `verify_lock "${s.verify_lock}" names no existing task`);

  // Parallelism: >1 in_progress is valid only if every in_progress task
  // beyond the first has parallel_approved, its deps are done, and all
  // in_progress expected-file sets are pairwise disjoint.
  const running = tasks.filter((t) => t.status === 'in_progress');
  if (running.length > 1) {
    const unapproved = running.filter((t) => !t.parallel_approved);
    if (unapproved.length > 1) {
      say('parallel-unapproved', `${running.length} tasks in_progress but ${unapproved.map((t) => t.id).join(', ')} lack parallel_approved`);
    }
    for (const t of running) {
      if (!t.parallel_approved) continue;
      const unmet = (t.depends_on || []).filter((d) => (byId.get(d) || {}).status !== 'done');
      if (unmet.length) say('parallel-deps-unmet', `${t.id} is in_progress in parallel but depends on ${unmet.join(', ')} (not done)`);
    }
    for (let i = 0; i < running.length; i++) {
      for (let j = i + 1; j < running.length; j++) {
        const pairs = filesOverlap(running[i].files, running[j].files);
        if (pairs.length) {
          say('parallel-files-overlap', `${running[i].id} and ${running[j].id} overlap on ${pairs.map(([a, b]) => `${a} ~ ${b}`).join('; ')}`);
        }
      }
    }
  }
  return problems;
}

// Validates a single task transition against the matrix and its context
// requirements. Returns a named problem string, or null when allowed.
function checkTransition(s, taskId, to) {
  const task = (s.tasks || []).find((t) => t.id === taskId);
  if (!task) return `unknown-task: ${taskId} does not exist`;
  const key = `${task.status}->${to}`;
  const rule = TRANSITIONS[key];
  if (!rule) return `invalid-transition: ${taskId} ${task.status} -> ${to} is not in the transition matrix`;
  if (rule.lock && s.verify_lock !== taskId) {
    return `verify-lock-required: ${taskId} ${task.status} -> ${to} is only reachable while the verify skill holds verify_lock for ${taskId}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook half: PostToolUse detection net.

function readStdin(cb) {
  let raw = '';
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => cb(raw));
}

// Resolves the project directory per the fallback chain (rule 12b): payload
// cwd/project field, then the edited file's path, then the project-hint JSON
// in KIMI_PLUGIN_ROOT. Never process.cwd().
function resolveProjectDir(input, filePath) {
  if (input && typeof input.cwd === 'string' && input.cwd) return input.cwd;
  if (input && typeof input.project_dir === 'string' && input.project_dir) return input.project_dir;
  if (filePath) {
    const m = String(filePath).replace(/\\/g, '/').match(/^(.*?)\/spearhead\//);
    if (m) return m[1];
  }
  if (process.env.KIMI_PLUGIN_ROOT) {
    try {
      const hint = JSON.parse(fs.readFileSync(path.join(process.env.KIMI_PLUGIN_ROOT, '.spearhead-project.json'), 'utf8'));
      if (hint && typeof hint.projectDir === 'string') return hint.projectDir;
    } catch {
      // no hint: fall through to null
    }
  }
  return null;
}

function main() {
  readStdin((raw) => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0); // unparseable input: detection net stays silent
    }
    const args = input.tool_input || {};
    const filePath = args.file_path || args.path || '';
    const normalized = String(filePath).replace(/\\/g, '/');
    const isStatus = /(^|\/)spearhead\/status\.yml$/.test(normalized);
    const isTaskFile = /(^|\/)spearhead\/plan\/tasks\/[^/]+$/.test(normalized);
    if (!isStatus && !isTaskFile) process.exit(0);
    const projectDir = resolveProjectDir(input, filePath);
    if (projectDir === null) process.exit(0);
    const problems = [];
    if (isStatus) {
      problems.push('status.yml was written directly instead of through scripts/state.js (guard.js should have blocked this).');
      try {
        const { status, errors } = parseStatus(fs.readFileSync(filePath, 'utf8'));
        problems.push(...errors.map((e) => `parse: ${e}`));
        if (errors.length === 0) problems.push(...checkInvariants(status));
      } catch (err) {
        problems.push(`unreadable: ${err.message}`);
      }
      if (problems.length === 1) {
        // direct write, but the result still satisfies every invariant
        problems.push('The written file happens to satisfy the invariants, but route future mutations through scripts/state.js.');
      }
    } else {
      const base = normalized.split('/').pop();
      if (!/^T-\d+\.md$/.test(base)) {
        problems.push(`task file "${base}" does not match T-<n>.md; task ids come from the counter in status.yml via scripts/state.js.`);
      }
    }
    if (problems.length === 0) process.exit(0);
    process.stderr.write('spearhead state violation (detected post-write, never auto-repaired):\n- ' + problems.join('\n- ') + '\n');
    process.exit(2);
  });
}

module.exports = {
  parseStatus,
  serializeStatus,
  checkInvariants,
  checkTransition,
  globOverlap,
  filesOverlap,
  resolveProjectDir,
  PHASE_ENUMS,
  PHASE_ORDER,
  TASK_STATUSES,
  TRANSITIONS,
  main,
};

// Runs on load for both entry paths (direct execution, and kimi-code's
// __plugin_run_node require() shim, which bypasses require.main === module).
// SPEARHEAD_HOOK_LIB=1 is the library-mode escape hatch for state.js/tests.
if (!process.env.SPEARHEAD_HOOK_LIB) main();

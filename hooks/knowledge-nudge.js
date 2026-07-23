#!/usr/bin/env node
'use strict';
// PostToolUse nudge hook, two independent matchers (hooks/hooks.json /
// .kimi-plugin/plugin.json): `Read` (code-doc-on-first-read) and
// `Bash|PowerShell` (task-done doc update). Nudges only -- it never writes
// spearhead-knowledge/ notes, never writes spearhead-attacks/status.yml, and
// never calls the embeddings API itself (DESIGN.md ADR-003); the agent does
// the actual writing as a natural next step.
//
// Read matcher (PROBLEM.md acceptance criteria 2-6): on a read of a source
// file (extension heuristic, excludes .md/config/lockfiles -- see
// isSourceFile), computes the file's canonical knowledge-note path via
// scripts/knowledge-path.js and derives a three-way state from a single
// content-hash comparison (source_hash, T-1): no note there -> `new`
// (nudge to write one, naming the exact target path); note exists and its
// source_hash matches the source's current content hash -> `current`
// (never nudge, regardless of session); note exists but source_hash is
// missing or mismatched -> `stale` (nudge with refresh framing -- in-place
// update plus a new ## Changelog entry, not a duplicate note). `new` and
// `stale` both go through the session-scoped "already nudged this (path,
// hash) pair" throttle (same idle-expiry pattern as remind.js) -- a file
// that changes again after being nudged once naturally re-nudges, since
// its hash changes; `current` skips the throttle entirely, since it never
// nudges.
//
// Bash/PowerShell matcher (PROBLEM.md acceptance criterion 12): on a
// successful `state.js transition <T-id> done` invocation -- detected the
// same way state.js itself reports success, an "OK: <T-id> -> done" line on
// stdout -- reads that task's expected files from spearhead-attacks/status.yml
// (read-only; this hook never writes it) and nudges the agent to update
// each file's code doc with a new ## Changelog entry referencing the task
// and attack.
//
// All three nudge message sites (new-note, refresh, task-done) include a
// line reminding the agent to use [[wikilinks]] only for genuinely related
// notes (PROBLEM.md acceptance criterion 6).
//
// Loaded both by direct execution and by kimi-code's __plugin_run_node
// require() shim; runs on load unless SPEARHEAD_HOOK_LIB=1 (library/tests).

const wasLib = !!process.env.SPEARHEAD_HOOK_LIB;
process.env.SPEARHEAD_HOOK_LIB = '1'; // import validate-state.js's library half
const fs = require('node:fs');
const path = require('node:path');
const inv = require(path.join(__dirname, 'validate-state.js'));
const { computeKnowledgePath } = require(path.join(__dirname, '..', 'scripts', 'knowledge-path.js'));
const { hashContent } = require(path.join(__dirname, '..', 'lib', 'hash.js'));
const { parseFrontmatter } = require(path.join(__dirname, '..', 'lib', 'knowledge-frontmatter.js'));

const STATE_FILE = '.knowledge-nudge-state.json';
// Reused verbatim across all three nudge message sites (new-note, refresh,
// task-done) -- PROBLEM.md acceptance criterion 6.
const WIKILINK_LINE = 'Use `[[wikilinks]]` only for genuinely related notes -- do not add indiscriminate cross-links.';
const MAX_TRACKED_SESSIONS = 20;
const MAX_NUDGED_PER_SESSION = 500;
// Same idle-expiry constant/pattern as remind.js: a session silent this
// long is treated as new, so the code-doc nudge fires again.
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;

// Extension heuristic (DESIGN.md): everything counts as "source" except
// docs (.md), dotfile config, and known config/lockfile basenames or
// extensions. Best-effort, not exhaustive -- a nudge that fires on a file
// that turns out not to need documentation costs nothing (the agent just
// ignores it); a missed nudge is the only real failure mode.
const NON_SOURCE_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.rst',
  '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.lock', '.log', '.csv', '.tsv', '.sum', '.mod',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.mov', '.avi',
  '.env',
]);
const CONFIG_OR_LOCK_BASENAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'composer.lock', 'gemfile.lock', 'cargo.lock', 'go.sum', 'go.mod', 'poetry.lock', 'pipfile.lock',
  'dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile',
]);

// True when `filePath` looks like source code worth documenting: has an
// extension, is not a dotfile (hidden/config by convention), and matches
// neither the non-source extension nor the config/lockfile basename lists.
function isSourceFile(filePath) {
  const base = path.basename(String(filePath || ''));
  if (!base) return false;
  if (base.startsWith('.')) return false; // dotfiles: config/hidden by convention
  if (CONFIG_OR_LOCK_BASENAMES.has(base.toLowerCase())) return false;
  const ext = path.extname(base).toLowerCase();
  if (!ext) return false; // no extension: Makefile-like, not source
  if (NON_SOURCE_EXTENSIONS.has(ext)) return false;
  return true;
}

// Session ID resolution with fallback to 'default' -- same as remind.js, so
// both hooks agree on what counts as "one session" even though they track
// separate state files.
function sessionKeyFrom(input) {
  for (const k of ['session_id', 'sessionId', 'session', 'conversation_id', 'chat_id']) {
    if (input && typeof input[k] === 'string' && input[k]) return input[k];
  }
  return 'default';
}

// Fallback chain for the project directory (rule 12b). Never process.cwd().
function resolveProjectDir(input, hintPath) {
  if (input && typeof input.cwd === 'string' && input.cwd) return input.cwd;
  if (input && typeof input.project_dir === 'string' && input.project_dir) return input.project_dir;
  if (typeof hintPath === 'string') {
    const m = hintPath.replace(/\\/g, '/').match(/^(.*?)\/spearhead-attacks\//);
    if (m) return m[1];
  }
  if (process.env.KIMI_PLUGIN_ROOT) {
    try {
      const hint = JSON.parse(fs.readFileSync(path.join(process.env.KIMI_PLUGIN_ROOT, '.spearhead-project.json'), 'utf8'));
      if (hint && typeof hint.projectDir === 'string') return hint.projectDir;
    } catch {
      // no hint: fall through
    }
  }
  return null;
}

function loadState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed && typeof parsed.sessions === 'object' && parsed.sessions !== null) return parsed;
  } catch {
    // missing or corrupt state: treat as fresh
  }
  return { sessions: {} };
}

// Returns true the first time `relPath` is seen at `currentHash` for
// `sessionId` (or after that session has gone idle long enough to be
// treated as new); false on every subsequent call within the same session
// for the same (path, hash) pair. `nudged` maps path -> last-nudged-hash
// (not an array of paths): a file that changes again after being nudged
// once naturally re-nudges, since its hash no longer matches the recorded
// one. Old-format state (array `nudged`, from before this field became a
// map) is treated as empty rather than crashing. Always records the call,
// so it degrades gracefully to "nudge every time" if the state file cannot
// be written (read-only project).
function shouldNudge(statePath, sessionId, relPath, currentHash) {
  const state = loadState(statePath);
  const entry = state.sessions[sessionId] || { nudged: {}, at: 0 };
  const idle = entry.at && Date.now() - entry.at > SESSION_IDLE_MS;
  const isMap = entry.nudged && typeof entry.nudged === 'object' && !Array.isArray(entry.nudged);
  const nudged = idle || !isMap ? {} : { ...entry.nudged };
  const already = nudged[relPath] === currentHash;
  if (!already) {
    nudged[relPath] = currentHash;
    const keys = Object.keys(nudged);
    if (keys.length > MAX_NUDGED_PER_SESSION) {
      keys.slice(0, keys.length - MAX_NUDGED_PER_SESSION).forEach((k) => delete nudged[k]);
    }
  }
  state.sessions[sessionId] = { nudged, at: Date.now() };
  const ids = Object.keys(state.sessions);
  if (ids.length > MAX_TRACKED_SESSIONS) {
    ids
      .sort((a, b) => (state.sessions[a].at || 0) - (state.sessions[b].at || 0))
      .slice(0, ids.length - MAX_TRACKED_SESSIONS)
      .forEach((id) => delete state.sessions[id]);
  }
  try {
    fs.writeFileSync(statePath, JSON.stringify(state) + '\n');
  } catch {
    // read-only project: fall back to nudging every read
  }
  return !already;
}

// Read matcher: code-doc-on-first-read, staleness-aware (source_hash, T-1).
//
// Derives a three-way state from a single content-hash comparison:
//   - no note at the computed target path -> `new`
//   - note exists, its `source_hash` matches the source's current content
//     hash -> `current` -- never nudges, regardless of session
//   - note exists, `source_hash` missing or mismatched -> `stale` -- nudges
//     with refresh framing (in-place update + new ## Changelog entry, not
//     a duplicate note)
// `new` and `stale` both go through the existing session-throttle check;
// `current` skips it entirely (nothing to throttle -- it never nudges).
function handleRead(input, projectDir) {
  const args = input.tool_input || {};
  const filePath = args.file_path || args.path || args.notebook_path;
  if (!filePath || typeof filePath !== 'string' || !isSourceFile(filePath)) return '';

  let targetPath;
  try {
    targetPath = computeKnowledgePath(filePath, projectDir);
  } catch {
    return ''; // best-effort: never crash the hook on a naming edge case
  }

  const absSource = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
  let currentHash;
  try {
    currentHash = hashContent(fs.readFileSync(absSource));
  } catch {
    return ''; // source unreadable/deleted between the Read call and now: silent
  }

  const absTarget = path.join(projectDir, targetPath);
  let state = 'new';
  if (fs.existsSync(absTarget)) {
    let noteHash;
    try {
      noteHash = parseFrontmatter(fs.readFileSync(absTarget, 'utf8')).fields.source_hash;
    } catch {
      noteHash = undefined; // malformed/unreadable note: falls into `stale` below
    }
    state = noteHash === currentHash ? 'current' : 'stale';
  }
  if (state === 'current') return '';

  const relSource = path.relative(projectDir, absSource).split(path.sep).join('/');
  const spearheadDir = path.join(projectDir, 'spearhead-attacks');
  const statePath = path.join(spearheadDir, STATE_FILE);
  if (!shouldNudge(statePath, sessionKeyFrom(input), relSource, currentHash)) return '';

  if (state === 'stale') {
    return (
      `spearhead-knowledge: "${relSource}" has changed since ${targetPath} was last updated ` +
      '(source_hash no longer matches). Update that note in place -- do not create a duplicate -- ' +
      'with a new ## Changelog entry describing the change, and refresh its source_hash frontmatter ' +
      `to this file's current content hash. ${WIKILINK_LINE}\n`
    );
  }

  return (
    `spearhead-knowledge: "${relSource}" has no code doc yet. Write one at ${targetPath} ` +
    '(the exact path scripts/knowledge-path.js computes for this source -- naming is deterministic, ' +
    'do not pick a different path) with type/tags/source/source_hash frontmatter (set source_hash to ' +
    `this file's current content hash) and a populated ## Changelog section. ${WIKILINK_LINE}\n`
  );
}

// Extracts whatever text a PostToolUse payload's tool_response carries,
// across the field names different tools/runtimes use for command output.
function extractOutput(toolResponse) {
  if (!toolResponse) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  const parts = [];
  for (const k of ['stdout', 'output', 'result', 'text']) {
    if (typeof toolResponse[k] === 'string') parts.push(toolResponse[k]);
  }
  return parts.join('\n');
}

// Bash/PowerShell matcher: task-done doc update.
function handleBash(input, projectDir) {
  const args = input.tool_input || {};
  const command = String(args.command || '');
  const m = command.match(/state\.js\s+transition\s+(T-\d+)\s+done\b/);
  if (!m) return '';
  const taskId = m[1];

  // Success is detected the same way state.js itself reports it: an
  // "OK: <T-id> -> done" line on stdout. A REFUSED (failed) transition, or
  // a tool_response this hook cannot read, stays silent.
  const output = extractOutput(input.tool_response);
  if (!new RegExp(`OK:\\s*${taskId}\\s*->\\s*done`).test(output)) return '';

  let status;
  try {
    const parsed = inv.parseStatus(fs.readFileSync(path.join(projectDir, 'spearhead-attacks', 'status.yml'), 'utf8'));
    if (parsed.errors.length) return '';
    status = parsed.status;
  } catch {
    return '';
  }
  const task = (status.tasks || []).find((t) => t.id === taskId);
  if (!task || !(task.files || []).length) return '';

  const attackId = (status.attack && status.attack.id) || '';
  const lines = task.files.map((f) => {
    let target;
    try {
      target = computeKnowledgePath(f, projectDir);
    } catch {
      target = null;
    }
    return target ? `- ${f} -> ${target}` : `- ${f}`;
  });
  return (
    `spearhead-knowledge: ${taskId} (${attackId}) just transitioned to done. Update the code doc for each ` +
    `touched file below with a new ## Changelog entry referencing ${taskId} and ${attackId}:\n` +
    lines.join('\n') +
    `\n${WIKILINK_LINE}\n`
  );
}

function main() {
  let raw = '';
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let input = null;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0); // unparseable input: never nudge
    }
    const tool = input.tool_name || '';
    const args = input.tool_input || {};
    const hintPath = args.file_path || args.path || args.notebook_path || null;
    const projectDir = resolveProjectDir(input, hintPath);
    if (projectDir === null) process.exit(0);
    if (!fs.existsSync(path.join(projectDir, 'spearhead-attacks'))) process.exit(0);

    let message = '';
    if (tool === 'Read') message = handleRead(input, projectDir);
    else if (tool === 'Bash' || tool === 'PowerShell') message = handleBash(input, projectDir);
    process.stdout.write(message);
  });
}

module.exports = {
  isSourceFile,
  sessionKeyFrom,
  resolveProjectDir,
  shouldNudge,
  handleRead,
  handleBash,
  extractOutput,
  main,
};
if (!wasLib) main();

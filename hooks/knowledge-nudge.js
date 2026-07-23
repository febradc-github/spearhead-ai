#!/usr/bin/env node
'use strict';
// PostToolUse nudge hook, two independent matchers (hooks/hooks.json /
// .kimi-plugin/plugin.json): `Read` (code-doc-on-first-read) and
// `Bash|PowerShell` (task-done doc update). Nudges only -- it never writes
// spearhead-knowledge/ notes, never writes spearhead-attacks/status.yml, and
// never calls the embeddings API itself (DESIGN.md ADR-003); the agent does
// the actual writing as a natural next step.
//
// Read matcher (PROBLEM.md acceptance criterion 4): on a read of a source
// file (extension heuristic, excludes .md/config/lockfiles -- see
// isSourceFile), computes the file's canonical knowledge-note path via
// scripts/knowledge-path.js. If no note there already documents this exact
// source (source: frontmatter match), nudges the agent to write one, naming
// the exact target path. Session-scoped "already nudged this file"
// tracking (same idle-expiry pattern as remind.js) keeps re-reads within a
// session from re-nudging; an already-documented file is never nudged
// regardless of session, because the existence check is re-derived from
// disk on every call.
//
// Bash/PowerShell matcher (PROBLEM.md acceptance criterion 12): on a
// successful `state.js transition <T-id> done` invocation -- detected the
// same way state.js itself reports success, an "OK: <T-id> -> done" line on
// stdout -- reads that task's expected files from spearhead-attacks/status.yml
// (read-only; this hook never writes it) and nudges the agent to update
// each file's code doc with a new ## Changelog entry referencing the task
// and attack.
//
// Loaded both by direct execution and by kimi-code's __plugin_run_node
// require() shim; runs on load unless SPEARHEAD_HOOK_LIB=1 (library/tests).

const wasLib = !!process.env.SPEARHEAD_HOOK_LIB;
process.env.SPEARHEAD_HOOK_LIB = '1'; // import validate-state.js's library half
const fs = require('node:fs');
const path = require('node:path');
const inv = require(path.join(__dirname, 'validate-state.js'));
const { computeKnowledgePath } = require(path.join(__dirname, '..', 'scripts', 'knowledge-path.js'));

const STATE_FILE = '.knowledge-nudge-state.json';
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

// Returns true the first time `relPath` is seen for `sessionId` (or after
// that session has gone idle long enough to be treated as new); false on
// every subsequent call within the same session. Always records the call,
// so it degrades gracefully to "nudge every time" if the state file cannot
// be written (read-only project).
function shouldNudge(statePath, sessionId, relPath) {
  const state = loadState(statePath);
  const entry = state.sessions[sessionId] || { nudged: [], at: 0 };
  const idle = entry.at && Date.now() - entry.at > SESSION_IDLE_MS;
  let nudged = idle ? [] : entry.nudged.slice();
  const already = nudged.includes(relPath);
  if (!already) {
    nudged.push(relPath);
    if (nudged.length > MAX_NUDGED_PER_SESSION) nudged = nudged.slice(nudged.length - MAX_NUDGED_PER_SESSION);
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

// Read matcher: code-doc-on-first-read.
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
  if (fs.existsSync(path.join(projectDir, targetPath))) return ''; // already documented under this exact source

  const relSource = path.relative(projectDir, path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath)).split(path.sep).join('/');
  const spearheadDir = path.join(projectDir, 'spearhead-attacks');
  const statePath = path.join(spearheadDir, STATE_FILE);
  if (!shouldNudge(statePath, sessionKeyFrom(input), relSource)) return '';

  return (
    `spearhead-knowledge: "${relSource}" has no code doc yet. Write one at ${targetPath} ` +
    '(the exact path scripts/knowledge-path.js computes for this source -- naming is deterministic, ' +
    'do not pick a different path) with type/tags/source frontmatter and a populated ## Changelog section.\n'
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
    '\n'
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

#!/usr/bin/env node
'use strict';
// PreToolUse guard. Blocks, at the only point where blocking is possible:
//   - git commits with --no-verify, ANY "Co-Authored-By:" trailer, or
//     Anthropic/Claude attribution ("Generated with ...", anthropic emails);
//   - ANY tool access to env files (.env, .env.*, *.env, .envrc);
//   - raw Write/Edit/NotebookEdit (and shell redirection/in-place edits)
//     targeting spearhead-attacks/status.yml -- all status mutations go through
//     scripts/state.js, which validates before writing.
//
// HONESTY: the shell-command checks are string matching. They are a
// best-effort speed bump against accidents, not a security boundary; a
// determined agent or user can compose a command these patterns miss. The
// hard guarantees live in scripts/state.js (validates before writing) and
// validate-state.js (detects after writing). The README documents exactly
// this and claims no more than guard.test.js proves.
//
// Safe to run anywhere: the commit and env-file checks apply outside
// spearhead projects too; nothing here requires a spearhead-attacks/ directory.
// Exit 2 blocks the tool call and feeds stderr back to the model.
//
// Loaded both by direct execution and by kimi-code's __plugin_run_node
// require() shim; runs on load unless SPEARHEAD_HOOK_LIB=1 (library/tests).

const fs = require('node:fs');
const path = require('node:path');

const ENV_MSG =
  'spearhead forbids touching env files (.env, .env.*, *.env, .envrc): they hold secrets and are never read, written, searched, or referenced in commands. No exceptions -- ask the user for any config value you need.';
const STATE_MSG =
  'spearhead-attacks/status.yml is mutated only through scripts/state.js (node <plugin>/scripts/state.js <command> ...), which validates every mutation against the invariants and the transition matrix before writing. Raw edits are blocked.';

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

// True when a path, filename, or glob targets an env file.
function isEnvTarget(value) {
  if (!value || typeof value !== 'string') return false;
  const base = value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  if (/^\.envrc$/i.test(base)) return true;
  if (/^\.env(\..+)?$/i.test(base)) return true; // .env, .env.local, .env.production
  if (/\.env$/i.test(base)) return true; // prod.env, config.env
  if (/[*?]/.test(base) && /\.env/i.test(base)) return true; // globs like .env* or *.env*
  return false;
}

// True when a shell command references an env file anywhere.
function commandTouchesEnv(command) {
  const tokens = String(command).split(/[\s"'`;|&<>()]+/);
  return tokens.some((t) => isEnvTarget(t.replace(/[,:;)]+$/, '')));
}

function isStatusFile(value) {
  return typeof value === 'string' && /(^|[\\/])spearhead-attacks[\\/]status\.yml$/.test(value);
}

// Best-effort: a shell command whose writing construct actually TARGETS
// status.yml (redirection into it, tee into it, sed -i on it, mv/cp with it
// as the destination, PowerShell writers). Reading it (cat, grep, test -f)
// stays allowed -- including reads with unrelated redirects like 2>/dev/null.
function commandWritesStatus(command) {
  const c = String(command);
  if (!/spearhead-attacks[\\/]status\.yml/.test(c)) return false;
  const FILE = String.raw`['"]?\S*spearhead-attacks[\\/]status\.yml`;
  if (new RegExp(String.raw`>>?\s*${FILE}`).test(c)) return true; // redirection into it
  if (new RegExp(String.raw`\btee\b[^|;&]*\s${FILE}`).test(c)) return true; // tee into it
  if (new RegExp(String.raw`\bsed\b[^|;&]*\s-i[^|;&]*\s${FILE}`).test(c)) return true; // in-place edit
  if (new RegExp(String.raw`\b(mv|cp)\b[^|;&]*\s${FILE}['"]?\s*(?:$|[|;&])`).test(c)) return true; // as the destination (last arg)
  if (new RegExp(String.raw`\b(Set-Content|Out-File|Add-Content)\b[^|;&]*spearhead-attacks[\\/]status\.yml`, 'i').test(c)) return true;
  return false;
}

function checkTool(tool, args) {
  const violations = [];
  if (FILE_TOOLS.has(tool)) {
    const targets = [args.file_path, args.notebook_path, args.path, args.glob];
    if (tool === 'Glob') targets.push(args.pattern); // Glob's pattern is a file glob
    if (targets.some(isEnvTarget)) violations.push(ENV_MSG);
    if (WRITE_TOOLS.has(tool) && targets.some(isStatusFile)) violations.push(STATE_MSG);
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = (args && args.command) || '';
    if (commandTouchesEnv(command)) violations.push(ENV_MSG);
    if (commandWritesStatus(command)) violations.push(STATE_MSG);
    if (/\bgit\b/.test(command) && /\bcommit\b/.test(command)) {
      if (/--no-verify\b/.test(command)) {
        violations.push('spearhead forbids --no-verify on commits; fix the hook failure instead.');
      }
      if (/co-authored-by:/i.test(command) || /generated (with|by).*\b(claude|anthropic)\b/i.test(command) || /noreply@anthropic\.com/i.test(command)) {
        violations.push('spearhead forbids attribution in commit messages: never tag Anthropic/Claude and never add a "Co-Authored-By:" trailer.');
      }
    }
  }
  return violations;
}

// kimi-code runs hooks with the plugin root as cwd and no project env var.
// When a tool path lets us locate the project (the directory containing
// spearhead-attacks/), leave a hint so path-less events (UserPromptSubmit) can
// resolve it too. Fails soft: a missing hint only degrades remind.js.
function refreshProjectHint(input, args) {
  if (!process.env.KIMI_PLUGIN_ROOT) return;
  let projectDir = null;
  if (input && typeof input.cwd === 'string' && input.cwd) projectDir = input.cwd;
  else {
    for (const p of [args.file_path, args.path, args.notebook_path]) {
      const m = typeof p === 'string' && p.replace(/\\/g, '/').match(/^(.*?)\/spearhead-attacks\//);
      if (m) {
        projectDir = m[1];
        break;
      }
    }
  }
  if (!projectDir) return;
  try {
    fs.writeFileSync(
      path.join(process.env.KIMI_PLUGIN_ROOT, '.spearhead-project.json'),
      JSON.stringify({ projectDir }) + '\n'
    );
  } catch {
    // read-only plugin root: the hint is best-effort
  }
}

function main() {
  let raw = '';
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0); // unparseable input: never block
    }
    const tool = input.tool_name || '';
    const args = input.tool_input || {};
    refreshProjectHint(input, args);
    const violations = checkTool(tool, args);
    if (violations.length === 0) process.exit(0);
    process.stderr.write(violations.join('\n') + '\n');
    process.exit(2);
  });
}

module.exports = { isEnvTarget, commandTouchesEnv, isStatusFile, commandWritesStatus, checkTool, main };
if (!process.env.SPEARHEAD_HOOK_LIB) main();

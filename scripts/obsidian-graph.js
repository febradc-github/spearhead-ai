#!/usr/bin/env node
'use strict';
// Opens Obsidian directly to the graph view via the Advanced URI community
// plugin. Constructs an `obsidian://advanced-uri` URI for the vault (the
// project root, same root-resolution convention as scripts/state.js and
// scripts/knowledge-path.js) and asks the OS to open it via the platform's
// URI-open command (`open` on macOS, `xdg-open` on Linux, `start` on
// Windows).
//
// URI dispatch is fire-and-forget at the OS level: this script can only
// confirm the platform-open command itself was invoked without a spawn
// error -- never that Obsidian actually reached the graph view. It relies
// on two undocumented-here-but-user-side preconditions:
//   1. Obsidian is installed.
//   2. The Advanced URI community plugin is installed and enabled in the
//      vault.
//
// Usage: node scripts/obsidian-graph.js
//
// Dependency-free: Node built-ins only.

const path = require('node:path');
const cp = require('node:child_process');

const PRECONDITIONS = [
  'Obsidian must be installed.',
  'The Advanced URI community plugin must be installed and enabled in the vault.',
];

const LIMITATION =
  'Note: opening a URI is fire-and-forget at the OS level -- this only confirms the ' +
  'platform open command was invoked without a spawn error, not that Obsidian actually ' +
  'reached the graph view.';

// Maps process.platform to the OS command that opens an arbitrary URI.
const PLATFORM_COMMANDS = {
  darwin: 'open',
  linux: 'xdg-open',
  win32: 'start',
};

// Builds the obsidian://advanced-uri URI that opens the local graph view
// for the vault at `projectDir` (vault name = basename of the resolved
// project root).
function buildUri(projectDir) {
  const vault = path.basename(path.resolve(projectDir));
  return `obsidian://advanced-uri?vault=${encodeURIComponent(vault)}&commandid=graph:open`;
}

// Real invocation of the platform's URI-open command. Never used by tests;
// tests inject options.exec instead so no process is ever actually spawned.
function defaultExec(command, args) {
  return cp.spawnSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
}

// Constructs the graph-view URI and asks the OS to open it. Returns a
// result object ({ ok, supported, uri, lines }); never throws. `lines` is
// the full user-facing message, including the two preconditions and the
// fire-and-forget limitation, ready to relay verbatim.
function openGraph(options = {}) {
  const {
    platform = process.platform,
    projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    exec = defaultExec,
  } = options;

  const uri = buildUri(projectDir);
  const command = PLATFORM_COMMANDS[platform];

  if (!command) {
    return {
      ok: false,
      supported: false,
      uri,
      lines: [
        `Unsupported platform "${platform}": could not auto-open Obsidian.`,
        `Open this URI manually: ${uri}`,
        ...PRECONDITIONS.map((p) => `Precondition: ${p}`),
        LIMITATION,
      ],
    };
  }

  // win32's `start` is a cmd.exe builtin invoked through a shell (see
  // defaultExec); it takes a window-title arg before the target.
  const args = platform === 'win32' ? ['', uri] : [uri];
  const result = exec(command, args);

  if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
    const detail = result.error ? result.error.message : `exit code ${result.status}`;
    return {
      ok: false,
      supported: true,
      uri,
      lines: [
        `Failed to invoke "${command}" to open Obsidian: ${detail}`,
        `Open this URI manually: ${uri}`,
        ...PRECONDITIONS.map((p) => `Precondition: ${p}`),
        LIMITATION,
      ],
    };
  }

  return {
    ok: true,
    supported: true,
    uri,
    lines: [
      `Invoked "${command}" to open: ${uri}`,
      ...PRECONDITIONS.map((p) => `Precondition: ${p}`),
      LIMITATION,
    ],
  };
}

function main() {
  const result = openGraph();
  process.stdout.write(result.lines.join('\n') + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) main();

module.exports = { openGraph, buildUri, PLATFORM_COMMANDS };

'use strict';
// Tests for scripts/obsidian-graph.js: URI construction, the
// platform-to-open-command mapping via the injected options.exec seam (so
// no real subprocess is ever spawned), the unsupported-platform fallback,
// and the spawn-error surfacing path.
const test = require('node:test');
const assert = require('node:assert/strict');

const { openGraph, buildUri, PLATFORM_COMMANDS } = require('./obsidian-graph.js');

test('buildUri constructs the obsidian://advanced-uri URI from the project dir basename', () => {
  const uri = buildUri('/home/dev/projects/my-vault');
  assert.equal(uri, 'obsidian://advanced-uri?vault=my-vault&commandid=graph:open');
});

test('buildUri encodes vault names with special characters', () => {
  const uri = buildUri('/home/dev/projects/my vault & co');
  assert.equal(uri, 'obsidian://advanced-uri?vault=my%20vault%20%26%20co&commandid=graph:open');
});

for (const [platform, command] of Object.entries(PLATFORM_COMMANDS)) {
  test(`maps platform "${platform}" to the "${command}" open command and never spawns a real process`, () => {
    const calls = [];
    const exec = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, error: null };
    };
    const result = openGraph({ platform, projectDir: '/repo/my-project', exec });

    assert.equal(calls.length, 1, 'exec must be called exactly once');
    assert.equal(calls[0].cmd, command);
    assert.ok(calls[0].args.includes('obsidian://advanced-uri?vault=my-project&commandid=graph:open'));

    assert.equal(result.ok, true);
    assert.equal(result.supported, true);
    assert.equal(result.uri, 'obsidian://advanced-uri?vault=my-project&commandid=graph:open');
    assert.match(result.lines.join('\n'), new RegExp(`Invoked "${command}"`));
  });
}

test('unsupported platform: does not throw, does not call exec, prints the URI and manual instructions', () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    return { status: 0, error: null };
  };

  const result = openGraph({ platform: 'freebsd', projectDir: '/repo/my-project', exec });

  assert.equal(calls.length, 0, 'exec must never be called for an unsupported platform');
  assert.equal(result.ok, false);
  assert.equal(result.supported, false);
  assert.equal(result.uri, 'obsidian://advanced-uri?vault=my-project&commandid=graph:open');
  const text = result.lines.join('\n');
  assert.match(text, /Unsupported platform "freebsd"/);
  assert.match(text, /obsidian:\/\/advanced-uri\?vault=my-project&commandid=graph:open/);
});

test('spawn-error case surfaces clearly rather than silently succeeding', () => {
  const exec = () => ({ status: null, error: new Error('spawn xdg-open ENOENT') });

  const result = openGraph({ platform: 'linux', projectDir: '/repo/my-project', exec });

  assert.equal(result.ok, false);
  assert.equal(result.supported, true);
  const text = result.lines.join('\n');
  assert.match(text, /Failed to invoke "xdg-open"/);
  assert.match(text, /spawn xdg-open ENOENT/);
  assert.match(text, /Open this URI manually/);
});

test('non-zero exit status (no error object) is also treated as a failure', () => {
  const exec = () => ({ status: 1, error: null });

  const result = openGraph({ platform: 'darwin', projectDir: '/repo/my-project', exec });

  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /exit code 1/);
});

test('output states both preconditions and the fire-and-forget limitation on success', () => {
  const exec = () => ({ status: 0, error: null });
  const result = openGraph({ platform: 'linux', projectDir: '/repo/my-project', exec });
  const text = result.lines.join('\n');
  assert.match(text, /Obsidian must be installed/);
  assert.match(text, /Advanced URI community plugin must be installed and enabled/);
  assert.match(text, /fire-and-forget/);
});

test('CLAUDE_PROJECT_DIR is honored as the default project root when set', () => {
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = '/some/other/root/vault-name';
  try {
    const exec = () => ({ status: 0, error: null });
    const result = openGraph({ platform: 'linux', exec });
    assert.equal(result.uri, 'obsidian://advanced-uri?vault=vault-name&commandid=graph:open');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prev;
  }
});

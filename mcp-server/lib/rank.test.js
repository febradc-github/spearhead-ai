'use strict';
// Tests for rank.js: the CLI-ranking module that replaces embeddings.js'
// vector-similarity ranking (see plan/tasks/T-1.md). `options.exec` is
// always injected here so no test spawns a real `claude`/`kimi` process.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rankNotes,
  detectCli,
  buildPrompt,
  invokeCli,
  parseCliOutput,
  resetCliCache,
  RankingCliUnavailableError,
  RankingCliRequestError,
} = require('./rank.js');

// Runs `fn` with `vars` applied to process.env, restoring the previous
// values (including "was unset") afterwards even if fn throws/rejects.
async function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

// ---------------------------------------------------------------------
// detectCli
// ---------------------------------------------------------------------

test('detectCli honors SPEARHEAD_RANKING_CLI=claude without probing', async () => {
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: 'claude' }, async () => {
    let probed = false;
    const exec = async () => {
      probed = true;
      throw new Error('should not be called');
    };
    const cli = await detectCli({ exec });
    assert.equal(cli, 'claude');
    assert.equal(probed, false);
  });
});

test('detectCli honors SPEARHEAD_RANKING_CLI=kimi without probing', async () => {
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: 'kimi' }, async () => {
    let probed = false;
    const exec = async () => {
      probed = true;
      throw new Error('should not be called');
    };
    const cli = await detectCli({ exec });
    assert.equal(cli, 'kimi');
    assert.equal(probed, false);
  });
});

test('detectCli probes claude then kimi (in order) when the env var is unset', async () => {
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    const probeOrder = [];
    const exec = async (cmd) => {
      probeOrder.push(cmd);
      if (cmd === 'claude') throw new Error('not found');
      return { stdout: 'kimi 1.0.0', stderr: '' };
    };
    const cli = await detectCli({ exec });
    assert.equal(cli, 'kimi');
    assert.deepEqual(probeOrder, ['claude', 'kimi']);
  });
});

test('detectCli picks claude when both probes would succeed (claude wins first)', async () => {
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    const probeOrder = [];
    const exec = async (cmd) => {
      probeOrder.push(cmd);
      return { stdout: `${cmd} 1.0.0`, stderr: '' };
    };
    const cli = await detectCli({ exec });
    assert.equal(cli, 'claude');
    assert.deepEqual(probeOrder, ['claude']);
  });
});

test('detectCli throws RankingCliUnavailableError when neither probe succeeds', async () => {
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    const exec = async () => {
      throw new Error('command not found');
    };
    await assert.rejects(() => detectCli({ exec }), RankingCliUnavailableError);
  });
});

test('detectCli caches the resolved CLI across calls (probe only runs once)', async () => {
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    let calls = 0;
    const exec = async (cmd) => {
      calls += 1;
      if (cmd === 'claude') return { stdout: 'claude 1.0.0', stderr: '' };
      throw new Error('unreachable');
    };
    const first = await detectCli({ exec });
    const second = await detectCli({ exec });
    assert.equal(first, 'claude');
    assert.equal(second, 'claude');
    assert.equal(calls, 1);
  });
});

// ---------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------

test('buildPrompt includes the query and each candidate path + excerpt', () => {
  const prompt = buildPrompt('how does auth work', [
    { path: 'notes/auth.md', excerpt: 'auth uses tokens' },
    { path: 'notes/db.md', excerpt: 'db stores rows' },
  ]);
  assert.match(prompt, /how does auth work/);
  assert.match(prompt, /notes\/auth\.md/);
  assert.match(prompt, /auth uses tokens/);
  assert.match(prompt, /notes\/db\.md/);
  assert.match(prompt, /db stores rows/);
  assert.match(prompt, /JSON array/i);
});

// ---------------------------------------------------------------------
// invokeCli -- argument-array construction, never shell-string concatenation
// ---------------------------------------------------------------------

test('invokeCli spawns claude with an argument array (--print, prompt, --model, --output-format json)', async () => {
  let capturedCmd;
  let capturedArgs;
  let capturedOptions;
  const exec = async (cmd, args, options) => {
    capturedCmd = cmd;
    capturedArgs = args;
    capturedOptions = options;
    return { stdout: '{"result":"[]"}', stderr: '' };
  };
  await invokeCli('claude', 'the prompt; rm -rf /', { exec, model: 'claude-test-model' });
  assert.equal(capturedCmd, 'claude');
  assert.ok(Array.isArray(capturedArgs));
  assert.deepEqual(capturedArgs, [
    '--print',
    'the prompt; rm -rf /',
    '--model',
    'claude-test-model',
    '--output-format',
    'json',
  ]);
  assert.ok(Number.isFinite(capturedOptions.timeout));
  assert.ok(capturedOptions.timeout > 0);
});

test('invokeCli spawns kimi with an argument array (--prompt, prompt, --model, --output-format stream-json)', async () => {
  let capturedCmd;
  let capturedArgs;
  const exec = async (cmd, args) => {
    capturedCmd = cmd;
    capturedArgs = args;
    return { stdout: '', stderr: '' };
  };
  await invokeCli('kimi', 'the $(prompt) & danger', { exec, model: 'kimi-test-model' });
  assert.equal(capturedCmd, 'kimi');
  assert.deepEqual(capturedArgs, [
    '--prompt',
    'the $(prompt) & danger',
    '--model',
    'kimi-test-model',
    '--output-format',
    'stream-json',
  ]);
});

test('invokeCli raises RankingCliRequestError with .cause on non-zero exit', async () => {
  const err = new Error('Command failed');
  err.code = 1;
  const exec = async () => {
    throw err;
  };
  await assert.rejects(
    () => invokeCli('claude', 'p', { exec }),
    (thrown) => {
      assert.ok(thrown instanceof RankingCliRequestError);
      assert.equal(thrown.cause, err);
      return true;
    }
  );
});

test('invokeCli raises RankingCliRequestError with .cause on timeout', async () => {
  const err = new Error('Command timed out');
  err.killed = true;
  err.signal = 'SIGTERM';
  const exec = async () => {
    throw err;
  };
  await assert.rejects(
    () => invokeCli('claude', 'p', { exec }),
    (thrown) => {
      assert.ok(thrown instanceof RankingCliRequestError);
      assert.equal(thrown.cause, err);
      return true;
    }
  );
});

test('invokeCli passes a bounded, finite timeout to the exec seam', async () => {
  let seenTimeout;
  const exec = async (cmd, args, options) => {
    seenTimeout = options.timeout;
    return { stdout: '{"result":"[]"}', stderr: '' };
  };
  await invokeCli('claude', 'p', { exec });
  assert.ok(Number.isFinite(seenTimeout));
  assert.ok(seenTimeout > 0 && seenTimeout < 120000);
});

// ---------------------------------------------------------------------
// parseCliOutput -- claude JSON envelope
// ---------------------------------------------------------------------

test('parseCliOutput parses a claude-shaped JSON envelope into the instructed array', () => {
  const envelope = JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: JSON.stringify(['notes/a.md', 'notes/b.md']),
  });
  const parsed = parseCliOutput('claude', envelope);
  assert.deepEqual(parsed, ['notes/a.md', 'notes/b.md']);
});

test('parseCliOutput returns [] for a validly-parsed empty claude result (not an error)', () => {
  const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: '[]' });
  const parsed = parseCliOutput('claude', envelope);
  assert.deepEqual(parsed, []);
});

test('parseCliOutput raises RankingCliRequestError when claude envelope is not valid JSON', () => {
  assert.throws(() => parseCliOutput('claude', 'not json at all'), RankingCliRequestError);
});

test('parseCliOutput raises RankingCliRequestError when claude envelope has no result field', () => {
  const envelope = JSON.stringify({ type: 'result', subtype: 'success' });
  assert.throws(() => parseCliOutput('claude', envelope), RankingCliRequestError);
});

test('parseCliOutput raises RankingCliRequestError when claude result text is not valid JSON', () => {
  const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: 'not a json array' });
  assert.throws(() => parseCliOutput('claude', envelope), RankingCliRequestError);
});

test('parseCliOutput raises RankingCliRequestError when claude result JSON is not an array', () => {
  const envelope = JSON.stringify({ type: 'result', subtype: 'success', result: '{"foo":"bar"}' });
  assert.throws(() => parseCliOutput('claude', envelope), RankingCliRequestError);
});

// ---------------------------------------------------------------------
// parseCliOutput -- kimi stream-json JSONL
// ---------------------------------------------------------------------

test('parseCliOutput parses a kimi-shaped stream-json JSONL stream, using the last Assistant message', () => {
  const lines = [
    JSON.stringify({ type: 'assistant', content: 'thinking out loud' }),
    JSON.stringify({ type: 'tool_call', name: 'search' }),
    JSON.stringify({ type: 'assistant', content: JSON.stringify(['notes/x.md']) }),
  ];
  const parsed = parseCliOutput('kimi', lines.join('\n'));
  assert.deepEqual(parsed, ['notes/x.md']);
});

test('parseCliOutput handles kimi Assistant content given as an array of text blocks', () => {
  const lines = [
    JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(['notes/y.md', 'notes/z.md']) }],
    }),
  ];
  const parsed = parseCliOutput('kimi', lines.join('\n'));
  assert.deepEqual(parsed, ['notes/y.md', 'notes/z.md']);
});

test('parseCliOutput returns [] for a validly-parsed empty kimi result (not an error)', () => {
  const lines = [JSON.stringify({ type: 'assistant', content: '[]' })];
  const parsed = parseCliOutput('kimi', lines.join('\n'));
  assert.deepEqual(parsed, []);
});

test('parseCliOutput raises RankingCliRequestError on unparseable kimi JSONL lines', () => {
  const lines = ['{not valid json', JSON.stringify({ type: 'assistant', content: '[]' })];
  assert.throws(() => parseCliOutput('kimi', lines.join('\n')), RankingCliRequestError);
});

test('parseCliOutput raises RankingCliRequestError when kimi stream has no Assistant message', () => {
  const lines = [JSON.stringify({ type: 'tool_call', name: 'search' })];
  assert.throws(() => parseCliOutput('kimi', lines.join('\n')), RankingCliRequestError);
});

test('parseCliOutput raises RankingCliRequestError when kimi Assistant content is not valid JSON', () => {
  const lines = [JSON.stringify({ type: 'assistant', content: 'plain text, not json' })];
  assert.throws(() => parseCliOutput('kimi', lines.join('\n')), RankingCliRequestError);
});

// ---------------------------------------------------------------------
// rankNotes -- end-to-end
// ---------------------------------------------------------------------

test('rankNotes returns the candidates in model-ranked order, filtering non-matches', async () => {
  const candidates = [
    { path: 'notes/a.md', excerpt: 'aaa' },
    { path: 'notes/b.md', excerpt: 'bbb' },
    { path: 'notes/c.md', excerpt: 'ccc' },
  ];
  const exec = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: 'claude 1.0.0', stderr: '' };
    return { stdout: JSON.stringify({ type: 'result', result: JSON.stringify(['notes/c.md', 'notes/a.md']) }), stderr: '' };
  };
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    const result = await rankNotes('query text', candidates, { exec });
    assert.deepEqual(result, [
      { path: 'notes/c.md', excerpt: 'ccc' },
      { path: 'notes/a.md', excerpt: 'aaa' },
    ]);
  });
});

test('rankNotes returns [] when the model reports nothing relevant', async () => {
  const candidates = [{ path: 'notes/a.md', excerpt: 'aaa' }];
  const exec = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: 'claude 1.0.0', stderr: '' };
    return { stdout: JSON.stringify({ type: 'result', result: '[]' }), stderr: '' };
  };
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    const result = await rankNotes('query text', candidates, { exec });
    assert.deepEqual(result, []);
  });
});

test('rankNotes ignores hallucinated paths not present in the candidate set', async () => {
  const candidates = [{ path: 'notes/a.md', excerpt: 'aaa' }];
  const exec = async (cmd, args) => {
    if (args[0] === '--version') return { stdout: 'claude 1.0.0', stderr: '' };
    return {
      stdout: JSON.stringify({ type: 'result', result: JSON.stringify(['notes/nonexistent.md', 'notes/a.md']) }),
      stderr: '',
    };
  };
  resetCliCache();
  await withEnv({ SPEARHEAD_RANKING_CLI: undefined }, async () => {
    const result = await rankNotes('query text', candidates, { exec });
    assert.deepEqual(result, [{ path: 'notes/a.md', excerpt: 'aaa' }]);
  });
});

test('RankingCliUnavailableError and RankingCliRequestError are both real, distinctly-named Error subclasses', () => {
  const unavailable = new RankingCliUnavailableError();
  const request = new RankingCliRequestError('boom');
  assert.ok(unavailable instanceof Error);
  assert.equal(unavailable.name, 'RankingCliUnavailableError');
  assert.ok(request instanceof Error);
  assert.equal(request.name, 'RankingCliRequestError');
});

'use strict';
// Tests for server.js: T-1 proved the core architectural assumption behind
// A-1 (dual-runtime MCP server support) with a stub `search` tool; this
// suite covers T-6's real wiring -- the server starts the T-5 watch
// pipeline on boot (PROBLEM.md #1, #3), and `search` embeds the query,
// ranks index entries via T-4's similarity.js, and returns
// `{path, excerpt, score}` for the top results, surfacing a missing API key
// or embeddings-call failure as a named tool error rather than an
// empty/silent result (PROBLEM.md #2, #10).
//
// Two styles of test, matching what each is proving:
//   - "starts and lists tools" / "starts the watch pipeline on boot" spawn
//     a real server subprocess over its stdio transport (the SDK's own
//     client), the same way T-1's tests did -- proving the actual bundled
//     entry point boots for real.
//   - `search` ranking/error-surfacing tests connect a client to
//     `createServer({root, embed})` in-process via the SDK's
//     InMemoryTransport, with a fixture index pre-populated in a temp dir
//     and an injected embed stub -- no live network call is ever made by
//     this suite, and no subprocess is needed to exercise the tool handler
//     itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createServer } = require('./server.js');
const { loadIndex, setEntry } = require('./lib/index-store.js');
const { MissingApiKeyError, EmbeddingsRequestError } = require('./lib/embeddings.js');

const SERVER_PATH = path.join(__dirname, 'server.js');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spearhead-server-'));
}

function writeFile(root, relPath, content = 'hello') {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return content;
}

// Polls `check` until it returns truthy or `timeoutMs` elapses -- the
// boot-time reconcile runs asynchronously in the spawned subprocess, so
// tests wait for its effect rather than asserting immediately after
// connect() resolves (same pattern as lib/watch.test.js).
async function waitFor(check, timeoutMs = 4000, intervalMs = 20) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

// Spawns a fresh server process per call, speaks MCP over its stdio
// transport via the SDK's own client, and always closes the connection
// (which also tears down the spawned process) even if fn throws. Every
// spawn is pinned to a fresh temp dir as both `cwd` and `CLAUDE_PROJECT_DIR`
// (belt-and-suspenders against resolveRoot()'s fallback chain) so booting
// the real watch pipeline (main()) never touches this repo's own
// spearhead-knowledge/spearhead-attacks trees. Also disables the embeddings
// API key by default so a boot-time reconcile of a fixture file never makes
// a live network call. `options.setup(root)` runs before the process is
// spawned (e.g. to write fixture files the boot-time reconcile should see);
// `options.env` extends/overrides the subprocess environment.
async function withStdioClient(fn, options = {}) {
  const root = mkRoot();
  if (options.setup) options.setup(root);
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, SPEARHEAD_EMBEDDINGS_API_KEY: '', ...options.env },
  });
  const client = new Client({ name: 'spearhead-knowledge-test-client', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await fn(client, root);
  } finally {
    await client.close();
  }
}

// Connects a client to `createServer(options)` in-process over a linked
// InMemoryTransport pair -- no subprocess, no stdio, so `options.embed` (a
// plain injected async function) is reachable from the test. Always closes
// the connection even if fn throws.
async function withInMemoryClient(options, fn) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(options);
  const client = new Client({ name: 'spearhead-knowledge-test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test('server starts and lists a search tool with the expected input schema', async () => {
  await withStdioClient(async (client) => {
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === 'search');
    assert.ok(search, 'search tool must be registered');
    assert.equal(search.inputSchema.type, 'object');
    assert.equal(search.inputSchema.properties.query.type, 'string');
    assert.ok(search.inputSchema.required.includes('query'), 'query must be required');
    assert.equal(search.inputSchema.properties.limit.type, 'number');
    assert.ok(!search.inputSchema.required.includes('limit'), 'limit must be optional');
  });
});

test('server starts the T-5 watch pipeline on boot: watched dirs exist and a pre-existing file gets reconciled', async () => {
  await withStdioClient(
    async (client, root) => {
      // watchKnowledgeSources() creates its two owned dirs synchronously on
      // start; if boot never called it, neither would exist.
      assert.equal(fs.existsSync(path.join(root, 'spearhead-knowledge')), true);
      assert.equal(fs.existsSync(path.join(root, 'spearhead-attacks')), true);

      // Boot also runs a startup reconcile() (T-5) over the pre-existing
      // fixture file below, with no manual index-build step (PROBLEM.md
      // #1) -- the embeddings key is deliberately unset for this spawn, so
      // reconcile is expected to reach it and mark it pending (not leave it
      // absent from the index) rather than silently skip it.
      const seen = await waitFor(() => {
        const index = loadIndex(root);
        return index['spearhead-knowledge/code/pre-existing.md'];
      });
      assert.ok(seen, 'boot-time reconcile must have reached the pre-existing fixture file');
      assert.equal(seen.pending, true);
    },
    { setup: (root) => writeFile(root, 'spearhead-knowledge/code/pre-existing.md', 'pre-existing content') }
  );
});

test('search tool ranks fixture index entries by similarity and returns {path, excerpt, score}', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/close.md', 'the file that matches the query well');
  writeFile(root, 'spearhead-knowledge/code/far.md', 'an unrelated note');
  setEntry(root, 'spearhead-knowledge/code/close.md', {
    hash: 'h1',
    embedding: [1, 0, 0],
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/far.md', {
    // [1, 1, 0] scores ~0.707 against the [1, 0, 0] query -- above
    // similarity.js's DEFAULT_MIN_SCORE cutoff (0.5) so it still surfaces
    // as a second, lower-ranked result, while staying clearly below
    // close.md's exact-match score of 1 so the ranking order this test
    // asserts still holds.
    hash: 'h2',
    embedding: [1, 1, 0],
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });

  const embed = async (text) => {
    assert.equal(text, 'find the matching file');
    return [1, 0, 0]; // identical to close.md's embedding -> ranks first
  };

  await withInMemoryClient({ root, embed }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'find the matching file' } });
    assert.equal(result.isError, undefined);
    const { results } = JSON.parse(result.content[0].text);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.path),
      ['spearhead-knowledge/code/close.md', 'spearhead-knowledge/code/far.md']
    );
    assert.equal(results[0].score, 1);
    assert.equal(results[0].excerpt, 'the file that matches the query well');
    assert.ok(Object.prototype.hasOwnProperty.call(results[0], 'path'));
    assert.ok(Object.prototype.hasOwnProperty.call(results[0], 'excerpt'));
    assert.ok(Object.prototype.hasOwnProperty.call(results[0], 'score'));
  });
});

test('search tool defaults to the top 8 results and honors a custom limit', async () => {
  const root = mkRoot();
  // [1, i * 0.1] stays close to parallel with the [1, 0] query across the
  // whole i=0..11 range (worst case, i=11, still scores ~0.67), keeping
  // every fixture above similarity.js's DEFAULT_MIN_SCORE cutoff (0.5) so
  // this test isolates limit-truncation behavior rather than the cutoff.
  for (let i = 0; i < 12; i++) {
    const relPath = `spearhead-knowledge/code/note-${i}.md`;
    writeFile(root, relPath, `note ${i}`);
    setEntry(root, relPath, {
      hash: `h${i}`,
      embedding: [1, i * 0.1],
      updated: '2026-07-22T00:00:00.000Z',
      type: 'code',
    });
  }
  const embed = async () => [1, 0];

  await withInMemoryClient({ root, embed }, async (client) => {
    const defaultResult = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(JSON.parse(defaultResult.content[0].text).results.length, 8);

    const limited = await client.callTool({ name: 'search', arguments: { query: 'anything', limit: 3 } });
    assert.equal(JSON.parse(limited.content[0].text).results.length, 3);
  });
});

test('search tool excludes below-threshold entries and includes at/above-threshold entries (default minScore)', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/below.md', 'unrelated note');
  writeFile(root, 'spearhead-knowledge/code/above.md', 'closely related note');
  setEntry(root, 'spearhead-knowledge/code/below.md', {
    // Orthogonal to the [1, 0] query -> score 0, below the default 0.5 cutoff.
    hash: 'h1',
    embedding: [0, 1],
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/above.md', {
    // [0.8, 0.2] scores ~0.970 against [1, 0] -- comfortably above the 0.5 cutoff.
    hash: 'h2',
    embedding: [0.8, 0.2],
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  const embed = async () => [1, 0];

  await withInMemoryClient({ root, embed }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, undefined);
    const { results } = JSON.parse(result.content[0].text);
    assert.deepEqual(
      results.map((r) => r.path),
      ['spearhead-knowledge/code/above.md']
    );
  });
});

test('search tool returns results: [] as a successful response when every entry scores below the threshold', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/orthogonal.md', 'unrelated note');
  writeFile(root, 'spearhead-knowledge/code/opposite.md', 'opposite note');
  setEntry(root, 'spearhead-knowledge/code/orthogonal.md', {
    hash: 'h1',
    embedding: [0, 1], // score 0
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/opposite.md', {
    hash: 'h2',
    embedding: [-1, 0], // score -1
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  const embed = async () => [1, 0];

  await withInMemoryClient({ root, embed }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, undefined);
    const { results } = JSON.parse(result.content[0].text);
    assert.deepEqual(results, []);
  });
});

test('SPEARHEAD_SEARCH_MIN_SCORE overrides which entries are included', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/high.md', 'closely related note');
  writeFile(root, 'spearhead-knowledge/code/mid.md', 'somewhat related note');
  setEntry(root, 'spearhead-knowledge/code/high.md', {
    hash: 'h1',
    embedding: [1, 0], // score 1
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/mid.md', {
    // [1, 1] scores ~0.707 against [1, 0] -- above the default 0.5 cutoff,
    // below a stricter 0.95 override.
    hash: 'h2',
    embedding: [1, 1],
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  const embed = async () => [1, 0];

  const previous = process.env.SPEARHEAD_SEARCH_MIN_SCORE;
  try {
    await withInMemoryClient({ root, embed }, async (client) => {
      process.env.SPEARHEAD_SEARCH_MIN_SCORE = '0.95';
      const strict = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
      assert.deepEqual(
        JSON.parse(strict.content[0].text).results.map((r) => r.path),
        ['spearhead-knowledge/code/high.md']
      );

      process.env.SPEARHEAD_SEARCH_MIN_SCORE = '0.6';
      const lenient = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
      assert.deepEqual(
        JSON.parse(lenient.content[0].text).results.map((r) => r.path),
        ['spearhead-knowledge/code/high.md', 'spearhead-knowledge/code/mid.md']
      );
    });
  } finally {
    if (previous === undefined) delete process.env.SPEARHEAD_SEARCH_MIN_SCORE;
    else process.env.SPEARHEAD_SEARCH_MIN_SCORE = previous;
  }
});

test('unset or unparseable SPEARHEAD_SEARCH_MIN_SCORE falls back to the default threshold', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/mid.md', 'somewhat related note');
  writeFile(root, 'spearhead-knowledge/code/low.md', 'unrelated note');
  setEntry(root, 'spearhead-knowledge/code/mid.md', {
    hash: 'h1',
    embedding: [1, 1], // score ~0.707, above the default 0.5 cutoff
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/low.md', {
    hash: 'h2',
    embedding: [0, 1], // score 0, below the default cutoff
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  const embed = async () => [1, 0];

  const previous = process.env.SPEARHEAD_SEARCH_MIN_SCORE;
  try {
    await withInMemoryClient({ root, embed }, async (client) => {
      delete process.env.SPEARHEAD_SEARCH_MIN_SCORE;
      const unset = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
      assert.deepEqual(
        JSON.parse(unset.content[0].text).results.map((r) => r.path),
        ['spearhead-knowledge/code/mid.md']
      );

      process.env.SPEARHEAD_SEARCH_MIN_SCORE = 'not-a-number';
      const unparseable = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
      assert.deepEqual(
        JSON.parse(unparseable.content[0].text).results.map((r) => r.path),
        ['spearhead-knowledge/code/mid.md']
      );
    });
  } finally {
    if (previous === undefined) delete process.env.SPEARHEAD_SEARCH_MIN_SCORE;
    else process.env.SPEARHEAD_SEARCH_MIN_SCORE = previous;
  }
});

test('search tool surfaces a named, non-empty tool error when the embeddings API key is missing', async () => {
  const root = mkRoot();
  const embed = async () => {
    throw new MissingApiKeyError();
  };

  await withInMemoryClient({ root, embed }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.length > 0, 'error text must not be empty');
    assert.match(result.content[0].text, /MissingApiKeyError/);
  });
});

test('search tool surfaces a named, non-empty tool error when the embeddings call fails', async () => {
  const root = mkRoot();
  const embed = async () => {
    throw new EmbeddingsRequestError('embeddings API responded with status 500');
  };

  await withInMemoryClient({ root, embed }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /EmbeddingsRequestError/);
    assert.match(result.content[0].text, /status 500/);
  });
});

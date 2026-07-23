'use strict';
// Tests for server.js: T-1 proved the core architectural assumption behind
// A-1 (dual-runtime MCP server support) with a stub `search` tool; T-6
// wired up the real thing (boot-time T-5 watch pipeline); this suite covers
// T-3's rework of `search`'s ranking step -- it builds {path, excerpt}
// candidates from every indexed path and asks rank.js's rankNotes (T-1) to
// filter/order them by relevance, returning {path, excerpt} for the top
// results (no numeric score, per PROBLEM.md/DESIGN.md's resolved decision),
// surfacing a ranking-CLI-unavailable or ranking-request failure as a named
// tool error rather than an empty/silent result (PROBLEM.md #10).
//
// Two styles of test, matching what each is proving:
//   - "starts and lists tools" / "starts the watch pipeline on boot" spawn
//     a real server subprocess over its stdio transport (the SDK's own
//     client), the same way T-1's tests did -- proving the actual bundled
//     entry point boots for real.
//   - `search` ranking/error-surfacing tests connect a client to
//     `createServer({root, rank})` in-process via the SDK's
//     InMemoryTransport, with a fixture index pre-populated in a temp dir
//     and an injected `rank` stub -- no real subprocess is ever spawned by
//     this suite, and no ranking CLI needs to be installed to exercise the
//     tool handler itself.
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
const { RankingCliUnavailableError, RankingCliRequestError } = require('./lib/rank.js');

const SERVER_PATH = path.join(__dirname, 'server.js');
const SERVER_SOURCE = fs.readFileSync(SERVER_PATH, 'utf8');

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
// spearhead-knowledge/spearhead-attacks trees. `options.setup(root)` runs
// before the process is spawned (e.g. to write fixture files the boot-time
// reconcile should see); `options.env` extends/overrides the subprocess
// environment.
async function withStdioClient(fn, options = {}) {
  const root = mkRoot();
  if (options.setup) options.setup(root);
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...options.env },
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
// InMemoryTransport pair -- no subprocess, no stdio, so `options.rank` (a
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
      // #1) -- indexing has no network dependency, so reconcile is expected
      // to reach it and produce a normal successful entry (not leave it
      // absent from the index) rather than silently skip it.
      const seen = await waitFor(() => {
        const index = loadIndex(root);
        return index['spearhead-knowledge/code/pre-existing.md'];
      });
      assert.ok(seen, 'boot-time reconcile must have reached the pre-existing fixture file');
      assert.equal(seen.pending, undefined);
      assert.ok(seen.hash, 'entry must have a hash');
      assert.ok(seen.updated, 'entry must have an updated timestamp');
      assert.ok(seen.type, 'entry must have a type');
    },
    { setup: (root) => writeFile(root, 'spearhead-knowledge/code/pre-existing.md', 'pre-existing content') }
  );
});

test('search tool ranks fixture index entries via the injected rank stub and returns {path, excerpt}', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/close.md', 'the file that matches the query well');
  writeFile(root, 'spearhead-knowledge/code/far.md', 'a somewhat related note');
  setEntry(root, 'spearhead-knowledge/code/close.md', {
    hash: 'h1',
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  setEntry(root, 'spearhead-knowledge/code/far.md', {
    hash: 'h2',
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });

  const rank = async (query, candidates) => {
    assert.equal(query, 'find the matching file');
    assert.equal(candidates.length, 2);
    assert.deepEqual(
      candidates.map((c) => c.path).sort(),
      ['spearhead-knowledge/code/close.md', 'spearhead-knowledge/code/far.md']
    );
    // Simulate the ranking CLI's judgment: both relevant, close.md first.
    return candidates.slice().sort((a, b) => (a.path < b.path ? -1 : 1));
  };

  await withInMemoryClient({ root, rank }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'find the matching file' } });
    assert.equal(result.isError, undefined);
    const { results } = JSON.parse(result.content[0].text);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.path),
      ['spearhead-knowledge/code/close.md', 'spearhead-knowledge/code/far.md']
    );
    assert.equal(results[0].excerpt, 'the file that matches the query well');
    assert.ok(Object.prototype.hasOwnProperty.call(results[0], 'path'));
    assert.ok(Object.prototype.hasOwnProperty.call(results[0], 'excerpt'));
    assert.ok(!Object.prototype.hasOwnProperty.call(results[0], 'score'), 'results must not carry a score field');
  });
});

test('search tool defaults to the top 8 results and honors a custom limit', async () => {
  const root = mkRoot();
  for (let i = 0; i < 12; i++) {
    const relPath = `spearhead-knowledge/code/note-${i}.md`;
    writeFile(root, relPath, `note ${i}`);
    setEntry(root, relPath, { hash: `h${i}`, updated: '2026-07-22T00:00:00.000Z', type: 'code' });
  }
  // Simulate the ranking CLI judging every candidate relevant, in index order.
  const rank = async (query, candidates) => candidates;

  await withInMemoryClient({ root, rank }, async (client) => {
    const defaultResult = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(JSON.parse(defaultResult.content[0].text).results.length, 8);

    const limited = await client.callTool({ name: 'search', arguments: { query: 'anything', limit: 3 } });
    assert.equal(JSON.parse(limited.content[0].text).results.length, 3);
  });
});

test('search tool returns results: [] as a successful response when nothing is relevant', async () => {
  const root = mkRoot();
  writeFile(root, 'spearhead-knowledge/code/unrelated.md', 'unrelated note');
  setEntry(root, 'spearhead-knowledge/code/unrelated.md', {
    hash: 'h1',
    updated: '2026-07-22T00:00:00.000Z',
    type: 'code',
  });
  // Simulate the ranking CLI judging nothing relevant to the query.
  const rank = async () => [];

  await withInMemoryClient({ root, rank }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, undefined);
    const { results } = JSON.parse(result.content[0].text);
    assert.deepEqual(results, []);
  });
});

test('search tool surfaces a named, non-empty tool error when the ranking CLI is unavailable', async () => {
  const root = mkRoot();
  const rank = async () => {
    throw new RankingCliUnavailableError();
  };

  await withInMemoryClient({ root, rank }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.length > 0, 'error text must not be empty');
    assert.match(result.content[0].text, /RankingCliUnavailableError/);
  });
});

test('search tool surfaces a named, non-empty tool error when the ranking CLI request fails', async () => {
  const root = mkRoot();
  const rank = async () => {
    throw new RankingCliRequestError('claude CLI invocation failed: timed out', { cause: new Error('timeout') });
  };

  await withInMemoryClient({ root, rank }, async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /RankingCliRequestError/);
    assert.match(result.content[0].text, /timed out/);
  });
});

test('search no longer references the removed embeddings/min-score env vars or the embeddings/similarity modules', () => {
  for (const needle of [
    'SPEARHEAD_EMBEDDINGS_API_KEY',
    'SPEARHEAD_EMBEDDINGS_ENDPOINT',
    'SPEARHEAD_SEARCH_MIN_SCORE',
    'rankBySimilarity',
    "require('./lib/embeddings.js')",
    "require('./lib/similarity.js')",
  ]) {
    assert.ok(!SERVER_SOURCE.includes(needle), `server.js must not reference ${needle}`);
  }
  assert.ok(!/cosine similarity/i.test(SERVER_SOURCE), 'SEARCH_TOOL.description must not mention cosine similarity');
  assert.ok(
    !/minimum relevance score/i.test(SERVER_SOURCE),
    'SEARCH_TOOL.description must not mention a minimum relevance score threshold'
  );
});

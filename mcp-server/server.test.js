'use strict';
// Tests for server.js: proves the core architectural assumption behind A-1
// (dual-runtime MCP server support) -- the bundled server starts over the
// stdio transport, lists its tools via the real MCP SDK client, and exposes
// `search` with the expected input schema. Real search/embeddings/index
// logic is a stub here (returns an empty result set); full logic lands in
// T-6. No live network/embeddings calls are made by these tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const SERVER_PATH = path.join(__dirname, 'server.js');

// Spawns a fresh server process per call, speaks MCP over its stdio
// transport via the SDK's own client, and always closes the connection
// (which also tears down the spawned process) even if fn throws.
async function withClient(fn) {
  const transport = new StdioClientTransport({ command: 'node', args: [SERVER_PATH] });
  const client = new Client({ name: 'spearhead-knowledge-test-client', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test('server starts and lists a search tool with the expected input schema', async () => {
  await withClient(async (client) => {
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

test('search tool call returns a stub empty result set', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.results, []);
  });
});

test('search tool call accepts an optional limit argument', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: 'search', arguments: { query: 'anything', limit: 3 } });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.results, []);
  });
});

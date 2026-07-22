#!/usr/bin/env node
'use strict';
// Bundled MCP server (ADR-001, ADR-005): declared in both
// .claude-plugin/plugin.json and .kimi-plugin/plugin.json, spawned by the
// host runtime as a stdio subprocess. This task (A-1/T-1) proves the core
// architectural assumption -- that both runtimes can load a bundled MCP
// server and discover its tools -- so `search` is a stub here: it always
// returns an empty result set. Real index/embeddings logic lands in T-6.
//
// Low-level Server API (not McpServer/registerTool) so the tool's input
// schema is a plain JSON Schema object, not a zod shape -- keeps
// @modelcontextprotocol/sdk the only dependency this package declares.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const SEARCH_TOOL = {
  name: 'search',
  description:
    'Semantic search over the spearhead-knowledge base. Stub implementation: always returns an empty result set; full index/embeddings logic lands in T-6.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query text' },
      limit: { type: 'number', description: 'Max results to return (default 8)' },
    },
    required: ['query'],
  },
};

function createServer() {
  const server = new Server({ name: 'spearhead-knowledge', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SEARCH_TOOL] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'search') {
      throw new Error(`unknown tool: ${request.params.name}`);
    }
    // Stub: no index exists yet (T-3 through T-6 build it). Always empty.
    return { content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] };
  });

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createServer, SEARCH_TOOL };

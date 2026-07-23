#!/usr/bin/env node
'use strict';
// Bundled MCP server (ADR-001, ADR-005): declared in both
// .claude-plugin/plugin.json and .kimi-plugin/plugin.json, spawned by the
// host runtime as a stdio subprocess. T-1 proved the core architectural
// assumption (dual-runtime MCP server support) with a stub `search` tool;
// this task (T-6) wires up the real thing: on boot, starts the T-5
// watch/pipeline (fs.watch + hash-gated embeddings + index store) against
// the project root, and the `search` tool embeds the query, ranks every
// index entry via T-4's similarity.js, and returns `{path, excerpt, score}`
// for the top results (PROBLEM.md #2). A missing API key or embeddings-call
// failure at query time is caught and returned as a named, non-empty tool
// error (`isError: true`), never a silent/empty result (PROBLEM.md #10).
//
// Low-level Server API (not McpServer/registerTool) so the tool's input
// schema is a plain JSON Schema object, not a zod shape -- keeps
// @modelcontextprotocol/sdk the only dependency this package declares.

const fs = require('node:fs');
const path = require('node:path');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const { createPipeline, reconcile } = require('./lib/pipeline.js');
const { watchKnowledgeSources } = require('./lib/watch.js');
const { loadIndex } = require('./lib/index-store.js');
const { rankBySimilarity } = require('./lib/similarity.js');
const { embed: defaultEmbed } = require('./lib/embeddings.js');
const { parseFrontmatter } = require('../lib/knowledge-frontmatter.js');

const DEFAULT_LIMIT = 8;
const EXCERPT_LENGTH = 200;

const SEARCH_TOOL = {
  name: 'search',
  description:
    'Semantic search over the spearhead-knowledge base. Embeds the query, ranks indexed notes/docs by cosine similarity, and returns the top matches as {path, excerpt, score}.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query text' },
      limit: { type: 'number', description: 'Max results to return (default 8)' },
    },
    required: ['query'],
  },
};

// Same project-dir resolution convention as scripts/state.js: an explicit
// override env var first, then process.cwd() (the host runtime spawns this
// server with the project root as its working directory).
function resolveRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

// Strips frontmatter (if any) and returns a short excerpt of the body for a
// search result. Reads the file fresh (not from the index) so the excerpt
// always reflects current on-disk content. A file that's since been deleted
// or become unreadable yields an empty excerpt rather than throwing --
// ranking/paths/scores still get returned to the caller.
function buildExcerpt(root, relPath) {
  let content;
  try {
    content = fs.readFileSync(path.join(root, relPath), 'utf8');
  } catch {
    return '';
  }
  const { body } = parseFrontmatter(content);
  const trimmed = body.trim();
  return trimmed.length > EXCERPT_LENGTH ? `${trimmed.slice(0, EXCERPT_LENGTH)}...` : trimmed;
}

// Core of the `search` tool: embeds `query`, ranks the on-disk index, and
// returns `{path, excerpt, score}` entries for the top `limit` (default 8)
// matches. `options.embed` overrides the embeddings client (tests inject a
// stub here; no live network call is made by this module's own test
// suite). Rejects with whatever error embed() throws (MissingApiKeyError,
// EmbeddingsRequestError) -- the caller (the tool handler) is responsible
// for turning that into a named tool error rather than swallowing it.
async function runSearch(root, { query, limit } = {}, options = {}) {
  const embed = options.embed || defaultEmbed;
  const effectiveLimit = typeof limit === 'number' ? limit : DEFAULT_LIMIT;

  const queryEmbedding = await embed(query);
  const index = loadIndex(root);
  const ranked = rankBySimilarity(index, queryEmbedding, effectiveLimit);
  return ranked.map(({ path: relPath, score }) => ({
    path: relPath,
    excerpt: buildExcerpt(root, relPath),
    score,
  }));
}

// Starts the T-5 watch pipeline against `root`: a sequential hash-gated
// embeddings queue (pipeline.js) fed by a recursive fs.watch over the three
// knowledge sources (watch.js), plus a one-time startup reconcile so an
// index left stale/pending by a crash (or a project that's never been
// indexed at all) self-heals with no manual rebuild step (PROBLEM.md #1,
// #3). Returns `{pipeline, watcher, reconciled}`; `reconciled` is the
// promise for the startup reconcile settling, primarily a test convenience.
function startPipeline(root, options = {}) {
  const pipeline = createPipeline(root, options);
  const watcher = watchKnowledgeSources(root, pipeline.enqueue);
  const reconciled = reconcile(root, pipeline);
  return { pipeline, watcher, reconciled };
}

function createServer(options = {}) {
  const root = options.root || resolveRoot();
  const embed = options.embed;

  const server = new Server({ name: 'spearhead-knowledge', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SEARCH_TOOL] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'search') {
      throw new Error(`unknown tool: ${request.params.name}`);
    }
    const args = request.params.arguments || {};
    try {
      const results = await runSearch(root, args, { embed });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    } catch (err) {
      // A clear, named tool error (PROBLEM.md #10) -- surfaced as an
      // isError result rather than thrown, so it reaches the caller as
      // part of the tool call's own result instead of a raw protocol
      // rejection, and rather than silently returning an empty result set.
      return {
        isError: true,
        content: [{ type: 'text', text: `${err.name || 'Error'}: ${err.message}` }],
      };
    }
  });

  return server;
}

async function main() {
  const root = resolveRoot();
  startPipeline(root);
  const server = createServer({ root });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createServer, runSearch, startPipeline, resolveRoot, SEARCH_TOOL };

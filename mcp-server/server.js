#!/usr/bin/env node
'use strict';
// Bundled MCP server (ADR-001, ADR-005): declared in both
// .claude-plugin/plugin.json and .kimi-plugin/plugin.json, spawned by the
// host runtime as a stdio subprocess. T-1 proved the core architectural
// assumption (dual-runtime MCP server support) with a stub `search` tool;
// T-6 wired up the real thing (boot-time T-5 watch/pipeline against the
// project root); this task (T-3) reworks `search`'s ranking step to use
// T-1's CLI-based rank.js instead of embeddings/cosine-similarity
// (PROBLEM.md/DESIGN.md's resolved decision to drop numeric similarity
// scoring in favor of the ranking CLI's own relevance judgment): the
// `search` tool builds `{path, excerpt}` candidates for every indexed path
// and asks rankNotes() to filter/order them, returning `{path, excerpt}`
// for the top results -- no `score` field, since relevance is now conveyed
// by array order and by omission of non-matches. A ranking-CLI-unavailable
// or ranking-request failure at query time is caught and returned as a
// named, non-empty tool error (`isError: true`), never a silent/empty
// result (PROBLEM.md #10); an empty result because nothing was genuinely
// relevant remains a distinct, successful response.
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
const { rankNotes } = require('./lib/rank.js');
const { parseFrontmatter } = require('../lib/knowledge-frontmatter.js');

const DEFAULT_LIMIT = 8;
const EXCERPT_LENGTH = 200;

const SEARCH_TOOL = {
  name: 'search',
  description:
    'Search over the spearhead-knowledge base. Ranks indexed notes/docs against the query using the ranking CLI\'s own relevance judgment, and returns the relevant matches, most relevant first, as {path, excerpt}. Non-relevant candidates are omitted entirely rather than scored; an empty result set means no indexed note was genuinely relevant to the query, not a tool malfunction.',
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

// Core of the `search` tool: builds a {path, excerpt} candidate for every
// indexed path and asks the ranking CLI (via rank.js's rankNotes) which are
// relevant, in relevance order, then truncates to `limit` (default 8).
// `options.rank` overrides rankNotes itself (tests inject a stub here; no
// real subprocess is spawned by this module's own test suite). Rejects with
// whatever error rank() throws (RankingCliUnavailableError,
// RankingCliRequestError) -- the caller (the tool handler) is responsible
// for turning that into a named tool error rather than swallowing it. A
// validly-ranked empty array (nothing relevant) is returned as-is, a
// distinct, legitimate outcome from a rejection.
async function runSearch(root, { query, limit } = {}, options = {}) {
  const rank = options.rank || rankNotes;
  const effectiveLimit = typeof limit === 'number' ? limit : DEFAULT_LIMIT;

  const index = loadIndex(root);
  const candidates = Object.keys(index).map((relPath) => ({
    path: relPath,
    excerpt: buildExcerpt(root, relPath),
  }));
  const ranked = await rank(query, candidates, options);
  return ranked.slice(0, effectiveLimit);
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
  const rank = options.rank;

  const server = new Server({ name: 'spearhead-knowledge', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [SEARCH_TOOL] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'search') {
      throw new Error(`unknown tool: ${request.params.name}`);
    }
    const args = request.params.arguments || {};
    try {
      const results = await runSearch(root, args, { rank });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    } catch (err) {
      // A clear, named tool error (PROBLEM.md #10) -- e.g.
      // RankingCliUnavailableError or RankingCliRequestError -- surfaced as
      // an isError result rather than thrown, so it reaches the caller as
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

# ADR-009: Replace the MCP-server search architecture with an in-agent `guru` sub-agent

## Context

A-1 through A-4 built and then repeatedly reworked an MCP-server-based
search architecture for the second-brain knowledge base: a persistent
subprocess (declared via `mcpServers` in both plugin manifests) that
file-watched `spearhead-knowledge/`, maintained an index, and exposed a
`search` tool. The ranking backend inside that server moved from
third-party embeddings (Voyage AI, A-1) to CLI-subprocess-based LLM
ranking (`claude --print`/`kimi --prompt`, A-4).

Further discussion after A-4 shipped surfaced a more fundamental issue:
an MCP server is a separate subprocess with no callback into the host's
own running conversation. Any LLM reasoning it performs necessarily means
either a third-party API call (A-1's problem) or a brand-new, disconnected
CLI session per search (A-4's problem — real added latency and cost for
no benefit, since the calling agent was already a running LLM session
capable of the same reasoning). ADR-001 chose an MCP server specifically
to give callers "a persistent, declarable, tool-callable" search
capability, reasoning that raw grep wasn't semantically powerful enough.
That reasoning weakens considerably once the ranking mechanism is an
LLM's own judgment rather than vector math — an already-running agent
using its own `Glob`/`Grep`/`Read` tools and reasoning inline is at least
as capable, with zero extra infrastructure.

## Decision

Delete `mcp-server/` entirely (server, index, file-watching, all four
generations of ranking backend) and replace its capability with a
dedicated `guru` sub-agent (`agents/guru.md`, dispatched via the Agent
tool by an already-running Claude Code session, same pattern as
`spearhead-scout`/`-coder`/`-verifier`). `guru` searches
`spearhead-knowledge/**/*.md` directly, cross-checks any match's
`source_hash` against a freshly-computed hash of its source file to
detect staleness (reusing A-2's exact hash-compare idiom), falls back to
reading/grepping the actual source when nothing relevant or only stale
matches exist, and documents what it finds by writing or refreshing a
`code/` note. `guru` is dispatched internally only — no direct
user-facing command — and is scoped to `code/` notes only;
`decisions/`/`design/`/`architecture/` notes remain agent-judgment, as
they have been since A-1's original, never-fully-built "opportunistic
capture" design.

This is a direct reversal of ADR-001. It's the right call once the
premise underlying that decision (semantic search requires infrastructure
beyond what an agent's own tools provide) no longer holds.

## Consequences

- No persistent background process, no index file, no file-watching, no
  `mcpServers` manifest declaration — the second-brain feature's entire
  runtime footprint shrinks to: markdown files on disk, a sub-agent
  definition, and the existing nudge hooks (`knowledge-nudge.js`,
  reworked `remind.js`).
- Zero per-search latency/cost beyond the calling agent's own reasoning —
  no subprocess spawn, no CLI-availability detection, no output-format
  parsing fragility (the entire class of failure A-4's `rank.js` had to
  guard against, `RankingCliUnavailableError`/`RankingCliRequestError`,
  no longer exists).
- Every environment precondition A-1 through A-4 introduced
  (`SPEARHEAD_EMBEDDINGS_API_KEY`, `SPEARHEAD_EMBEDDINGS_ENDPOINT`,
  `SPEARHEAD_SEARCH_MIN_SCORE`, `SPEARHEAD_RANKING_CLI`, a `claude`/`kimi`
  CLI installed and authenticated) is gone. `guru`'s only real dependency
  is the same tools (`Glob`/`Grep`/`Read`) any spearhead sub-agent already
  uses.
- The knowledge base becomes directly Obsidian-compatible without any
  extra machinery — it was always just markdown files with frontmatter
  and wikilinks; removing the MCP-server layer doesn't change that, it
  just removes an indirection that wasn't buying anything Obsidian's own
  linking/graph view didn't already do natively.
- `mcp-server/`'s four generations of implementation (A-1's embeddings
  client, A-3's threshold logic, A-4's CLI-ranking module) become dead
  code, deleted in full — a real amount of built-and-shipped work is
  discarded. This is treated as the correct outcome of an honest
  design reversal, not a sunk-cost reason to keep the old architecture;
  the alternative (patching a fifth generation onto an architecture whose
  core premise no longer holds) would be worse.

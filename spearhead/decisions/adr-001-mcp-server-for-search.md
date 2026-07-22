## Context

The second-brain feature needs a way for agents to semantically search
accumulated project knowledge instead of reading files by trial and error.
Two mechanisms were considered: an on-demand CLI script the agent shells out
to, versus a persistent MCP server exposing a real `search` tool.

## Decision

Ship a bundled MCP server (`mcp-server/`), declared in both
`.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json`. It file-watches
the knowledge sources, maintains a live embeddings index, and exposes a
`search` tool directly in the agent's tool palette.

## Consequences

- Introduces the plugin's first real npm dependency (the MCP SDK), isolated
  to `mcp-server/package.json` so `scripts/` and `hooks/` remain
  dependency-free.
- Search is a genuine tool call (like `Read` or `Grep`), not a shell-out —
  the agent can use it without an intermediate slash command.
- Requires a persistent process; plugin loaders on both runtimes must
  support declared MCP servers (confirmed for both Claude Code and
  kimi-code).
- Index freshness depends on `fs.watch` firing reliably; the same
  hash-comparison logic used for incremental updates also self-heals after
  a crash (see `DESIGN.md` failure-mode handling), so this is not a single
  point of permanent staleness.

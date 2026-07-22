## Context

The MCP server is the plugin's first component to need a real npm
dependency (the MCP SDK). Every other script (`scripts/`, `hooks/`) is
currently dependency-free by design (Node built-ins only), documented in the
plugin's README.

## Decision

The MCP server lives in its own top-level directory, `mcp-server/`, with its
own `package.json` and `node_modules/`, separate from the repo root.
Embeddings API calls use Node's built-in `fetch` rather than an HTTP client
library, keeping the MCP SDK as the only new dependency.

## Consequences

- `scripts/` and `hooks/` remain dependency-free exactly as before — the
  new dependency's blast radius is contained to one directory.
- The plugin installer/loader must run `npm install` inside `mcp-server/`
  (or the dependency must be vendored) — this is a packaging detail for the
  breakdown/execute phases to confirm against how the plugin is distributed.
- Anyone auditing "does this plugin have dependencies" can answer precisely
  by directory rather than the answer depending on which script they're
  reading.

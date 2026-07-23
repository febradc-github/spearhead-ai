# ADR-008: Replace the embeddings-API ranking backend with CLI-based LLM ranking

## Context

The `spearhead-knowledge` MCP server's `search` tool depended on a
third-party embeddings API (Voyage AI, via `SPEARHEAD_EMBEDDINGS_API_KEY`)
to compute vector embeddings, ranked by cosine similarity
(`mcp-server/lib/similarity.js`, including A-3's minimum-score cutoff).
The user does not want any third-party API dependency in the plugin, even
though the existing implementation already degraded gracefully without a
key configured (indexing entries stayed `pending`, hooks only nudged,
nothing crashed).

Two alternatives were considered and rejected before reaching this
decision:

1. **Delete the entire second-brain feature** (MCP server, hooks, notes
   layout) — rejected by the user after further discussion; the feature
   itself is wanted, only the third-party dependency isn't.
2. **A local/offline embedding model** (e.g. MiniLM via
   `onnxruntime-node`) — technically feasible on modest hardware (a
   quantized MiniLM-class model needs well under 1GB RAM, no GPU), but
   still requires a one-time model-weight download from a third-party
   host (e.g. Hugging Face) and adds a heavier native dependency
   (`onnxruntime-node`, platform-specific binaries) than the plugin
   currently has anywhere else.

## Decision

Replace the embeddings-and-cosine-similarity backend with LLM-based
ranking, invoking whichever CLI matches the runtime already
installed and authenticated for the user — `claude` (Claude Code,
`--print --output-format json`) or `kimi` (kimi-code, `--prompt
--output-format stream-json`) — via `node:child_process` with an argument
array (never shell-string interpolation, to eliminate command-injection
risk regardless of query content).

This was chosen over the local-model alternative because:
- It requires **zero new accounts, API keys, or vendor relationships** —
  the whole stated objection to Voyage AI. A local model still involves a
  third-party asset download and a materially heavier install
  (native binary, model weights) for a codebase that today is pure
  JS plus one MCP SDK dependency.
- It is honestly not "zero network calls ever" either — invoking `claude`
  or `kimi` still makes a network call per search, just to a provider the
  user is already authenticated with, not a new one requiring a new key.
  This tradeoff was discussed explicitly with the user and accepted.

A single CLI invocation per `search` call, given the whole candidate note
list in one prompt, was chosen over per-note scoring (N calls per search
— far higher latency and cost for no benefit at this feature's target
corpus scale) and over a lexical pre-filter step (adds a second matching
algorithm and a silent-false-negative risk, solving a large-corpus
problem this attack has no evidence exists yet).

## Consequences

- No file in the shipped plugin computes, stores, or requests a vector
  embedding from any provider; `SPEARHEAD_EMBEDDINGS_API_KEY`,
  `SPEARHEAD_EMBEDDINGS_ENDPOINT`, and `SPEARHEAD_SEARCH_MIN_SCORE` are no
  longer referenced anywhere.
- The plugin's dual-runtime support (`.claude-plugin/` / `.kimi-plugin/`)
  now extends to this feature too — the same MCP server code detects and
  uses whichever CLI is actually available, rather than assuming one.
- `search` results lose the numeric `score` field (an LLM's self-reported
  confidence isn't a meaningful calibrated number); relevance is conveyed
  by array order and by omission of non-matches, with an empty result
  meaning "nothing genuinely relevant," matching A-3's contract through a
  different mechanism.
- Indexing (`pipeline.js`) becomes purely local (watch → hash → store, no
  external call), simplifying it — all CLI-related failure handling now
  lives at query time in the new `rank.js` module instead.
- Prompt size scales with indexed-note count; this attack does not solve
  unbounded/enterprise-scale corpora — a future attack would need to
  revisit this if it becomes a real problem in practice.
- A new runtime precondition (`claude` or `kimi` CLI installed and
  authenticated) replaces the old one (`SPEARHEAD_EMBEDDINGS_API_KEY`
  set); its absence surfaces as a clear, named tool error, never a silent
  empty result, matching the plugin's existing fail-clearly philosophy.

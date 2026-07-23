# SHIP — A-1: Second brain: plugin decision/design documentation system

## What changed

**T-1 — MCP server skeleton + dual-runtime manifest declaration.** Bundled `mcp-server/` scaffolded with its own `package.json`/`node_modules` (isolated dependency footprint so `scripts/`/`hooks/` stay dependency-free), declared in both `.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json` as an `mcpServers` entry, with a stub `search` tool as the initial contract.

**T-2 — Shared frontmatter parser.** `lib/knowledge-frontmatter.js` extends `validate-state.js`'s existing minimal YAML parser to handle note frontmatter (`type`, `tags`, `related`, `source`, `updated`), reused by naming, indexing, and hook code.

**T-3 — Content hashing + embeddings client module.** `mcp-server/lib/hash.js` (sha256, `node:crypto`) and `mcp-server/lib/embeddings.js` (embeds text via `fetch` against `SPEARHEAD_EMBEDDINGS_API_KEY`/`SPEARHEAD_EMBEDDINGS_ENDPOINT`, no HTTP client dependency), with named `MissingApiKeyError`/`EmbeddingsRequestError` for clear failure surfacing.

**T-4 — Index storage + cosine similarity.** `mcp-server/lib/index-store.js` reads/writes `spearhead-knowledge/index/embeddings.json` atomically (temp file + rename), keyed by relative path, entries `{hash, embedding, updated, type}`. `mcp-server/lib/similarity.js` ranks entries by cosine similarity, no vector-db dependency.

**T-5 — File-watch pipeline.** `mcp-server/lib/watch.js` recursively watches (`fs.watch`) the three knowledge sources (`spearhead-knowledge/**/*.md`, `spearhead-attacks/**/*.md`, `README.md`/`docs/**/*.md`). `mcp-server/lib/pipeline.js` hash-gates each create/change event (skip if unchanged, else embed + index), processes events through a sequential in-memory queue (no concurrent embeddings calls under load spikes), marks failed embeds `pending` for retry without crashing the watcher, and self-heals on startup by reconciling against the index via the same hash-comparison path.

**T-6 — Real `search` MCP tool.** Replaced the T-1 stub: `server.js` now starts the T-5 pipeline on boot and exposes `search(query, limit?)`, embedding the query and ranking the index via `similarity.js`, returning `{path, excerpt, score}` (default limit 8). Missing API key or embeddings failures surface as clear, named tool errors rather than empty/silent results.

**T-7 — Deterministic naming script.** `scripts/knowledge-path.js` computes the canonical note path for a source file (`code/<parent>-<basename>.md`), checking existing notes' `source:` frontmatter synchronously and escalating one more parent level only on a genuine collision — existing notes are never renamed.

**T-8 — Search-first reminder.** Extended `hooks/remind.js`'s existing injected message (both full-rules and one-line-anchor variants) with a line nudging the agent to try the `spearhead-knowledge` search tool before reading source files, reusing `remind.js`'s proven cadence/idle-expiry management rather than adding a competing tracker. `rules/RULES.md` updated to match.

**T-9 — `knowledge-nudge.js` hook.** New `PostToolUse` hook registered in `hooks/hooks.json` (Claude Code) and `.kimi-plugin/plugin.json` (kimi-code) with two matchers: `Read` (nudges code documentation on a source file's first read, session-scoped no-repeat via the same idle-expiry pattern as `remind.js`) and `Bash|PowerShell` (on a successful `state.js transition <T-id> done`, reads the task's expected files from `status.yml` read-only and nudges a `## Changelog` update per file). Nudge-only — never writes state, never calls the embeddings API.

*(Mid-execution correction: T-9's expected-file set originally named `.claude-plugin/plugin.json` for Claude Code hook registration; replanned to `hooks/hooks.json` after discovering `.claude-plugin/plugin.json` has no `hooks` field in this repo — hooks are registered via `hooks/hooks.json`, confirmed against the three existing hooks and the upstream sibling project this convention was copied from.)*

**T-10 — README + CHANGELOG documentation.** README gained a "Second-brain knowledge base" section covering the three sources, the `spearhead-knowledge/` layout, the `search` tool, the `SPEARHEAD_EMBEDDINGS_API_KEY` requirement, and the opportunistic capture triggers. `CHANGELOG.md` gained a `0.7.0` entry.

## Why

From `PROBLEM.md`'s real goal: give any project using spearhead a persistent, queryable knowledge base combining spearhead's own decision record, existing project documentation, and knowledge spearhead generates opportunistically as it works — so both the user and Claude Code agents retrieve relevant context via natural-language search first, instead of re-deriving it by reading the repository file-by-file. The knowledge base grows the more spearhead is used, even on projects with thin existing documentation.

## How to verify

Per-task verification commands (all green in `spearhead-attacks/verify/V-<n>.1.md`):

- `node mcp-server/lib/hash.test.js`, `node mcp-server/lib/embeddings.test.js` (T-3)
- `node mcp-server/lib/index-store.test.js`, `node mcp-server/lib/similarity.test.js` (T-4)
- `node mcp-server/lib/watch.test.js`, `node mcp-server/lib/pipeline.test.js` (T-5)
- `node mcp-server/server.test.js` (T-6)
- `node scripts/knowledge-path.test.js` (T-7)
- `node hooks/remind.test.js` (T-8)
- `node hooks/knowledge-nudge.test.js` (T-9)
- `node -e "require('fs').readFileSync('README.md','utf8')"` (T-10 sanity)

Full-repo integration check (run after every merge, most recently post-T-10): `node --test` across the repo excluding gitignored `spearhead-attacks/worktrees/*` — 178/178 pass, 0 fail.

Manual smoke test for a reviewer: set `SPEARHEAD_EMBEDDINGS_API_KEY`, start `mcp-server/server.js` in a project with at least one completed attack and a README, confirm `spearhead-knowledge/index/embeddings.json` is created with no manual rebuild step, then call the `search` tool with a natural-language question and confirm a relevant `{path, excerpt, score}` result pointing at real file content.

## Tradeoffs

From `DESIGN.md`'s rejected alternatives:

- **Hook nudges over static `rules/RULES.md` prose** — static prose reminders don't reliably fire every session (the reason `remind.js`'s cadence-managed injection exists at all); rejected the simpler zero-new-code option to satisfy PROBLEM.md's "automatic byproduct, no extra step" requirement.
- **Persistent MCP server + live index over an on-demand CLI search script** — an on-demand script would re-embed/re-scan the knowledge base per query (slow, one API call per document per search — the opposite of the token/cost-saving goal); the MCP server maintains a live, incrementally-updated index instead. Also locked in by PROBLEM.md's explicit "Query interface: MCP server" requirement.
- **Single `embeddings.json` file over one JSON file per note** — avoids per-file I/O at query time (whole index loads once, plain-loop cosine similarity); atomic-rewrite cost of one growing file is negligible at documentation scale (hundreds, not millions, of notes), and it keeps the flat-file, dependency-light storage model.

Mid-execution deviation (not a rejected alternative, a correction): T-9's task file initially specified the wrong hook-registration file (see T-9 note above); corrected via `/spearhead:replan` before merge, no functional impact.

## Rollout

Plain deploy — this ships as part of the spearhead plugin itself (skills/commands/scripts/hooks/MCP server declared in both manifests), installable and usable by any project that installs spearhead. No feature flag: the MCP server and hooks are inert until `SPEARHEAD_EMBEDDINGS_API_KEY` is set and a project opts into using the `search` tool. The CHANGELOG's `0.7.0` entry does not yet have a matching `plugin.json`/`.kimi-plugin/plugin.json` version bump — flagged as a retro follow-up, per this repo's convention of version bumps as separate `chore:` commits.

## Monitor after release

From `DESIGN.md`'s failure-mode handling:

- **Embeddings API down or key missing**: watch for entries stuck `pending` in `embeddings.json` (indicates repeated embed failures) and for named `MissingApiKeyError`/`EmbeddingsRequestError` surfacing on `search` calls rather than silent empty results.
- **Load spikes** (many files changed at once, e.g. after a large task completes): the sequential in-memory queue should prevent concurrent embeddings calls / rate-limit bursts — watch for queue backlog growth if a project's watched-file churn is unusually high.
- **Malformed frontmatter**: should index with `type: unknown` and log a warning to server stderr rather than crash the watcher or skip the file — watch server stderr for these warnings as a signal of upstream note-authoring issues.
- **Server crash mid-index**: `embeddings.json` writes are atomic; on restart the server should re-scan and reconcile via the same hash-comparison path — watch that restart doesn't leave `pending` entries stuck indefinitely.

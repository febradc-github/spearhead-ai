## Problem statement

A-4 replaced the second-brain feature's third-party embeddings dependency
with a CLI-subprocess-based ranking mechanism (`mcp-server/lib/rank.js`
shelling out to `claude --print`/`kimi --prompt`). Further discussion
surfaced a more fundamental issue with that design: an MCP server is a
separate subprocess with no callback into the host's own running
conversation, so any LLM reasoning it does either means a third-party API
call or a brand-new, disconnected CLI subprocess session — neither of
which is actually necessary. The calling agent (Claude Code or kimi-code,
already running, already reasoning) can search and judge relevance itself
using its own built-in `Glob`/`Grep`/`Read` tools, with zero extra
inference cost, zero subprocess spawns, and zero CLI-availability
detection logic. This attack replaces the MCP-server/CLI-ranking
architecture entirely with a dedicated `guru` sub-agent that performs the
whole search → staleness-check → source-fallback → document loop
natively, and extends the knowledge base to be genuinely usable as an
Obsidian vault.

## Real goal

Delete `mcp-server/` in full and replace its search capability with a
`guru` sub-agent (same dispatch pattern as `spearhead-scout`/
`spearhead-coder`/`spearhead-verifier`) that: searches
`spearhead-knowledge/**/*.md` directly for relevance; cross-checks any
match's `source_hash` frontmatter against the current hash of its
`source:` file to detect staleness (reusing A-2's exact hash-compare
idiom); falls back to reading/grepping the actual source when nothing
relevant is found or the only matches are stale; and documents what it
learns from that fallback by writing or refreshing a `code/` note before
returning its answer. Alongside this, make the knowledge base directly
usable as an Obsidian vault (frontmatter-driven color-coding via
`cssclasses`, wikilink-based graph navigation, a documented Graph View
setup, and a `/spearhead:obsidian-graph` command that opens Obsidian
straight to the graph view).

## In scope

- Delete entirely: `mcp-server/` (the whole directory — `server.js`,
  `lib/rank.js`, `lib/pipeline.js`, `lib/watch.js`, `lib/index-store.js`,
  `lib/embeddings.js`/`lib/similarity.js` if any remnants remain, and all
  their tests, `package.json`, `package-lock.json`).
- Relocate `mcp-server/lib/hash.js`'s `hashContent` to `lib/hash.js` (a
  peer of the already-kept `lib/knowledge-frontmatter.js`); update
  `hooks/knowledge-nudge.js`'s import accordingly. No behavior change to
  `hashContent` itself — a pure relocation.
- New `agents/guru.md` sub-agent, dispatched via the Agent tool (Claude
  Code) with a kimi-code fallback path (kimi-code doesn't support
  plugin-defined sub-agents, per this repo's existing convention — the
  skill/hook that would dispatch `guru` falls back to doing the same
  search→staleness→fallback→document steps inline under kimi-code,
  mirroring how other Claude-Code-only agents already degrade).
  `guru`'s job, per the confirmed scope from this attack's dialogue:
  - Searches `spearhead-knowledge/**/*.md` via `Glob`/`Grep`/`Read` (no
    index, no server) for notes relevant to the query it's given.
  - For any match, cross-checks the note's `source_hash` frontmatter
    against a freshly-computed hash of the file at its `source:` path
    (via the relocated `hash.js`). A mismatch (or a `source:` path that
    no longer exists) means the note is stale.
  - If nothing relevant is found, or the only matches are stale, falls
    back to reading/grepping the actual source/repo to find the answer.
  - When the fallback path finds an answer, writes a new `code/` note (if
    none existed) or refreshes the existing stale one (in place, plus a
    `## Changelog` entry) — reusing `scripts/knowledge-path.js` for
    deterministic naming and the existing `code/` note conventions from
    A-1/A-2. **`guru` only writes/refreshes `code/` notes** — per this
    attack's confirmed scope, `decisions/`/`design/`/`architecture/` notes
    stay agent-judgment/manual, same as they've been since A-1; `guru` is
    not responsible for deciding when something is decision/design/
    architecture-worthy.
  - Returns its answer (grounded in fresh knowledge, refreshed knowledge,
    or freshly-discovered source, whichever path it took).
  - **No direct user-facing command** — per this attack's confirmed
    scope, `guru` is only ever dispatched internally by an already-running
    agent session, the same pattern as `spearhead-scout`/`-coder`/
    `-verifier`; no new `/spearhead:guru` slash command.
- `hooks/remind.js`'s "try the `spearhead-knowledge` search tool first"
  nudge reworked to instead nudge dispatching the `guru` agent — there's
  no more MCP search tool to reference.
- Knowledge-note type taxonomy expands from `{code, decisions,
  architecture}` to `{code, decisions, design, architecture}` — `design`
  was specified in A-1's original `PROBLEM.md` under "opportunistic
  capture" but never actually built or enforced; this attack formalizes
  it as a valid `type` value and documents the four-way split, without
  building any new automated trigger for it (per the confirmed scope
  above, only `code/` has an automated writer — `guru`).
- Obsidian compatibility: notes' existing `type` frontmatter field and
  `[[wikilink]]`-based `related` field are already compatible with
  Obsidian's native linking and Graph View. This attack adds: a
  `cssclasses` frontmatter field per note (mirroring `type`, e.g.
  `cssclasses: [kb-code]`) so an opt-in CSS snippet can color-code notes
  by type in Obsidian's reading view; the CSS snippet itself, shipped as
  a file the user can manually enable (not auto-applied — `.obsidian/`
  configuration is commonly gitignored per-user, so this attack does not
  bundle or commit any `.obsidian/` workspace/graph config); and
  documentation of a recommended Graph View group-by-`type` color setup
  for users who open this vault in Obsidian themselves.
- New `commands/obsidian-graph.md` + `skills/spearhead-obsidian-graph/SKILL.md`
  pair (matching this repo's existing command/skill pairing convention):
  `/spearhead:obsidian-graph` constructs an `obsidian://` URI targeting a
  vault named after the repository's root directory name, and opens it
  via the OS's default URI-open mechanism (`open` on macOS, `xdg-open` on
  Linux, `start` on Windows) to navigate directly to the graph view.
  Requires a community plugin (e.g. Advanced URI or Command URI) already
  installed in the user's Obsidian app — documented explicitly as a
  precondition, same as `claude`/`kimi` being a precondition for `guru`;
  the command surfaces a clear message (not a silent no-op) if the URI
  open fails or Obsidian/the plugin isn't available.
- `README.md`'s "Second-brain knowledge base" section rewritten again to
  describe the `guru`-agent-based mechanism (no more MCP server, no more
  `search` tool); `.claude-plugin/plugin.json`'s and
  `.kimi-plugin/plugin.json`'s `mcpServers` blocks removed. New
  `CHANGELOG.md` entry. A new ADR recording this architectural reversal
  (MCP-server/CLI-ranking → in-agent `guru` sub-agent) and its reasoning.

## Out of scope

- `guard.js`, `validate-state.js`, the state machine, and the gated
  pipeline's skills/commands — unrelated, untouched.
- `hooks/knowledge-nudge.js` and `lib/knowledge-frontmatter.js` — kept,
  not deleted; their existing `code/` note staleness/nudge mechanism is
  unchanged except for the relocated `hash.js` import path.
- `scripts/knowledge-path.js` — kept unchanged, reused by `guru` for
  deterministic `code/` note naming exactly as it's used today.
- Building any automated trigger/writer for `decisions/`/`design/`/
  `architecture/` notes — confirmed out of scope; those stay manual/
  agent-judgment, as they've been since A-1.
- A direct `/spearhead:guru` command — confirmed out of scope; internal
  dispatch only.
- Bundling or committing `.obsidian/` workspace/graph configuration files
  — the CSS snippet and Graph View setup are documented/opt-in, not
  auto-applied, to avoid conflicting with a user's own per-vault Obsidian
  settings (commonly gitignored).
- Installing or configuring Obsidian, the `claude`/`kimi` CLIs, or any
  Obsidian community plugin — all are user-side preconditions this attack
  documents but does not automate installation of.
- Rewriting git history or past decision records (A-1 through A-4's
  committed `spearhead-attacks/` files, or ADR-001 through ADR-008) — kept
  as historical record, same assumption carried through every attack this
  session.
- Bumping the plugin version / marketplace manifest version (handled at
  ship time, per this repo's existing convention).
- Designing exactly how large a note corpus `guru`'s search scales to —
  same target scale (typical personal-notes corpus) as every prior
  second-brain attack; revisiting scale limits is a future attack if it
  becomes a real problem.

## Assumptions

- **The Obsidian vault is `spearhead-knowledge/`, not the whole repo
  root** — confirmed explicitly by the user. Obsidian's default vault
  display name is the opened folder's own name (`spearhead-knowledge`),
  which does NOT automatically equal the repo root directory's name, so
  satisfying "vault name = repo root directory name" requires either a
  documented one-time manual step (renaming the vault in Obsidian's own
  settings after first opening it) or another mechanism — exactly which
  is a design-phase decision, informed by recon confirming whether
  Obsidian actually supports a vault display-name override independent
  of the folder name (not assumed here). Regardless of mechanism, the
  `/spearhead:obsidian-graph` command's `obsidian://` URI construction
  targets `vault=<repo-root-directory-name>`, since that's what the URI
  scheme needs to match against Obsidian's registered vault name.
- **`/spearhead:obsidian-graph` does not need to separately check whether
  Obsidian is running** — invoking the OS's URI-open mechanism on an
  `obsidian://` URI launches Obsidian automatically if it's installed and
  registered as the URI-scheme handler (standard OS behavior once
  Obsidian has been installed), the same way any other registered
  URI-scheme handler works.
- **`guru`'s fallback source search has no special scope restriction
  beyond what its dispatcher's own tool permissions already allow** — it
  uses `Glob`/`Grep`/`Read` the same way any other spearhead sub-agent
  does, read-only, no write access outside `spearhead-knowledge/`.
- **Existing `code/` notes from before this attack (if any exist on
  disk) are unaffected** — this attack does not migrate or rewrite
  existing notes' frontmatter; the `cssclasses` field is additive going
  forward, added by `guru`/`knowledge-nudge.js` on next write/refresh,
  not backfilled.
- **The exact `guru.md` agent-definition prompt content (model choice,
  detailed instructions) is a design-phase decision**, following the
  established pattern in `agents/spearhead-scout.md` — this criterion set
  fixes behavior and scope, not exact prose.

## Acceptance criteria

1. `mcp-server/` no longer exists in the working tree (no file under
   that directory survives).
2. `lib/hash.js` exports `hashContent` (relocated from
   `mcp-server/lib/hash.js`, unchanged behavior); `hooks/knowledge-nudge.js`
   imports it from the new location; no file imports from
   `mcp-server/lib/hash.js`.
3. `agents/guru.md` exists, following the same frontmatter/structure
   pattern as `agents/spearhead-scout.md`, and its documented behavior
   matches: search `spearhead-knowledge/**/*.md` first; cross-check
   `source_hash` for staleness on any match; fall back to source
   grep/read when nothing relevant or only stale matches exist; on a
   successful fallback, write a new `code/` note or refresh an existing
   stale one (via `scripts/knowledge-path.js` for naming) before
   returning an answer.
4. `guru` is dispatched only via the Agent tool by an already-running
   session (documented as such in its own frontmatter `description`,
   matching `spearhead-scout`/`-coder`/`-verifier`'s "never invoke
   directly" convention) — no new user-facing `/spearhead:guru` command
   exists.
5. `.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json` contain no
   `mcpServers` key.
6. `hooks/remind.js` no longer references an MCP `spearhead-knowledge`
   search tool; its nudge text instead points at dispatching `guru`.
7. Note frontmatter's `type` field accepts `code`, `decisions`, `design`,
   and `architecture` as documented valid values (in
   `lib/knowledge-frontmatter.js` and/or its documentation); notes gain a
   `cssclasses` field mirroring `type` (e.g. `cssclasses: [kb-code]`) on
   next write/refresh.
8. A CSS snippet file exists (location documented) providing distinct
   visual styling per `cssclasses` value, shipped as opt-in (not
   referenced by any `.obsidian/` config committed to the repo).
9. `commands/obsidian-graph.md` + `skills/spearhead-obsidian-graph/SKILL.md`
   exist, following this repo's existing command/skill pairing
   convention; the skill constructs an `obsidian://` URI targeting a
   vault named after the repository's root directory name and opens it
   via the OS-appropriate URI-open command, surfacing a clear message
   (not a silent failure) if the open fails.
10. `README.md`'s "Second-brain knowledge base" section describes the
    `guru`-agent mechanism, contains no reference to the MCP server,
    `search` tool, embeddings, or CLI-subprocess ranking as the current
    mechanism, and documents the recommended Obsidian Graph View setup;
    `CHANGELOG.md` gains a new entry without editing/deleting prior ones.
11. A new ADR under `spearhead-attacks/decisions/` records the
    MCP-server-to-`guru`-agent architectural reversal and its reasoning;
    ADR-001 through ADR-008 are untouched.
12. The full test suite (`find . -name "*.test.js" -not -path
    "*/node_modules/*" -not -path "./spearhead-attacks/worktrees/*" |
    xargs node --test`) passes with 0 failures — including a relocated,
    still-passing `lib/hash.test.js` and `hooks/knowledge-nudge.test.js`
    updated for the new import path.

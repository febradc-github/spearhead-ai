# DESIGN — A-5: Replace MCP-server search with guru sub-agent + Obsidian-friendly knowledge base

This attack has three genuinely open design decisions (`guru`'s kimi-code
fallback, `cssclasses` frontmatter handling, `/spearhead:obsidian-graph`'s
implementation mechanism); everything else in PROBLEM.md's scope
(deleting `mcp-server/`, relocating `hash.js`, reworking `remind.js`'s
nudge text, manifest `mcpServers` removal, README/CHANGELOG) is a
mechanical consequence of the approved problem statement with no real
alternative to weigh.

## Decision 1: `guru`'s kimi-code fallback

### Candidate approaches

**1. Document the process inline, no dispatch mechanism needed under kimi-code (chosen)**

`guru`'s process (search → staleness cross-check → source fallback →
document) is written clearly enough — in `hooks/remind.js`'s nudge text
and/or `rules/RULES.md` — that under kimi-code (no plugin-defined
sub-agents), the calling agent just performs the steps itself inline, in
the same session, rather than dispatching anything. `agents/guru.md`
remains the canonical description of the process either way; kimi-code
just doesn't get the "isolated context" benefit of a separate dispatch.

- **Complexity**: lowest — no new dispatch mechanism, no dependency on
  any kimi-code-specific sub-agent primitive.
- **Performance**: identical steps run either way; only the isolation
  (whether the search/reading happens in a disposable sub-agent context
  or inline) differs.
- **Maintainability**: one process description (`guru.md`) is the single
  source of truth for both runtimes — no second, parallel fallback
  implementation to keep in sync.
- **Reversibility**: fully reversible; if kimi-code later adds
  plugin-defined sub-agents, `guru` becomes dispatchable there too with
  no redesign.

**2. Dispatch kimi-code's built-in generic sub-agent with `guru`'s process as an input package**

Mirrors the pattern used by `spearhead-execute`'s kimi-code fallback
("dispatch kimi-code's built-in coder sub-agent with the same restricted
input package").

- **Complexity**: higher — depends on kimi-code exposing some
  general-purpose, dispatchable sub-agent primitive suited to an
  open-ended "search, judge relevance, maybe write a file" task. Unlike
  `spearhead-execute`'s fallback (which maps cleanly onto kimi-code's own
  "coder" role) or `spearhead-verify`'s (a read-only judgment role),
  `guru`'s task doesn't have a confirmed equivalent role in kimi-code's
  built-in sub-agent set.
- **Performance**: no meaningful difference if it worked.
- **Maintainability**: worse — introduces a dependency on unconfirmed
  kimi-code internals; if that primitive doesn't exist or doesn't fit,
  this degrades to option 1 anyway.
- **Reversibility**: fine, but not chosen.

Rejected: no confirmed kimi-code primitive this cleanly maps onto (recon
flagged this as an open risk, not a confirmed capability), and inline
fallback already satisfies every PROBLEM.md acceptance criterion without
depending on it.

## Decision 2: `cssclasses` frontmatter field handling

### Candidate approaches

**1. Register `cssclasses` in `lib/knowledge-frontmatter.js`'s `LIST_FIELDS` (chosen)**

One-line addition: `LIST_FIELDS = new Set(['tags', 'related', 'cssclasses'])`.
Parsed and serialized as an array, the same as `tags`/`related` already
are.

- **Complexity**: trivial — one line, reuses existing list-field handling
  verbatim.
- **Performance**: no measurable difference.
- **Maintainability**: `cssclasses` becomes a properly recognized,
  documented field with correct round-trip behavior through
  `parseFrontmatter`/`serializeFrontmatter`, consistent with every other
  structured frontmatter field.
- **Reversibility**: fully reversible — removing the entry restores
  today's behavior exactly.

**2. Leave `cssclasses` unregistered, rely on the parser's existing forward-compatibility (unrecognized keys silently ignored)**

- **Complexity**: zero code change.
- **Performance**: no difference.
- **Maintainability**: worse — per recon, unrecognized keys are parsed
  but dropped on serialization (`serializeFrontmatter` only re-emits
  known fields), so any code path that reads-then-rewrites a note's
  frontmatter programmatically would silently lose `cssclasses`. Notes
  are mostly hand-authored by the agent today (frontmatter text is
  written directly via `Write`/`Edit`, not generated through
  `serializeFrontmatter`), so this risk is currently low — but leaving a
  documented frontmatter field unregistered is a latent trap for the
  first future code path that does call `serializeFrontmatter`
  programmatically.
- **Reversibility**: fine, but not chosen.

Rejected: the one-line fix costs nothing and removes a latent
round-trip-loss trap; no reason to accept option 2's downside for zero
benefit.

## Decision 3: `/spearhead:obsidian-graph`'s implementation mechanism

### Candidate approaches

**1. A small, dependency-free `scripts/obsidian-graph.js`, matching this repo's existing `scripts/` convention (chosen)**

A Node script (no dependencies, same spirit as `scripts/state.js` and
`scripts/knowledge-path.js`) that: detects the OS (`process.platform`),
constructs an `obsidian://advanced-uri?vault=<repo-root-dir-name>&commandid=graph:open`
URI (Advanced URI plugin — chosen over Command URI because it
explicitly supports vault targeting by name in the same URI, which this
attack's requirement needs; Command URI's documented syntax didn't show
an equivalent vault parameter), and invokes the platform's URI-open
command (`open` on macOS, `xdg-open` on Linux, `start` on Windows) via
`node:child_process`. The `skills/spearhead-obsidian-graph/SKILL.md`
wrapper just runs this script and relays its output.

- **Complexity**: low — one small script, no new dependency, reuses the
  OS-detection idiom any Node script would use.
- **Performance**: instant — a single subprocess spawn.
- **Maintainability**: platform-detection and URI-construction logic
  lives in exactly one deterministic place, testable in isolation
  (`node:test` can inject the spawn call the same way `rank.js`'s tests
  injected `options.exec`, mirroring an established pattern from A-4)
  — consistent with ADR-004's reasoning for `knowledge-path.js`
  ("leaving [deterministic] computation to per-session agent judgment
  risks drift").
- **Reversibility**: fully reversible; deleting the script and reverting
  the skill/command pair removes the feature cleanly.

**2. Inline shell command in the skill's own prose, no committed script**

The `SKILL.md`'s Process section just instructs the agent to run the
right `open`/`xdg-open`/`start` command directly via the `Bash` tool at
invocation time, re-deriving platform detection and URI construction
each time from the prose description.

- **Complexity**: appears lower (no new file) but is actually higher in
  practice — the LLM has to correctly re-derive OS detection and
  URL-encoding every single invocation, with no way to unit-test that
  logic ahead of time.
- **Performance**: no meaningful difference.
- **Maintainability**: worse — the exact same "per-session judgment
  risks drift" problem ADR-004 already rejected for note-path
  computation applies identically here.
- **Reversibility**: fine, but not chosen.

Rejected: this repo has already made this exact tradeoff once
(ADR-004) and chose the deterministic-script answer; no reason to make
the opposite choice for a structurally identical problem.

## Failure-mode handling

**`guru`:**

- **Bad input** (an unclear or malformed query): `guru` is an LLM-driven
  agent, not a deterministic function — it uses its own judgment to
  report "nothing relevant found" rather than erroring, the same way any
  agent handles an ambiguous request.
- **Dependency down** (malformed note frontmatter, unreadable source
  file): inherited safety from existing, unchanged code —
  `parseFrontmatter` never throws (falls back to `{type: 'unknown'}`);
  a `source:` path that no longer exists is treated the same as a hash
  mismatch — stale, triggering the source fallback.
- **Load spike** (large `spearhead-knowledge/` corpus): out of scope to
  solve, per PROBLEM.md — same target scale as every second-brain attack
  before this one; `Glob`/`Grep` already handle typical repo sizes
  without special handling.
- **Partial failure** (the source-fallback grep finds nothing either):
  `guru` reports that nothing was found anywhere and does not fabricate
  or write a note it isn't confident about — never writes a note as a
  side effect of failing to find an answer.

**`/spearhead:obsidian-graph`:**

- **Bad input**: not applicable — no user-supplied argument beyond
  invoking the command.
- **Dependency down** (Obsidian not installed, the required community
  plugin not installed/enabled, or the vault not yet opened/registered
  in Obsidian): the script cannot observe whether Obsidian actually
  handled the URI and reached the graph view — `obsidian://` dispatch is
  fire-and-forget at the OS level once the platform's `open`/`xdg-open`/
  `start` command has been invoked. The script instead: (a) confirms the
  platform-open binary itself exists and ran without a spawn error, (b)
  clearly documents this limitation (both in `SKILL.md`'s process and in
  the command's own output) rather than falsely claiming success it
  can't verify, and (c) lists the two documented preconditions (Obsidian
  installed, Advanced URI plugin installed) so a user hitting a silent
  no-op knows what to check.
- **Load spike**: not applicable.
- **Partial failure** (unsupported/undetected platform): the script
  falls back to printing the constructed `obsidian://` URI and
  instructing the user to open it manually, rather than crashing or
  silently doing nothing.

## Open questions resolved during design

- **kimi-code fallback for `guru`**: inline, documented process — no
  dispatch-mechanism dependency on unconfirmed kimi-code internals.
- **`cssclasses` frontmatter handling**: registered in `LIST_FIELDS`,
  full round-trip support, one-line change.
- **`/spearhead:obsidian-graph` mechanism**: a dependency-free
  `scripts/obsidian-graph.js`, Advanced URI plugin assumed (documented
  precondition), `commandid=graph:open` targeting the global Graph View.
  **Flag for execute**: the exact core command ID (`graph:open`) was
  sourced from search results, not a fully verified official reference —
  the coder implementing this task should re-verify it against Advanced
  URI's own documentation or Obsidian's core command list before
  shipping, rather than trusting this document's assertion blindly.
- **Numeric "score" carried over from A-4's CONTEXT.md flag**: no longer
  applicable — `guru` returns a natural-language answer, not a
  structured `{path, excerpt, score}` API response; there is no tool
  contract left to assign a score to.

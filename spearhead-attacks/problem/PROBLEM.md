## Problem statement

Spearhead attacks accumulate a rich decision record per attack (`PROBLEM.md`,
`DESIGN.md`, `PLAN.md`, task files, verification reports, `RETRO.md`), but
there is no way to search or recall this history across attacks — and no way
to search the rest of a project's knowledge (README, docs, wiki, or an
understanding of the source code itself) either. Every time an AI agent needs
information about the project, it falls back to reading files directly —
often many of them, by trial and error — which wastes tokens. The user wants
a "second brain" for the spearhead plugin: a searchable, growing knowledge
base that agents consult first, so they can find an answer instead of
re-deriving it by reading the repository.

## Real goal

Give any project using spearhead a persistent, queryable knowledge base that
combines (a) spearhead's own decision record, (b) existing project
documentation (README, docs/, wiki), and (c) new knowledge spearhead itself
generates opportunistically as it works — so both the user and Claude Code
agents can retrieve relevant context via natural-language search first,
falling back to reading source files only when the index has no answer. The
knowledge base grows the more spearhead is used, even on projects with thin
existing documentation.

## In scope

- **Semantic search index** (embeddings-based) over three knowledge sources:
  1. Spearhead's own decision record: `PROBLEM.md`, `DESIGN.md`, `PLAN.md`,
     task files, verification reports (`V-<n>.<k>.md`), `RETRO.md`,
     `CHANGELOG.md`.
  2. General project documentation: `README.md`, `docs/`, wiki-style
     markdown already present in the repo.
  3. A new, persistent knowledge store spearhead grows over time (see
     opportunistic capture below).
- **Opportunistic, automatic capture**, mediated entirely through spearhead's
  own hooks — not gated to being mid-pipeline-phase, but always mediated by
  the plugin (fires whenever spearhead is installed and active in the
  project, pipeline attack running or not):
  - **Code documentation**: the first time any source file is read and no
    doc exists yet for it, spearhead nudges the current agent (same pattern
    as `remind.js`'s existing reminders) to write one under `code/`. A
    re-read of an already-documented, *unchanged* file does not duplicate
    the note; a re-read after the source changed refreshes the existing note
    in place. Additionally, when a task transitions to `done` (post
    mechanical + verifier gates), the coding agent updates the documentation
    for every source file that task's diff touched — creating it if it
    doesn't exist yet, or updating it and appending a `## Changelog` entry
    (referencing the task and attack) if it does.
  - **Decision/architecture knowledge**: recon/design/execute/verify work
    opportunistically captures reusable notes (why an approach was chosen or
    rejected, architecture observations) into `decisions/` and
    `architecture/`, in addition to the attack-scoped files those phases
    already produce.
- **Search-first reminder**: a nudge (new hook, same family as `remind.js`)
  that reminds the agent, on user inquiries, to use the search tool below
  before reading source files directly — search first, read only if the
  index has no answer.
- **Query interface: a bundled MCP server**, declared in `.claude-plugin/
  plugin.json` (and the kimi-code equivalent), not a slash command:
  - Exposes a `search` tool: natural-language query in, ranked excerpts with
    source pointers out (cosine similarity over local embeddings — genuine
    semantic ranking, not grep or keyword matching).
  - **File-watches** the three knowledge sources (`fs.watch`, Node
    built-in) and re-embeds a note automatically when it's created or
    changed — no manual "rebuild the index" step.
  - Calls the embeddings API via Node's built-in `fetch` — no HTTP client
    dependency; the only new dependency is the MCP SDK itself, which is
    acceptable here because the server is a persistent process, not a
    hook bound by the 10s hook timeout / dependency-free constraint that
    `guard.js`/`remind.js`/`state.js` operate under.
  - A thin `/spearhead:recall` command may still exist as a user-facing
    wrapper, but the agent itself calls the MCP `search` tool directly.
- **Obsidian-compatible knowledge graph**:
  - Notes use `[[wikilink]]` cross-references to genuinely related notes
    only — no indiscriminate linking.
  - Every note carries categorizing frontmatter (`type`, `tags`) so the user
    can color-code/group the graph by type in Obsidian's own graph view.
- **Storage root**: a top-level `spearhead-knowledge/` directory, sibling to
  `spearhead-attacks/` (not nested inside it) — `spearhead-attacks/` stays
  pipeline state only; `spearhead-knowledge/` holds the second-brain
  knowledge base and its index.
- **Naming convention**:
  - `spearhead-knowledge/code/<parent-folder>-<basename>.md` — e.g.
    `spearhead-knowledge/code/frontend-utils.md` for `src/frontend/utils.ts`.
    On a genuine collision (same computed slug, different `source:`),
    escalate one more parent level for the *new* note only; existing notes
    are never renamed.
  - `spearhead-knowledge/decisions/ATK<n>-<topic-slug>.md`
  - `spearhead-knowledge/architecture/<topic-slug>.md`
- **Code documentation content** includes a `## Changelog` section recording
  each time the note is generated or refreshed (date + what changed/why).
- **Writing style**: direct, minimal commentary, factual — no fluff beyond
  what's needed to convey intent and content.
- Works across multiple attacks within one project (A-1, A-2, ...).

## Out of scope

- Self-hosted/local embedding models — v1 uses an external embeddings API.
- Cross-project search (indexing spans one project only).
- A UI beyond the CLI/agent query interface — Obsidian itself is the viewer;
  the plugin does not build a dashboard or control Obsidian's app settings.
- Rewriting or summarizing existing project docs (README etc.) — those are
  indexed as-is, not regenerated.
- Indexing arbitrary non-documentation source (the code itself is not
  embedded wholesale — only the generated code documentation notes are).

## Assumptions

- Embeddings and index metadata are stored as local flat files under
  `spearhead-knowledge/index/`, consistent with the plugin's file-based,
  dependency-light model; the MCP server reads/writes them directly (no
  external vector database).
- The specific embeddings provider/model is a design-phase decision;
  requires an API key the user configures (network calls happen inside the
  MCP server, at file-watch-triggered index time and at query time).
- The nudge mechanism (code-doc-on-first-read, search-first-reminder,
  task-done doc updates) is a new hook or extension of `remind.js`'s
  pattern; exact hook wiring is a design-phase decision. These nudges are
  separate from the MCP server: hooks nudge agents to *write* notes; the
  server only indexes and searches what's already on disk.
- Opportunistic capture writes files directly (not through `state.js`, since
  it never touches `spearhead-attacks/status.yml` or pipeline phase state).
- Obsidian color-coding is enabled via frontmatter only; actual graph colors
  are configured by the user inside Obsidian, not by the plugin.

## Acceptance criteria

1. Starting the MCP server against a project with at least one completed
   spearhead attack and some general docs (README/docs/wiki) produces a
   local index containing embeddings for all three knowledge sources
   (spearhead decision record, general docs, opportunistic notes), with no
   manual index-build step required.
2. Calling the MCP server's `search` tool with a natural-language question
   returns at least one relevant excerpt with a correct source file pointer,
   verifiable against the actual file content.
3. Creating or editing a note under the watched knowledge sources while the
   server is running updates only that note's index entry, automatically,
   without a manual rebuild (verifiable via before/after index diff).
4. Reading an undocumented source file for the first time in a
   spearhead-active project results in a reminder that leads to a code doc
   being created under `code/` with correct naming and a populated
   `## Changelog` section.
5. Two source files that would compute the same base slug (same basename,
   different parent folders) are disambiguated by parent-folder prefix
   without either file's note ever needing to be renamed.
6. Re-reading an already-documented, unchanged source file does not create a
   duplicate note; re-reading after the source changed updates the existing
   note and appends a new `## Changelog` entry.
7. A user inquiry triggers a reminder to search the index before source
   files are read, verifiable by the reminder firing on relevant prompts.
8. Notes carry `type`/`tags` frontmatter and only include `[[wikilinks]]` to
   genuinely related notes, not indiscriminate cross-links.
9. None of the above (MCP server indexing/search, opportunistic capture)
   requires raw Write/Edit to `spearhead-attacks/status.yml` or alters pipeline
   phase state (`state.js show` unchanged before/after).
10. If the embeddings API key is missing or the API call fails, the MCP
    server reports a clear, named error on the affected tool call rather
    than silently producing an empty or corrupt index.
11. The feature ships as part of the spearhead plugin (skills/commands/
    scripts/hooks/MCP server, declared in `.claude-plugin/plugin.json` and
    the kimi-code equivalent), installable and usable by any project that
    installs spearhead — not hardcoded to this repo.
12. When a task transitions to `done`, every source file in that task's
    diff has its code documentation updated (created if missing) with a new
    `## Changelog` entry referencing the task and attack that caused the
    change.

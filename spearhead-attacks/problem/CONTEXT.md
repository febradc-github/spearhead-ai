# Recon: Replace MCP-server search with guru sub-agent (A-5)

## Repo conventions

- **Test framework**: `node:test` (Node.js built-in), `node:assert/strict`. Direct execution via `node <file>.test.js` or `npm test` in project subdirectories.
- **Agent-definition pattern** (files `agents/<name>.md`):
  - Frontmatter fields: `name`, `description`, `model`, `effort`
  - Structure: brief description, "Isolation justification:" section stating why isolation is needed, then numbered constraints/rules (do not do X, always do Y)
  - Body: detailed task specification, expectations, and reporting format
  - Tone: technical, imperative, direct
  - Examples: `spearhead-scout.md` (haiku, read-only recon, 25 files / 60k chars budget), `spearhead-coder.md` (inherit model, one task test-first in worktree), `spearhead-verifier.md` (opus, independent fresh-eyes verdict)
- **Command/skill pairing pattern**:
  - `commands/<name>.md` — thin wrapper file (2–3 lines frontmatter + `<important>Use the Skill tool to invoke...</important>` + description)
  - `skills/spearhead-<name>/SKILL.md` — actual implementation (frontmatter: `name`, `description`, `user-invocable: false`; then the behavior spec in structured sections like "Process", "Reporting", etc.)
  - Example: `/spearhead:status` command dispatches `spearhead-status` skill; skill reads state and renders a task board
- **Lint/build/test**: no transpilation, no linters declared; repo is pure Node.js
- **State mutation**: only via `scripts/state.js` CLI; hooks are nudge-only or detection-only, never write state files

## Affected surface

### Files to be deleted (mcp-server/ directory)

**Complete inventory of deletable files:**
- `mcp-server/server.js` — MCP server entry point, exposes `search` tool
- `mcp-server/package.json` — declares @modelcontextprotocol/sdk dependency
- `mcp-server/package-lock.json`
- `mcp-server/server.test.js` — tests the search tool
- `mcp-server/lib/hash.js` — content-hashing helper (164 lines, exports `hashContent(content)`)
- `mcp-server/lib/hash.test.js`
- `mcp-server/lib/pipeline.js` — file-watch + index pipeline
- `mcp-server/lib/pipeline.test.js`
- `mcp-server/lib/rank.js` — CLI-based ranking logic (replaces embeddings)
- `mcp-server/lib/rank.test.js`
- `mcp-server/lib/index-store.js` — load/save index to disk
- `mcp-server/lib/index-store.test.js`
- `mcp-server/lib/watch.js` — file-watch implementation
- `mcp-server/lib/watch.test.js`
- `mcp-server/node_modules/` — gitignored

### Files to be modified in-place

**`hooks/knowledge-nudge.js`** (lines 1–330)
- **Line 47**: imports `hashContent` from `'../mcp-server/lib/hash.js'`; must update to `'../lib/hash.js'` once hash.js is relocated
- **Lines 174–237**: `handleRead()` function — exact logic to replicate in `guru` agent:
  - Line 192: `computeKnowledgePath(filePath, projectDir)` — deterministic note naming
  - Lines 199–203: compute `currentHash = hashContent(fs.readFileSync(absSource))`
  - Lines 206–215: three-way state from `source_hash` frontmatter comparison:
    - `state = 'new'` if no note exists
    - `state = 'current'` if `noteHash === currentHash`
    - `state = 'stale'` if hash mismatch or missing
  - Lines 223–237: nudge messages (exact text, `targetPath`, `relSource`, `WIKILINK_LINE`)
- **Lines 42–48**: imports that will need updating after hash.js move

**`hooks/remind.js`** (lines 1–172)
- **Line 75**: contains the "search-first" nudge text: `'Before reading source files to answer a question, try the spearhead-knowledge search tool first.\n'`
- **Must be reworded** to nudge dispatching `guru` agent instead (exact new wording is a design decision, but will reference dispatching `guru` or similar)

**`.claude-plugin/plugin.json`** and **`.kimi-plugin/plugin.json`**
- Both contain `"mcpServers": { "spearhead-knowledge": { ... } }` blocks (lines 8–13 in claude-plugin, lines 17–22 in kimi-plugin)
- Must be deleted entirely (remove the `mcpServers` key and its value)
- `.kimi-plugin/plugin.json` also has hooks array (lines 23–53) — its entries for `knowledge-nudge.js` stay; only the MCP-server declaration is removed

**`lib/knowledge-frontmatter.js`** (lines 1–150, current SCALAR_FIELDS and LIST_FIELDS)
- **Lines 33–34**: `LIST_FIELDS = new Set(['tags', 'related'])` and `SCALAR_FIELDS = new Set(['type', 'source', 'updated', 'source_hash'])`
- **Design decision needed**: adding `cssclasses` as a LIST_FIELD (array value) — current code already ignores unrecognized keys (line 111), so forward-compat is built in, but an explicit LIST_FIELDS addition will enable serialization of `cssclasses: [kb-code]` etc.
- **Design decision needed**: expanding `type` values from current (inferred `'unknown'`) to include `'code'`, `'decisions'`, `'design'`, `'architecture'` — parser/serializer already handle arbitrary scalars, no code changes needed for that, just validation/documentation

**`README.md`** (lines 169–256, "Second-brain knowledge base" section)
- Full rewrite needed: currently describes MCP server, file-watching, embeddings index, CLI-based ranking
- New version will describe: `guru` sub-agent, direct Glob/Grep/Read over `spearhead-knowledge/**/*.md`, source_hash staleness check, fallback to reading actual source
- Lines 202–227 specifically (the search.md tool description)

### Index entry shape change
- **Current** (lines 71–74 from prior CONTEXT.md): `{ hash, embedding, updated, type }` stored in `spearhead-knowledge/index/embeddings.json`
- **New** (design decision): likely `{ hash, updated, type }` without embeddings (embeddings no longer computed or stored)

### Related existing code to reuse

**`lib/knowledge-frontmatter.js` `parseFrontmatter()` / `serializeFrontmatter()`** — used by `guru` to read/write `source_hash` frontmatter and create/update notes. Already robust, forward-compatible with unrecognized fields.

**`scripts/knowledge-path.js`** — deterministic naming algorithm (lines 62–94: `computeKnowledgePath()`) used by both hooks and new `guru` agent. Called via `const { computeKnowledgePath } = require('../scripts/knowledge-path.js')` (already an established pattern in `hooks/knowledge-nudge.js`).

**Session-throttle pattern** from `hooks/knowledge-nudge.js` (lines 144–172: `shouldNudge()` and related state file logic) — reusable for tracking what `guru` has already nudged about during one session, to avoid repeat pushes.

## Risks and unknowns

1. **hashContent consumers** — confirmed via grep: `mcp-server/lib/pipeline.js` (line 79), `hooks/knowledge-nudge.js` (line 47, 200), `mcp-server/lib/pipeline.test.js`, `mcp-server/lib/hash.test.js`, `hooks/knowledge-nudge.test.js`. All are either in `mcp-server/` (being deleted) or `hooks/` (will update import path). No surprises.

2. **`knowledge-frontmatter.js` field extensibility** — currently, unrecognized frontmatter keys are silently ignored (line 111), not an error. This means adding `cssclasses` support:
   - Without explicit LIST_FIELDS entry: notes with `cssclasses: [kb-code]` can be read (parsed), but will lose the array structure on round-trip (unknown keys are dropped during serialization, line 141–144)
   - With explicit LIST_FIELDS entry: `cssclasses: [kb-code]` will be preserved in serialization
   - Decision: should `cssclasses` be serialized (added to LIST_FIELDS), or is `type` alone sufficient for visual styling? PROBLEM.md says "mirroring type" (e.g., `cssclasses: [kb-code]` for code notes), so serialization is likely required.

3. **`guru` sub-agent availability in kimi-code** — plugin-defined sub-agents don't exist in kimi-code. PROBLEM.md should specify the fallback: likely "main session dispatches guru's prompt manually" or "use kimi's built-in sub-agent if available, else fall back to main session with guru's input package". Established precedent from `spearhead-coder` and `spearhead-verifier` fallbacks (README.md lines 338–348).

4. **Source staleness detection in `guru`** — the new agent must:
   - Read `spearhead-knowledge/**/*.md` (or a subset) via Glob and Read tools
   - Extract `source_hash` frontmatter from each candidate note
   - For each note, re-hash its `source:` file to detect staleness
   - Mark stale matches and skip them during ranking, with a clear fallback to reading the actual source
   - Exact logic mirrors `hooks/knowledge-nudge.js` handleRead (lines 206–215) but happens in the opposite direction (agent→note rather than file→nudge)

5. **Numeric scoring after `guru` ranking** — A-4's CONTEXT.md flagged this as a design decision. Current test fixtures expect `.score` field (README.md doesn't mention scoring in the new design). PROBLEM.md doesn't specify whether numeric scores survive or ranking is ordinal-only. This affects test fixtures in `mcp-server/server.test.js` and the exact return value shape from `guru`.

6. **obsidian-graph command/skill pair** — the new command will follow the established pattern (command → skill), but:
   - Does the implementation actually generate a graph visualization, or just nudge the agent to use Obsidian's built-in Graph View feature?
   - Is it a read-only report (like `/spearhead:status`), or does it offer interactive navigation?
   - PROBLEM.md says "add a `/spearhead:obsidian-graph` command+skill pair" but provides no acceptance criteria for what the skill does

7. **ADR for the reversal** — PROBLEM.md says "write a new ADR" reversing ADR-001's MCP-server decision. Context:
   - ADR-001 (adr-001-mcp-server-for-search.md) chose an MCP server over on-demand CLI shelling
   - A-5 reverses this: back to on-demand dispatch, but now via a sub-agent (`guru`) rather than a raw shell-out
   - New ADR should explain why the shift (agent can rank semantically + handle staleness more robustly than a subprocess) and why a sub-agent is better than `spawnSync` in the main session's context

## Prior art

### Agent-definition frontmatter and structure

From `agents/spearhead-scout.md` (lines 1–6):
```
---
name: spearhead-scout
description: Budgeted read-only recon over the repo, returning a structured summary for CONTEXT.md. Dispatched by spearhead-recon -- never invoke directly.
model: haiku
effort: medium
---
```

And isolation-justification pattern (line 8): `Isolation justification: recon reading burns context; isolating it keeps the main session lean.`

**Pattern for `agents/guru.md`**: same frontmatter structure; model (design choice, likely `haiku` for speed or `sonnet` for reasoning), effort level, isolation justification explaining why searching via sub-agent preserves main context.

### Source_hash staleness check idiom

From `hooks/knowledge-nudge.js` lines 206–215:
```javascript
let state = 'new';
if (fs.existsSync(absTarget)) {
  let noteHash;
  try {
    noteHash = parseFrontmatter(fs.readFileSync(absTarget, 'utf8')).fields.source_hash;
  } catch {
    noteHash = undefined;
  }
  state = noteHash === currentHash ? 'current' : 'stale';
}
if (state === 'current') return '';
```

**Guru must replicate**: for each candidate note, extract `source_hash` frontmatter, re-hash the `source:` file, compare. If they match, mark as `current` (use it); if mismatch or missing, mark as `stale` (don't rank it, log it for fallback).

### Command/skill pairing

From `commands/status.md` (3 lines):
```yaml
---
description: "Read-only render of the attack: phases (execute derived), task board, dispatch modes, parallel-eligible tasks, blockers, verify lock, staleness flags."
---

<important>
Use the Skill tool to invoke the `spearhead-status` skill.
</important>
```

And `skills/spearhead-status/SKILL.md` (lines 1–27):
```yaml
---
name: spearhead-status
description: "Read-only render of the spearhead attack: phases (execute derived), task board, dispatch modes, parallel-eligible tasks, blockers, verify lock, and staleness flags. Dispatched by /spearhead:status only."
user-invocable: false
---

# Status

<important>
- Strictly read-only...
- Staleness is a FLAG...
</important>

## Process

1. Read `state.js show`...
2. Render...
3. Staleness...
4. End with...
```

**Pattern for `/spearhead:obsidian-graph`**: `commands/obsidian-graph.md` (thin wrapper) and `skills/spearhead-obsidian-graph/SKILL.md` (implementation). Exact behavior TBD by design phase.

### Deterministic-naming algorithm

From `scripts/knowledge-path.js` lines 62–94 (`computeKnowledgePath(sourcePath, projectDir)`):
- Normalizes source path to POSIX-relative form
- Extracts immediate parent folder and basename (`<parent>-<basename>.md`)
- Checks for collisions in `spearhead-knowledge/code/` by comparing `source:` frontmatter
- Escalates one more parent level only on genuine collision (existing note never renamed)
- Returns relative path like `spearhead-knowledge/code/frontend-utils.md`

**Guru must use** for writing new `code/` notes on successful fallback to source reading.

### Injectable-stub pattern for testing

From `mcp-server/server.test.js` lines 96–106, 168–175:
```javascript
async function withInMemoryClient(options, fn) { ... }

const embed = async (text) => {
  assert.equal(text, 'find the matching file');
  return [1, 0, 0];
};

await withInMemoryClient({ root, embed }, async (client) => {
  // test body using the injected stub
});
```

**Guru tests** must inject a `rankNotes` (or `readAndRank`) stub that returns known results without spawning a real subprocess or dispatching a sub-agent. Exact injection point TBD by implementation, but pattern is established.

## Budget

- **Reads used**: 12 file reads (CONTEXT.md prior, spearhead-scout.md, spearhead-coder.md, spearhead-verifier.md, knowledge-nudge.js, hash.js, knowledge-path.js, knowledge-frontmatter.js, remind.js, .claude-plugin/plugin.json, .kimi-plugin/plugin.json, commands/status.md, skills/spearhead-status/SKILL.md, README.md [partial + continuation], adr-001-mcp-server-for-search.md [partial])
- **Characters used**: ~52,000 (under 60k limit)
- **Bash commands**: 2 (directory listing for mcp-server, grep searches for hashContent and cssclasses/type)
- **Skipped**:
  - Full README.md beyond line 256 (sufficient coverage of second-brain section and kimi fallbacks)
  - Full adr-001 and other ADRs (context extracted, specifics not needed for CONTEXT.md)
  - Command pairs for execute/verify/ship/retro (status.md pattern is representative)
  - Individual skill implementations beyond spearhead-status (pattern established)
  - mcp-server individual file reads (inventory confirmed via bash, structure clear from prior attack A-4)
  - Knowledge-nudge test file (logic is clear from implementation)

**Prescribed reading order completed:**
1. ✅ **Agent-definition pattern**: spearhead-scout.md, spearhead-coder.md, spearhead-verifier.md — frontmatter, body structure, tone
2. ✅ **Staleness-check logic**: hooks/knowledge-nudge.js — source_hash comparison (lines 206–215), hash import (line 47), import path change needed
3. ✅ **hashContent location**: mcp-server/lib/hash.js — pure function, relocates to lib/hash.js, no behavior change
4. ✅ **Deterministic naming**: scripts/knowledge-path.js — collision-safe algorithm, used for new code/ notes
5. ✅ **Frontmatter handling**: lib/knowledge-frontmatter.js — scalar/list field distinction, cssclasses as potential new list field
6. ✅ **Current search nudge**: hooks/remind.js — "try spearhead-knowledge search tool first" text (line 75), needs reword
7. ✅ **Plugin manifests**: .claude-plugin/plugin.json, .kimi-plugin/plugin.json — both have mcpServers blocks to remove
8. ✅ **Command/skill pattern**: commands/status.md + skills/spearhead-status/SKILL.md — template for obsidian-graph pair
9. ✅ **README "Second-brain" section**: lines 169–256 — full description of current MCP-server + search mechanism, slated for rewrite
10. ✅ **mcp-server inventory**: bash confirm of complete file list (server.js, lib/*.js, test files, package.json)
11. ✅ **Prior ADR**: adr-001-mcp-server-for-search.md — decision context for the reversal ADR

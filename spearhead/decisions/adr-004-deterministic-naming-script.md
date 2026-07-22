## Context

Code documentation filenames must follow a collision-safe convention
(`<parent>-<basename>.md`, escalating one more parent level only on a
genuine collision) without ever renaming an existing, already-linked note.
Leaving this computation to per-session agent judgment risks drift — two
sessions could compute different names for the same file, or fail to detect
a collision correctly.

## Decision

A dedicated, dependency-free helper script, `scripts/knowledge-path.js`,
is the sole authority for computing a source file's target note path. It
checks existing notes under the target slug for a conflicting `source:`
frontmatter value and escalates only as needed. Hook nudges name the exact
path this script would produce; the agent (or the nudge itself) invokes it
directly rather than re-deriving the algorithm from memory.

## Consequences

- Naming is deterministic and mechanically checkable — the same input path
  always produces the same output, regardless of which session or agent
  computes it.
- Mirrors the existing `state.js`-as-sole-writer discipline: one script is
  the single source of truth for a specific piece of derived state, instead
  of trusting every caller to reimplement the rule correctly.
- Adds one more small, dependency-free script to `scripts/`, consistent
  with the rest of the plugin's tooling.

# ADR-006: Detect note staleness via a content hash stored in note frontmatter

## Context

A-1's retro found that `hooks/knowledge-nudge.js`'s `Read` matcher only checks whether a code-documentation note exists at all (`fs.existsSync`), never whether the source file it documents has changed since the note was written. PROBLEM.md's criterion 4 for this attack requires: re-reading a source file after it changed should re-nudge the agent to refresh the note, and this must hold across sessions (a note written last week must still be detected as stale today, in a new session) — not just within a single conversation.

Three ways to detect "the source changed since the note was written" were considered: filesystem modification time, a hash tracked only in the hook's own transient session state, or a hash stored durably in the note's own frontmatter.

## Decision

Store a `source_hash` field (sha256 of the source file's content, computed via the existing `mcp-server/lib/hash.js`'s `hashContent`) in each note's frontmatter, alongside the existing `type`/`tags`/`related`/`source`/`updated` fields already handled by `lib/knowledge-frontmatter.js`. `handleRead` computes the source's current hash on every read of a source file and compares it against the note's stored `source_hash` to decide: no note → new-note nudge; note with matching hash → silent (up to date); note with missing or mismatched hash → refresh nudge.

## Consequences

- **Durable across sessions and machines**, because the source of truth lives in the note file itself (which is meant to be a persistent, cross-session artifact — the entire point of the second-brain feature), not in the hook's disposable, idle-expiring session state.
- **Reuses an established pattern** rather than inventing a new one: this is the same hash-compute-and-compare idiom T-3/T-5 already use for the embeddings index's own staleness detection, so there's no new mental model for maintainers to learn.
- **Correct where mtime would lie**: content hashing is immune to the false-positive/false-negative failure modes of filesystem timestamps (git checkouts resetting mtimes, editors touching files without changing content, CI normalizing timestamps).
- **New per-read cost**: every `Read` of a source file now hashes its content, versus the previous `fs.existsSync` check. Accepted — it's the same cost profile already accepted for T-5's file-watch indexing pipeline, and the extension heuristic already excludes large binary files from this path.
- **Requires agents to actually set `source_hash`** when authoring or refreshing a note (the hook only nudges; it doesn't write the field itself, consistent with ADR-003's nudge-only design). A note written without following the nudge's instruction will be treated as permanently stale (missing `source_hash` is indistinguishable from a real mismatch) — an acceptable default, since it fails toward "nudge again" rather than "silently stop checking."

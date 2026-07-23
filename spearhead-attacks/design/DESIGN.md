## Chosen approach

Reuse the codebase's existing hash-compare idiom (already used by T-3/T-5's embeddings index: hash content, compare to a stored value, act on mismatch) rather than inventing a new staleness mechanism.

1. **`lib/knowledge-frontmatter.js`**: add `source_hash` to the existing `SCALAR_FIELDS` set — it parses/serializes exactly like `source`/`updated` already do, no new code paths.

2. **`hooks/knowledge-nudge.js`'s `handleRead`**: replace the current `fs.existsSync(targetPath)`-only check with a three-way state derived from a single hash computation:
   - Compute `currentHash = hashContent(source content)`, importing `hashContent` directly from `mcp-server/lib/hash.js` (sync, `node:crypto` only, zero external deps — importing it doesn't add a dependency, just crosses the `hooks/` → `mcp-server/lib/` directory boundary).
   - `!existsSync(targetPath)` → state `new`.
   - Note exists, `parseFrontmatter(note).source_hash === currentHash` → state `current` → **never nudge, regardless of session** (criterion 3 — this holds today and keeps holding).
   - Note exists, `source_hash` missing or mismatched → state `stale` → refresh nudge.
   - `new` and `stale` both go through the existing session-throttle check before nudging; `current` skips the throttle check entirely (it never nudges, so there's nothing to throttle).

3. **Session-throttle schema change**: `.knowledge-nudge-state.json`'s per-session `nudged` field changes from an array of paths (`["src.js", ...]`) to an object mapping path to the hash it was last nudged for (`{"src.js": "<hash>"}`). One field, one comparison (`nudged[relPath] === currentHash`) now serves both "already nudged this unchanged-undocumented file this session" (old behavior) and "already nudged this exact stale state this session" (new behavior) — a file that changes again after being nudged once naturally gets a new hash and re-nudges, without a second parallel data structure. Old-format state files (array `nudged`, from before this fix) are treated as empty on load — never crash, worst case is one extra nudge.

4. **Nudge message text**: both `handleRead`'s two message variants (new-note, refresh) and `handleBash`'s task-done message gain a line: *"Use `[[wikilinks]]` only for genuinely related notes — do not add indiscriminate cross-links."* Reusing the message-construction pattern already in place (template strings naming the exact target path); no new message-building abstraction.

5. **`handleBash`'s detection logic is unchanged** — it doesn't need staleness detection (a task's diff always means the touched files changed, by definition), only the added wikilink line.

## Rejected alternatives

**B — mtime comparison instead of content hash.** Compare the source file's `fs.statSync(...).mtimeMs` against the note's mtime; no frontmatter change, no hash import, no cross-directory dependency at all. Simpler on paper. Rejected: mtimes are not a reliable proxy for content change — a fresh `git clone`/checkout resets all file mtimes to checkout time regardless of git history, editors and formatters can touch a file without changing its meaningful content, and CI/deploy pipelines routinely normalize timestamps. This would produce both false staleness (spurious refresh nudges after every clone) and false freshness (a note note updated after a real edit if the note file happens to have a later mtime than the source for unrelated reasons). PROBLEM.md's criterion 4 requires detecting an actual content change, not a filesystem-timestamp change — mtime cannot honestly satisfy that.

**C — track the hash only in the hook's own session state file, not in note frontmatter.** Avoids touching `lib/knowledge-frontmatter.js` or the note format at all — the hook remembers "what hash did I last see for this path" purely in its own transient state. Rejected: the session state file idle-expires (12h) and evicts old sessions (cap 20) by design — it is explicitly not meant to be a durable record. Criterion 4 doesn't scope "source changed" to "changed within the same session"; a note written last week must still be correctly detected as stale on a fresh read today, in a brand-new session, possibly by a different agent/machine. Only the note itself (frontmatter) is a durable, cross-session source of truth for "what content did this note last document" — consistent with the note being the actual persistent artifact and the state file being disposable bookkeeping.

## Failure-mode handling

- **Bad input (source unreadable/deleted between the Read tool call and hook execution)**: wrap the hash computation in the same try/catch style already used around `computeKnowledgePath` ("best-effort: never crash the hook on a naming edge case") — on failure, treat as `state: new`'s absence of information and return `''` (silent), never throw.
- **Bad input (malformed note frontmatter)**: `parseFrontmatter` already never throws — falls back to `{type: 'unknown'}` on parse failure (existing prior art), so a malformed note simply has `source_hash === undefined`, which correctly falls into the `stale` branch (safe default: nudge to fix it up).
- **Dependency down**: none — no network calls added; `hashContent` is `node:crypto` only, same as today's zero-network hook contract.
- **Load spike**: hashing on every `Read` of a source file is a new per-call cost (previously just `fs.existsSync`), but it's the same cost profile already accepted for T-5's embeddings pipeline (hash every changed file); source files this heuristic targets are code, not large binaries (already excluded by the extension denylist), so this stays well inside the existing 10s hook timeout.
- **Partial failure (state file corrupted or old-format array `nudged`)**: `loadState` treats anything that isn't the expected object shape as empty — degrades to "may nudge once more than strictly necessary," never crashes. Matches the existing "unparseable state: treat as fresh" pattern already in the code.
- **Partial failure (state file write fails, read-only project)**: unchanged from today — existing try/catch around `fs.writeFileSync` falls back to "nudge every time," a pre-existing, accepted degradation.

## Open questions resolved during design

- **Where does the hash comparison happen — in `handleRead` directly, or a new helper?** Inline in `handleRead`, following the file's existing style (`isSourceFile`, `shouldNudge` etc. are all small top-level functions, not a class or module split); the three-way branch (`new`/`current`/`stale`) is a handful of lines, not enough to justify a new abstraction.
- **Does `shouldNudge`'s signature need to change?** Yes, minimally: it already takes `(statePath, sessionId, relPath)`; extending it to `(statePath, sessionId, relPath, currentHash)` and changing its internal comparison from array-membership to hash-equality is a small, backward-compatible-at-the-call-site change (both existing call sites already have exactly this information available).

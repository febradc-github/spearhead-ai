## Context

Three capture triggers need to prompt an agent to act: search-first
(before reading source), code-doc-on-first-read, and doc-update-on-task-done.
The simplest option — static prose in `rules/RULES.md` — was compared against
hook-based nudges.

## Decision

Search-first is folded into `hooks/remind.js`'s existing injected message
(one extra line, both the full-rules and one-line-anchor variants) rather
than a new hook — it already runs on every `UserPromptSubmit` with proven
cadence management. Code-doc-on-first-read and doc-update-on-task-done share
one new hook file, `hooks/knowledge-nudge.js`, with two matchers (`Read`,
and `Bash|PowerShell` for `state.js transition ... done`), reusing
`remind.js`'s session-id/idle-expiry pattern for "already nudged this file"
tracking.

## Consequences

- Static-prose-only was rejected: `remind.js` exists specifically because
  prose reminders don't reliably fire every session; a rules-file mention
  would not satisfy the "automatic, no extra step" requirement.
- No competing cadence tracker: search-first rides `remind.js`'s existing
  state file instead of introducing a second one.
- `knowledge-nudge.js` is a genuinely new hook (two new matchers registered
  in both plugin manifests), so it adds to the PreToolUse/PostToolUse
  surface `guard.js` and `validate-state.js` already occupy — must not
  conflict with their matchers or block on their exit codes.
- Hooks only ever nudge; they never call the embeddings API or write index
  files themselves (that stays inside the MCP server, per `adr-001`), so
  they stay within the existing 10s hook timeout.

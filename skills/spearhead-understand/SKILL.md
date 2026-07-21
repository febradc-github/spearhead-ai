---
name: spearhead-understand
description: "Phase 1 of the spearhead pipeline: restates the problem, extracts the real goal, applies the clarification gate rule, and writes problem/PROBLEM.md with checkable acceptance criteria for user approval. Dispatched by /spearhead:understand or /spearhead:attack only."
argument-hint: "[problem statement]"
user-invocable: false
---

# Understand

<important>
- Read the clarification gate rule from the plugin's `rules/RULES.md` and apply it verbatim; do not restate it from memory.
- Every acceptance criterion must be checkable: verifiable by a command, a test, or an observable output. Reject your own vague drafts ("works well", "is fast", "handles errors gracefully") and rewrite them until each is testable.
- All status mutations go through the state CLI: `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js" <command> ... --dir <project root>` (if the variable is unset, use the plugin's install path). Never Write/Edit `spearhead/status.yml` -- guard.js blocks it.
- Approval is the user's, never yours. Do not set `understand: approved` until the user has said yes to the finished PROBLEM.md.
</important>

## Preconditions

None -- this is the pipeline's entry phase. If `spearhead/status.yml` exists with an active attack whose `understand` is already `approved`, tell the user this phase is closed for the current attack and point at `/spearhead:recon` (or `/spearhead:abort` to start over). If instead the user wants to REPLACE the approved problem with a different idea (a pivot, not a refinement of this one), invoke the `spearhead-pivot` skill -- it confirms, archives the current attack, and re-enters this phase with the new idea. Never reopen `understand` in place; phases only advance.

## Process

1. If `spearhead/status.yml` does not exist (or the previous attack is `aborted`/`complete`): run `state.js init "<short title>"` (pass `--attack-counter <n>` from the archived attack when this follows an abort). This lazily creates `spearhead/`.
2. First run for this project: offer the repo-hygiene addition to `.gitignore`:

   ```
   spearhead/.remind-state.json
   spearhead/worktrees/
   ```

   and recommend committing the rest of `spearhead/` (it is the project's decision record). If the user declines, run `state.js set-gitignore-declined` and never ask again for this attack.
3. Set the phase in dialogue: `state.js set-phase understand in_dialogue`.
4. Restate the problem in your own words. Extract the real goal behind the request -- what the user is actually trying to achieve, which may be narrower or wider than what they typed. Identify inputs, outputs, constraints, scale, and edge cases.
5. Apply the clarification gate rule (from `rules/RULES.md`): classify each ambiguity, batch the blocking ones into ONE message to the user, and record every non-blocking assumption for `## Assumptions`.
6. Write `spearhead/problem/PROBLEM.md`:
   - `## Problem statement` -- the user's problem, restated.
   - `## Real goal` -- what success actually means.
   - `## In scope` / `## Out of scope` -- explicit lists.
   - `## Assumptions` -- every non-blocking assumption made.
   - `## Acceptance criteria` -- numbered, each one checkable by a command, test, or observable output.
7. Show the user the file (or a faithful summary) and ask for approval of PROBLEM.md as written.
8. On approval: `state.js set-phase understand approved`, then tell the user `/spearhead:recon` is next. On requested changes: revise and re-ask; the phase stays `in_dialogue`.

## Refusals

- Attack already past this gate: name the current phase and the command for it.
- The user asks you to skip approval or approve on their behalf: refuse; the gate is hard.

## Error handling

- `state.js` refuses a mutation: report its named reason verbatim and stop; never work around it by editing the file.

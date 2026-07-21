---
name: spearhead-abort
description: "Aborts the current attack with a recorded reason: artifacts archived to spearhead/archive/<timestamp>/, worktrees removed, branches left for salvage, counter bumped. History, not deletion. Dispatched by /spearhead:abort only."
argument-hint: "[reason]"
user-invocable: false
---

# Abort

<important>
- Abort is archival, not deletion: every phase artifact survives under `spearhead/archive/<timestamp>/`.
- Explicitly EXCLUDED from the archive: `.remind-state.json` (session tracking survives in place) and `worktrees/` (worktrees are removed; the `spearhead/T-<n>` branches are left in git for manual salvage -- say so in the report).
- Confirm before acting: aborting parks real work. State what will be archived and what survives, then wait for the user's yes. Exception: when the invoker states the confirmation was already obtained (spearhead-pivot does this), skip the prompt — state what you are archiving and proceed.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Read `state.js show`. No active attack: report and stop.
2. Tell the user what abort will do (archive list, worktree removal, branches kept) and confirm — unless the invoker (e.g. spearhead-pivot) states the confirmation was already obtained, in which case state what you are archiving and proceed without a second prompt.
3. `state.js abort "<reason from $ARGUMENTS, or ask>"` -- records `state: aborted` + the reason and bumps `attack_counter`; the archived status.yml carries all of it.
4. Remove any task worktrees: `git worktree remove --force spearhead/worktrees/T-<n>` for each present. Branches stay.
5. Archive: create `spearhead/archive/<ISO timestamp>/` and MOVE into it: `problem/`, `design/`, `plan/`, `verify/`, `ship/`, `retro/`, `decisions/` (those that exist), and `status.yml`. Never move `.remind-state.json` or `worktrees/`.
6. Report: where the archive lives, which branches remain for salvage, and that the next attack is `A-<n+1>` -- `/spearhead:understand` (or `/spearhead:attack`) starts it; pass `--attack-counter <n+1>` from the archived status when initializing.

## Refusals

- No active attack: nothing to abort.
- The user asks to delete instead of archive: refuse; history, not deletion.

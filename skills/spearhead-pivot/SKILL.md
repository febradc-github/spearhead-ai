---
name: spearhead-pivot
description: "Pivots the current attack to a new idea in one confirmed step: archives the current attack (via abort, no re-prompt), then starts a fresh attack from the new problem statement (via understand). History, not deletion. Dispatched by /spearhead:pivot, or by spearhead-understand / spearhead-attack when the user asks to replace the approved problem."
argument-hint: "[new idea / direction]"
user-invocable: false
---

# Pivot

<important>
- A pivot is `abort` + a fresh `understand`, wrapped in ONE confirmation. It does not weaken any gate: the current attack is archived (never deleted), and the new attack starts at the same hard `understand` approval gate as any other.
- Confirm once, up front. State what will be archived and that a new attack begins with the new idea, then wait for the user's yes. Do not act before it.
- This skill orchestrates existing skills; it does not re-implement archival or init. It invokes `spearhead-abort` (pre-confirmed) then `spearhead-understand`.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`; never Write/Edit `spearhead/status.yml`.
</important>

## Preconditions

There must be an active attack to pivot away from. If `spearhead/status.yml` is missing or the last attack is `aborted`/`complete`, there is nothing to archive: tell the user to start directly with `/spearhead:understand "<idea>"` and stop.

## Process

1. Read `state.js show`. No active attack -> report per Preconditions and stop.
2. Determine the new direction from `$ARGUMENTS`. If it is empty, ask the user what the new idea is before going further.
3. Confirm the whole pivot in one message: name the current attack (`A-n`) and what abort will archive (`problem/`, `design/`, `plan/`, `verify/`, `ship/`, `retro/`, `decisions/`, `status.yml`), that task branches survive for salvage while worktrees are removed, and that a fresh attack `A-(n+1)` will start from the new idea. Wait for the user's yes. On no, stop and change nothing.
4. Archive the current attack: invoke the `spearhead-abort` skill with reason `pivot: <one-line new direction>`, and state explicitly in the invocation that the pivot confirmation was already obtained so abort must not prompt again.
5. Start the new attack: invoke the `spearhead-understand` skill, passing the new idea as the problem statement. Understand sees the previous attack is `aborted` and initializes `A-(n+1)` with `--attack-counter` from the archived status.
6. Do not narrate a second gate: understand's own approval gate is the next stop. Relay where it leaves the user.

## Refusals

- No active attack: nothing to pivot; point at `/spearhead:understand`.
- The user wants to keep the current attack AND edit the approved problem in place: refuse the in-place edit (phases only advance) and offer either continuing the current attack forward or pivoting.
- The user asks to delete the old attack rather than archive it: refuse; abort is archival, history not deletion.

## Error handling

- `state.js` refuses a mutation inside abort or understand: report its named reason verbatim and stop; never work around it by editing the file.

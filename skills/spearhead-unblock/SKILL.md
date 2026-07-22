---
name: spearhead-unblock
description: "Recovery for blocked or stale tasks (retry / reset / replan) and for a stale verify lock (--lock). Never silently discards work. Dispatched by /spearhead:unblock only."
argument-hint: "[T-id | --lock]"
user-invocable: false
---

# Unblock

<important>
- Precondition: the target task is `blocked` or flagged possibly stale (`in_progress`, `dispatched_at` older than 30 minutes, no visible activity); or `--lock` with a held `verify_lock`. Anything else: refuse, naming the task's actual state.
- Never silently discard work. Reset deletes a branch and worktree only after explicit confirmation.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process (task)

1. Show what happened: attempts used, the last error output (from the execute report or `V-<n>.<k>.md`), and a diff summary (`git diff <base_branch>...spearhead/T-<n> --stat`).
2. If the task is stale `in_progress` (not `blocked`): confirm with the user that the dispatch is dead, then `state.js transition T-<n> blocked` first -- the matrix routes stale recovery through `blocked`.
3. Offer exactly three recoveries and wait for the choice:
   1. **retry** -- keep the branch, worktree, and partial work; reset attempts: `state.js transition T-<n> todo` (the CLI resets `attempts` on this transition). Next `/spearhead:execute T-<n>` resumes in the same worktree.
   2. **reset** -- discard the work. Requires explicit confirmation. Then: `git worktree remove --force spearhead-attacks/worktrees/T-<n>`, `git branch -D spearhead/T-<n>`, `state.js transition T-<n> todo --reset` (clears branch, worktree, mode, dispatch time, parallel approval).
   3. **replan** -- the task itself is wrong: send the user to `/spearhead:replan` (the task can be edited or removed while `blocked`; do not transition it here).

## Process (--lock)

1. Read the holder from `state.js show`. No lock held: report that and stop.
2. Show which task holds it and since when; confirm with the user that no verify is actually running (a live verify's lock must never be cleared).
3. On confirmation: `state.js unlock`. The held task is still `implemented`; `/spearhead:verify T-<n>` restarts verification cleanly.

## Refusals

- Task neither `blocked` nor stale: name its state and the command that owns it.
- `--lock` when `verify_lock` is null: nothing to clear.

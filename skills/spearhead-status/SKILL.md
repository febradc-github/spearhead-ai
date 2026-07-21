---
name: spearhead-status
description: "Read-only render of the spearhead attack: phases (execute derived), task board, dispatch modes, parallel-eligible tasks, blockers, verify lock, and staleness flags. Dispatched by /spearhead:status only."
user-invocable: false
---

# Status

<important>
- Strictly read-only: this skill never mutates state, never dispatches, never clears anything. Recovery belongs to `/spearhead:unblock`.
- Staleness is a FLAG, never a fact: file state cannot know whether a background agent is alive. Present it as "possibly stale", with the threshold stated, and suggest inspection via `/spearhead:unblock`.
</important>

## Process

1. Read `state.js show` (read-only) -- or report that no attack exists and point at `/spearhead:understand` / `/spearhead:attack`.
2. Render:
   - **Attack** -- id, title, state, started.
   - **Phases** -- the six stored phases, plus `execute: <n>/<m> tasks done (derived)`. Never present execute as a stored field.
   - **Task board** -- per task: id, title, status, mode, branch, attempts, verify attempts, dependencies. Group by status.
   - **Dispatched now** -- `in_progress` tasks with their mode and `dispatched_at`.
   - **Parallel-eligible now** -- `todo` tasks whose `depends_on` are all `done` AND whose file sets are disjoint from every `in_progress` task's (approval would still be required at launch).
   - **Blockers** -- `blocked` tasks with their attempt counts; each points at `/spearhead:unblock T-<n>`.
   - **Verify lock** -- holder or free.
3. **Staleness:** flag any `in_progress` or lock-holding task whose `dispatched_at` is older than 30 minutes (state the threshold in the output) as `possibly stale -- inspect and recover via /spearhead:unblock T-<n>` (or `--lock` for the lock).
4. End with the single most useful next command.

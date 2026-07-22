---
name: spearhead-ship
description: "Phase 7 of the spearhead pipeline: SHIP.md (what changed, how to verify, tradeoffs, rollout, monitoring) once every task is done. Dispatched by /spearhead:ship or /spearhead:attack only."
user-invocable: false
---

# Ship

<important>
- Hard gate: refuse unless every task is `done` -- a fact DERIVED from task states (`state.js show` prints `execute_complete`), never stored. Refusal message names the tasks that are not done and the command each needs.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Check the gate: `state.js show`; `execute_complete` must be true. Refuse otherwise, listing each unfinished task with its state and next command (`todo` -> execute, `implemented` -> verify, `blocked` -> unblock).
2. Write `spearhead-attacks/ship/SHIP.md` as a PR-description / release-note draft:
   - `## What changed` -- per task, one paragraph, from the merge commits and verification reports.
   - `## Why` -- from PROBLEM.md's real goal.
   - `## How to verify` -- the commands a reviewer runs; lifted from the verification reports.
   - `## Tradeoffs` -- from DESIGN.md's rejected alternatives and any execute-time ADRs.
   - `## Rollout` -- feature flag / staged rollout if applicable; plain deploy otherwise.
   - `## Monitor after release` -- what to watch, from the design's failure modes.
3. Offer to delete the merged `spearhead/T-<n>` branches (`git branch -d`). The user may decline; they are merged, so deletion loses nothing either way.
4. `state.js set-phase ship complete`; point at `/spearhead:retro`.

## Refusals

- Any task not `done`: name it, its state, and its command. The gate is derived; there is no field to flip.

---
name: spearhead-breakdown
description: "Phase 4 of the spearhead pipeline: decomposes the approved design into atomic tasks with binding expected-file sets, dependencies, and a testing strategy; approval records base_branch and creates the tasks. Dispatched by /spearhead:breakdown or /spearhead:attack only."
user-invocable: false
---

# Breakdown

The command is named `breakdown` (not `plan`) because `plan` would collide
with Claude Code's built-in plan mode; the phase it gates is still recorded
as `phases.plan` in status.yml.

<important>
- Hard gate: refuse unless `phases.design` is `approved`. Refusal message: "breakdown requires `design: approved` -- run /spearhead:design first."
- Atomic tasks: completable by one agent holding its full context; target <= ~200 changed lines and one concern per task. Every task leaves the system working. Riskiest task first.
- Expected-file sets are BINDING: they cover files the task will modify or create, globs allowed for predictable creations (e.g. `src/auth/**`, `tests/auth/**`) so test-first work's new test files don't trip scope containment. A plan whose tasks list only modified files is incomplete -- test-first work always creates files. Reject it and redo it.
- Lockfile routing (section 4a of the spec, summarized): changes to dependency manifests/lockfiles and regenerated artifacts go into ONE dedicated task, or the tasks touching them are serialized via `depends_on`. Two parallel-eligible tasks may never both list a lockfile.
- The testing strategy is decided HERE, before implementation; the verifier reads it later.
- Approval is the user's. Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Check the gate (`state.js show`). Refuse if unmet.
2. Decompose DESIGN.md into ordered atomic tasks. Sequence so every task leaves the system in a working state; put the riskiest/most uncertain task first. Record `depends_on` edges only where a real ordering exists -- fewer edges means more parallel-eligible work later.
3. For each task draft `spearhead-attacks/plan/tasks/T-<n>.md` (numbering from the status counter -- see step 6) containing:
   - `## Goal` -- one concern, one sentence.
   - `## Expected files` -- the binding set, paths and globs, covering modifications AND creations.
   - `## Depends on` -- task ids or "none".
   - `## Acceptance criteria` -- per-task, a subset of or derived from PROBLEM.md's criteria.
   - `## Out of scope` -- explicit list; the verifier checks the diff against it.
   - `## Verification commands` -- the exact test/lint/build commands that prove it done.
4. Write `spearhead-attacks/plan/PLAN.md`: the ordered task list with one-line summaries, the dependency graph, and `## Testing strategy` (frameworks, coverage expectations, what new tests are required where -- the verifier reads this section verbatim).
5. Self-check before asking approval: pairwise-overlap the expected-file sets of tasks with no dependency path between them and flag collisions (they will block parallelism later -- either accept the serialization or re-cut the tasks); check the lockfile routing rule; check every task has creations covered by its file set.
6. Ask the user for approval of PLAN.md and the task files. On approval:
   1. Determine the current branch: `git rev-parse --abbrev-ref HEAD`.
   2. `state.js approve-plan --base-branch <branch>`.
   3. For each task in order: `state.js add-task "<title>" --depends <ids> --files "<set>"`. The CLI assigns `T-<n>` from the monotonic counter; if a draft filename does not match the assigned id, rename the file to match.
   4. Tell the user `/spearhead:execute` is next, and which tasks are immediately eligible.

## Refusals

- `design` not `approved`: name the gate and `/spearhead:design`.
- `state.js add-task` refusals (unknown deps, cycles): report the named reason, fix the plan, re-ask approval for the changed part.

## After approval

Plan changes go through `/spearhead:replan`, never through re-running this skill.

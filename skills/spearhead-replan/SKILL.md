---
name: spearhead-replan
description: "Amends the approved plan without restarting the pipeline: edit, add, split, or remove todo/blocked tasks, re-validated against the invariants and re-approved by the user. Dispatched by /spearhead:replan only."
user-invocable: false
---

# Replan

<important>
- Hard gate: refuse unless `phases.plan` is `approved`. There is nothing to amend before approval -- that is still `/spearhead:breakdown`.
- Only `todo` and `blocked` tasks may be edited or removed -- never `in_progress`, `implemented`, or `done`. `state.js` refuses violations (`replan-scope`); relay them.
- This is the sanctioned answer to "the file sets overlap" and "the plan was wrong". Nothing else may rewrite tasks.
- Every amendment requires user approval BEFORE `state.js` applies it.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Check the gate (`state.js show`). Refuse if unmet.
2. Hear the amendment (or propose one if routed here from an overlap refusal): edits to titles, expected-file sets, or dependencies; new tasks; splits (edit the original + add the remainder); removals.
3. Validate the proposal before asking approval: file sets still cover creations (test-first rule from the plan skill), lockfile routing still holds, dependencies acyclic, disjointness of parallel-intended tasks. Update the affected `plan/tasks/T-<n>.md` files and PLAN.md's task list to match.
4. Present the amendment as a diff of the plan and ask for approval.
5. On approval, apply via the CLI -- `state.js edit-task T-<n> --title/--depends/--files ...`, `state.js add-task "<title>" --depends --files` (new ids come from the counter; write the matching task file), `state.js remove-task T-<n>` (refused while other tasks depend on it -- amend those first). Any refusal: report the named reason, adjust, re-ask.
6. Report the amended board and the next eligible task.

## Refusals

- `plan` not `approved`: point at `/spearhead:breakdown`.
- Amendments touching `in_progress`/`implemented`/`done` tasks: refuse; finish or unblock them first.

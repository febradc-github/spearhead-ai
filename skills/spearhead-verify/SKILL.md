---
name: spearhead-verify
description: "Phase 6 of the spearhead pipeline: mechanical gates in the task's worktree, an independent verifier verdict, merge with integration check on pass, and a versioned verification report either way. Dispatched by /spearhead:verify or /spearhead:attack only."
argument-hint: "[T-id]"
user-invocable: false
---

# Verify

<important>
- Hard gate: refuse unless the task is `implemented` and `verify_lock` is free. `state.js lock T-<n>` enforces both; report its refusal verbatim (a stale lock is cleared only by the user via `/spearhead:unblock --lock`).
- Nothing self-certifies: the verdict on a fix is never written by the turn (or agent) that produced the fix. The mechanical gates are the hard floor; the verifier's judgment sits on top.
- Read the anti-reward-hacking checklist from the plugin's `rules/RULES.md`; it is canonical there and goes into the verifier's input package verbatim.
- Verification is sequential even when execution was parallel: it merges into and tests the shared `base_branch`.
- Only this skill reaches `done`. The transition matrix makes `implemented -> done` (and `implemented -> in_progress`) possible only while this skill holds the lock.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Resolve the task (from `$ARGUMENTS`, or the only `implemented` task; several: ask which). Acquire the lock: `state.js lock T-<n>`. Refused: relay the named reason and stop.
2. `state.js bump-verify T-<n>` -- this attempt is `<k>`; its report is `spearhead/verify/V-<n>.<k>.md`. History is never overwritten: a fail-fix-reverify cycle produces V-n.1.md, V-n.2.md, ...
3. **Mechanical gates, run for real in the task's worktree on its branch:** the FULL test suite (not just new tests), lint, build -- the commands from the task file plus the project's standard suite. Any failure:
   write `V-<n>.<k>.md` (gate, command, full output) -> `state.js transition T-<n> in_progress` -> `state.js unlock` -> report to the user. Stop here; nothing else increments.
4. **Independent verdict.** Assemble the verifier input package -- exactly and only:
   - the task file `plan/tasks/T-<n>.md` (including its out-of-scope list);
   - the acceptance criteria (task file + the PROBLEM.md criteria it derives from);
   - the diff: `git diff <base_branch>...spearhead/T-<n>`;
   - the `## Testing strategy` section of `plan/PLAN.md`;
   - the anti-reward-hacking checklist copied verbatim from `rules/RULES.md`.

   **Claude Code:** dispatch the `spearhead-verifier` agent (opus, read-only, fresh context) with that package. It returns a per-criterion verdict with evidence plus the four checklist results. It never fixes, never merges, never writes state.

   **kimi-code fallback:** use a built-in read-only sub-agent if one exists, with the same package. Otherwise run the mandatory **fresh-eyes protocol** in the main session: re-read ONLY the input package; explicitly disregard the implementation conversation; record the verdict per criterion in `V-<n>.<k>.md`. The mechanical gates of step 3 already ran for real either way -- they are the hard floor. The verdict must never be written by the same turn that produced a fix: if this session implemented the task (kimi coder fallback), the verdict must come from a sub-agent or, at minimum, a fresh turn that has re-derived everything from the package alone.
5. **Verdict fail:** write `V-<n>.<k>.md` with per-criterion failures and evidence -> `state.js transition T-<n> in_progress` -> `state.js unlock` -> report. The coder's next pass addresses the named failures.
6. **Verdict pass -- merge and integration check:**
   1. On `base_branch`: `git merge --no-ff spearhead/T-<n>`.
   2. Run the full suite once more on the merged tree (the integration check -- it catches interaction failures between merged tasks; per-branch gates caught the task's own).
   3. **Integration pass:** write `V-<n>.<k>.md` (verdict + integration result) -> `state.js transition T-<n> done` (the CLI clears the worktree field) -> `git worktree remove spearhead/worktrees/T-<n>` (keep the branch until ship) -> `state.js unlock`.
   4. **Integration fail:** `git revert -m 1 <merge-commit>` so `base_branch` stays green -> write `V-<n>.<k>.md` recording the integration failure output (blame lands on the task being merged) -> `state.js transition T-<n> in_progress` -> `state.js unlock` -> report.
7. Report the outcome. All tasks `done` (derived -- `state.js show` prints `execute_complete`): point at `/spearhead:ship`. Otherwise name the next eligible task.

## Refusals

- Task not `implemented`, or lock held: relay `state.js`'s named refusal (`not-implemented`, `lock-held`) and the resolving command.
- The user asks to skip the mechanical gates or the independent verdict: refuse; both are the phase.

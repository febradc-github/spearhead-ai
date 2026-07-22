---
name: spearhead-execute
description: "Phase 5 of the spearhead pipeline: dispatches the spearhead-coder agent on one task in its own git worktree and branch, enforcing the parallelism rule and the retry policy. Dispatched by /spearhead:execute or /spearhead:attack only."
argument-hint: "[T-id]"
user-invocable: false
---

# Execute

<important>
- Hard gate: refuse unless `phases.plan` is `approved`. Refusal message: "execute requires `plan: approved` -- run /spearhead:breakdown first."
- Git preconditions: refuse (naming the requirement) if the project is not a git repository, or if `base_branch` has uncommitted changes outside `spearhead-attacks/`. The worktree/branch model depends on both.
- Read the parallelism rule, the scope containment rule, and the failure and retry policy from the plugin's `rules/RULES.md` before dispatching; they are canonical there, not here.
- You dispatch and supervise; the coder codes. Never implement task work in this session on Claude Code. Never mark a task `done` -- `implemented` is this phase's ceiling; only /spearhead:verify reaches `done`.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`. The CLI enforces the transition matrix and the parallel invariants; report its refusals verbatim.
</important>

## Task isolation and commit model

Every task runs on its own branch in its own worktree:

- Branch `spearhead/T-<n>` is created from `base_branch`; worktree at `spearhead-attacks/worktrees/T-<n>/`:
  `git branch spearhead/T-<n> <base_branch> && git worktree add spearhead-attacks/worktrees/T-<n> spearhead/T-<n>`
- The coder works ONLY inside that worktree, committing small conventional commits on that branch. It never merges, never touches `base_branch`, never edits `spearhead-attacks/` state files, never uses `--no-verify`. Commit messages never tag Anthropic or Claude and never carry a "Co-Authored-By:" trailer (commit message rule in `rules/RULES.md`; guard.js enforces it).
- Merging is verify's job, on pass, with an integration check. Parallel coders therefore never contend for the index, the working tree, or the test runner; the expected-file disjointness check exists to predict merge conflicts, not to provide isolation.

## Process

1. Check gates: `state.js show`; `git rev-parse --is-inside-work-tree`; `git status --porcelain` on `base_branch` filtered to paths outside `spearhead-attacks/`. Refuse on any failure, naming the unmet requirement.
2. Resolve the target task: `$ARGUMENTS` id, or the first `todo` task whose `depends_on` are all `done`. No eligible task: say why (blocked tasks -> `/spearhead:unblock`; all done -> `/spearhead:verify` or `/spearhead:ship`).
3. **Parallelism check** (rule in `rules/RULES.md`): if another task is already `in_progress`, this dispatch is a parallel launch. Verify (a) deps done and (b) expected-file sets disjoint against EVERY in_progress task, then propose the specific pairing to the user and wait for explicit approval. On approval: `state.js set-parallel T-<n>`. On (a)/(b) failure: refuse, naming the conflicting task and files -- a file-set overlap cannot be overridden, only re-planned (`/spearhead:replan`).
4. Create the branch and worktree (commands above). Then dispatch:
   `state.js transition T-<n> in_progress --branch spearhead/T-<n> --worktree spearhead-attacks/worktrees/T-<n> --mode <background|foreground>`
5. **Dispatch the coder** with ONLY this input package: the task file `plan/tasks/T-<n>.md`, PROBLEM.md's acceptance criteria, CONTEXT.md's conventions, DESIGN.md, and the worktree path. Nothing from this conversation.
   - **Claude Code:** dispatch the `spearhead-coder` agent. Prefer background dispatch (`mode: background`) so this session stays free -- the user can keep talking, run `/spearhead:status`, or launch an approved parallel task. If the runtime cannot dispatch in the background (the attempt errors or demonstrably blocks the turn), dispatch in the foreground and record `mode: foreground`; nothing in the state model depends on true concurrency.
   - **kimi-code fallback:** plugin agents are unavailable. Dispatch kimi-code's built-in `coder` sub-agent with the same restricted input package. If no such sub-agent exists, implement in the main session -- still ONLY inside the task's worktree, still test-first, still small commits on the task branch. The worktree/branch model, scope containment, and the retry policy hold regardless of who codes.
   - **Background/parallel fallback (any runtime):** if background dispatch is unavailable, offer parallel-eligible tasks sequentially instead of concurrently -- same approval, same disjointness check, same worktrees, tasks queued back-to-back. Only concurrency degrades, never the gates.
6. On coder completion, check its report and diff (`git diff <base_branch>...spearhead/T-<n> --stat`):
   - **Scope containment:** every changed path must fall inside the expected-file set. A stray path is a violation: `state.js transition T-<n> blocked`, report the paths, point at `/spearhead:unblock`. Adjacent problems the coder found go to `retro/RETRO.md` under `## Follow-ups`, never fixed inline.
   - **Retry policy:** verification-command failures give at most 2 repair attempts (`state.js bump-attempts T-<n>` each time -- the CLI refuses a third). After the second failure: `state.js transition T-<n> blocked` and report exactly what was tried and the final error output. Never weaken a test to pass. A blocked BACKGROUND task is surfaced to the user immediately, not silently parked.
   - **Success:** `state.js transition T-<n> implemented`; tell the user to run `/spearhead:verify T-<n>` (verification is always sequential, because it merges into the shared `base_branch`).
7. After completing or launching a task, you may proactively list which remaining `todo` tasks are parallel-eligible RIGHT NOW and ask whether to launch any alongside. Never launch a parallel task without that explicit approval.

## Refusals

- `plan` not `approved`; not a git repo; dirty `base_branch` outside `spearhead-attacks/`: name the requirement.
- Parallel launch failing deps/disjointness: name the conflicting task and files; only `/spearhead:replan` can resolve an overlap.
- Task not `todo` (or unknown): report its actual state and the command that handles it (`blocked` -> `/spearhead:unblock`, `implemented` -> `/spearhead:verify`).

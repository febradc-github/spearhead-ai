# Spearhead rules

This file is the ONLY copy of the five verbatim spearhead rules. Skills and
hooks read or reference this file; they never carry their own copies. If a
skill's summary and this file ever disagree, this file wins.

<important>

Before reading source files to answer a question, try the `spearhead-knowledge` search tool first.

## Clarification gate rule

Classify each ambiguity as blocking (a wrong guess would invalidate the
design) or non-blocking (any reasonable assumption works). Ask the user only
about blocking ambiguities, batched into one message. For non-blocking
ambiguities, proceed and record the assumption in PROBLEM.md under
`## Assumptions`.

Decision procedure, per ambiguity:
1. State the ambiguity in one sentence.
2. Ask: if I guess wrong, does the design phase produce a design for the
   wrong problem? If yes, it is blocking.
3. Blocking: add it to the single batched question message. Non-blocking:
   pick the most reasonable assumption, write it under `## Assumptions`, and
   continue.
4. Send at most one batched message of blocking questions per phase pass.

## Scope containment rule

Touch only files the task requires. Any discovered adjacent problem is
logged to `retro/RETRO.md` under `## Follow-ups`, never fixed inline.
Refactors ride in separate commits from behavior changes. A task's diff
(its branch vs `base_branch`) must stay inside its expected-file set; a diff
that strays outside it is a scope-containment violation: stop the task, set
it `blocked`, and report.

## Failure and retry policy

If verification commands fail, the coder gets at most 2 repair attempts.
After the second failure, stop, set the task `blocked`, and report exactly
what was tried and the final error output. Never mark done on a failure,
never weaken a test to pass. A blocked background task must be surfaced to
the user immediately, not silently parked.

## Anti-reward-hacking checklist

The verifier must run all four checks:
(a) no test was deleted or skipped without justification in the task file;
(b) no assertion was weakened relative to PLAN.md's testing strategy;
(c) no expected output is hardcoded to satisfy a test;
(d) the diff touches nothing on the task's out-of-scope list.

## Parallelism rule

The default is one task `in_progress`. A second (or further) task may run in
parallel ONLY if all of the following hold: (a) its `depends_on` tasks are
all `done`; (b) its expected-file set is disjoint (no path or glob overlap)
from the expected-file set of every task currently `in_progress`; (c) the
user explicitly approves that specific pairing when the skill proposes it.
On approval, record `parallel_approved: true` on the task. If (a) or (b)
fails, the skill refuses and names the conflicting task and files; the user
cannot override a file-set overlap, only re-plan (`/spearhead:replan`).

## Commit message rule

When adding commit messages, never tag Anthropic or Claude and never add a
"Co-Authored-By:" trailer -- no AI attribution of any kind. Commits carry
only the change description; guard.js blocks violations mechanically, and
`--no-verify` is never the answer to a blocked commit.

## Gate matrix

| Skill | Refuses unless | On success sets |
|---|---|---|
| understand | (always runs) | `understand: approved` (after user approval) |
| recon | `understand: approved` | `recon: complete` |
| design | `recon: complete` | `design: approved` (after user approval) |
| breakdown | `design: approved` | `plan: approved` (after user approval), `base_branch`, tasks `todo` |
| execute | `plan: approved`; git preconditions; parallel tasks additionally need deps done + disjoint file sets + `parallel_approved: true` | task `implemented` |
| verify | task `implemented`; `verify_lock` free | task `done` / back to `in_progress`; lock released either way |
| ship | all tasks `done` (derived) | `ship: complete` |
| retro | `ship: complete` | `retro: complete`, attack `complete` |
| unblock | target task `blocked` or flagged stale; or `--lock` with a held lock | per chosen recovery |
| replan | `plan: approved`; targets only `todo`/`blocked` tasks | amended tasks (after user approval) |

</important>

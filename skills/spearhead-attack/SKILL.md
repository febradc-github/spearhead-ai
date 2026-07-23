---
name: spearhead-attack
description: "Orchestrating entry point for the spearhead pipeline: classifies the current state from status.yml and drives phase by phase via the Skill tool, pausing at every hard gate. Dispatched by /spearhead:attack only."
argument-hint: "[problem: what/why, expected vs actual, constraints]"
user-invocable: false
---

# Attack

<important>
- This skill routes; the phase skills do the work. Invoke them via the Skill tool using their fully-qualified `spearhead:spearhead-X` name (`spearhead:spearhead-understand`, `spearhead:spearhead-recon`, ...); never inline their behavior here. A bare `spearhead-X` name is not the registered skill name and risks resolving to the wrong (or no) skill.
- Every hard gate still pauses for the user. Orchestration never converts an approval gate into an auto-approval.
- Read `state.js show` for classification; never guess the phase from conversation memory.
- If the user asks to change the idea / pivot to a different problem (rather than move forward in the current one), invoke the `spearhead:spearhead-pivot` skill instead of routing to a phase. It confirms before archiving.
</important>

## Process

1. If `spearhead-attacks/status.yml` is missing or the last attack is `aborted`/`complete`: this is a fresh attack. Invoke `spearhead:spearhead-understand`, passing `$ARGUMENTS` as the problem statement.
2. Otherwise classify from `state.js show` and route to the next incomplete phase, in pipeline order:
   - `understand` not `approved` -> `spearhead:spearhead-understand`
   - `recon` not `complete` -> `spearhead:spearhead-recon`
   - `design` not `approved` -> `spearhead:spearhead-design`
   - `plan` not `approved` -> `spearhead:spearhead-breakdown`
   - tasks not all `done` (derived) -> `blocked` tasks first (`spearhead:spearhead-unblock`), then `implemented` tasks (`spearhead:spearhead-verify`), then eligible `todo` tasks (`spearhead:spearhead-execute`)
   - `ship` not `complete` -> `spearhead:spearhead-ship`
   - `retro` not `complete` -> `spearhead:spearhead-retro`
   - all complete -> tell the user the attack is finished; `$ARGUMENTS` with a new problem starts the next one via `spearhead:spearhead-understand`.
3. After each phase skill returns, stop at its gate: report where the pipeline stands and what approval or command comes next. Continue only when the user says to (or re-run `/spearhead:attack`, which re-classifies).

## Refusals

- Inherited from the routed skill; this skill adds none of its own. Relay refusals verbatim.

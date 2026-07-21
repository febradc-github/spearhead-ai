---
name: spearhead-retro
description: "Phase 8 of the spearhead pipeline: criterion-by-criterion confirmation against PROBLEM.md, consolidated follow-ups and lessons into RETRO.md, and attack completion. Dispatched by /spearhead:retro or /spearhead:attack only."
user-invocable: false
---

# Retro

<important>
- Hard gate: refuse unless `phases.ship` is `complete`. Refusal message: "retro requires `ship: complete` -- run /spearhead:ship first."
- The confirmation is against PROBLEM.md's original criteria, criterion by criterion, with evidence -- not a vibe check. An unmet criterion is reported as unmet, with what it would take; never papered over.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Check the gate (`state.js show`). Refuse if unmet.
2. Walk PROBLEM.md's `## Acceptance criteria` one by one; for each cite the evidence (verification report, test, observable output) that it is met. Any unmet criterion: report it plainly and ask the user whether to accept the gap (recorded) or reopen work (`/spearhead:replan` needs `plan: approved` -- it still is).
3. Write `spearhead/retro/RETRO.md`:
   - `## Criteria confirmation` -- the per-criterion table with evidence.
   - `## Follow-ups` -- consolidated from execute-time entries plus anything new; each with enough context to become its own attack.
   - `## Lessons` -- what the next attack should do differently.
   - `## Docs and runbooks updated` / `## Dead code removed` -- lists (or "none", stated).
4. `state.js set-phase retro complete`, then `state.js set-attack-complete` (this also bumps `attack_counter` so the next attack is `A-<n+1>`).
5. Close out: the attack is complete; the next `/spearhead:understand` starts fresh.

## Refusals

- `ship` not `complete`: name the gate and `/spearhead:ship`.

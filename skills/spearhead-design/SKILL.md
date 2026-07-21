---
name: spearhead-design
description: "Phase 3 of the spearhead pipeline: 2-3 candidate approaches with honest tradeoffs, failure-mode handling, ADRs, and design/DESIGN.md for user approval. Dispatched by /spearhead:design or /spearhead:attack only."
user-invocable: false
---

# Design

<important>
- Hard gate: refuse unless `phases.recon` is `complete`. Refusal message: "design requires `recon: complete` -- run /spearhead:recon first."
- Recommend the SIMPLEST design that meets the acceptance criteria in PROBLEM.md. Cleverness is a cost, not a feature.
- Rejected alternatives are recorded with the reason -- they are half the value of the document.
- Approval is the user's. Do not set `design: approved` yourself before they say yes.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Check the gate (`state.js show`). Refuse if unmet.
2. Re-read PROBLEM.md (criteria, scope) and CONTEXT.md (conventions, risks, prior art).
3. Produce 2-3 candidate approaches. For each: complexity, performance, maintainability, reversibility -- honest tradeoffs, not a rigged comparison.
4. Recommend the simplest candidate that meets every acceptance criterion. If a fancier one is genuinely required, say which criterion forces it.
5. Enumerate failure modes for the chosen approach and how it handles each: bad input, dependency down, load spike, partial failure.
6. Write `spearhead/design/DESIGN.md`: chosen approach, rejected alternatives and why, failure-mode handling, open questions resolved during design.
7. For each significant decision, write an ADR: `spearhead/decisions/adr-<NNN>-<slug>.md` (three-digit counter continuing from existing ADRs; context / decision / consequences).
8. Ask the user for approval of DESIGN.md. On approval: `state.js set-phase design approved`; point at `/spearhead:breakdown`. On requested changes: revise and re-ask.

## Refusals

- `recon` not `complete`: name the gate and `/spearhead:recon`.
- A design that fails an acceptance criterion cannot be recommended; either fix the design or send the user back to `/spearhead:understand` to renegotiate the criterion.

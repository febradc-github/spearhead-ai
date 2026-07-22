---
name: spearhead-recon
description: "Phase 2 of the spearhead pipeline: budgeted context gathering (and mandatory bug reproduction) into problem/CONTEXT.md. Dispatched by /spearhead:recon or /spearhead:attack only."
user-invocable: false
---

# Recon

<important>
- Hard gate: refuse unless `phases.understand` is `approved` in `spearhead-attacks/status.yml`. Refusal message: "recon requires `understand: approved` -- run /spearhead:understand first."
- Reading has a budget: 25 file reads or 60k characters, whichever is hit first. State when the budget is hit and what was skipped.
- If the problem is a bug, reproduce it BEFORE anything else. No reproduction, no design: stop and report.
- Status mutations only via `node "$CLAUDE_PLUGIN_ROOT/scripts/state.js"`.
</important>

## Process

1. Check the gate (`state.js show`). Refuse if unmet.
2. **Bug path first:** if PROBLEM.md describes a bug, attempt to reproduce it now. Record in CONTEXT.md the exact reproduction command and observed vs expected output. If it cannot be reproduced within a reasonable effort, write what was tried to CONTEXT.md, report to the user, and STOP -- do not set the phase complete and do not proceed toward design.
3. Gather context in this order until the budget is spent:
   1. entry points and build/run scripts;
   2. conventions (lint config, existing patterns, dominant libraries);
   3. tests nearest the affected area;
   4. the modules the problem touches;
   5. related tickets/docs if present.
4. **Dispatch:** on Claude Code, dispatch the `spearhead-scout` agent (haiku, read-only) with the reading order, the budget, and PROBLEM.md's scope; it returns a structured summary so raw file contents never enter this session. **kimi-code fallback:** plugin agents are unavailable -- read directly in this session with the SAME 25-file / 60k-char budget, summarizing into CONTEXT.md as you go rather than holding raw contents. The budget is enforced by your own counting, not by isolation; count every read.
5. Write `spearhead-attacks/problem/CONTEXT.md`:
   - `## Repo conventions` -- naming, layout, test framework, lint/build commands.
   - `## Affected surface` -- files/modules the problem touches.
   - `## Reproduction` (bugs only) -- exact command, observed vs expected.
   - `## Risks and unknowns`.
   - `## Prior art` -- existing patterns or code to reuse.
   - `## Budget` -- reads/characters used; what was skipped if the budget hit.
6. `state.js set-phase recon complete` (informational phase: no user approval needed), then point at `/spearhead:design`.

## Refusals

- `understand` not `approved`: name the gate and `/spearhead:understand`.
- Unreproducible bug: stop at step 2; suggest the user provide a reproduction or re-scope via `/spearhead:understand`.

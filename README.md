# spearhead-ai

A gated problem-attack workflow plugin for Claude Code and kimi-code. It
encodes a seasoned engineer's end-to-end workflow for attacking a problem —
understand → recon → design → plan → execute → verify → ship → retro — with
hard gates between phases, externalized file-based state, mechanical
enforcement at the point where blocking is possible, per-task git worktrees
for physically isolated (optionally parallel) execution, and independent
verification so nothing ever certifies its own work.

## Backstory

Spearhead started as a question, not a plugin. I asked Claude: *"Forget the
tooling for a second — if you were a seasoned engineer handed a real
problem, how would you actually attack it?"* The answer wasn't a clever
trick. It was discipline: restate the problem until you're sure it's the
real one; scout the terrain before designing anything; weigh a few honest
alternatives and pick the simplest that survives the requirements; cut the
work into pieces small enough that each one can be finished and proven;
implement each piece in isolation; have someone *else* judge whether it's
done; ship deliberately; then look back and write down what you learned.

The follow-up question was the interesting one: *"Then why don't you work
that way by default?"* Because good intentions don't survive a long
session. Context gets compacted, enthusiasm skips steps, and the model that
wrote the code is a poor judge of whether the code is done. The answer to
that isn't better prompting — it's structure: state that lives in files
instead of memory, gates that refuse instead of advise, a validating CLI as
the only way to change workflow state, and a fresh-context verifier with a
checklist of the exact ways an eager coder cheats.

So this plugin is, quite literally, Claude's own answer to "how would you
solve this problem?" — turned into machinery it cannot talk itself out of.
Point it at a problem with `/spearhead:attack` and it walks its own advice,
one gate at a time.

## Requirements

- Node.js (any current LTS) on `PATH` — the hooks and the state CLI are small
  dependency-free Node scripts. No npm installs, no network calls.
- git — execute's worktree/branch model requires the project to be a git
  repository with a clean base branch.
- `SPEARHEAD_EMBEDDINGS_API_KEY` — required for the bundled
  `spearhead-knowledge` MCP server's `search` tool (see "Second-brain
  knowledge base" below). This is the one exception to the dependency-free,
  offline rule above: `mcp-server/` has its own `package.json`/`node_modules`
  and makes network calls to an embeddings API. Nothing else in the plugin
  does either.

## Install

In Claude Code:

1. Run `/plugin`.
2. Choose **Marketplaces** -> **Add marketplace**.
3. Paste the repo link: `https://github.com/febradc-github/spearhead-ai`
4. Back in the plugin menu, install **spearhead** from the `spearhead`
   marketplace.

In kimi-code:

1. Run `/plugins install https://github.com/febradc-github/spearhead-ai`
   (or `/plugins install /path/to/spearhead` for a local checkout).
2. Run `/reload` (or start a new session) to activate it.

The kimi-code manifest is `.kimi-plugin/plugin.json` (skills, commands, and
hooks). It points at the same `skills/` and `commands/` directories as the
Claude Code manifest, so no capability is duplicated. One caveat: kimi-code
does not support plugin-defined sub-agents, so the three agents below are
Claude Code-only — under kimi-code the skills that dispatch them fall back as
described in "kimi-code fallbacks", and no fallback ever weakens a gate.

## Install (local development)

    claude --plugin-dir ./spearhead

## Commands vs. skills

Every capability has two files: a `commands/<name>.md` (the command you type,
e.g. `/spearhead:breakdown`) and a `skills/spearhead-<name>/SKILL.md` (the actual
behavior, internally named `spearhead-<name>` so it never collides with a
same-named skill from another plugin). The command is a thin wrapper that
dispatches to the skill. Every skill sets `user-invocable: false`, so the
commands are the only entries in the `/` menu — skills are reachable only
through their command wrapper or the `attack` orchestrator's routing (via the
Skill tool).

Contributor rule (same as turnstile's): new command basenames must not
duplicate Claude Code built-in commands or core mode names. The plugin
namespace prevents hard collisions, but a same-named twin still confuses
users and intent routing — which is why the phase-4 command is
`/spearhead:breakdown`, not `plan` (that name belongs to Claude Code's plan
mode; the phase itself is still recorded as `phases.plan` in status.yml).

## Commands

| Command | Purpose |
|---|---|
| `/spearhead:attack [problem]` | Orchestrating entry point: classifies the current state and drives the pipeline phase by phase, pausing at every hard gate. The one-command golden path. |
| `/spearhead:understand [problem]` | Phase 1: restates the problem, extracts the real goal, applies the clarification gate rule, writes `problem/PROBLEM.md` with checkable acceptance criteria. Approval gate. |
| `/spearhead:recon` | Phase 2: budgeted context gathering (25 reads / 60k chars) into `problem/CONTEXT.md`; bugs must be reproduced before anything else. |
| `/spearhead:design` | Phase 3: 2–3 candidate approaches with honest tradeoffs and failure modes; recommends the simplest that meets the criteria; writes `design/DESIGN.md` + ADRs. Approval gate. |
| `/spearhead:breakdown` | Phase 4: atomic tasks with binding expected-file sets, dependencies, and the testing strategy; approval records `base_branch` and creates the tasks. Approval gate. |
| `/spearhead:execute [T-id]` | Phase 5: dispatches the coder on one task in its own worktree and branch; enforces the parallelism rule and the 2-attempt retry policy. |
| `/spearhead:verify [T-id]` | Phase 6: mechanical gates (full suite, lint, build) in the task's worktree, independent verifier verdict, merge + integration check on pass, versioned report either way. One at a time. |
| `/spearhead:ship` | Phase 7: `ship/SHIP.md` (what changed, how to verify, rollout, monitoring) once every task is done — a derived fact, never a stored one. |
| `/spearhead:retro` | Phase 8: criterion-by-criterion confirmation against PROBLEM.md, lessons, follow-ups; completes the attack. |
| `/spearhead:status` | Read-only board: phases (execute shown as derived), tasks, dispatch modes, parallel-eligible tasks, blockers, verify lock, staleness flags. |
| `/spearhead:unblock [T-id \| --lock]` | Recovery: retry / reset / replan for a blocked or stale task; clears a stale verify lock after confirmation. Never silently discards work. |
| `/spearhead:replan` | Amends the approved plan without restarting: edit/add/split/remove `todo`/`blocked` tasks, re-validated and re-approved. The sanctioned answer to file-set overlaps. |
| `/spearhead:abort [reason]` | Aborts the attack with a recorded reason; archives artifacts to `spearhead-attacks/archive/<timestamp>/`. History, not deletion. |
| `/spearhead:pivot [new idea]` | Changes the idea mid-attack: one confirmation, then archives the current attack (like abort) and starts a fresh one from the new problem statement. Never reopens an approved phase in place; the monotonic phase invariant stays intact. The pipeline also routes here when it recognizes a "change the idea" request. |

## Workflow

```
/spearhead:understand ──approval──> /spearhead:recon ──complete──> /spearhead:design
                                                                        │ approval
        ┌───────────────────────────────────────────────────────────────┘
        v
/spearhead:breakdown ──approval──> /spearhead:execute ──implemented──> /spearhead:verify
   (base_branch recorded,        (worktree + branch per task,        (gates, verdict,
    tasks created todo)           parallel only if approved,          merge + integration
        │                         disjoint, deps done)                check; V-n.k report)
        │                              ^      │ blocked                   │ all done (derived)
        │ /spearhead:replan            │      v                           v
        └── amends todo/blocked ───────┘  /spearhead:unblock         /spearhead:ship
            tasks                          (retry/reset/replan)           │ complete
                                                                          v
                                                                    /spearhead:retro
```

## Project data layout

Created lazily in your repo the first time understand runs:

```
spearhead-attacks/
  status.yml                    # the ONLY place workflow status lives
  problem/PROBLEM.md            # phase 1: goal, scope, assumptions, criteria
  problem/CONTEXT.md            # phase 2: conventions, surface, reproduction
  design/DESIGN.md              # phase 3: chosen + rejected approaches
  plan/PLAN.md                  # phase 4: task list + testing strategy
  plan/tasks/T-<n>.md           # per task: goal, files, AC, out-of-scope, commands
  verify/V-<n>.<k>.md           # verification report, attempt k -- history kept
  ship/SHIP.md                  # PR description / release note draft
  retro/RETRO.md                # lessons, follow-ups
  decisions/adr-<NNN>-<slug>.md # ADRs from design and execute time
  worktrees/                    # per-task git worktrees (gitignored)
  archive/<timestamp>/          # aborted attacks
  .remind-state.json            # hook session tracking (gitignored)
```

Task ids are `T-<n>` from a single monotonic counter; ids are never reused.
Verification reports are `V-<n>.<k>` where `<k>` is the attempt — a
fail-fix-reverify cycle leaves `V-3.1.md`, `V-3.2.md`, … as permanent history.

### .gitignore guidance

Understand offers this on first run (and records a decline so it never nags):

```
spearhead-attacks/.remind-state.json
spearhead-attacks/worktrees/
```

Commit the rest of `spearhead-attacks/` — it is the project's decision record.

## Second-brain knowledge base

Spearhead maintains a searchable "second brain" over its own decision record
and the project's documentation, so an agent can answer from a semantic
index instead of re-reading source files cold. Three sources feed it:

- `spearhead-knowledge/**/*.md` — the notes described below (code docs,
  decisions, architecture).
- `spearhead-attacks/**/*.md` — the attack's own decision record (PROBLEM.md,
  DESIGN.md, ADRs, task files, …).
- General project docs: the top-level `README.md` and `docs/**/*.md`.

Layout, created lazily alongside `spearhead-attacks/`:

```
spearhead-knowledge/
  code/          # one note per documented source file: <parent>-<basename>.md
  decisions/     # ATK-scoped decision/architecture notes
  architecture/  # cross-attack architecture notes
  index/         # embeddings.json -- the search index, one flat file, atomic writes
```

Every note opens with frontmatter (`type`, `tags`, `related` as
`[[spearhead-knowledge/<type>/<slug>.md]]` wikilinks — only to genuinely
related notes, never indiscriminate cross-links — `source`, `updated`,
`source_hash`). `spearhead-knowledge/code/` note paths are never left to
per-session judgment: `scripts/knowledge-path.js <source-path>` computes the
canonical, collision-safe path (`<parent>-<basename>.md`, escalating one
more parent level only on a genuine `source:` collision — an existing note
is never renamed).

**Search.** The bundled `spearhead-knowledge` MCP server (`mcp-server/`,
declared in both `.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json`)
is the sole owner of the index: it file-watches the three sources above,
content-hashes each changed file (`sha256`, skipping the embeddings call
when nothing actually changed), and keeps
`spearhead-knowledge/index/embeddings.json` up to date. It exposes one MCP
tool:

- `search(query, limit?)` — embeds the query, ranks every indexed note/doc
  by cosine similarity, and returns the top `limit` (default 8) as
  `{path, excerpt, score}`. A missing `SPEARHEAD_EMBEDDINGS_API_KEY` or a
  failed embeddings call comes back as a named tool error
  (`MissingApiKeyError`, `EmbeddingsRequestError`), never a silent empty
  result.

**Opportunistic capture.** Documentation is a byproduct of normal work, not
a separate step, via two nudge-only hook touch-points (they never write
notes, never write `status.yml`, and never call the embeddings API
themselves — the agent does the actual writing):

- **Search-first** — every `remind.js` injection (full rules and the
  one-line anchor) tells the agent to try the `spearhead-knowledge` search
  tool before reading source files cold.
- **Code-doc-on-first-read, staleness-aware** (`hooks/knowledge-nudge.js`,
  `PostToolUse` on `Read`) — on every read of a source file, the hook
  content-hashes it (`sha256`, re-derived from disk every call) and derives
  a three-way state against the matching `spearhead-knowledge/code/` note's
  `source_hash` frontmatter: no note yet → nudges the agent to write one at
  the exact path `scripts/knowledge-path.js` computes; note's `source_hash`
  matches → silent, note is current; note's `source_hash` is missing or
  stale → nudges a refresh (update in place, new `## Changelog` entry, never
  a duplicate note). Session-scoped, idle-expiring "already nudged this
  (path, hash) pair" tracking (same pattern as `remind.js`) keeps repeat
  reads at an unchanged hash from re-nudging, while a file that changes
  again after being nudged once naturally re-nudges.
- **Task-done doc update** (same `hooks/knowledge-nudge.js`, `PostToolUse`
  on `Bash|PowerShell`) — on a successful `state.js transition <T-id> done`,
  the hook reads that task's expected-file set from `status.yml` (read-only)
  and nudges the agent to add a `## Changelog` entry to each touched file's
  code doc, referencing the task and attack.

All three nudge messages above also remind the agent to use `[[wikilinks]]`
only for genuinely related notes, never indiscriminately.

## The task isolation and commit model

- Plan approval records the current branch as `base_branch`.
- Execute creates branch `spearhead/T-<n>` from `base_branch` and a worktree
  at `spearhead-attacks/worktrees/T-<n>/`. The coder works only there, in small
  conventional commits on its own branch. It never merges, never touches
  `base_branch`, never edits `spearhead-attacks/` state, never uses `--no-verify`.
- Verify merges (`--no-ff`) on a full pass, then runs the suite once more on
  the merged tree — the **integration check**. If it fails, the merge is
  reverted, the task goes back to `in_progress` with the output attached, and
  `base_branch` stays green. Blame is unambiguous: per-branch gates catch a
  task's own failures; the integration check catches interaction failures and
  lands them on the task being merged.
- Worktrees give parallel coders physical isolation (no index, working-tree,
  or test-runner contention). The expected-file disjointness check exists to
  predict merge conflicts, not to provide isolation.

## Parallelism and the background fallback

One task `in_progress` is the default. A second runs in parallel only when
its dependencies are all `done`, its expected-file set is disjoint from every
running task's (glob-aware), and the user explicitly approves that specific
pairing. An overlap cannot be overridden — only re-planned. Two parallel
tasks may never both touch a lockfile; the plan phase routes lockfile changes
into one dedicated task or serializes them.

If the runtime cannot dispatch sub-agents in the background, execute runs in
the foreground (`mode: foreground`) and offers parallel-eligible tasks
sequentially — same approval, same disjointness check, same worktrees. Only
concurrency degrades, never the gates; nothing in the state model depends on
true concurrency existing.

## State enforcement

`spearhead-attacks/status.yml` is the single source of truth for workflow status, and
every mutation goes through `scripts/state.js`, a dependency-free CLI that
validates the *result* of each mutation against the invariants and the task
transition matrix before writing atomically, and refuses invalid mutations
with a named reason (`phase-order`, `parallel-files-overlap`,
`attempts-exceeded`, …). The transition matrix makes `implemented -> done`
reachable only while the verify skill holds `verify_lock`, so no agent can
mark its own work done. Derivable facts are never stored: there is no
`phases.execute` anywhere; "execute is complete" is computed from task
states.

Three hooks back this up:

- **`remind.js`** (UserPromptSubmit) — prompt 1 and every 30th inject the
  gate matrix and the full contents of `rules/RULES.md` (the only copy of the
  five workflow rules; a sync test asserts byte identity). Other prompts get
  a one-line anchor (< 500 chars) with the current phase, verify-lock status,
  and background dispatches.
- **`guard.js`** (PreToolUse) — blocks `git commit --no-verify`, attribution
  in commit messages (any `Co-Authored-By:` trailer, and Anthropic/Claude
  tags — commit message rule in `rules/RULES.md`), any access to env files
  (`.env`, `.env.*`, `*.env`, `.envrc`), and raw Write/Edit (or shell
  redirection) to `spearhead-attacks/status.yml`, pointing at `scripts/state.js`.
  Safe anywhere.
- **`validate-state.js`** (PostToolUse) — a detection net, not enforcement:
  re-checks every invariant on any observed raw write to `status.yml` or a
  task file and loudly reports corruption. It never auto-repairs. It also
  exports the invariant checker that `state.js` enforces with, so enforcement
  and detection share one implementation.

### An honest note about guard.js

The shell-command checks in `guard.js` are string matching. They are a
best-effort speed bump against accidents, **not a security boundary**; a
determined agent or user can compose a command the patterns miss.
`guard.test.js` asserts exactly the documented patterns, and this README
claims no more than those tests prove. The hard guarantees live elsewhere:
`state.js` validates before writing, and `validate-state.js` detects after.

## Agents

| Agent | Model | Why isolation | Constraints |
|---|---|---|---|
| `spearhead-coder` | inherit | A clean context holding only one task's spec, so scope cannot creep from conversation history. | One task, test-first, inside its worktree, small commits on its branch. Never merges, never edits state, never `--no-verify`. |
| `spearhead-verifier` | opus | Independent judgment requires never having seen the implementation conversation. | Read-only. Task file + criteria + diff + testing strategy + anti-reward-hacking checklist in; per-criterion verdict with evidence out. Never fixes, never merges, never writes state. |
| `spearhead-scout` | haiku | Recon reading burns context; isolation keeps the main session lean. | Read-only, 25-file / 60k-char budget, structured summary out. |

## kimi-code fallbacks

kimi-code does not support plugin-defined sub-agents. Each dispatching skill
detects this and falls back, preserving gate semantics:

| Agent | kimi-code fallback | Gate preserved by |
|---|---|---|
| coder | kimi's built-in `coder` sub-agent with the same restricted input package; failing that, the main session implements — still inside the task's worktree. | The worktree/branch model, scope containment, and the retry policy are enforced by the skill, git, and `state.js` regardless of who codes. |
| verifier | A built-in sub-agent if available; otherwise a mandatory fresh-eyes protocol: re-read ONLY the verifier input package, disregard the implementation conversation, record the per-criterion verdict. The verdict is never written by the same turn that produced the fix. | The mechanical gates (full suite, lint, build, integration check) run for real either way — they are the hard floor. |
| scout | The main session reads with the same budget, summarizing as it goes. | The budget is enforced by counting, not isolation. |

kimi-code also loads hook scripts with `require()` (bypassing
`require.main === module`) and passes edited paths as `tool_input.path`
rather than `tool_input.file_path`; every hook handles both, and resolves the
project directory from the hook payload, a tool path, or a project-hint JSON
— never from `process.cwd()`.

## Dry-run transcript

One small problem — "rate-limit the login endpoint" — walked through every
phase. `$` lines are the state CLI calls the skills make; refusals are real
output.

```
> /spearhead:recon
  refuse: recon requires `understand: approved` -- run /spearhead:understand first.

> /spearhead:understand rate-limit the login endpoint
  $ state.js init "rate-limit the login endpoint"     OK: initialized attack A-1
  [offers .gitignore entries for .remind-state.json and worktrees/ -- accepted]
  [restates problem; one blocking question batched: "per-IP or per-account?" -> per-account]
  [writes problem/PROBLEM.md: goal, scope, assumptions, 3 checkable criteria]
  Approve PROBLEM.md? > yes
  $ state.js set-phase understand approved            OK

> /spearhead:design
  refuse: design requires `recon: complete` -- run /spearhead:recon first.
  ($ state.js set-phase design approved => REFUSED: phase-order: design is
   approved but recon is not complete -- the CLI backs the skill's refusal)

> /spearhead:recon
  [dispatches spearhead-scout; budget 25 reads/60k chars; writes CONTEXT.md]
  $ state.js set-phase recon complete                 OK

> /spearhead:design
  [3 candidates; recommends in-memory token bucket (simplest meeting criteria);
   failure modes; adr-001. Approve?] > yes
  $ state.js set-phase design approved                OK

> /spearhead:breakdown
  [3 atomic tasks, riskiest first; expected-file sets include glob creations;
   testing strategy written into PLAN.md. Approve?] > yes
  $ state.js approve-plan --base-branch main          OK: plan approved; base_branch = main
  $ state.js add-task "risky: token-bucket store" --files "src/ratelimit/**,tests/ratelimit/**"
                                                      OK: added T-1 (todo)
  $ state.js add-task "wire limiter into login route" --depends T-1 \
      --files "src/routes/login.js,tests/routes/login.test.js"
                                                      OK: added T-2 (todo)
  $ state.js add-task "docs + config knob" --files "docs/ratelimit.md,src/config.js"
                                                      OK: added T-3 (todo)

> /spearhead:ship
  refuse: ship requires every task done. T-1 todo, T-2 todo, T-3 todo.
  ($ state.js set-phase ship complete => REFUSED: execute-incomplete: ship
   requires every task done (derived from task states, never stored))

> /spearhead:execute T-1
  $ git branch spearhead/T-1 main && git worktree add spearhead-attacks/worktrees/T-1 spearhead/T-1
  $ state.js transition T-1 in_progress --branch spearhead/T-1 \
      --worktree spearhead-attacks/worktrees/T-1 --mode background
                                                      OK: T-1 -> in_progress
  [spearhead-coder dispatched in the background with only the task package]
  Parallel-eligible right now: T-3 (no deps, files disjoint from T-1).
  T-2 is not (depends on T-1). Launch T-3 alongside? > yes
  $ state.js set-parallel T-3                         OK
  $ state.js transition T-3 in_progress ...           OK: T-3 -> in_progress

  [user asks to also parallelize a hypothetical T-4 touching src/ratelimit/store.js]
  refuse: file sets overlap; re-plan instead.
  ($ state.js transition T-4 in_progress ... => REFUSED: parallel-files-overlap:
   T-1 and T-4 overlap on src/ratelimit/** ~ src/ratelimit/store.js)

  [T-1 coder reports done; diff inside its file set]
  $ state.js transition T-1 implemented               OK
  Run /spearhead:verify T-1.

> /spearhead:verify T-1
  $ state.js lock T-1                                 OK: verify_lock = T-1
  $ state.js bump-verify T-1                          OK: T-1 verify attempt = 1
  [mechanical gates in the worktree: 1 test FAILS]
  -> writes verify/V-1.1.md with the failing output
  $ state.js transition T-1 in_progress               OK   (only legal under the lock)
  $ state.js unlock                                   OK
  [coder repairs on its branch; execute re-runs; T-1 implemented again]

> /spearhead:verify T-1
  $ state.js lock T-1 && state.js bump-verify T-1     OK: T-1 verify attempt = 2
  [gates pass; spearhead-verifier verdict: 3/3 criteria pass, 4 checks clean]
  $ git checkout main && git merge --no-ff spearhead/T-1
  [integration check on merged main: PASS] -> writes verify/V-1.2.md
  $ state.js transition T-1 done                      OK   (worktree field cleared)
  $ git worktree remove spearhead-attacks/worktrees/T-1
  $ state.js unlock                                   OK

  [later: T-3 implemented; its verify verdict passes but the integration
   check on merged main FAILS -- T-3's config knob broke a ratelimit test]
  $ git revert -m 1 <merge-commit>       # main stays green; blame lands on T-3
  -> writes verify/V-3.1.md recording the integration failure
  $ state.js transition T-3 in_progress && state.js unlock

  [T-3's coder fails its verification commands twice during repair]
  $ state.js bump-attempts T-3                        OK: T-3 attempts = 1
  $ state.js bump-attempts T-3                        OK: T-3 attempts = 2
  $ state.js bump-attempts T-3
    REFUSED: attempts-exceeded: T-3 already used 2 repair attempts; the retry
    policy requires blocking the task, not retrying
  $ state.js transition T-3 blocked                   OK   [surfaced immediately]

> /spearhead:unblock T-3
  [shows attempts, last error, diff summary; offers retry / reset / replan] > retry
  $ state.js transition T-3 todo                      OK   (attempts reset, work kept)
  [execute re-runs T-3; repaired; verify passes -> verify/V-3.2.md; T-3 done.
   T-2's dependency is met; executed and verified -> done]

> /spearhead:ship
  [all tasks done (derived: state.js show -> execute_complete: true)]
  [writes ship/SHIP.md; offers to delete merged spearhead/T-* branches]
  $ state.js set-phase ship complete                  OK

> /spearhead:retro
  [confirms each PROBLEM.md criterion with evidence; writes retro/RETRO.md]
  $ state.js set-phase retro complete                 OK
  $ state.js set-attack-complete                      OK: attack A-1 complete; next attack is A-2
```

## License

MIT — see [LICENSE](LICENSE).

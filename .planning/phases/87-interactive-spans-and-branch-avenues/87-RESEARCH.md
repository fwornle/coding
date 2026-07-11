# Phase 87: Interactive Spans & Branch Avenues - Research

**Researched:** 2026-07-11
**Domain:** Cross-agent experiment orchestration — forking a completed interactive measurement span into headless "avenue" re-runs on persistent `avenue/<task_id>` git branches, grouped + compared in the dashboard, with cross-branch measurement-data survival.
**Confidence:** HIGH for reuse seams (all confirmed by reading source); MEDIUM for the net-new `avenue/*` branch lifecycle + cross-branch writeback (greenfield, but the precedent is fully mapped).

All findings below are `[VERIFIED: codebase grep/read]` unless tagged otherwise — every file path, signature, and line reference was read directly this session.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Launch surface is **dashboard-first, CLI-backed** — a "Fork into avenues" action on a completed span in the dashboard, implemented as a **thin wrapper over a documented CLI / experiment-spec path**. Do NOT build a UI-only path with no scriptable equivalent.
- **D-02:** Variant selection is **curated-by-default with opt-in sweep** — user explicitly picks avenues; a **sweep toggle** expands chosen dimensions into their cross-product. A sweep MUST show a **count + cost/token preview before launch** (matrix-explosion guardrail).
- **D-03:** Variant axes are **agent × model × framework × knowledge-injection**:
  - Agent — claude / copilot / opencode / mastra.
  - Model — opus / sonnet / gpt-5 / haiku / etc.
  - Framework — the **SDD methodology harness**: `gsd`, `spec-workflow`, … or **no framework**. NOT a code framework.
  - Knowledge-injection — **on/off toggle** for injected observations/digests/insights/VKB context (v6.0 injection prefix). First-class axis.
- **D-04:** Avenues are **adoptable** — `avenue/<task_id>` branches hold the real code changes. Dashboard tracks **merge status** (merged / unmerged / conflicts, computed from git) and lets the user **promote a winning avenue back to main**.
- **D-05:** Branches **persist until explicitly pruned**. Measurement data is written to **main `.data` stores** regardless of branch, so pruning never loses data.
- **D-06:** Comparison is **origin-grouped N-way + pairwise drill-down** — ranked rows; selecting any two opens the **existing Phase 86-04 difference viewer**. Add a grouping/ranking layer on top of 86-04; do NOT rebuild trajectory diffing.
- **D-07:** Default ranking axis is **outcome score** (Phase 73); tokens/cost, route quality, wall-clock as secondary sortable columns.
- **D-08:** Avenue re-runs start from a **full Phase 67 `RunSnapshot`**, restored via the existing `repro-restore` / `experiment-restore` rig, so every avenue starts **byte-identical** to the origin and only the D-03 axes vary. Reuse the proven rig, not a lighter capture.

### Claude's Discretion
- Avenue execution isolation & parallelism (worktree-per-branch vs sequential; concurrency limits) — note the `.data/run-restores/*` worktree precedent.
- Cross-branch measurement-data survival mechanism (no collision, no double-counting) — must honor Phase 83 reconciliation identity rules.
- How the knowledge-injection on/off toggle is wired per-agent — reuse the v6.0 injection seam.

### Deferred Ideas (OUT OF SCOPE)
- Varying the initial prompt text across avenues (prompt-variant experiments) — separate future phase.
- Net-new comparison metrics beyond Phases 72/73/82/83.
- The 18 phase-matched pending todos (VKB/observability/data-integrity) — reviewed, not folded.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

The ROADMAP requirement IDs for Phase 87 are **TBD** (v7.5 requirements SPEC/RUN/CMP/ORCH terminate at Phase 80; Phases 81–87 were added 2026-07-05 as the Uniform 4-Agent Measurement Program without new REQ IDs). Requirements below are **derived from the 8 locked decisions + the phase goal** — the planner should treat these as the acceptance surface.

| Derived ID | Description | Research Support |
|-----------|-------------|------------------|
| AVN-01 | Fork a completed span → capture origin `RunSnapshot` + initial prompt; produce an avenue experiment-spec | §1 (snapshot rig), §2 (spec model) |
| AVN-02 | Dashboard "Fork into avenues" action = thin wrapper over `experiment-run.mjs` via the vkb-server→coordinator seam (D-01) | §8, §2 |
| AVN-03 | Variant picker: agent × model × framework × knowledge-injection, curated-default + sweep with server-resolved count+cost preview (D-02/D-03) | §2, §3, §6 |
| AVN-04 | Knowledge-injection on/off toggle wired per-agent (D-03) | §3 |
| AVN-05 | Each avenue executes headless on a persistent `avenue/<task_id>` git branch (D-04/D-05) — **NET-NEW branch lifecycle** | §4 |
| AVN-06 | Measurement rows written to MAIN `.data` store; no collision / no double-count across branches (D-05) | §5 (critical risk) |
| AVN-07 | Origin-grouped N-way ranked panel; select 2 → existing 86-04 `DifferenceViewer` (D-06/D-07) | §6 |
| AVN-08 | Merge-status tracking (merged/unmerged/conflicts from git) + promote-a-winner to main (D-04) | §7 |
| AVN-09 | Prune action removes a branch on demand; measurement data survives (D-05) | §4, §7 |
</phase_requirements>

---

## Summary

Phase 87 is **almost entirely an orchestration + presentation layer over already-shipped primitives.** The experiment runner (Phase 77/78), the snapshot/restore rig (Phase 67), the dashboard launch→CLI→coordinator bridge (Phase 85), the frozen `performanceSlice` Redux contract (Phase 86-02), and the `DifferenceViewer` trajectory diff (Phase 86-04) all exist and are unit/live-proven. The phase's job is to (a) add a 4th "knowledge-injection" axis + a "framework" (SDD harness) axis meaning, (b) replace the runner's **throwaway sandbox worktree** with a **persistent `avenue/<task_id>` branch**, (c) add an **origin-grouped N-way ranking layer** on top of the existing pairwise diff, and (d) add **git merge-status + promote/prune** actions.

**Two genuinely net-new mechanisms** carry the risk: the `avenue/*` **persistent branch lifecycle** (the runner today uses detached throwaway worktrees under `.data/run-restores/*` — §4) and the **cross-branch measurement-data writeback** (§5). The good news on §5: the runner **already writes the measurement span to the MAIN `.data` dir** (`runCell` at `experiment-runner.mjs:490-491`) while isolating only the agent's file/KB writes to the sandbox. The token identity discipline that prevents double-counting (`(user_hash, tool_call_id)` dedup + `WHERE task_id = ?` aggregation, both in the single MAIN `token_usage.db`) is preserved automatically as long as avenues keep writing their span to MAIN `.data` and keep a unique composite `task_id` per avenue.

**Primary recommendation:** Model an avenue as **one experiment cell with a unique `task_id`**, launched through the EXISTING `experiment-run.mjs` → coordinator seam. Extend `restoreForCell` (or add an `avenue`-mode restore) to create a **named persistent `avenue/<task_id>` branch worktree** instead of a detached throwaway, but keep the span writing to MAIN `.data` exactly as `runCell` does today. Add the knowledge-injection axis as an env-var toggle read by the existing injection seams. Build the N-way panel as a new component that feeds `setCompareA/setCompareB` into the unchanged `DifferenceViewer`. Do NOT install any npm packages (Phase 86 no-install discipline; UI-SPEC Registry Safety).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Origin span capture (snapshot + prompt) | Node host (scripts/lib) | — | `measurement-start.mjs` already captures snapshot + goal; runs on host |
| Fork action trigger | Frontend (dashboard) | vkb-server API | D-01 dashboard-first; mirrors existing Re-run button |
| Avenue spec resolution + count/cost preview | vkb-server API (server-side) | — | D-02/D-09: server-resolved cell count, never client recompute |
| Headless avenue execution | Host coordinator (:3034) | run-launch.mjs | Container has no agent CLIs (Phase 85 D-01); host-only spawn |
| `avenue/*` branch worktree create/prune | Node host (git) | — | git worktree machinery is host-side; **NET-NEW** |
| Measurement row write | MAIN `.data` (proxy + measurement-stop) | — | D-05 survival; identity keyed in single MAIN store |
| N-way ranking + grouping | Frontend (Redux slice + component) | — | Presentation; extends performanceSlice |
| Pairwise trajectory diff | Frontend (`DifferenceViewer`) | — | REUSE 86-04 unchanged |
| Merge-status compute | vkb-server API → host git | Frontend badge | git status is host-side; badge renders verbatim |
| Promote/prune | Host coordinator (git) | vkb-server API + Frontend | State-changing git ops must run host-side |

---

## Standard Stack

**No new packages.** Every dependency already exists in-repo. The UI-SPEC (Registry Safety) and Phase 86 discipline forbid new installs. Confirmed dashboard versions:

| Library | Version (in repo) | Purpose | Why Standard |
|---------|-------------------|---------|--------------|
| `@reduxjs/toolkit` | `^2.9.0` | Slice/thunk/selector for launcher + N-way state | Existing `performanceSlice` contract |
| `react` | `^18.3.1` | Dashboard UI | Existing app |
| `lucide-react` | `^0.544.0` | Icons (`Check`, `GitBranch`, `AlertTriangle`) | UI-SPEC icon set |
| `tailwindcss` | `^3.4.4` | Styling via existing tokens | UI-SPEC extends existing |
| `js-yaml` | (in lib) | Experiment spec parse | `experiment-spec.mjs` uses it |
| `node:child_process` | builtin | Fixed-argv detached spawn / git | run-launch / restore-snapshot |

**No `## Package Legitimacy Audit` needed** — this phase installs **zero external packages**. All code is host Node builtins + already-vetted in-repo modules.

---

## §1 — Origin Snapshot + Restore Rig (D-08)

**Status: EXISTING, reuse wholesale.**

### What a `RunSnapshot` captures
Built by `captureSnapshot(taskId, { repoRoot, dataDir, prompt })` in `lib/repro/capture-snapshot.mjs`. Writes `.data/run-snapshots/<sanitizeTaskId(task_id)>/` containing (confirmed by reading the composer + restore):
- `git-sha.txt` — the captured HEAD SHA (the ONE fatal restore input).
- `dirty.patch` — staged+unstaged tracked changes, binary-safe.
- `untracked/` + `untracked/list.txt` — untracked file contents.
- `submodules.json` — per-submodule `{ path, sha, dirtyPatch }` (the 5-submodule caveat).
- `kb/exports/general.json` — the `.data/knowledge-graph` KB export (compaction-independent; leveldb excluded).
- `env-allowlist.json` — allowlisted env (secret-deny-regex filtered).
- `llm-settings.json` — the `processOverrides` routing config.
- `fixtures/llm/` — record/replay LLM fixtures (optional).
- manifest with `clock_base` + per-channel capability map (llm:record; WebSearch/WebFetch/MCP:record-only; clock:virtualized).

### How origin capture happens today
`scripts/measurement-start.mjs` (read confirmed): when a span opens, it calls `captureSnapshot(taskId, { repoRoot: REPO_ROOT, dataDir, prompt: goalSentence || '' })` at ~line 304 (best-effort, non-fatal). The goal/prompt comes from `--goal` arg, TTY prompt, or the resolved spec's `goal_sentence`. **The origin prompt is already stored in the snapshot manifest's `prompt` field + the span's `goal_sentence`.**

### Restore signatures (the seam to reuse)
- `restoreSnapshot(snapshotId, opts)` in `lib/repro/restore-snapshot.mjs` — returns `{ worktree, sandboxDataDir, replayArmed, inPlace, steps }`. DEFAULT path (`inPlace:false`): `git worktree add --detach <restoreRoot>/<cleanId>-<stamp> <sha>` under `.data/run-restores/`, then submodules → dirty patch → untracked → `hydrateSandbox` KB → env/config. **This is the detached-worktree precedent §4 extends.**
- `restoreForCell(snapshotId, opts)` in `lib/experiments/experiment-restore.mjs` — the per-cell orchestrator: calls `restoreSnapshot` with `inPlace:false`, computes a `digestRestoredState(...)` sha256 over `git_sha + KB exports + routing`, returns `{ worktree, sandboxDataDir, digest }`. `runVariantRepeats` + `assertRepeatsIdentical` prove byte-identical restores (D-11/D-12 of Phase 77).

### Reuse/extend seam for avenues
Avenues restore from the origin span's snapshot exactly as cells do — `restoreForCell(originSnapshotId, ...)`. **The one change (§4):** where `restoreSnapshot` does `git worktree add --detach ... <sha>`, an avenue needs `git worktree add -b avenue/<task_id> ... <sha>` (a NAMED branch, not detached) so the avenue's commits land on a persistable branch. Recommend a new `avenueMode` option threaded through `restoreForCell → restoreSnapshot` rather than forking the module.

**Net-new:** the `avenue/<task_id>` named-branch variant of `git worktree add`. Everything else is reuse.

---

## §2 — Headless Run Engine + Spec Model (D-01/D-03)

**Status: EXISTING engine; spec axes need extension.**

### The engine
- `scripts/experiment-run.mjs` — operator CLI. Flags: `--spec`, `--variant` (repeatable subset), `--repeats`, `--timeout`, `--run-id`, `--run-dir`, `--rerun-of`, `--task-class`, `--model V=M`, `--agent V=A`, `--capture-raw-bodies`. Env contract: `CODING_REPO`, `LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE`. Delegates to `runMatrix`.
- `lib/experiments/experiment-runner.mjs` — `runMatrix(spec, opts)`: sequential, idempotent, resumable loop. Per cell: `runCell` → `restoreForCell` (isolated sandbox) → `measurement-start` (MAIN data dir span) → `launchCell` (terminal-state timer) → `measurement-stop --headless` inline score in a `finally`. Terminal states: `complete | timeout | abort`. Key functions: `cellName(cell)`, `composeTaskId(expId, cell, rep)`, `launchCell(...)`, `runCell(...)`, `applyVariantOverride`, `configureProxyRoutingEnv(agent, baseEnv, {port, taskId, model})`.
- `lib/experiments/agent-headless.mjs` — `argvForAgent(agentName, goal, {model})` (fixed argv per agent: claude `-p ... --permission-mode acceptEdits`, opencode `run ... -m ... --dangerously-skip-permissions`, mastracode `--prompt ... -m`, copilot `-p ... --allow-all-tools --model`), `resolveAgentBinary`, `probeCopilotHeadless`.

### The spec model (needs the D-03 axes)
`lib/experiments/experiment-spec.mjs` — `resolveExperimentSpec(fileOrObj)` → `{ goal_sentence, repeats, cells }`. `expandAxes({agent[], model[], framework[], env[]})` does the cartesian expansion. **Each cell carries EXACTLY five keys: `agent, model, framework, env, test_command`** (`makeCell`) — any other key is silently dropped.

**Critical gap for D-03:** The current axes are `agent × model × framework × env`. D-03 wants `agent × model × framework × knowledge-injection`. There is **no dedicated knowledge-injection axis** — the natural home is the existing **`env` axis** (a settings bundle), OR a new explicit axis. Recommend: encode knowledge-injection as a distinguished `env` value (e.g. `env: 'kb-on'` / `env: 'kb-off'`) OR add a 5th cell key. **If adding a key, `makeCell` and every downstream reader (`measurement-stop.mjs`, `evidence-harness.mjs` — which the spec header says reads exactly the five keys) must be updated** — this is a cross-module contract change, flag as `[RISK]`.

Also: `KNOWN_AGENTS = ['claude', 'copilot', 'opencode']` in `experiment-spec.mjs:39` — **`mastra`/`mastracode` is NOT in the enum**, so `validateCells` HARD-BLOCKS a mastra cell. But `agent-headless.mjs` DOES support `mastracode`. D-03 lists mastra as an agent. **Net-new:** add `mastracode` (or `mastra`) to `KNOWN_AGENTS`. `[ASSUMED]` that the intended agent token is `mastracode` (matches `AGENT_CONFIG_FILE` + `argvForAgent`) — confirm with user which literal the variant picker emits.

### Reuse/extend seam
Fork = build an avenue experiment-spec (one cell per chosen variant, `goal_sentence` = origin prompt, `snapshot_id` = origin snapshot) and drive `experiment-run.mjs`. The runner is the headless engine; avenues need only the branch-worktree extension (§4) and the injection axis (§3).

**Net-new:** knowledge-injection axis in the spec + `mastracode` agent enum. **Existing:** the entire run loop.

---

## §3 — Knowledge-Injection On/Off Seam (D-03, headline use case)

**Status: EXISTING injection system; NO on/off toggle exists — NET-NEW toggle.**

### The v6.0 injection seams (confirmed)
- **Claude:** a per-prompt `UserPromptSubmit` hook. Registered in `~/.claude/settings.json:117` → `node /Users/Q284340/Agentic/coding/src/hooks/knowledge-injection-hook.js`. This hook reads stdin JSON, calls `callRetrieval({query, budget, threshold, context})` from `src/hooks/retrieval-client.js` (Qdrant semantic search backend), and emits `hookSpecificOutput.additionalContext` (the ~300-token working-memory prefix; `MAX_OUTPUT_CHARS = 9500`, `MAX_CONTEXT_CHARS = 300`).
- **Non-Claude agents:** `scripts/launch-agent-common.sh` function `_inject_knowledge_context()` (lines 337-365). At session start it runs `src/hooks/knowledge-injection-${agent}.js` (opencode/copilot/mastra adapters exist: `knowledge-injection-opencode.js`, `-copilot.js`, `-mastra.js`), each of which calls `callRetrieval(...)` and writes a context file (e.g. opencode writes `.opencode/knowledge-context.md`). Called from the launch sequence at `launch-agent-common.sh:570` ("12.5. Inject knowledge context").

### The on/off toggle (net-new — recommended wiring)
There is currently **no env var** that disables injection (confirmed: grep for `DISABLE.*KNOWLEDGE` / `SKIP_INJECT` returns nothing). Recommend a single env var, e.g. `CODING_KNOWLEDGE_INJECTION` (default on), checked at TWO points:
1. **Bash seam:** early-return in `_inject_knowledge_context()` (`launch-agent-common.sh:340`) when the var is off — one guard covers opencode/copilot/mastra.
2. **Claude hook:** early-return at the top of `main()` in `src/hooks/knowledge-injection-hook.js` (before the retrieval call) when the var is off. **CAVEAT:** the Claude hook runs in the agent's own process; the env var must reach it. Since the avenue agent is spawned by the runner with a controlled env (`configureProxyRoutingEnv` / `launchCell` env), thread `CODING_KNOWLEDGE_INJECTION=0` into that env for the "injection off" avenues.

### Reuse/extend seam
Per-avenue the runner already builds the agent env (`runCell` builds `agentBaseEnv` then `configureRouting`). Add the injection flag to that env based on the avenue's knowledge-injection axis value. **The toggle is env-var-in / early-return-out — no change to the retrieval service.**

**Net-new:** the env-var guard (2 early returns) + threading it from the avenue axis into the agent launch env. **Existing:** the whole injection system.

**Top risk:** Claude injection is a GLOBAL `~/.claude/settings.json` hook — it fires for the interactive session too. The env-var guard must be scoped to the avenue agent's spawned env so toggling injection off for an avenue does NOT disable injection for the operator's interactive session. Because the runner spawns each agent as a child with its own env, this is achievable, but `[VERIFY]` the Claude `-p` headless child actually inherits the runner-supplied env (it should, via `spawn(..., {env})`).

---

## §4 — Git Branch / Worktree Isolation for `avenue/*` (Claude's Discretion)

**Status: NET-NEW branch lifecycle; strong precedent exists.**

### The precedent (confirmed live)
`git worktree list` shows `.data/run-restores/smoke-spec-*` entries as **detached-HEAD worktrees** — the runner creates one per cell via `restoreSnapshot`'s `git worktree add --detach <restoreRoot>/<cleanId>-<stamp> <sha>`. `.claude/worktrees/agent-*` are separate (agent-isolation worktrees, locked). The machinery is `git worktree add` (fixed-argv spawnSync in `restore-snapshot.mjs:256`).

### What avenues change
Today's cell worktrees are **throwaway + detached** (no branch, pruned implicitly). An avenue must:
1. Restore into a worktree on a **named branch** `avenue/<task_id>`: `git worktree add -b avenue/<task_id> <path> <origin_sha>`.
2. Let the agent commit its work (or the runner commits the working-tree diff at cell close) so the branch **holds the real code changes** (D-04).
3. **Persist** the branch until an explicit prune (D-05).

### Recommendation (isolation & parallelism)
- **Worktree-per-branch, sequential execution.** The runner is ALREADY strictly sequential (`runMatrix` D-09: single-owner experiment LevelDB store forbids concurrent cells; `await` each). Do NOT parallelize avenues — it would violate the single-span-slot / single-owner-store invariants and re-introduce the token mis-attribution hazard (Phase 85 D-02). Keep sequential.
- **Worktree location:** put avenue worktrees under a NEW root, e.g. `.data/avenues/<task_id>/` (parallel to `.data/run-restores/`), so the persistent branches are distinguishable from throwaway restores. `.data/` is gitignored.
- **Prune lifecycle:** `git worktree remove <path>` + `git branch -D avenue/<task_id>` on explicit prune (D-05). Auto-prune sweepers exist as precedent (`.data/run-restores` and `com.coding.lsl-lock-sweeper` patterns), but D-05 says **no auto-expiry** — prune is on-demand only.
- **Concurrency limit:** effectively 1 (sequential). If the planner ever allows parallel avenues, each needs its own worktree AND a distinct `task_id` (which they have by construction), but the single-owner store + single span slot still gate to 1.

### Reuse/extend seam
Extend `restoreSnapshot` (via an `avenueMode`/`branchName` option) to emit `git worktree add -b avenue/<task_id>` instead of `--detach`. Add a prune primitive in a new module (e.g. `lib/experiments/avenue-branch.mjs`) with fixed-argv `git worktree remove` + `git branch -D`, mirroring `run-launch.mjs`'s fixed-argv discipline.

**Net-new:** named-branch worktree add, commit-on-close, prune primitive. **Existing:** the worktree machinery + fixed-argv git pattern.

---

## §5 — Cross-Branch Data Survival (D-05, riskiest integrity question)

**Status: EXISTING mechanism already solves this — preserve it exactly.**

### The key finding (this is the answer to the "top risk")
The runner **already** writes the measurement span to the **MAIN `.data` dir**, NOT the sandbox — deliberately. `experiment-runner.mjs:485-491`:
```
// The measured span MUST live in the MAIN data dir — the dir the shared host proxy reads
// active-measurement.json from. ... measurement-stop's aggregateByTaskId ALSO reads the
// MAIN token-usage.db, so start+stop both use spanEnv.
const mainDataDir = dataDir || process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot || REPO_ROOT, '.data');
const spanEnv = { ...process.env, LLM_PROXY_DATA_DIR: mainDataDir };
```
Only the **agent's file/KB writes** are isolated to the sandbox (`cwd=worktree`, `agentBaseEnv.LLM_PROXY_DATA_DIR = sandboxDataDir`). Token attribution goes to MAIN. **An avenue running in an `avenue/*` worktree inherits this exact split — its span + token rows land in MAIN `.data`, surviving branch switches and prunes (D-05 satisfied by construction).**

### Identity rules that prevent double-counting (Phases 82/83)
- **Aggregation identity:** `aggregateByTaskId(task_id)` in `lib/experiments/token-aggregate.mjs` sums `WHERE task_id = ?` over `token_usage` (bound-param, SQL-injection-safe, `COALESCE(SUM(...),0)`). Each avenue has a UNIQUE composite `task_id` (`composeTaskId(expId, cell, rep)`), so avenue token totals never collide — **provided each avenue keeps a distinct `task_id`.**
- **Dedup identity:** `insertTokenRowDeduped` keys on **`(user_hash, tool_call_id)`** (Phase 82-04). It was upgraded from first-writer-wins to **merge-on-cache**: a dedup HIT on a cache-less row ENRICHES cache/reasoning in place; a HIT on an already-cached row DROPS the incoming row (no double-count). `MERGE_ON_CACHE_SQL: UPDATE token_usage SET cache_read_tokens=?, cache_write_tokens=?, reasoning_tokens=MAX(...) WHERE user_hash=? AND tool_call_id=?`.
- **Per-request binding:** each agent binds its rows to the avenue's `task_id` via `configureProxyRoutingEnv` — claude via `x-task-id` header, copilot via the `/v1/copilot/t/<taskId>` base-URL path, opencode via `ANTHROPIC_BASE_URL`. This kills the ambient-span singleton leak (Phase 82-06).
- **Reconciliation:** `measurement-stop.mjs` writes `.data/measurements/<sanitizeTaskId(task_id)>/reconciliation.json` (Phase 83) — wire-vs-transcript match/flag counts, served verbatim by the dashboard, never recomputed client-side.

### The hard rules the planner MUST preserve
1. **Avenue span → MAIN `.data`** (never the avenue worktree's `.data`). If an avenue accidentally opens its span in the worktree sandbox, its tokens land with an empty task_id (the exact pre-fix 0-token bug documented in `runCell`).
2. **Unique `task_id` per avenue** — `composeTaskId` already guarantees this; do not reuse the origin span's task_id for an avenue.
3. **`(user_hash, tool_call_id)` dedup unchanged** — do not touch the merge-on-cache logic.
4. **Single span slot / single-owner store** — never run two avenues (or an avenue + interactive session) concurrently (Phase 85 D-02 409 guard).

**Net-new:** nothing on the writeback path — it already works. **Risk:** a plan that "isolates" avenue data into the branch worktree would REVIVE the 0-token bug and lose data on prune. The planner must explicitly assert span→MAIN in every avenue task.

---

## §6 — Comparison Surface Reuse (D-06/D-07)

**Status: EXISTING pairwise diff + frozen slice; N-way panel is NET-NEW (thin).**

### Reuse targets (confirmed)
- `integrations/system-health-dashboard/src/components/performance/difference-viewer.tsx` — `DifferenceViewer()` self-reads `selectCompareA`/`selectCompareB`, dispatches `fetchContextTurns(aId/bId)`, aligns via the PURE `run-align.ts` `alignRuns(aTurns, bTurns)` (common-prefix + LCS tail), renders `ContextBand` + cumulative token deltas + `loopFlags`. **Mount it unchanged.**
- `run-align.ts` — `alignRuns(a, b): AlignResult`, `turnSignature`, `sizeBucket` (pure). No change.
- `performanceSlice.ts` — the FROZEN Phase 86-02 contract. Relevant existing pieces to EXTEND (not fork):
  - `setCompareA`/`setCompareB` actions + `selectCompareA`/`selectCompareB` selectors — the 2-of-N selection wiring (the runs-table "Compare selected (2)" idiom at 86-05).
  - `Run` interface with `score` (RunScore: `goal_achieved`, `corrected_*`), `outcome` (RunOutcome: `totalTokens`), route fields (`loop_count`, `wallclock_per_step`), `canonical_model`/`canonical_agent`.
  - `fetchRuns`, `selectRuns`, `selectFilteredRuns`, `runModels`, `scoreStateOf`.
  - Thunks/selectors for the launcher already exist: `fetchSpecList`, `launchExperiment`, `fetchRunStatus`, `cancelRun`, `selectSpecList`, `selectRunStatus`, `setLauncherPrefill`, `LauncherPrefill`.

### N-way ranking layer (net-new, thin)
Add to `performanceSlice` (EXTEND — do not create a new slice per D-05 discretion + 86 precedent):
- An **avenue-grouping selector** that groups `Run`s by their origin span. **Open question:** the Run record needs an `origin_span_id` (or the existing `rerun_of` / `base_variant` / `experiment_id` linkage) to group avenues by origin. `rerun_of` links re-runs; avenues need an analogous `origin_span` field on the Run metadata written by `measurement-start`/`run-write.mjs`. `[VERIFY]` whether `experiment_id` (the spec's) suffices as the group key or a new `origin_span_id` is needed. **Likely net-new metadata field.**
- A **ranking selector**: default sort by outcome score (`corrected_goal_achieved ?? goal_achieved`, Phase 73 corrected-wins), secondary sortable columns tokens/cost (`outcome.totalTokens`), route quality (`loop_count`/route heuristics), wall-clock (`wallclock_per_step` × steps or started/ended delta).
- The panel component: a `Card` + shadcn `Table` (sortable), ranked rows, merge-status badge per row, Promote/Prune row actions, 2-of-N row selection → `setCompareA/setCompareB` → switch to Compare tab (existing `DifferenceViewer` renders). Per UI-SPEC §Interaction Contract 5.

**Net-new:** the origin-grouped N-way panel component + grouping/ranking selectors + (likely) an `origin_span_id` Run metadata field. **Existing:** `DifferenceViewer`, `run-align`, `setCompareA/B`, the whole slice contract, the ranking data fields.

---

## §7 — Merge-Status Tracking + Promote-a-Winner (D-04)

**Status: NET-NEW git-status compute + promote/prune; host-executor precedent exists.**

### Compute merge status
For each `avenue/<task_id>` branch, compute merged/unmerged/conflicts from git (host-side — the container has no git repo write access to signal). Mechanism (fixed-argv, host coordinator seam):
- `git branch --merged main` → contains `avenue/<task_id>`? → `merged`.
- Ahead/behind: `git rev-list --left-right --count main...avenue/<task_id>`.
- Conflicts: `git merge-tree` (or a dry-run `git merge --no-commit --no-ff` in a scratch worktree) to detect conflicting files WITHOUT mutating main.
- UI-SPEC copy: `branch: avenue/{task_id} · ahead {n} · behind {m} · {conflicts} conflicting files`. `unknown` → NO badge (honesty).

### Promote a winner
Merge `avenue/<task_id>` into main. State-changing → must run host-side (coordinator seam, like Phase 85's experiment executor). If git reports conflicts, BLOCK with a warning (UI-SPEC: `avenue/{task_id} has conflicts with main — resolve them before promoting`).

### Reuse/extend seam
The host-executor precedent is the **health-coordinator experiment executor**: `scripts/health-coordinator.js:2735` `POST /experiments/run` and `:2768` `POST /experiments/cancel`, which delegate to `lib/experiments/experiment-executor.mjs` → `run-launch.mjs` (`launchRun`/`cancelRun`). Add analogous coordinator endpoints (`/experiments/avenue-merge-status`, `/experiments/avenue-promote`, `/experiments/avenue-prune`) + a new `lib/experiments/avenue-branch.mjs` with fixed-argv git primitives. The vkb-server routes (`lib/vkb-server/api-routes.js:116-119` already host `/api/experiments/run|run-status|run-cancel|specs`) proxy to the coordinator; add `/api/experiments/avenue-*` mirrors.

**Net-new:** git merge-status compute, promote (merge), prune primitives + their coordinator/vkb routes + UI badge/actions. **Existing:** the coordinator delegation pattern, fixed-argv git discipline, the vkb→coordinator proxy seam.

---

## §8 — Control Center Host (D-01)

**Status: EXISTING launch→CLI→coordinator bridge; add a "Fork" entry point.**

### The bridge (all confirmed)
- **Frontend trigger:** UI-SPEC says the "Fork into avenues" button mirrors the existing **Re-run** button idiom in `runs-table.tsx` (the `isCompletedExperimentRun(run)` guard + `dispatch(setLauncherPrefill(buildRerunPrefill(run, specList)))` at ~line 521). Fork uses the same guard (only completed spans) + pre-fills the variant picker.
- **Variant picker:** extend `experiment-launcher.tsx` — it already has `matrix-preview` (`data-testid="matrix-preview"`, `bg-muted/40`, server-resolved `cellCount`), spec select, `Checkbox` variant subset, per-variant model/agent `Input` overrides, `ring-2 ring-primary` pre-fill highlight, dismissible `launch-error` alert. Add the 4-axis picker (agent/model/framework/knowledge-injection) + sweep toggle + count+cost preview.
- **API:** `launchExperiment({spec, overrides, rerun_of})` thunk (slice) → `POST /api/experiments/run` (vkb-server `handleExperimentRun`, `api-routes.js:116`) → delegates to host coordinator `:3034` `POST /experiments/run` → `experiment-executor.mjs` → `run-launch.launchRun` → detached `node scripts/experiment-run.mjs`. The 409 concurrency guard (single span slot) is enforced (Phase 85 D-02).
- **Monitoring:** `fetchRunStatus` polls `progress.json` (5s), `RunProgress`/`RunProgressCell` types, `cancelRun` group-kills.

### Reuse/extend seam
Fork = (1) capture/reference the origin snapshot (§1), (2) synthesize an avenue experiment-spec (§2) with the origin prompt as `goal_sentence`, (3) POST through the existing `launchExperiment` path. The **spec must be scriptable** (D-01 CLI-backed) — write the fork's avenue-spec to `config/experiments/` OR pass it inline through the existing spec path so a power user can reproduce the sweep from the CLI.

**Open question:** the launcher today lists **existing** `config/experiments/*.yaml` specs (D-09: dashboard launches, never edits). Fork needs to CREATE an avenue-spec from a completed span. This is a NEW capability (spec synthesis) — but keep it CLI-backed: the fork action generates a spec file (or a documented CLI invocation) rather than a UI-only in-memory matrix. `[ASSUMED]` the planner will add a spec-synthesis step; confirm whether the synthesized spec is persisted to `config/experiments/` or held transiently.

**Net-new:** the Fork button + avenue-spec synthesis + the 4-axis picker + sweep count/cost preview. **Existing:** the entire launch→CLI→coordinator→runner→monitor bridge.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Byte-identical origin restore | A "lighter" snapshot | `restoreForCell` / `restoreSnapshot` (Phase 67) | D-08 mandates full RunSnapshot; the rig handles submodules/dirty-patch/KB/routing |
| Headless agent launch | New per-agent spawner | `argvForAgent` + `runCell` (Phase 78) | Fixed-argv, permission flags, proxy routing, terminal-state timer all solved |
| Detached host spawn / group kill | New daemon or launchd job | `run-launch.launchRun`/`cancelRun` via coordinator (Phase 85) | Detached + unref + negated-pid group kill already proven |
| Token attribution / dedup | Any per-branch token store | MAIN `token_usage.db` + `aggregateByTaskId` + `insertTokenRowDeduped` | §5 — identity keyed on task_id + (user_hash, tool_call_id); double-count already prevented |
| Trajectory diff | A second diff viewer | `DifferenceViewer` + `run-align` (Phase 86-04) | D-06 explicit: add a layer, don't rebuild |
| Launcher/monitor state | A new Redux slice | Extend `performanceSlice` | 86-02 frozen contract; D-05 discretion says extend |
| Knowledge retrieval | New injection pipeline | `callRetrieval` + existing adapters/hook | Only an on/off env guard is needed |
| Matrix count/cost preview | Client-side axes recompute | Server-resolved `cellCount` (`fetchSpecList`) | D-02/D-09: server-authoritative, never client recompute |

**Key insight:** ~85% of this phase is wiring already-shipped, live-proven primitives. The only genuinely new code is the persistent `avenue/*` branch lifecycle (§4), git merge-status/promote/prune (§7), the knowledge-injection axis + toggle (§2/§3), and the N-way ranking panel (§6).

---

## Common Pitfalls

### Pitfall 1: Isolating avenue measurement data into the branch worktree
**What goes wrong:** an avenue opens its span with `LLM_PROXY_DATA_DIR = <avenue worktree>/.data`, so the shared host proxy (reading MAIN `active-measurement.json`) never sees the task_id → every token row lands with empty task_id → 0-token avenue → data lost on prune.
**Why it happens:** "isolation" intuition conflates AGENT file isolation (correct: sandbox worktree) with SPAN isolation (wrong: must be MAIN).
**How to avoid:** span → MAIN `.data` (`spanEnv` at `experiment-runner.mjs:491`); only agent cwd/KB → worktree. Assert this in every avenue task's acceptance.
**Warning signs:** avenue Runs show 0 tokens or quarantine empty.

### Pitfall 2: Reusing the origin span's task_id for an avenue
**What goes wrong:** avenue tokens collide with the origin's under one `WHERE task_id = ?`, double-counting.
**How to avoid:** each avenue gets a unique `composeTaskId(expId, cell, rep)`; keep origin as its own record, avenues as distinct.

### Pitfall 3: Adding a 5th cell key without updating downstream readers
**What goes wrong:** `makeCell` drops unknown keys; `measurement-stop.mjs`/`evidence-harness.mjs` read exactly `agent, model, framework, env, test_command`. A new `knowledge_injection` key silently vanishes.
**How to avoid:** either encode injection in the `env` axis, or update `makeCell` + every reader in lockstep (cross-module contract change).

### Pitfall 4: Disabling injection globally instead of per-avenue
**What goes wrong:** the Claude `UserPromptSubmit` hook is a GLOBAL `~/.claude/settings.json` registration; a global disable kills injection for the operator's interactive session too.
**How to avoid:** scope the `CODING_KNOWLEDGE_INJECTION=0` env var to the avenue agent's spawned child env only. Verify the `-p` child inherits it.

### Pitfall 5: Parallelizing avenues
**What goes wrong:** two avenues (or avenue + interactive) contend the single span slot + single-owner experiment LevelDB → token mis-attribution + store corruption.
**How to avoid:** keep the runner's sequential `await`-each loop; honor the Phase 85 D-02 409 guard.

### Pitfall 6: Promote/prune mutating main from the container
**What goes wrong:** the dashboard container has no agent CLIs and shouldn't mutate git main.
**How to avoid:** route all state-changing git ops through the host coordinator seam (Phase 85 D-01 boundary).

---

## Runtime State Inventory

> Phase 87 is primarily net-new code + a branch lifecycle, not a rename/migration. This section covers the runtime state the NEW `avenue/*` branches introduce.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Measurement rows in MAIN `.data/token_usage.db`, `.data/measurements/<task_id>/`, `.data/experiments/` Run store — avenues write here, survive prune (D-05). | None (survival is the goal); ensure span→MAIN |
| Live service config | The host LLM proxy `:12435` reads MAIN `active-measurement.json` for token attribution; `processOverrides` in `.data/llm-settings.json` captured in the snapshot. | None new; avenues route via existing proxy seam |
| OS-registered state | `git worktree` registrations under `.git/worktrees/` for each `avenue/*` worktree — **NET-NEW persistent worktrees**. Not auto-pruned (D-05). | Prune primitive must `git worktree remove` + `git branch -D` |
| Secrets/env vars | New `CODING_KNOWLEDGE_INJECTION` env var (net-new) threaded into avenue agent env. No secret. | Document; default on |
| Build artifacts | Avenue worktrees populate submodules via `submodule update --init` (restore rig). Stale worktrees accumulate under `.data/avenues/` until pruned. | Prune lifecycle owns cleanup |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cell worktree = detached throwaway | Avenue worktree = named `avenue/<task_id>` branch, persistent | This phase | Holds real code changes; adoptable (D-04) |
| Token dedup first-writer-wins | merge-on-cache (`insertTokenRowDeduped`) | Phase 82-04 | Cross-branch avenue writes enrich, never double-count |
| Ambient span singleton | per-request task_id binding (x-task-id / copilot path / ANTHROPIC_BASE_URL) | Phase 82-06 | Avenue rows bind to the right task_id |
| Pairwise-only compare | Pairwise `DifferenceViewer` + (this phase) N-way origin-grouped ranking | 86-04 → 87 | Layer, don't rebuild |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Intended mastra agent literal is `mastracode` (matches `AGENT_CONFIG_FILE`/`argvForAgent`) | §2 | Variant picker emits wrong token → validateCells blocks the cell |
| A2 | Knowledge-injection axis best encoded as an `env` value or a new cell key (planner's call) | §2/§3 | Silent key-drop if a 5th key added without updating readers |
| A3 | A new `origin_span_id` Run metadata field (or reuse of `experiment_id`) is needed to group avenues by origin | §6 | N-way grouping can't key without it |
| A4 | Fork synthesizes an avenue-spec (persisted or transient) — planner confirms persistence | §8 | Determines whether `config/experiments/` gets written |
| A5 | The Claude `-p` headless child inherits the runner-supplied env (so injection toggle scopes correctly) | §3 | Global injection disable leaks to interactive session |
| A6 | Sequential-only execution is acceptable (matches runner + span-slot invariants) | §4 | If parallel avenues wanted, needs a bigger redesign |

---

## Open Questions

1. **Avenue-to-origin grouping key.** Does `experiment_id` suffice, or is a new `origin_span_id` field on the Run record required? Recommendation: add `origin_span_id` to `measurement-start` args → `run-write.mjs` metadata (mirrors `rerun_of`/`base_variant`).
2. **Knowledge-injection axis encoding.** `env` value vs new cell key? Recommendation: reuse `env` (`kb-on`/`kb-off`) to avoid the cross-module 5-key contract change (Pitfall 3).
3. **`mastra` vs `mastracode` enum + Copilot headless.** Confirm the agent literal; copilot avenues are still gated on the `probeCopilotHeadless` drivability check (records a skip-Run, never silently absent — Phase 78 D-08).
4. **Where the winning avenue's commits come from.** Does the agent commit during the run, or does the runner commit the working-tree diff at cell close? D-04 needs the branch to HOLD the changes. Recommendation: runner commits the worktree diff onto `avenue/<task_id>` at cell close (deterministic; agent may or may not commit).
5. **Conflict detection without mutating main.** Use `git merge-tree` (read-only) for the merge-status badge; only `git merge` on explicit Promote.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` (worktree, merge-tree) | §4/§7 branch lifecycle | ✓ | system git | — |
| Host LLM proxy `:12435` | Token attribution | ✓ (launchd `com.coding.llm-cli-proxy`) | — | Health-gated; unrouted = unmeasured |
| health-coordinator `:3034` | Host executor (spawn/git) | ✓ (launchd `com.coding.health-coordinator`) | — | required (container can't spawn) |
| vkb-server `:8080` | API routes | ✓ (supervisor `web-services:vkb-server`) | — | — |
| dashboard `:3032` | UI | ✓ | — | gsd-browser for verify |
| Qdrant / retrieval service | Knowledge injection | ✓ (existing v6.0) | — | Injection fail-open (already) |
| agent CLIs (claude/opencode/mastracode/copilot) | Avenue execution | claude/opencode ✓ | — | copilot gated on drivability probe; mastra `[VERIFY]` |

**Missing dependencies with no fallback:** none identified — all infra exists.
**Blocking `[VERIFY]`:** mastra/mastracode headless drivability (not yet exercised in the runner; `KNOWN_AGENTS` excludes it today).

---

## Validation Architecture

> `nyquist_validation` is not explicitly `false` in `.planning/config.json` → included. **CAVEAT:** the dashboard has **no component-unit test harness** (no jsdom/vitest/testing-library — confirmed by Phase 86-03 SUMMARY: "adding one is a package install, excluded"). Dashboard validation = `npm run build` typecheck + Playwright e2e (`tests/e2e/` / `performance.spec.ts`) + `gsd-browser` visual verify on `:3032`. Host lib validation = `node --test`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework (host lib) | `node --test` (`.mjs` unit tests, existing under `tests/`) |
| Framework (dashboard) | Playwright e2e (`performance.spec.ts`, `performance-compare.spec.ts`) + vite build typecheck |
| Config file | `tests/` conventions; no jsdom harness (Wave 0 gap = accepted, no install) |
| Quick run command | `node --test tests/experiments/*.test.mjs` (repo convention: tests live under tests/experiments/, never lib/**) |
| Full suite command | `npx playwright test` + `cd integrations/system-health-dashboard && npm run build` |

### Phase Requirements → Test Map (Nyquist — prove each decision holds)
| Req | Behavior | Test Type | Automated Command | Exists? |
|-----|----------|-----------|-------------------|---------|
| AVN-05 | `avenue/<task_id>` branch worktree created (named, not detached) | unit | `node --test tests/experiments/avenue-branch.test.mjs` | ❌ Wave 0 |
| AVN-06 | Avenue span writes to MAIN `.data`; token rows aggregate under avenue task_id, no double-count vs origin | integration | `node --test` asserting `aggregateByTaskId` isolation + `insertTokenRowDeduped` merge-on-cache | ❌ Wave 0 |
| AVN-04 | Injection OFF avenue → agent env carries `CODING_KNOWLEDGE_INJECTION=0`, retrieval NOT called | unit | grep env threading + early-return guard | ❌ Wave 0 |
| AVN-03 | Sweep count/cost preview server-resolved before launch; launch disabled until rendered | e2e | `performance.spec.ts` launcher flow | extend |
| AVN-07 | N-way panel ranks by outcome score; select 2 → `DifferenceViewer` | e2e | `performance-compare.spec.ts` | extend |
| AVN-08 | Merge-status badge = git-computed; promote blocked on conflicts | e2e + unit | git merge-status unit + badge e2e | ❌ Wave 0 |
| AVN-09 | Prune removes worktree+branch; measurement data still queryable | integration | prune primitive unit + post-prune `aggregateByTaskId` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test` on the touched lib module (host) OR vite build (dashboard).
- **Per wave merge:** full `node --test` suite + `npx playwright test`.
- **Phase gate:** full suite green + `gsd-browser` visual verify of the N-way panel + merge badge + prune/promote confirm bars on `:3032` in BOTH light and dark themes (UI-SPEC §Interaction 7 + CLAUDE.md).

### Wave 0 Gaps
- [ ] `tests/experiments/avenue-branch.test.mjs` — worktree create + prune primitives (AVN-05/09)
- [ ] Cross-branch double-count integration test — span→MAIN + task_id isolation (AVN-06, the top risk)
- [ ] Injection-toggle env threading test (AVN-04)
- [ ] Extend `performance.spec.ts` / `performance-compare.spec.ts` for fork launcher + N-way panel + merge badge
- [ ] Merge-status git-compute unit test (AVN-08)

---

## Security Domain

> `security_enforcement` not explicitly `false` → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `_validRunId` charset+length bound; `SHELL_META_RE` on test_command (`experiment-spec.mjs`); avenue branch name derived from sanitized task_id (`sanitizeTaskId`) |
| V1/V5 Command Injection | yes | **Fixed-argv only, never `shell:true`** (CLAUDE.md mandatory) — every git/spawn call is a literal string[] |
| V4 Access Control | yes | Coordinator endpoints reject external origins (`req.socket.remoteAddress` check, `health-coordinator.js:2737`); run_dir must stay under `.data/experiments/runs/` |
| V6 Cryptography | no | No crypto beyond sha256 digest (determinism proof) — never hand-rolled |
| V5 Path Traversal | yes | `sanitizeTaskId` (`[A-Za-z0-9._-]`, `path.basename`) on every snapshot/branch/measurement path; untracked-restore `../escape` guard |

### Known Threat Patterns for {git branch ops + host spawn}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell metachar in goal/branch/test_command | Tampering | Fixed-argv arrays; `SHELL_META_RE` reject at resolve time |
| Path traversal via avenue task_id | Tampering | `sanitizeTaskId` + `path.basename`; run_dir under-tree assertion |
| Promote merging attacker-controlled branch into main | Elevation | Host-only, confirm-gated (UI-SPEC destructive confirm); conflict-block |
| Prune deleting the wrong worktree/branch | Tampering | Prune keyed on sanitized `avenue/<task_id>`; fixed-argv `git worktree remove`/`branch -D` |
| Autonomous agent edits escaping sandbox | Elevation | Agent cwd = avenue worktree (isolated); span → MAIN (only measurement, not code) |
| Concurrent span-slot contention | DoS/mis-attribution | Phase 85 D-02 409 guard; sequential runner |

---

## Sources

### Primary (HIGH confidence — all read directly this session)
- `scripts/experiment-run.mjs`, `lib/experiments/experiment-runner.mjs`, `lib/experiments/experiment-spec.mjs`, `lib/experiments/agent-headless.mjs`, `lib/experiments/experiment-restore.mjs`, `lib/experiments/run-launch.mjs`, `lib/experiments/token-aggregate.mjs`, `lib/experiments/experiment-executor.mjs`
- `lib/repro/restore-snapshot.mjs`, `lib/repro/capture-snapshot.mjs`, `scripts/repro-restore.mjs`, `scripts/measurement-start.mjs`, `scripts/measurement-stop.mjs` (grep)
- `scripts/launch-agent-common.sh` (`_inject_knowledge_context`, `configure_proxy_routing`), `src/hooks/knowledge-injection-hook.js`, `src/hooks/knowledge-injection-opencode.js`, `~/.claude/settings.json` (UserPromptSubmit registration)
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` (full), `.../components/performance/difference-viewer.tsx`, `run-align.ts`, `experiment-launcher.tsx`, `runs-table.tsx` (grep)
- `lib/vkb-server/api-routes.js` (experiment routes), `scripts/health-coordinator.js` (experiment executor endpoints)
- `.planning/phases/87-*/87-CONTEXT.md`, `87-UI-SPEC.md`, `87-DISCUSSION-LOG.md`; `.planning/phases/85-*/85-CONTEXT.md`; `.planning/phases/82-*/82-04-*.md` (dedup identity); `git worktree list` (live precedent)

### Secondary (MEDIUM)
- `.planning/STATE.md` roadmap evolution + `[86-02]`/`[82-06]`/`[83-07]` decisions (milestone context)

---

## Metadata

**Confidence breakdown:**
- Snapshot/restore rig (§1): HIGH — read source + signatures.
- Run engine + spec (§2): HIGH — read full runner + spec; injection-axis gap identified.
- Injection seam (§3): HIGH on location, MEDIUM on toggle scoping (needs `[VERIFY]` on Claude `-p` env inheritance).
- Branch lifecycle (§4): MEDIUM — greenfield, but precedent + machinery fully mapped.
- Cross-branch survival (§5): HIGH — the existing span→MAIN split + dedup identity is confirmed and solves it.
- Comparison reuse (§6): HIGH — slice + viewer read directly.
- Merge status/promote (§7): MEDIUM — git primitives standard, wiring net-new.
- Control Center host (§8): HIGH — full bridge confirmed.

**Research date:** 2026-07-11
**Valid until:** 2026-08-10 (stable internal codebase; re-verify if Phase 82/85/86 code moves).

## RESEARCH COMPLETE

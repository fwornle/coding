# Phase 78: Autonomous Cross-Agent Runner - Research

**Researched:** 2026-07-03
**Domain:** Unattended multi-agent orchestration over already-shipped experiment machinery (Phase 67 restore rig, Phase 77 spec/restore, the measured-span seam, per-agent CLI launchers, Run-KB write/judge/score)
**Confidence:** HIGH — every claim below is grounded in on-disk code (file:line quoted) or a live `--help` probe of the installed agent binaries. No external packages are introduced.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Drive each agent via a **thin per-agent headless adapter that reuses the existing `config/agents/*.sh` launch scripts** (resolved through `lib/agent-registry.js` / `lib/agent-detector.js`), passing each CLI's non-interactive/print flag. Do NOT build a parallel standalone driver layer, and do NOT carve a headless path into interactive `bin/coding`.
- **D-02:** The agent runs with **`cwd` = the restored sandbox worktree** and **`LLM_PROXY_DATA_DIR` = the sandbox `.data/`** (outputs of Phase 77's `restoreForCell`), so all file edits AND token/route rows land inside the isolated cell.
- **D-03:** Each cell's work is wrapped in a **measured span** (`measurement-start.mjs` → `measurement-stop.mjs`) tagged with `variant`, `repeat`, `task_hash`, threading the Phase-77 per-variant `span.meta` (`agent/model/framework/test_command`).
- **D-04:** **Agent process exit is the completion signal.** `exit(0)` → **complete**; wall-clock timeout kill → **`timeout`**; non-zero/killed → **`abort`**. All three recorded, none silently dropped.
- **D-05:** The per-variant **`test_command` runs AFTER completion, for scoring only** — NOT the completion gate.
- **D-06:** **Default per-cell wall-clock timeout = 20 minutes**, overridable via a spec/CLI field.
- **D-07:** Gate Copilot with a **minimal one-turn headless probe** ("can Copilot run one headless turn against a trivial prompt and exit 0?") — matching the `copilot + headless → unsupported` gate in `experiment-spec.mjs`.
- **D-08:** On probe failure, the **Copilot variant cell is skipped with a recorded reason on the Run record** (e.g. `skipped: copilot-headless-unsupported`) — never silently absent.
- **D-09:** **Sequential cell execution** — not parallel.
- **D-10:** **Idempotent cell identity = `task_hash + variant + repeat`.** A re-run skips already-completed cells → exactly one Run per cell; interrupted matrix is resumable.
- **D-11:** **Scoring runs inline per cell** — `judge.mjs` / `score-write.mjs` execute right after each cell's span closes.
- **D-12:** **Claude + OpenCode are REQUIRED** end-to-end (satisfies SC#4's "≥2 agents"). **Mastra is best-effort** (recorded-skip on failure). **Copilot is gated** by the RUN-04 probe.

### Claude's Discretion
- Exact module layout (e.g. `lib/experiments/experiment-runner.mjs` + thin `scripts/experiment-run.mjs` CLI) and the adapter shape over `config/agents/*.sh`.
- The precise per-agent headless invocation/flags — the researcher confirms; the adapter encodes (resolved below).
- Timeout implementation (spawn + timer + SIGTERM→SIGKILL) and the exact `timeout`/`abort` enum wording.
- The exact prompt/handoff to each headless agent (how `goal_sentence` + sandbox context are delivered).
- The one-turn Copilot probe's exact trivial prompt and success assertion.
- Cell sequencing/resume bookkeeping (manifest vs querying Run-KB for existing `task_hash+variant+repeat`).

### Deferred Ideas (OUT OF SCOPE)
- Parallel cell execution (D-09 is sequential).
- Separate (non-inline) scoring pass.
- Closed `framework/approach` enum (stays free-form).
- Success gate / N-repeat variance / ranked report (CMP-01/02/03) → Phase 79.
- Auto-routing / policy engine → v7.6.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RUN-02 | Launch the specified agent (Claude/OpenCode/Mastra) autonomously against the goal, wrapping the work in a measured span tagged with `variant`, `repeat`, `task_hash`. | Headless flags confirmed for all agents (§Unknown 1); measured-span CLI surface confirmed (§Unknown 3); restore→launch env binding confirmed (§Unknown 4). **Gap:** `repeat` is not threadable and `variant` is dropped at Run-write — the runner must encode both into the per-cell `task_id` (§Unknown 3, §Unknown 6). |
| RUN-03 | Runs execute unattended to completion/timeout/abort; timeouts/aborts recorded as such. | Terminal-state mechanics grounded in existing SIGTERM→SIGKILL analogs (§Unknown 5). **Gap:** Run.metadata has no terminal-state field today — must be added by the runner (§Unknown 5). |
| RUN-04 | Copilot gated on an explicit headless-drivability check; skipped-with-reason if unsupported, never silently absent. | `copilot -p/--prompt --allow-all-tools` non-interactive mode is documented and installed (§Unknown 2). The pessimistic seed reflects the tmux interactive path, not `copilot -p`. **Gap:** no `skipped`/`skip_reason` field on Run.metadata today (§Unknown 2). |
</phase_requirements>

## Summary

Phase 78 is an **orchestrator over shipped parts** — the four gray areas in CONTEXT.md all resolve to "wire the existing module, do not rebuild it." The research confirms that the mechanical pieces exist and are directly callable, and that **`scripts/measurement-stop.mjs` is already the complete inline scorer** (aggregate → `writeRun` → `gatherEvidence` → `runJudge` → overlay non-GSD dims → `writeScore`, all in one try/finally at `scripts/measurement-stop.mjs:215-535`). The runner therefore does NOT re-implement scoring (D-11); it wraps a cell in `measurement-start` → agent-launch → `measurement-stop` with `LLM_PROXY_DATA_DIR` pointed at the Phase-77 sandbox.

All four agent CLIs are installed and expose a documented **non-interactive/headless** mode: `claude -p`, `opencode run`, `mastracode --prompt`, and — critically for RUN-04 — `copilot -p ... --allow-all-tools`. The pessimistic `copilot + headless → unsupported` seed in `experiment-spec.mjs:65-71` was based on the **interactive tmux per-prompt injection path** (`config/agents/copilot.sh` launches copilot inside a tmux wrapper + HTTP adapter), NOT on `copilot -p`. The RUN-04 probe should therefore run `copilot -p "<trivial>" --allow-all-tools` and assert exit 0 — and may well PASS.

Three **gaps** require planner action, none of them a rebuild: (1) neither `variant` nor `repeat` is persisted on a Run today (`variant` is threaded into `span.meta` but explicitly dropped at Run-write, `scripts/measurement-start.mjs:156-157`; `repeat` is never threaded), and `task_hash` is a **constant across the whole matrix** because it is `sha256(goal_sentence)` (`scripts/measurement-stop.mjs:440-442`) — so cells are indistinguishable without variant+repeat; (2) Run.metadata has no terminal-state field (`complete`/`timeout`/`abort`); (3) Run.metadata has no `skipped`/`skip_reason` field. The cleanest fix for (1) is to **encode `variant`+`repeat` into the per-cell `task_id`** the runner passes to `measurement-start`, because `task_id` is already the `writeRun` idempotency key (`lib/experiments/run-write.mjs:64-72`) and is persisted as `Run.metadata.task_id`; `readRuns` then supplies the resume ledger (D-10) with no separate manifest.

**Primary recommendation:** Build `lib/experiments/experiment-runner.mjs` (pure orchestration logic, testable via injected seams) + a thin `scripts/experiment-run.mjs` operator CLI. Per cell, sequentially: `restoreForCell` → `spawn` the resolved agent CLI (fixed argv, no shell) with `cwd`=worktree + `LLM_PROXY_DATA_DIR`=sandboxDataDir under a 20-min SIGTERM→SIGKILL timer → run `measurement-stop.mjs` (inline scorer) → record terminal state. Encode `variant`+`repeat` into `task_id` for free idempotency via `readRuns`. Resolve the agent→binary mapping through the detector's `AGENT_COMMAND` parse, and drive the binary directly with its documented headless flag (the `.sh` scripts are interactive-tmux launchers and are NOT reusable as-is for headless — see Risk R1).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Matrix loop / cell sequencing (D-09) | Runner module (`lib/experiments/experiment-runner.mjs`) | — | Pure orchestration; sequential; no I/O beyond delegating to shipped modules. |
| Per-cell snapshot restore (RUN-01, consumed) | Phase-77 `experiment-restore.mjs` → Phase-67 `restore-snapshot.mjs` | — | Already shipped; runner only calls `restoreForCell`. |
| Headless agent launch (RUN-02) | Runner adapter (spawn) | `agent-detector.js` (AGENT_COMMAND resolution) | Each CLI's own `-p`/`run`/`--prompt` mode; runner owns the child process + timer. |
| Measured span open/close + tagging (RUN-02) | `scripts/measurement-start.mjs` / `measurement-stop.mjs` | proxy `measurement-span.js` dist | Shipped seam; runner sets env + flags, does not reimplement. |
| Token attribution to the cell | rapid-llm-proxy (via `LLM_PROXY_DATA_DIR`) | `token-aggregate.mjs` | Sandbox-scoped `.data`; aggregation read-only inside measurement-stop. |
| Inline scoring (RUN-03, D-11) | `measurement-stop.mjs` pipeline (`gatherEvidence`→`runJudge`→`writeScore`) | `judge.mjs`, `evidence-harness.mjs`, `score-write.mjs` | Already end-to-end inside measurement-stop; runner triggers it. |
| Run materialization + idempotency (D-10) | `run-write.mjs` (`writeRun`) + `query.mjs` (`readRuns`) | repo-global experiment store (`store.mjs`) | Store lives at `<repo>/.data/experiments`, not the sandbox — resume query works across cells. |
| Terminal-state recording (RUN-03) | Runner (maps exit code/signal → enum) | measurement-stop tags | **New field** — no existing home; runner must add it. |
| Copilot capability probe (RUN-04) | Runner probe helper | `copilot -p --allow-all-tools` | Standalone one-turn check; result gates copilot cells. |

## Standard Stack

This phase adds **no external packages**. The "stack" is in-repo shipped modules + installed agent CLIs.

### Core (in-repo modules the runner wires)
| Module | Entry point (file:line) | Purpose | Contract |
|--------|------------------------|---------|----------|
| Per-cell restore | `lib/experiments/experiment-restore.mjs:168` | `restoreForCell(snapshotId, {repoRoot, dataDir, ontologyDir}) → {worktree, sandboxDataDir, digest}` | `inPlace:false` always; zero blast radius (T-77-08). |
| Span open | `scripts/measurement-start.mjs` (`buildVariantMeta` :90; `main` :178) | Opens span, writes `<dataDir>/active-measurement.json`, sets `span.meta` from `--agent/--model/--framework/--test-command/--variant/--spec`. | `--task-id` required. Reads `LLM_PROXY_DATA_DIR` (:233). |
| Span close + inline score | `scripts/measurement-stop.mjs` (`main` :215) | Archives span, aggregates tokens, `writeRun`, `gatherEvidence`→`runJudge`→overlay→`writeScore`, prints summary. | `--headless` (never prompt) + `--task-class <cls>`; reads same `LLM_PROXY_DATA_DIR`. |
| Run write | `lib/experiments/run-write.mjs:51` | `writeRun(store, {span, taskClass, pending, tags, totals, heuristics}) → runId` | Idempotency key = `span.task_id` (:64-72); re-close updates same node. |
| Run read (resume ledger) | `lib/experiments/query.mjs:77` | `readRuns(store, {includePending}) → rows[]` | Joins Score+Outcome by `run_task_id`; excludes `pending` unless `includePending:true`. |
| Judge | `lib/experiments/judge.mjs:289` | `runJudge({span, trace, evidence, callProxy}) → judgment` | NEVER throws; quarantines to `{pending:true}`; trivial-run short-circuit. |
| Score write | `lib/experiments/score-write.mjs:72` | `writeScore(store, {span, judgment}) → scoreId` | Idempotent on `run_task_id`; preserves `corrected_*` overrides. |
| Store factory | `lib/experiments/store.mjs:40` | `openExperimentStore({repoRoot}) → GraphKMStore` | Repo-global at `<repo>/.data/experiments`; caller owns `close()`. Single-owner LevelDB (no concurrent openers — reinforces D-09 sequential). |
| Spec resolve (consumed) | `lib/experiments/experiment-spec.mjs:211` | `resolveExperimentSpec(fileOrObj) → {goal_sentence, repeats, cells}` | Cells carry exactly `{agent,model,framework,env,test_command}`. |
| Test command resolve (scoring only, D-05) | `lib/experiments/evidence-harness.mjs:245` | `resolveTestCommand(span, repoRoot) → argv[]|null` | Reads `span.meta.test_command`; fixed-argv; runs at score time, not completion. |

### Supporting (agent→binary resolution)
| Symbol | Location | Purpose | Caveat |
|--------|----------|---------|--------|
| `AGENT_COMMAND` parse | `lib/agent-detector.js:23-39` (`parseAgentConfig`) | Extracts the launch binary per `config/agents/*.sh`. | **Module-private** — not exported (only `AgentDetector` class + default export are public). Runner must re-expose or reimplement the ~10-line parse. |
| `AgentDetector` | `lib/agent-detector.js:56` | `detectAll()` / `getBest()` — which agents' binaries exist on PATH. | Useful for a pre-flight availability gate. |
| `AgentRegistry` | `lib/agent-registry.js:5` | Registers `claude`→`ClaudeMCPAdapter`, `copilot`→`CoPilotAdapter`. | These are **interactive MCP/HTTP adapters, NOT headless drivers** — do not use for launch (Risk R1). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Runner calls `measurement-stop.mjs` as a subprocess for inline scoring | Runner imports `writeRun`/`runJudge`/`writeScore` directly and re-implements the pipeline | Re-implementing duplicates the 320-line orchestration at `measurement-stop.mjs:333-502` (foreground capture, fg/bg split, canonical attribution, fixture archive, non-GSD overlay). **Reuse the subprocess** — it is the shipped inline scorer (D-11). Only import the modules directly if the runner needs finer control over `taskClass`/`pending` than the CLI flags expose. |
| Encode variant+repeat into `task_id` | Extend `measurement-stop.mjs` tags to persist `variant`+`repeat` | Extending measurement-stop touches a shared, well-tested close path. Encoding into `task_id` is additive and reuses the existing idempotency key. Recommend **encode into task_id AND also persist explicit `variant`/`repeat` tags** (Phase-79 CMP needs to group by variant without parsing the id). |
| Runner owns the 20-min timer for all agents | Rely on `mastracode --timeout` / `claude` internal limits | Only mastracode has a native `--timeout` (exit 2). For uniform `complete`/`timeout`/`abort` semantics across all four agents (D-04), the runner must own the wall-clock timer itself. |

**Installation:** None. All dependencies are in-repo or already-installed CLIs (see Environment Availability).

## Package Legitimacy Audit

**Not applicable.** This phase installs **no external packages** — it wires in-repo `.mjs` modules and shells out to already-installed agent CLIs (`claude`, `opencode`, `mastracode`, `copilot`) resolved from `config/agents/*.sh`. There is no npm/PyPI/crates install step, so slopcheck/registry verification is moot. If the planner later decides to add a helper library (not recommended — the repo convention is stdlib-only for these modules, per every `lib/experiments/*.mjs` header), run the Package Legitimacy Gate at that point.

## Resolved Unknowns (the core of this research)

### Unknown 1 — Per-agent headless / non-interactive invocation (RUN-02, D-01)

**Finding: the `config/agents/*.sh` scripts do NOT expose a headless path.** They are metadata + pre-launch hooks (`AGENT_NAME`, `AGENT_COMMAND`, `agent_pre_launch()`), and `scripts/launch-agent-common.sh` launches them **interactively inside tmux**:
```
scripts/launch-agent-common.sh:592-595
  # 19. Launch via tmux session wrapper
  source "$SCRIPT_DIR/tmux-session-wrapper.sh"
  tmux_session_wrapper "$AGENT_COMMAND" "$@"
```
So D-01's "reuse the `*.sh` scripts" means **reuse them as the agent→binary registry** (via `AGENT_COMMAND`, which `agent-detector.js:parseAgentConfig` already extracts), NOT literally invoke them for a headless turn. The thin adapter resolves `AGENT_COMMAND` per agent and spawns that binary directly with the CLI's own non-interactive flag. [VERIFIED: on-disk grep + live `--help` probes]

Confirmed headless invocations (all four binaries installed — see Environment Availability):

| Agent | `AGENT_COMMAND` (from `.sh`) | Headless invocation (fixed argv) | Exit-code semantics | Model / cwd controls |
|-------|-----------------------------|----------------------------------|---------------------|----------------------|
| **claude** (v2.1.191) | `$CODING_REPO/bin/claude-mcp` (interactive wrapper) | `claude -p "<goal>"` (a.k.a. `--print`, "Print response and exit … non-interactive mode") | 0 = ok; non-zero = error | `--model <m>`; `--add-dir <d>`; **autonomous edits need `--permission-mode acceptEdits` or `--dangerously-skip-permissions`**; cwd via spawn `cwd`. **Use the `claude` binary directly, NOT `bin/claude-mcp`** (that wrapper boots MCP + interactive session). |
| **opencode** (v1.15.13) | `opencode` | `opencode run "<goal>"` ("run opencode with a message") | 0 = ok; non-zero = error | `-m/--model <provider/model>`; `--dir <sandbox>` (sets working dir); `--agent <a>`; `--format json` (raw JSON events). |
| **mastracode** | `mastracode` | `mastracode --prompt "<goal>"` (`-p`; documented "Headless (non-interactive) mode") | **0 = success; 1 = error/aborted; 2 = timeout** (documented exit codes) | `-m/--model <id>`; `--mode {build\|plan\|fast}` (default build); `--output-format {text\|json\|stream-json}`; native `--timeout <sec>`; **no `--dir` — set cwd via spawn `cwd`**; `--settings <path>` for a CI settings file. |
| **copilot** | `copilot` | `copilot -p "<goal>" --allow-all-tools` ("Execute a prompt in non-interactive mode (exits after completion)") | 0 = ok; non-zero = error | `--model <m>`; `-C <dir>` (change working dir); `--allow-all-tools` **required for non-interactive**; `--allow-all-paths`; `--log-dir <d>`. |

**Adapter shape (Claude's Discretion, recommended):** a per-agent record `{ bin, argvFor(goal, {model, worktree, sandboxDataDir}), env }` that emits a fixed argv array. Spawn with `{ cwd: worktree, env: { ...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir } }` (D-02). Never build a shell string — the CLAUDE.md fixed-argv rule + `SHELL_META_RE` posture applies to the launch just as it does to `test_command`.

**Prompt/handoff (Claude's Discretion):** deliver `goal_sentence` as the single positional/`-p` prompt argument; the agent works inside `cwd`=sandbox worktree, so no path context is needed in the prompt. For claude/opencode/mastra the prompt is one argv element; for copilot the same. Keep it a literal string (no interpolation of untrusted content beyond the spec's own `goal_sentence`).

`[VERIFIED: live --help of installed binaries, 2026-07-03]` for every flag in the table.

### Unknown 2 — Copilot one-turn headless probe (RUN-04, D-07/D-08)

**The gate seed** (`lib/experiments/experiment-spec.mjs:65-71`):
```js
export const UNSUPPORTED_COMBINATIONS = Object.freeze([
  Object.freeze({
    when: Object.freeze({ agent: 'copilot', env: 'headless' }),
    reason: 'Copilot headless drivability is unproven',
    pointer: 'gated by Phase-78 RUN-04 drivability spike',
  }),
]);
```
`validateCells` (`experiment-spec.mjs:151-159`) **hard-throws** the whole matrix at resolve time on any cell matching `{agent:'copilot', env:'headless'}`. [VERIFIED: on-disk]

**KEY FINDING — the seed is pessimistic about the wrong path.** The installed Copilot CLI documents a first-class non-interactive mode:
```
copilot -p, --prompt <text>    Execute a prompt in non-interactive mode (exits after completion)
--allow-all-tools              … required for non-interactive mode (env: COPILOT_ALLOW_ALL)
example: $ copilot -p "Fix the bug in main.js" --allow-all-tools
```
The "unproven" prior (D-08 "Copilot per-prompt injection may not be supported") stems from `config/agents/copilot.sh`, which drives copilot **interactively inside tmux** plus an HTTP adapter (`copilot.sh:39-73` starts `lib/adapters/copilot-http-server.js`) — i.e. the injection path, not `copilot -p`. So the RUN-04 probe is genuinely worth running and **may pass**. [VERIFIED: live `copilot --help`, 2026-07-03]

**Recommended probe (Claude's Discretion, D-07):**
```
spawn('copilot', ['-p', 'Reply with the single word OK and nothing else.', '--allow-all-tools'],
      { cwd: <throwaway or sandbox>, timeout: <short, e.g. 90s> })
→ assert exit code === 0  (optionally assert stdout contains "OK")
```
Keep it a trivial one-turn prompt (D-07 — NOT a full drive). Run it **once per matrix** before the copilot cells, cache the boolean.

**Where the skip lands (D-08):** on probe failure, each copilot cell must produce a **Run record carrying a recorded skip reason** (e.g. `skipped: true, skip_reason: 'copilot-headless-unsupported'`), never silent absence. **Gap R3:** `Run.metadata` has no `skipped`/`skip_reason` field today (`run-write.mjs:94-129` enumerates a fixed tag set). The runner must add these fields — simplest via the `tags` object passed to `writeRun`, OR by writing a minimal skip-Run directly through `openExperimentStore`+`writeRun` with a `pending`/sentinel `task_class`. The planner must decide the exact persisted shape.

**Design tension the planner MUST resolve (Open Question Q1):** the spec gate hard-fails `copilot+env:headless` at *resolve* time, so a copilot cell cannot flow through a normally-resolved matrix while the gate stands. Options: (a) the probe is a **standalone** capability check run before resolution, and on success the runner (or a spec update) removes/bypasses the `copilot+headless` entry; (b) copilot participates with `env:default` and "headless" refers to the *runner's drive mechanism* (always headless), with the probe gating all copilot cells regardless of the `env` axis label. The empirical `copilot -p` finding favors revisiting the static gate.

### Unknown 3 — Measured-span tagging seam (RUN-02, D-03)

**Open side** (`scripts/measurement-start.mjs`): `buildVariantMeta(args)` (:90) reads `--agent/--model/--framework/--test-command/--variant/--spec` and produces `span.meta` with keys `{agent, model, framework, test_command, env, variant}` (conditional-spread, :157-164). `main` (:178) requires `--task-id`, resolves `LLM_PROXY_DATA_DIR` (:233, default `<repo>/.data`), and captures a run-snapshot at span open. [VERIFIED: on-disk]

**Close side** (`scripts/measurement-stop.mjs`): reads `span.meta?.agent/.framework/.test_command`; computes `task_hash = sha256(goal_sentence)` (:440-442); writes `Run.metadata` tags (:443-454): `task_hash, agent, model, framework, trace_id, snapshot_id, canonical_model, canonical_agent, background_models`. [VERIFIED: on-disk]

**Exact CLI surface the runner calls per cell:**
```
LLM_PROXY_DATA_DIR=<sandboxDataDir> \
  node scripts/measurement-start.mjs \
    --task-id "<cellTaskId>" \
    --agent <a> --model <m> --framework <f> \
    --test-command "<fixed-argv test cmd>" \
    --variant "<cellName>" \
    --goal "<goal_sentence>"
# … launch agent …
LLM_PROXY_DATA_DIR=<sandboxDataDir> \
  node scripts/measurement-stop.mjs --headless --task-class <cls>
```
(`--task-class` avoids the interactive prompt; measurement-stop already quarantines to `unclassified/pending` if omitted and unsure — `measurement-stop.mjs:297-304`.)

**Gap R2 (idempotency-critical):**
- `variant` IS threaded into `span.meta` but is **explicitly dropped** at Run-write: "downstream Run.metadata drops it; it never becomes a persisted attribution field" (`measurement-start.mjs:156-157`).
- `repeat` is **not threaded anywhere** — there is no `--repeat` flag and no `span.meta.repeat` (verified by grep; only `repeats`, the matrix count, exists).
- `task_hash` is **identical for every cell in an experiment** (all cells share one `goal_sentence`; `task_hash = sha256(goal_sentence)`), so it CANNOT distinguish cells.

→ The runner must make `variant`+`repeat` recoverable on the Run. **Recommended:** bake them into the per-cell `task_id` (e.g. `task_id = "<expId>--<variantName>--r<repeat>"`), since `task_id` is persisted (`Run.metadata.task_id`) AND is already the `writeRun` idempotency key. Additionally persist explicit `variant`/`repeat` tags (extend the `tags` object) so Phase-79 CMP can group by variant without parsing the id.

### Unknown 4 — Restore → launch → score wiring (RUN-02/03, D-02/D-11)

**Restore** (`lib/experiments/experiment-restore.mjs:168`):
```
restoreForCell(snapshotId, {repoRoot, dataDir, ontologyDir})
  → { worktree, sandboxDataDir, digest }        // inPlace:false always
```
`sandboxDataDir = <worktree>/.data` (`restore-snapshot.mjs:248`). So per D-02 the runner sets **agent `cwd` = `worktree`** and **`LLM_PROXY_DATA_DIR` = `sandboxDataDir`**. All agent file edits land in the isolated worktree; all proxy token/route rows land in the sandbox `.data`. [VERIFIED: on-disk]

**Score (inline, D-11)** — already fully implemented inside `measurement-stop.mjs:471-502`:
```
store = await openExperimentStore();                       // repo-global .data/experiments
try {
  await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });   // :475
  const evidence = gatherEvidence({ span, phaseArg, repoRoot });                    // :483
  judgment = isTrivialRun(trace) ? {not_scored:'trivial'} : await runJudge({...});  // :485-487
  overlayNonGsdRubric(judgment, evidence);                                          // :496 (VALID-03)
  await writeScore(store, { span, judgment });                                      // :497
} finally { await store.close(); }
```
Exact signatures: `writeRun(store,{span,taskClass,pending,tags,totals,heuristics})` (`run-write.mjs:51`); `runJudge({span,trace,evidence,callProxy})` (`judge.mjs:289`, never throws); `writeScore(store,{span,judgment})` (`score-write.mjs:72`); `readRuns(store,{includePending})` (`query.mjs:77`). [VERIFIED: on-disk]

**Important store-scoping note:** `openExperimentStore` writes to `<repoRoot>/.data/experiments` using `CODING_REPO`/`opts.repoRoot` (`store.mjs:40-50`) — it is **repo-global, NOT sandbox-scoped**. That is correct and necessary: the span + token_usage rows are sandbox-scoped (via `LLM_PROXY_DATA_DIR`), but the **Run KB is shared across cells** so `readRuns` can serve the D-10 resume ledger across the whole matrix. The runner must NOT redirect the experiment store into the sandbox.

→ **Simplest wiring (recommended):** the runner triggers scoring by invoking `measurement-stop.mjs --headless` as a subprocess (with `LLM_PROXY_DATA_DIR`=sandbox). This reuses the entire shipped inline pipeline (foreground-token capture, fg/bg split, canonical attribution, fixture archive, non-GSD overlay) rather than re-deriving 300 lines of it.

### Unknown 5 — Timeout / terminal-state mechanics (RUN-03, D-04/D-06)

**No existing timed-kill exists for a *foreground driven agent*,** but three in-repo SIGTERM→SIGKILL analogs are the pattern template:
- `lib/vkb-server/server-manager.js:162-167` — `process.kill(pid,'SIGTERM')` → wait 1s → `process.kill(pid,'SIGKILL')`.
- `lib/service-starter.js:193-196` — same escalation.
- `scripts/health-coordinator.js:1768` — `setTimeout(()=>{try{child.kill()}catch{}},3000)` on a spawned child.
[VERIFIED: on-disk grep]

**Recommended terminal-state machine (Claude's Discretion, D-04/D-06):**
```
const child = spawn(bin, argv, { cwd: worktree, env: {...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir} });
let killedByTimer = false;
const t = setTimeout(() => { killedByTimer = true; child.kill('SIGTERM');
   setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, GRACE_MS); }, timeoutMs); // timeoutMs default 20*60_000 (D-06)
child.on('exit', (code, signal) => { clearTimeout(t);
   const state = killedByTimer ? 'timeout'
               : (code === 0 ? 'complete' : 'abort'); ... });
```
- **MUST use `spawn` (async), not `spawnSync`** — `spawnSync` blocks and cannot honor a wall-clock timer.
- Fixed argv only (no shell string) — CLAUDE.md constraint applies to the launch and the kill.
- `timeoutMs` overridable via a spec/CLI field (D-06). `mastracode` has a native `--timeout` (exit 2) but the runner should own the timer for uniform semantics across all four agents.
- **Gap R4:** `Run.metadata` has no terminal-state field. The runner must persist the enum (`complete`/`timeout`/`abort`) — suggest a `terminal_state` tag added to the `tags` object passed through to `writeRun`, or written by the runner immediately after `measurement-stop`. Exact enum wording is Claude's Discretion; recommend `complete | timeout | abort` to match D-04 verbatim.
- **Ordering:** the span must still be closed (measurement-stop) even on timeout/abort so the Run is recorded with its terminal state (D-04 "none silently dropped"). Close the span in a `finally` regardless of agent exit.

### Unknown 6 — Idempotent sequential matrix loop (SC#4, D-09/D-10)

**Resume ledger = query the Run-KB (D-10, no separate manifest needed).** `readRuns(store, {includePending})` (`query.mjs:77`) returns every Run's metadata. Because `writeRun` is already keyed on `metadata.task_id` (`run-write.mjs:64-72`) and re-close updates the same node, encoding `variant`+`repeat` into `task_id` makes "already-completed cell" a direct `readRuns` lookup:
```
const done = new Set((await readRuns(store, { includePending:true }))
                       .filter(r => r.terminal_state === 'complete')   // only completed cells skip
                       .map(r => r.task_id));
for (const cell of cells) for (let rep=0; rep<repeats; rep++) {
   const taskId = cellTaskId(expId, cell, rep);
   if (done.has(taskId)) continue;   // D-10 skip
   ... run cell ...
}
```
- Include `includePending:true` when building the done-set so a quarantined-but-completed Run is not re-run; but gate the skip on `terminal_state === 'complete'` (a prior `timeout`/`abort` cell should be retried on resume — planner's call on retry policy).
- **Sequential (D-09):** the experiment LevelDB store is single-owner (`store.mjs:28-31` "two CLIs must not run concurrently") — this independently forces sequential execution and is a second reason (beyond token-attribution cleanliness) that D-09 is correct.
- `task_hash` alone is insufficient (constant across the matrix — see Unknown 3), so the composite `task_id` is the real cell key.

## Architecture Patterns

### System Architecture Diagram

```
                         experiment spec (YAML)  ──resolveExperimentSpec──►  { goal_sentence, repeats, cells[] }
                                                                                        │
                                    ┌───────────────────────────────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────────────────────────────────────┐
                    │  experiment-runner.mjs  (sequential loop, D-09)                           │
                    │                                                                           │
   readRuns(store) ─┤ (1) resume ledger: skip cells whose task_id already completed (D-10)      │
                    │                                                                           │
   [copilot?] ──────┤ (2) RUN-04 probe once: `copilot -p "OK" --allow-all-tools` → bool         │
                    │                                                                           │
                    │ for each (cell × repeat):                                                 │
                    │   (3) restoreForCell(snapshot) ─► { worktree, sandboxDataDir, digest }    │
                    │   (4) measurement-start --task-id <enc(variant,repeat)> --agent…          │──► span.meta + active-measurement.json
                    │        (env LLM_PROXY_DATA_DIR = sandboxDataDir)                           │    (in sandbox .data)
                    │   (5) spawn <agent bin> -p "<goal>"  cwd=worktree                          │──► agent edits worktree;
                    │        under 20-min SIGTERM→SIGKILL timer (D-04/D-06)                      │    proxy token rows → sandbox .data
                    │        exit0=complete | timer=timeout | nonzero=abort                      │
                    │   (6) measurement-stop --headless  (env same LLM_PROXY_DATA_DIR)           │
                    │        └─ writeRun → gatherEvidence → runJudge → writeScore (inline D-11)  │──► one scored Run in
                    │   (7) record terminal_state (+ skip_reason for probe-failed copilot)       │    <repo>/.data/experiments (shared)
                    └─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                         one scored Run per variant×repeat cell  (consumed by Phase 79 CMP)
```

### Recommended Project Structure
```
lib/experiments/
├── experiment-runner.mjs     # NEW: pure orchestration (loop, terminal-state machine,
│                             #      probe, resume) with injectable seams (restore, spawn,
│                             #      measurementStop) for node:test unit coverage
└── agent-headless.mjs        # NEW (optional): agent→argv adapter table + AGENT_COMMAND
                              #      resolution (the ~10-line parse re-exposed from detector)
scripts/
└── experiment-run.mjs        # NEW: thin operator CLI (--spec <file> [--variant …] [--repeats N]
                              #      [--timeout <sec>]); mirrors measurement-start.mjs CLI style
tests/experiments/
└── experiment-runner.test.mjs # NEW: node:test, inject fake spawn/restore/stop
```

### Pattern 1: Injectable-seam orchestration (matches the repo's testability idiom)
**What:** the runner takes `{ restore = restoreForCell, spawnAgent = realSpawn, runMeasurementStop = realSubprocess, readDone = readRuns }` as injectable defaults, so unit tests exercise the loop/terminal-state logic without real agents or git worktrees.
**Why standard here:** `experiment-restore.mjs:169` already does exactly this (`restore = restoreSnapshot` injectable seam); `judge.mjs:289` injects `callProxy`; `measurement-start.mjs:90` injects `resolveSpec`. Follow the established pattern.

### Pattern 2: Reuse measurement-stop as the inline scorer
**What:** trigger scoring by running `measurement-stop.mjs --headless` as a subprocess, not by re-importing the scoring modules.
**Why:** the CLI already chains `writeRun`→`gatherEvidence`→`runJudge`→overlay→`writeScore` in one store lifecycle (`measurement-stop.mjs:471-502`); re-implementing risks drifting from the shipped attribution logic.

### Anti-Patterns to Avoid
- **Launching agents via `config/agents/*.sh` / `launch-agent-common.sh`.** Those go through `tmux_session_wrapper` (interactive). Spawn the resolved binary directly with its headless flag. (Risk R1.)
- **Using `AgentRegistry.getAdapter('claude'|'copilot')` to drive a run.** Those adapters are interactive MCP/HTTP shims (`agent-registry.js:63-64`), not headless drivers.
- **`spawnSync` for the agent launch.** Blocks the timer — a hung agent would stall the whole matrix (defeats D-06). Use async `spawn`.
- **Building any shell string for the launch, kill, or test_command.** Fixed argv only (CLAUDE.md; `SHELL_META_RE`).
- **Redirecting the experiment store into the sandbox.** The Run KB must stay repo-global for the cross-cell resume query (D-10).
- **Relying on `task_hash` to identify a cell.** It is constant across the matrix.
- **Using `bin/claude-mcp` for a headless claude turn.** Use the `claude` binary + `-p`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Snapshot restore into an isolated sandbox | A custom git-worktree + KB-hydrate routine | `restoreForCell` (`experiment-restore.mjs:168`) | Submodule reconstruction, dirty-patch apply, KB hydrate, determinism digest are all handled (Phase 67/77). |
| Token aggregation + canonical model attribution | A token-summing pass | `measurement-stop.mjs` pipeline | fg/bg split, sub-agent exclusion, Anthropic-direct bypass warning already implemented (`measurement-stop.mjs:350-408`). |
| LLM judging / 5-dim rubric | A judge prompt | `runJudge` (`judge.mjs:289`) | Never-throws quarantine, trivial-run short-circuit, in-code ratio, proxy-URL precedence all shipped. |
| Idempotent Run/Score write | putEntity bookkeeping | `writeRun`/`writeScore` | UUIDv7 minting, re-close node reuse, stable edge keys, strict-path ontology validation (`run-write.mjs`, `score-write.mjs`). |
| Resume ledger | A JSON manifest of completed cells | `readRuns` over the composite `task_id` | The Run KB is the single source of truth (D-10). A manifest would drift from the KB. |
| Test-command execution for scoring | A shell runner | `resolveTestCommand` + harness (`evidence-harness.mjs:245,278`) | Fixed-argv, shell-meta rejection, bounded timeout, TAP parsing already done (D-05). |

**Key insight:** the only genuinely net-new code is (a) the agent→headless-argv adapter table, (b) the spawn+timer terminal-state machine, (c) the copilot probe, (d) the sequential resume loop, and (e) three additive Run fields (`variant`, `repeat`, `terminal_state`, `skip_reason`). Everything else is a function call into shipped code.

## Runtime State Inventory

> This is a build-new-orchestrator phase, not a rename/refactor. Included only for the external state the runner touches.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Experiment Run KB at `<repo>/.data/experiments/` (LevelDB + exports/experiment.json). The runner appends Runs here via `writeRun`. Single-owner LevelDB. | None (append-only via shipped writer); ensure no concurrent opener (D-09). |
| Stored data | Per-cell sandbox worktrees + `.data` under `<repo>/.data/run-restores/<snapshot-id>-<ts>/` (created by `restoreForCell`). Accumulate across cells. | Planner should decide a cleanup policy for old sandboxes (out-of-scope for correctness, but disk grows N×repeats per run). |
| Stored data | Declare-time baseline snapshot under `<repo>/.data/run-snapshots/<task_id>/` (Phase 77 D-09). Consumed read-only by the runner. | None. |
| Live service config | rapid-llm-proxy on port 12435 must be up (judge's `/api/complete`; token rows). `mastra`/`opencode` route through it; `claude` calls Anthropic direct (bypass, warned at `measurement-stop.mjs:400-408`). | None — verified available at plan time; runner should pre-flight-check proxy health (copilot.sh/mastra.sh already probe `:12435/health`). |
| OS-registered state | None — the runner does not register launchd/tmux/cron state. (It deliberately does NOT use the tmux launcher.) | None — verified by design (D-01 rejects the interactive path). |
| Secrets/env vars | `LLM_PROXY_DATA_DIR` (set per-cell to sandbox), `CODING_REPO`, `ANTHROPIC_API_KEY` (opencode direct path), `COPILOT_ALLOW_ALL` (copilot non-interactive), `LLM_PROXY_DIST_DIR`. Code reads only; no key renamed. | None — set per-cell in the spawned env, never globally exported. |
| Build artifacts | None produced by this phase. Proxy dist at `_work/rapid-llm-proxy/dist` is consumed read-only by measurement-start/stop (`measurement-start.mjs:53-54`). | None. |

**Nothing found in OS-registered / build-artifact categories** — verified: the runner is a foreground orchestrator that spawns short-lived child processes and appends to the existing KB; it registers no persistent OS state.

## Common Pitfalls

### Pitfall 1: Cells indistinguishable because task_hash is constant
**What goes wrong:** using `task_hash` (or the shared `goal_sentence`) as the cell key → every cell collides → only one Run ever written, the rest overwrite it.
**Why:** `task_hash = sha256(goal_sentence)` and all cells share one goal (`measurement-stop.mjs:440`).
**How to avoid:** composite key = `task_hash + variant + repeat`, encoded into the per-cell `task_id` (the `writeRun` idempotency key). Persist explicit `variant`/`repeat` tags too.
**Warning sign:** `readRuns` returns 1 row after a multi-cell run.

### Pitfall 2: Hung agent stalls the matrix
**What goes wrong:** `spawnSync` (or no timer) lets a wedged agent block forever.
**Why:** headless agents can hang on auth prompts (mastra first-run), network, or an infinite tool loop.
**How to avoid:** async `spawn` + 20-min SIGTERM→SIGKILL (D-06); map timer-kill → `timeout`. Pre-flight the agent's auth (mastra needs prior OAuth — `mastra.sh:34-66`).
**Warning sign:** a cell exceeds its wall-clock with no exit.

### Pitfall 3: Copilot cell silently absent
**What goes wrong:** the spec gate throws copilot+headless at resolve, so copilot never runs and produces no Run — violating RUN-04's "never silently absent."
**Why:** `validateCells` hard-fails the combination (`experiment-spec.mjs:151-159`).
**How to avoid:** resolve the gate via the standalone probe (Open Question Q1) and, on skip, write an explicit skip-Run with `skip_reason` (Gap R3).
**Warning sign:** copilot in the spec but zero copilot Runs and no skip record.

### Pitfall 4: Terminal state lost on abort/timeout
**What goes wrong:** the runner returns early on a non-zero agent exit and never closes the span → no Run for that cell.
**Why:** measurement-stop is the only thing that materializes the Run.
**How to avoid:** always run measurement-stop in a `finally`, then stamp `terminal_state`.
**Warning sign:** fewer Runs than cells attempted.

### Pitfall 5: Concurrent store openers corrupt/deadlock LevelDB
**What goes wrong:** parallelizing cells → two `openExperimentStore` against one single-owner LevelDB.
**Why:** `store.mjs:28-31` — single-owner.
**How to avoid:** strictly sequential (D-09); measurement-stop opens+closes the store within each cell.

### Pitfall 6: `claude -p` cannot edit files (permission prompt in headless)
**What goes wrong:** claude runs read-only or stalls waiting for a permission decision that never comes in `-p` mode.
**Why:** default permission mode requires interactive approval for edits.
**How to avoid:** pass `--permission-mode acceptEdits` (or `--dangerously-skip-permissions` inside the sandbox, where blast radius is zero — D-02). Same class of flag for copilot (`--allow-all-tools`, required).
**Warning sign:** claude cell "completes" with an empty diff.

## Code Examples

### Resolve an agent's launch binary from its `.sh` (re-exposing the private parse)
```js
// Source: lib/agent-detector.js:23-39 (parseAgentConfig) — currently module-private.
// The runner needs a public equivalent (copy or export).
function agentBinary(agentName, agentsDir) {
  const content = fs.readFileSync(path.join(agentsDir, `${agentName}.sh`), 'utf8');
  const m = content.match(/^AGENT_COMMAND="?([^"\n]+)"?/m);
  return m ? m[1].trim() : null;  // e.g. claude→"$CODING_REPO/bin/claude-mcp" (use `claude` directly for -p)
}
```

### Per-cell headless launch under a timeout (terminal-state machine)
```js
// Pattern from vkb-server/server-manager.js:162-167 + health-coordinator.js:1768 (SIGTERM→SIGKILL).
import { spawn } from 'node:child_process';
function launchCell({ bin, argv, worktree, sandboxDataDir, timeoutMs = 20 * 60_000 }) {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, {               // fixed argv — never a shell string (CLAUDE.md)
      cwd: worktree,                                // D-02
      env: { ...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir }, // D-02
    });
    let killedByTimer = false;
    const t = setTimeout(() => {
      killedByTimer = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5_000);
    }, timeoutMs);                                   // D-06
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve(killedByTimer ? 'timeout' : (code === 0 ? 'complete' : 'abort')); // D-04
    });
  });
}
```

### Copilot capability probe (RUN-04)
```js
// Source: live `copilot --help` — `-p`/`--prompt` + `--allow-all-tools` (required for non-interactive).
import { spawnSync } from 'node:child_process';
function probeCopilotHeadless() {
  const r = spawnSync('copilot',
    ['-p', 'Reply with the single word OK and nothing else.', '--allow-all-tools'],
    { encoding: 'utf8', timeout: 90_000 });
  return !r.error && r.status === 0;   // D-07: trivial one-turn, assert exit 0
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copilot only drivable via interactive tmux + HTTP adapter (`copilot.sh`) | Copilot CLI ships first-class `-p/--prompt … --allow-all-tools` non-interactive mode | present in the installed build (probed 2026-07-03) | RUN-04 probe likely PASSES; the static `copilot+headless→unsupported` seed should be revisited. |
| Scoring as a later batch pass | Inline scoring inside `measurement-stop.mjs` (Phase 73/76) | shipped | D-11 is a call, not new code. |
| Time-window token attribution | Foreground-lineage capture + fg/bg split + canonical model (Phase 75 ATTR) | shipped | Sandbox-scoped `LLM_PROXY_DATA_DIR` gives clean per-cell attribution. |

**Deprecated/outdated for this phase:**
- The `AgentRegistry` claude/copilot adapters (`agent-registry.js:63-64`) — interactive shims, not headless drivers. Do not use for launch.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `claude -p` needs `--permission-mode acceptEdits`/`--dangerously-skip-permissions` to edit files headlessly. | Unknown 1 / Pitfall 6 | Cells "complete" with empty diffs; scores meaningless. **Verify with a one-cell smoke run.** |
| A2 | `mastracode` picks up `cwd` from the spawn process cwd (no `--dir` flag exists). | Unknown 1 | Mastra edits the wrong tree. Mastra is best-effort (D-12) so impact is bounded; verify in the probe/smoke. |
| A3 | Running `measurement-stop.mjs --headless` as a subprocess is an acceptable inline-scoring trigger (vs importing the modules). | Unknown 4 | If the runner needs `taskClass` control the CLI doesn't expose, it may need to import `writeRun`/`runJudge`/`writeScore` directly. |
| A4 | The RUN-04 probe result can bypass/override the resolve-time `copilot+headless` spec gate. | Unknown 2 / Q1 | If the gate cannot be bypassed, copilot cannot participate even when the probe passes — planner must decide the gate-resolution mechanism. |
| A5 | `opencode run "<msg>"` exits with a process code after one non-interactive turn (not a long-lived server). | Unknown 1 | If `run` streams/stays attached, the timer/exit mapping needs adjustment. `opencode serve` is the server mode; `run` is documented as message-mode. |
| A6 | Copilot's `-p` mode was probed via `--help` text, not an actual end-to-end edit run. | Unknown 2 | The probe (D-07) is exactly the empirical check that resolves this — it is the intended verification. |

## Open Questions (RESOLVED)

> All three resolved by the gsd-planner in the Phase 78 plan set (2026-07-03); resolutions verified by gsd-plan-checker.

1. **How does the RUN-04 probe interact with the resolve-time `copilot+headless` gate?** (See Unknown 2 / A4.)
   - What we know: `validateCells` hard-throws copilot+env:headless before run 0; the copilot CLI supports `-p`.
   - What's unclear: whether "headless" (the `env` axis label) is the same thing as the runner's always-headless drive mechanism, and whether the probe removes the gate entry or copilot runs under `env:default`.
   - Recommendation: run the probe standalone *before* spec resolution; on pass, drive copilot cells with `env:default` (so they pass validation) OR have the runner strip the matching `UNSUPPORTED_COMBINATIONS` entry. The planner should pick one and document it.
   - **RESOLVED (78-03):** Copilot variants are authored under `env: default` so `validateCells` passes **without mutating Phase-77's frozen `UNSUPPORTED_COMBINATIONS` table**. The one-turn probe runs **standalone before the matrix loop**, caches a boolean, and the probe alone gates run-vs-skip-Run. The runtime gate is never stripped at runtime.

2. **Where exactly do `variant`, `repeat`, `terminal_state`, `skip_reason` persist on the Run?** (Gaps R2/R3/R4.)
   - What we know: none exist today; `task_id` is the idempotency key and IS persisted.
   - Recommendation: encode variant+repeat into `task_id` for idempotency, AND add explicit tags via the `tags` object into `writeRun` (which passes `tags` straight into `Run.metadata`) — this needs a tiny additive change to the `tags` allow-list in `run-write.mjs:94-129`, or the runner writing these via a post-close update. Planner decides: extend `writeRun`'s tag set vs. a runner-side metadata patch.
   - **RESOLVED (78-01 + 78-03):** Both mechanisms. 78-01 extends the `writeRun` tag allow-list (`run-write.mjs:100-128`) with `variant`/`repeat`/`terminal_state`/`skip_reason` (`?? null` idiom) and threads them via new `measurement-start/stop` seam flags (`--repeat`/`--terminal-state`/`--skip-reason`) — no fragile runner-side re-close/metadata patch. 78-03 additionally bakes `variant`+`repeat` into the composite `task_id = <expId>--<variant>--r<rep>` so cells are the idempotency key.

3. **Retry policy for a resumed `timeout`/`abort` cell.** Skip only `complete` cells (recommended) so failed cells retry, or skip any recorded cell? Affects the D-10 done-set filter.
   - **RESOLVED (78-03):** Resume skips **only** cells whose Run has `terminal_state === 'complete'`; `timeout`/`abort`/unscored cells are retried on re-run.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | RUN-02 (required agent, D-12) | ✓ | 2.1.191 | none — blocking if absent |
| `opencode` CLI | RUN-02 (required agent, D-12) | ✓ | 1.15.13 | none — blocking if absent |
| `mastracode` CLI | RUN-02 (best-effort, D-12) | ✓ | installed (`--version` reads stdin quirk) | recorded-skip (D-12 best-effort) |
| `copilot` CLI | RUN-04 (probe-gated) | ✓ | installed | recorded-skip on probe fail (D-08) |
| `node` | runner + all scripts | ✓ | (repo node) | none |
| rapid-llm-proxy `:12435` | inline judge `/api/complete`; token rows | ✓ (per CLAUDE.md ops) | — | judge quarantines to `pending` if unreachable (`judge.mjs:315-321`) — Runs still land, unscored |
| proxy dist `_work/rapid-llm-proxy/dist` | measurement-start/stop span surface | ✓ | — | none — measurement-start/stop import it |
| git | worktree restore | ✓ | — | none |
| km-core (`@fwornle/km-core`) | experiment store + writeRun/writeScore | ✓ (node_modules) | — | none |

**Missing dependencies with no fallback:** none detected at research time — all four agent binaries + node + git + km-core are present.
**Missing dependencies with fallback:** if the proxy is down, judging degrades to `pending` (Runs still recorded); mastra/copilot degrade to recorded-skip. Both are honest, non-blocking.

## Validation Architecture

> `workflow.nyquist_validation` is absent in `.planning/config.json` → treated as enabled. `research_enabled` is false, so no VALIDATION.md auto-generates — this section is **advisory** for the planner's acceptance criteria.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (the `lib/experiments/*` convention — every `tests/experiments/*.test.mjs` uses `import { test } from 'node:test'`) |
| Config file | none — run positionally |
| Quick run command | `node --test tests/experiments/experiment-runner.test.mjs` |
| Full suite command | `node --test tests/experiments` |
| Note | Top-level `npm test` is **jest** (`package.json`), but the experiments module is `node:test`. The per-variant `test_command` example is `node --test tests/experiments` (`config/experiments/example-experiment.yaml:37`). Use `node:test` for this phase's own tests. |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| RUN-02 | Adapter emits correct fixed-argv per agent | unit | `node --test tests/experiments/experiment-runner.test.mjs` | ❌ Wave 0 |
| RUN-02 | Agent spawned with cwd=worktree, env LLM_PROXY_DATA_DIR=sandbox | unit (fake spawn seam) | same | ❌ Wave 0 |
| RUN-03 | exit0→complete, timer→timeout, nonzero→abort | unit (fake child) | same | ❌ Wave 0 |
| RUN-03 | measurement-stop runs in finally even on abort | unit | same | ❌ Wave 0 |
| RUN-04 | probe success/failure → run vs recorded-skip | unit (fake spawnSync) | same | ❌ Wave 0 |
| D-10 | completed cell (by composite task_id) is skipped on re-run | unit (fake readRuns) | same | ❌ Wave 0 |
| SC#4 | exactly one Run per variant×repeat | integration (stubbed agent = `node -e process.exit(0)`) | `node --test tests/experiments/experiment-runner.integration.test.mjs` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test tests/experiments/experiment-runner.test.mjs`
- **Per wave merge:** `node --test tests/experiments`
- **Phase gate:** full experiments suite green + one live one-cell smoke (real `claude -p` against a trivial goal in a sandbox) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/experiments/experiment-runner.test.mjs` — covers RUN-02/03/04, D-10 (injected seams).
- [ ] `tests/experiments/experiment-runner.integration.test.mjs` — SC#4 with a stub agent binary (`node -e "process.exit(0)"`).
- [ ] A stub-agent fixture (a tiny script that exits 0 / hangs / exits non-zero on demand) for terminal-state tests.

## Security Domain

> `security_enforcement` is null in config → treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (agent CLIs hold their own OAuth/keys; runner sets none) | — |
| V4 Access Control | yes | Agent confined to the sandbox worktree (cwd) + sandbox `.data` (D-02); `restoreForCell` is `inPlace:false` (zero blast radius, T-77-08). |
| V5 Input Validation | yes | `goal_sentence`/`test_command` come from a validated spec (`experiment-spec.mjs`); `test_command` rejected on `SHELL_META_RE` (`evidence-harness.mjs:250`). |
| V6 Cryptography | no (only sha256 for task_hash/digest — no secrets crypto) | — |
| V12 Files/Resources | yes | Fixed-argv spawn (no shell), no path interpolation from untrusted input; sandbox path from the rig's `sanitizeTaskId`. |

### Known Threat Patterns for {headless agent orchestration}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via prompt/test_command/agent flags | Tampering | Fixed argv array only, never a shell string; `SHELL_META_RE` guard on `test_command`; `goal_sentence` passed as a single argv element (CLAUDE.md constraint-dodging-forbidden applies to the launch + kill). |
| Autonomous agent escaping the sandbox | Elevation of Privilege | cwd + `LLM_PROXY_DATA_DIR` pinned to the isolated worktree; `--dangerously-skip-permissions`/`--allow-all-tools` are acceptable **only because** the worktree is a throwaway sandbox (D-02) — never run these against the live checkout. |
| Hung/rogue agent denial-of-service | Denial of Service | 20-min SIGTERM→SIGKILL wall-clock (D-06); sequential execution bounds concurrent damage. |
| Token/route rows leaking into the live KB | Information Disclosure | `LLM_PROXY_DATA_DIR`=sandbox routes all proxy rows into the cell's `.data`, never the live `.data`. |

## Sources

### Primary (HIGH confidence) — on-disk code (this session)
- `config/agents/{claude,opencode,mastra,copilot}.sh` — launch metadata; interactive-tmux path.
- `scripts/launch-agent-common.sh:592-595` — tmux launch (proves `.sh` are not headless).
- `lib/agent-detector.js:23-39` — `AGENT_COMMAND` parse (module-private).
- `lib/agent-registry.js:63-64` — registered interactive adapters.
- `lib/experiments/experiment-spec.mjs:65-71,151-159` — copilot+headless gate.
- `scripts/measurement-start.mjs:90-165,178-243` — span open + `buildVariantMeta` (variant dropped :156-157).
- `scripts/measurement-stop.mjs:215-535` — inline scorer; tags :443-454; task_hash :440.
- `lib/experiments/experiment-restore.mjs:168-193` — `restoreForCell` return shape.
- `lib/repro/restore-snapshot.mjs:244-324` — sandbox worktree + `.data` layout.
- `lib/experiments/run-write.mjs:51-129` — `writeRun` idempotency + tag set.
- `lib/experiments/query.mjs:77-119` — `readRuns` resume-ledger source.
- `lib/experiments/judge.mjs:289-322` / `score-write.mjs:72-181` / `store.mjs:40-54` / `evidence-harness.mjs:245-266`.
- `lib/vkb-server/server-manager.js:162-167`, `lib/service-starter.js:193-196`, `scripts/health-coordinator.js:1768` — SIGTERM→SIGKILL analogs.

### Primary (HIGH confidence) — live `--help` probes (2026-07-03)
- `claude --help` (v2.1.191): `-p/--print`, `--model`, `--add-dir`, `--permission-mode`, `--dangerously-skip-permissions`.
- `opencode run --help` (v1.15.13): `run [message..]`, `-m/--model`, `--dir`, `--agent`, `--format json`.
- `mastracode --help`: `--prompt/-p`, `-m/--model`, `--mode`, `--output-format`, `--timeout`, documented exit codes 0/1/2.
- `copilot --help`: `-p/--prompt` (non-interactive, exits after completion), `--allow-all-tools` (required), `-C <dir>`, `--model`.

### Secondary (MEDIUM confidence)
- CLAUDE.md / MEMORY — proxy port 12435, fixed-argv rule, submodule build pipeline, copilot per-prompt-injection prior signal.

## Metadata

**Confidence breakdown:**
- Standard stack (in-repo modules): HIGH — signatures quoted from source.
- Headless invocations: HIGH — live `--help` on installed binaries.
- Copilot drivability: MEDIUM-HIGH — `-p` documented + installed; end-to-end pass is what the RUN-04 probe empirically settles.
- Idempotency/terminal-state gaps: HIGH — confirmed absent by grep + source read.
- Gate-vs-probe interaction (Q1): MEDIUM — a genuine design choice the planner must make.

**Research date:** 2026-07-03
**Valid until:** ~2026-08-03 for in-repo modules (stable); ~7 days for the agent-CLI flag surface (fast-moving CLIs — re-probe `--help` if a binary is upgraded before planning).

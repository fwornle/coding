---
phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight
plan: 02
type: execute
wave: 2
depends_on: [88-01]
files_modified:
  - lib/experiments/agent-headless.mjs
  - lib/experiments/experiment-runner.mjs
  - tests/experiments/agent-headless.test.mjs
  - tests/experiments/experiment-runner.test.mjs
autonomous: true
requirements: [PREFLIGHT-01, SUPPRESS-01]
must_haves:
  truths:
    - "Before a cell burns its run, a per-agent pre-flight validates the cell's routing env + resolved model with a bounded one-token round-trip"
    - "A cell that fails pre-flight lands a clean recorded skipped:<reason> Run UP FRONT (never a mid-run abort, never a hard required-agent failure)"
    - "The pre-flight is fail-soft and bounded — a hung probe skips that variant rather than hanging the matrix"
    - "The pre-flight probe invocation creates NO row in the experiment's Runs view (non-measured)"
  artifacts:
    - path: "lib/experiments/agent-headless.mjs"
      provides: "preflightAgent(agent, {env, model, spawn, timeoutMs}) — the generalized per-agent one-token round-trip"
      exports: ["preflightAgent"]
  key_links:
    - from: "lib/experiments/experiment-runner.mjs"
      to: "lib/experiments/agent-headless.mjs"
      via: "runMatrix runs preflightAgent per cell under the cell's routing env before launch; failure → writeSkipRun"
      pattern: "preflightAgent"
    - from: "runMatrix pre-flight skip"
      to: "writeSkipRun"
      via: "recorded skip-Run with a preflight:<reason> skip_reason (the RUN-04 recorded-skip path)"
      pattern: "writeSkipRun|skip_reason"
---

<objective>
Add a per-agent PRE-FLIGHT validation gate that runs BEFORE a cell launches its real agent: proxy
reachable + the cell's resolved model id round-trips one token under the SAME routing env the cell
will use. On failure, record a clean per-variant `skipped:<reason>` Run up front via the existing
RUN-04 recorded-skip path (a recorded skip is explicitly NOT a matrix failure) — never a mid-run
abort, never a hard required-agent error. The gate generalizes the copilot-only `probeCopilotHeadless`
into a bounded, fail-soft per-agent probe, and the probe invocation itself must not create a Runs row.

Purpose: turn today's silent one-horse race (opencode aborts, copilot 500s mid-run) into an
observable, up-front, per-variant run-or-clean-skip decision.
Output: `preflightAgent` in agent-headless.mjs, wired into runMatrix's per-cell loop, with the probe
tagged non-measured so it never binds an auto-measurement span.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-CONTEXT.md
@.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-01-agent-invocation-routing-alignment-PLAN.md

<interfaces>
From lib/experiments/agent-headless.mjs (existing — the RUN-04 probe to generalize):
export function probeCopilotHeadless({ spawn }): boolean   // bare-env one-turn copilot check, 90s bounded, fail-soft
const COPILOT_PROBE_TIMEOUT_MS = 90_000
const COPILOT_PROBE_PROMPT = 'Reply with the single word OK and nothing else.'

From lib/experiments/experiment-runner.mjs:
export function cellName(cell): string
export function composeTaskId(expId, cell, rep): string
// writeSkipRun({cell, rep, expId, goal, taskClass, skipReason, runMeasurement})  — module-private RUN-04 recorded skip
// runMatrix loop (~763-836): copilot probe gate at ~757; per-cell runCell at ~812
// COPILOT_SKIP_REASON = 'copilot-headless-unsupported'

From lib/experiments/agent-routing.mjs (Plan 01):
export function resolveCellModel(agent, specModel): string
export function buildAgentRoutingEnv(agent, baseEnv, {taskId, model, port}): object

From scripts/auto-measure-foreground.mjs (ambient exclusion ALREADY present — read, don't duplicate):
// ambient passes enumerate only UUID-shaped task_ids and explicitly EXCLUDE '<expId>--<variant>--rN'
// experiment-cell ids (task_id NOT LIKE '%--%'), so experiment cells are already separated from ambient.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Generalize the probe into preflightAgent — bounded, fail-soft, non-measured</name>
  <read_first>
    - lib/experiments/agent-headless.mjs (probeCopilotHeadless lines ~166-195; COPILOT_PROBE_* constants; argvForAgent lines ~86-114)
    - lib/experiments/agent-routing.mjs (resolveCellModel — Plan 01)
    - tests/experiments/agent-headless.test.mjs (probe test shape — pass/fail/error via injected spawn seam)
    - CLAUDE.md (km-core LLM proxy endpoint :12435 /api/complete — the round-trip contract; body {process, messages, taskType?})
  </read_first>
  <behavior>
    - preflightAgent('copilot', {env, model:'claude-haiku-4-5', spawn:okStub}) → {ok:true}
    - preflightAgent('opencode', {env, model:'anthropic/claude-haiku-4.5', spawn:err500Stub}) → {ok:false, reason:'preflight:<agent>-model-or-route (…)'}
    - a spawn that times out / ENOENTs (res.error set) → {ok:false, reason:'preflight:<agent>-unreachable'} (NEVER throws)
    - the probe spawn is invoked with a NON-MEASURED marker in env (COPILOT_AMBIENT_ROUTE='0' for copilot + a EXPERIMENT_PREFLIGHT='1' sentinel) so no auto-measurement binds it
    - the probe uses a bounded timeout (reuse/rename COPILOT_PROBE_TIMEOUT_MS as PREFLIGHT_TIMEOUT_MS, 90s) and a trivial one-token prompt
  </behavior>
  <action>
    In lib/experiments/agent-headless.mjs, add `export function preflightAgent(agent, { env, model, spawn = spawnSync,
    timeoutMs = PREFLIGHT_TIMEOUT_MS } = {})` returning `{ ok: boolean, reason?: string }`. It spawns the agent's OWN
    one-token invocation — the trivial `COPILOT_PROBE_PROMPT` goal via `argvForAgent(agent, prompt, { model })` (so the
    check hits the SAME CLI + resolved model + routing env the cell will use, which is exactly why the bare-env
    probeCopilotHeadless missed the model failures) — under the passed `env`, with a bounded `timeoutMs`. Map results:
    `r.error` (ENOENT/timeout) → `{ ok:false, reason:'preflight:'+agent+'-unreachable' }`; `r.status !== 0` →
    `{ ok:false, reason:'preflight:'+agent+'-model-or-route (exit '+r.status+')' }`; else `{ ok:true }`. NEVER throw
    (defensive try/catch → ok:false, mirrors probeCopilotHeadless). Before spawning, clone `env` and stamp the
    NON-MEASURED markers: `EXPERIMENT_PREFLIGHT='1'` and (for copilot) `COPILOT_AMBIENT_ROUTE='0'` + drop
    `COPILOT_PROVIDER_BASE_URL`/`COPILOT_PROVIDER_*` if present, so the probe copilot session is copadt-only-suppressed
    and never wire-bound to a measured span (parity with copilot.sh's interactive-suppression rationale). Keep
    probeCopilotHeadless exported for backward-compat (delegate it to preflightAgent('copilot', {env:{},...}) or leave
    as-is — do not break its test). Rename the timeout constant to PREFLIGHT_TIMEOUT_MS (keep the 90s value). Author
    the node:test cases FIRST (RED) with an injected `spawn` stub returning status 0 / status 1 / {error} shapes,
    asserting the ok/reason mapping AND that the env handed to the stub carries EXPERIMENT_PREFLIGHT='1'.
  </action>
  <verify>
    <automated>node --test tests/experiments/agent-headless.test.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `node --test tests/experiments/agent-headless.test.mjs` exits 0 including the new preflightAgent pass/fail/error cases
    - `grep -nE "export function preflightAgent" lib/experiments/agent-headless.mjs` matches
    - A test asserts the injected spawn receives an env with `EXPERIMENT_PREFLIGHT === '1'` (non-measured marker)
    - preflightAgent never throws: a stub whose spawn throws still yields `{ ok:false }` (asserted)
    - `grep -n "PREFLIGHT_TIMEOUT_MS" lib/experiments/agent-headless.mjs` shows the bounded timeout constant in use
  </acceptance_criteria>
  <done>preflightAgent runs a bounded, fail-soft, non-measured one-token round-trip per agent under the cell's routing env and returns a structured ok/reason.</done>
</task>

<task type="auto">
  <name>Task 2: Wire the pre-flight gate into runMatrix — clean recorded skip on failure</name>
  <read_first>
    - lib/experiments/experiment-runner.mjs (runMatrix loop lines ~763-836; writeSkipRun lines ~664-684; COPILOT_SKIP_REASON ~652; configureProxyRoutingEnv gate; runCell agentEnv build ~593-602)
    - lib/experiments/agent-headless.mjs (preflightAgent — Task 1)
    - lib/experiments/agent-routing.mjs (resolveCellModel, buildAgentRoutingEnv — Plan 01)
    - scripts/experiment-run.mjs (REQUIRED_AGENTS exit-code logic lines ~336-351 — a skip must NOT count as a required-agent failure)
    - tests/experiments/experiment-runner.test.mjs (runMatrix skip-Run + probe-gate tests ~Task 3 section)
  </read_first>
  <action>
    In runMatrix (experiment-runner.mjs), between the resume-skip check and the runCell call for EACH cell, run the
    per-agent pre-flight. Build the SAME routing env the cell will launch under: resolve
    `launchModel = resolveCellModel(cell.agent, cell.model)`, build `agentBaseEnv = { ...process.env, LLM_PROXY_DATA_DIR: <cell sandbox or main> }`
    (reuse runCell's env-construction contract; for the pre-flight a sandbox is not required — use a routing env from
    `configureRouting(cell.agent, {...process.env}, { port, taskId, model: launchModel })`), then call
    `preflightAgent(cell.agent, { env, model: launchModel, timeoutMs: PREFLIGHT_TIMEOUT_MS })`. Inject it as a new
    seam `preflight = preflightAgent` on runMatrix opts (so tests stub it). If `!ok`: call the EXISTING `writeSkipRun`
    with `skipReason = res.reason` (a `preflight:<agent>-…` string), push a summary entry
    `{ status:'skipped', reason: res.reason }`, emit progress `state:'skipped'`, `continue` — NO runCell, NO agent
    launch, NO mid-run abort. Fold the existing copilot drivability probe into this same gate: keep the once-per-matrix
    `probeCopilot()` for copilot cells (D-08) OR subsume it under the per-cell preflight — choose subsumption ONLY if
    the copilot skip_reason stays `copilot-headless-unsupported`-compatible for the RUN-04 contract; otherwise run BOTH
    (probe first, then preflight) and record whichever fails. Preserve byte-identical behavior when the injected
    `preflight` seam reports ok for every cell (existing tests must pass). Add runMatrix tests: (a) a cell whose
    preflight returns `{ok:false, reason}` lands a recorded skip-Run (writeSkipRun seam called) and NO runCell; (b)
    the skipped cell's summary `status:'skipped'` so scripts/experiment-run.mjs does NOT exit non-zero for it (assert
    the REQUIRED_AGENTS filter treats a `status:'skipped'` opencode cell as non-failing).
  </action>
  <verify>
    <automated>node --test tests/experiments/experiment-runner.test.mjs tests/experiments/experiment-runner.integration.test.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `node --test tests/experiments/experiment-runner.test.mjs` exits 0 with the new preflight-skip cases green
    - `grep -nE "preflight(Agent)?" lib/experiments/experiment-runner.mjs` shows the gate imported, injected as a seam, and called per cell before runCell
    - A test proves a failing preflight → writeSkipRun invoked + runCell (spawnAgent seam) NOT invoked for that cell
    - A test proves the resulting summary entry has `status:'skipped'` (so scripts/experiment-run.mjs's REQUIRED_AGENTS filter — which only counts `status:'ran'` non-complete cells — does not fail the run)
    - When the injected `preflight` seam returns ok for all cells, every prior runMatrix test still passes (byte-identical happy path)
    - `grep -n "preflight:" lib/experiments/experiment-runner.mjs` or the test shows the skip_reason carries a diagnosable `preflight:<agent>-…` string (never a bare abort)
  </acceptance_criteria>
  <done>runMatrix pre-flights each cell under its real routing env; a failure records a clean up-front skip via the RUN-04 path and never fails a required-agent cell or aborts mid-run; the happy path is unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| pre-flight subprocess → shared host proxy | a one-token probe crosses to the proxy under the cell's routing env |
| probe session → auto-measurement daemon | the probe must NOT be conflated with a measured cell |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-88-02-01 | DoS | preflightAgent hung probe | mitigate | bounded PREFLIGHT_TIMEOUT_MS (90s) + fail-soft return {ok:false}; a hung probe skips that variant, never hangs the matrix |
| T-88-02-02 | Injection | probe argv | mitigate | fixed-argv via argvForAgent (goal is a single element); child_process shell option never set |
| T-88-02-03 | Spoofing | probe session mis-attributed as a measured cell | mitigate | EXPERIMENT_PREFLIGHT='1' + COPILOT_AMBIENT_ROUTE='0' non-measured markers; experiment cells already excluded from ambient passes by task_id shape (auto-measure-foreground.mjs) |
| T-88-02-SC | Tampering | npm/pip/cargo installs | accept | NO package installs — pure JS over existing deps |
</threat_model>

<verification>
- `node --test tests/experiments/agent-headless.test.mjs tests/experiments/experiment-runner.test.mjs tests/experiments/experiment-runner.integration.test.mjs` all green
- A failing preflight yields a recorded skip (not an abort, not a required-agent failure)
- The probe env carries the non-measured marker
</verification>

<success_criteria>
- Every cell is pre-flighted under its real routing env before it burns a run
- A pre-flight failure → clean up-front recorded skip:<reason>, never a mid-run abort or a hard required-agent error
- The pre-flight probe never creates a Runs-view row and never hangs the matrix
</success_criteria>

<output>
Create `.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-02-SUMMARY.md` when done
</output>

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
    - "Before a cell burns its run, a per-agent pre-flight validates the proxy is reachable AND the cell's RESOLVED model round-trips one token against the agent's target provider via POST /api/complete"
    - "A cell that fails pre-flight lands a clean recorded skipped:<reason> Run UP FRONT (never a mid-run abort, never a hard required-agent failure)"
    - "The pre-flight is fail-soft and bounded — a hung/errored round-trip skips that variant rather than hanging the matrix"
    - "The pre-flight round-trip goes through POST /api/complete (NO agent CLI session), so it creates NO experiment Run and NO ambient-pass session — its token_usage row lands neutral (task_id='', process='experiment-preflight'), excluded from every Runs query by construction"
  artifacts:
    - path: "lib/experiments/agent-headless.mjs"
      provides: "preflightAgent(agent, {model, port, fetchImpl, timeoutMs}) — bounded HTTP one-token round-trip via /api/complete"
      exports: ["preflightAgent"]
  key_links:
    - from: "lib/experiments/agent-headless.mjs"
      to: "http://127.0.0.1:12435/api/complete"
      via: "preflightAgent POSTs {process:'experiment-preflight', provider:<agent>, model:<resolved>, messages}"
      pattern: "/api/complete"
    - from: "lib/experiments/experiment-runner.mjs"
      to: "lib/experiments/agent-headless.mjs"
      via: "runMatrix runs preflightAgent per cell (resolved model, no taskId) before launch; failure → writeSkipRun"
      pattern: "preflightAgent"
---

<objective>
Add a per-agent PRE-FLIGHT validation gate that runs BEFORE a cell launches its real agent: the proxy
is reachable AND the cell's RESOLVED model round-trips one token against that agent's target provider.
On failure, record a clean per-variant `skipped:<reason>` Run up front via the existing RUN-04
recorded-skip path (a recorded skip is explicitly NOT a matrix failure) — never a mid-run abort, never
a hard required-agent error.

The pre-flight is a bounded, fail-soft `POST /api/complete` round-trip (NOT an agent-CLI spawn). This
was proven live (2026-07-22): `{provider:copilot, model:'auto'}` → HTTP 500 "The requested model is not
supported" (the exact original failure), while the resolved `claude-haiku-4-5` → HTTP 200, 18 tokens.
Because it is a plain proxy call with no agent CLI session, it creates NO `~/.copilot`/opencode
session-state dir and its token_usage row lands neutral (`task_id=''`, `process='experiment-preflight'`
— verified), so it appears in NO experiment Run and NO ambient auto-measure pass BY CONSTRUCTION. This
replaces the earlier plan's non-existent `EXPERIMENT_PREFLIGHT` env sentinel (which had no consumer)
and the leaky bare-env `copilot -p` probe with a real, wired mechanism — no proxy code change required.

Purpose: turn today's silent one-horse race (opencode aborts, copilot 500s mid-run) into an
observable, up-front, per-variant run-or-clean-skip decision.
Output: `preflightAgent` in agent-headless.mjs, wired into runMatrix's per-cell loop.
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
Live-verified /api/complete contract (2026-07-22, proxy build 75c02cf on :12435; CLAUDE.md):
  POST http://127.0.0.1:12435/api/complete
  body  { process, messages:[{role,content}], provider?, model?, subscription? }
  200 → { content, provider, model, tokens:{input,output,total,...}, latencyMs }
  bad model → HTTP 500 { error:"Copilot API error (400): The requested model is not supported.", type:"API_ERROR" }
  Agent→provider for the round-trip:
    copilot  → provider:'copilot', model:<resolved> (e.g. claude-haiku-4-5 → 200; auto → 500)
    claude   → provider:'claude-code', model:<resolved> (e.g. sonnet)
    opencode → NO provider (auto-route); model = <resolved> with the 'rapid-proxy/' prefix STRIPPED to the
               bare id (e.g. claude-haiku-4.5) — the proxy serves it via claude-code (verified: 200, 15 tokens)
  A preflight token_usage row lands process='experiment-preflight', task_id='' (verified) → excluded from Runs.

From lib/experiments/agent-headless.mjs (existing):
export function probeCopilotHeadless({ spawn }): boolean   // legacy bare-env copilot -p spawn — KEEP exported for
  // backward-compat, but STOP using it in the runMatrix gate (it creates a ~/.copilot session → ambient Run leak).
const COPILOT_PROBE_TIMEOUT_MS = 90_000

From lib/experiments/experiment-runner.mjs:
export function cellName(cell): string
export function composeTaskId(expId, cell, rep): string
export async function configureProxyRoutingEnv(agent, baseEnv, {port, probe, route, taskId, model}): Promise<object>
// writeSkipRun({cell, rep, expId, goal, taskClass, skipReason, runMeasurement}) — module-private RUN-04 recorded skip
// runMatrix loop (~763-836): copilot probe gate at ~757; per-cell runCell at ~812
// COPILOT_SKIP_REASON = 'copilot-headless-unsupported'

From lib/experiments/agent-routing.mjs (Plan 01):
export function resolveCellModel(agent, specModel): string

From scripts/auto-measure-foreground.mjs (why /api/complete is leak-free — read, don't change):
// copilotPass enumerates ~/.copilot/session-state/<uuid> dirs; opencode/claude passes key on session dirs /
// UUID-shaped task_ids. A /api/complete call creates NO such dir and its row has task_id='' → NO Run.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: preflightAgent — bounded, fail-soft HTTP round-trip via /api/complete (no agent session)</name>
  <read_first>
    - lib/experiments/agent-headless.mjs (probeCopilotHeadless lines ~166-195; COPILOT_PROBE_* constants — the fail-soft/timeout pattern to mirror)
    - lib/experiments/agent-routing.mjs (resolveCellModel — Plan 01; the caller passes an ALREADY-resolved model)
    - CLAUDE.md (km-core LLM proxy endpoint :12435 /api/complete — body {process, messages, provider?, model?}; response {content, provider, model, tokens})
    - scripts/auto-measure-foreground.mjs (copilotPass/opencode/claude enumeration — proof /api/complete rows never become Runs)
  </read_first>
  <behavior>
    - preflightAgent('copilot', {model:'claude-haiku-4-5', fetchImpl:okStub}) → {ok:true}   (okStub returns 200 {tokens:{total:18}})
    - preflightAgent('copilot', {model:'auto', fetchImpl:stub500}) → {ok:false, reason:'preflight:copilot-model-or-route (HTTP 500)'}
    - preflightAgent('opencode', {model:'rapid-proxy/claude-haiku-4.5', fetchImpl:okStub}) → {ok:true} AND the stub received body.model==='claude-haiku-4.5' (prefix stripped) with NO body.provider (auto-route)
    - preflightAgent('claude', {model:'sonnet', fetchImpl:okStub}) → {ok:true} AND body.provider==='claude-code'
    - a fetch that rejects / AbortController-times-out → {ok:false, reason:'preflight:<agent>-unreachable'} (NEVER throws)
    - the posted body carries process:'experiment-preflight' and NO task_id (so the row is neutral → no Run)
    - the request is bounded by timeoutMs (AbortController); default PREFLIGHT_TIMEOUT_MS (reuse the 90s constant value)
  </behavior>
  <action>
    In lib/experiments/agent-headless.mjs, add `export async function preflightAgent(agent, { model, port =
    Number(process.env.LLM_PROXY_PORT) || 12435, fetchImpl = fetch, timeoutMs = PREFLIGHT_TIMEOUT_MS } = {})`
    returning `{ ok: boolean, reason?: string }`. Build the /api/complete body: `process:'experiment-preflight'`,
    `messages:[{ role:'user', content:'Reply with the single word OK.' }]`, and the agent→provider/model mapping from
    the interfaces block — copilot: `{ provider:'copilot', model }`; claude: `{ provider:'claude-code', model }`;
    opencode: `{ model: model.replace(/^rapid-proxy\//,'') }` (strip the provider prefix → bare id, NO provider so
    the proxy auto-routes exactly as opencode's rapid-proxy openai-compatible path does); mastracode/unknown: return
    `{ ok:true }` without a call (out of the 3-agent scope this phase). POST to
    `http://127.0.0.1:${port}/api/complete` with `fetchImpl`, an AbortController armed at `timeoutMs`, and
    `content-type: application/json`. Map results: a rejected/aborted fetch → `{ ok:false,
    reason:'preflight:'+agent+'-unreachable' }`; a non-2xx response → `{ ok:false,
    reason:'preflight:'+agent+'-model-or-route (HTTP '+status+')' }`; a 2xx → `{ ok:true }`. Wrap the whole body in
    try/catch so it NEVER throws (mirrors probeCopilotHeadless's fail-soft contract); clear the abort timer in a
    finally. Add/keep `PREFLIGHT_TIMEOUT_MS` (reuse the 90s value; you may alias the existing COPILOT_PROBE_TIMEOUT_MS
    or rename it). Do NOT spawn any agent CLI and do NOT set any `EXPERIMENT_PREFLIGHT` env var (removed — it had no
    consumer). Keep `probeCopilotHeadless` exported unchanged for backward-compat but it is NOT used by the new gate.
    Author the node:test cases FIRST (RED) with an injected `fetchImpl` stub returning 200/500/reject shapes,
    asserting the ok/reason mapping, the posted body (process, provider, stripped opencode model, no task_id), and
    fail-soft-never-throws.
  </action>
  <verify>
    <automated>node --test tests/experiments/agent-headless.test.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `node --test tests/experiments/agent-headless.test.mjs` exits 0 including the new preflightAgent 200/500/reject cases
    - `grep -nE "export async function preflightAgent" lib/experiments/agent-headless.mjs` matches
    - `grep -n "/api/complete" lib/experiments/agent-headless.mjs` shows the round-trip target (NOT an agent CLI spawn)
    - `grep -c "EXPERIMENT_PREFLIGHT" lib/experiments/agent-headless.mjs lib/experiments/experiment-runner.mjs` returns 0 for both (the fake sentinel is gone from all claims/code)
    - A test asserts the posted body has `process==='experiment-preflight'` and NO `task_id`, and that the opencode body.model has the `rapid-proxy/` prefix stripped
    - preflightAgent never throws: a fetchImpl that rejects yields `{ ok:false, reason:/unreachable/ }` (asserted)
  </acceptance_criteria>
  <done>preflightAgent runs a bounded, fail-soft, session-free /api/complete round-trip per agent with the resolved model and returns a structured ok/reason; no fake sentinel; no leaky agent spawn.</done>
</task>

<task type="auto">
  <name>Task 2: Wire the pre-flight gate into runMatrix — clean recorded skip on failure</name>
  <read_first>
    - lib/experiments/experiment-runner.mjs (runMatrix loop lines ~763-836; writeSkipRun lines ~664-684; COPILOT_SKIP_REASON ~652; the once-per-matrix probeCopilot() gate ~757-761)
    - lib/experiments/agent-headless.mjs (preflightAgent — Task 1)
    - lib/experiments/agent-routing.mjs (resolveCellModel — Plan 01)
    - scripts/experiment-run.mjs (REQUIRED_AGENTS exit-code logic lines ~336-351 — a `status:'skipped'` must NOT count as a required-agent failure)
    - tests/experiments/experiment-runner.test.mjs (runMatrix skip-Run + probe-gate tests ~Task 3 section)
  </read_first>
  <action>
    In runMatrix (experiment-runner.mjs), for EACH cell, between the resume-skip check and the runCell call, run the
    per-agent pre-flight. Resolve `launchModel = resolveCellModel(cell.agent, cell.model)` and call
    `preflightAgent(cell.agent, { model: launchModel, port })` — NO taskId is passed (the round-trip is a plain proxy
    liveness/model check, so there is no composite-taskId span collision and no dependency on measurement-start
    ordering; this resolves the sequencing risk). Inject it as a new seam `preflight = preflightAgent` on runMatrix
    opts (tests stub it). If `!ok`: call the EXISTING `writeSkipRun` with `skipReason = res.reason` (a
    `preflight:<agent>-…` string), push a summary entry `{ status:'skipped', reason: res.reason }`, emit progress
    `state:'skipped'`, and `continue` — NO runCell, NO agent launch, NO mid-run abort. REPLACE the current leaky
    once-per-matrix `probeCopilot()` spawn gate (which runs `copilot -p` and creates a ~/.copilot session-state dir →
    an ambient Runs-view row) with this per-cell preflight for copilot too; keep `probeCopilotHeadless` exported but
    remove its call from the loop. (Copilot CLI *presence* is still covered at launch by resolveAgentBinary; a truly
    missing binary surfaces as a recorded abort — acceptable, and no worse than today.) Preserve byte-identical
    behavior when the injected `preflight` seam reports ok for every cell (existing tests must pass). Add runMatrix
    tests: (a) a cell whose preflight returns `{ok:false, reason}` lands a recorded skip-Run (writeSkipRun seam
    called) and NO runCell (spawnAgent seam NOT invoked); (b) the skipped cell's summary has `status:'skipped'` so
    scripts/experiment-run.mjs's REQUIRED_AGENTS filter (which only counts `status:'ran'` non-complete cells) does
    NOT fail the run — assert a skipped opencode cell is treated as non-failing.
  </action>
  <verify>
    <automated>node --test tests/experiments/experiment-runner.test.mjs tests/experiments/experiment-runner.integration.test.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `node --test tests/experiments/experiment-runner.test.mjs` exits 0 with the new preflight-skip cases green
    - `grep -nE "preflight(Agent)?" lib/experiments/experiment-runner.mjs` shows the gate imported, injected as a seam, and called per cell before runCell WITHOUT a taskId argument
    - `grep -c "probeCopilot(" lib/experiments/experiment-runner.mjs` shows the leaky once-per-matrix `copilot -p` spawn gate removed from the loop (preflightAgent replaces it)
    - A test proves a failing preflight → writeSkipRun invoked + runCell (spawnAgent seam) NOT invoked for that cell
    - A test proves the resulting summary entry has `status:'skipped'` (so scripts/experiment-run.mjs's REQUIRED_AGENTS filter does not fail the run)
    - When the injected `preflight` seam returns ok for all cells, every prior runMatrix test still passes (byte-identical happy path)
    - The skip_reason carries a diagnosable `preflight:<agent>-…` string (never a bare abort)
  </acceptance_criteria>
  <done>runMatrix pre-flights each cell via a session-free /api/complete round-trip on the resolved model; a failure records a clean up-front skip via the RUN-04 path and never fails a required-agent cell or aborts mid-run; the leaky copilot -p spawn gate is gone; the happy path is unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| pre-flight round-trip → shared host proxy | a one-token /api/complete probe crosses to the proxy on :12435 |
| pre-flight token_usage row → auto-measurement / Runs queries | the probe row must NOT be conflated with a measured cell or an ambient session |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-88-02-01 | DoS | preflightAgent hung round-trip | mitigate | bounded via AbortController(PREFLIGHT_TIMEOUT_MS) + fail-soft {ok:false} — a hung probe skips that variant, never hangs the matrix |
| T-88-02-02 | Injection | /api/complete body | mitigate | JSON body with fixed process/model/provider fields; no shell, no spawn; model comes from resolveCellModel's closed mapping |
| T-88-02-03 | Spoofing | probe row mis-attributed as a measured cell / ambient session | mitigate | REAL wired mechanism (not the removed EXPERIMENT_PREFLIGHT sentinel): /api/complete creates NO agent session-state dir and its row is task_id='' + process='experiment-preflight' (verified) → excluded from experiment Runs (keyed on composite task_id) AND ambient passes (keyed on session dirs / UUID task_ids) BY CONSTRUCTION |
| T-88-02-SC | Tampering | npm/pip/cargo installs | accept | NO package installs — pure JS over existing deps + global fetch |
</threat_model>

<verification>
- `node --test tests/experiments/agent-headless.test.mjs tests/experiments/experiment-runner.test.mjs tests/experiments/experiment-runner.integration.test.mjs` all green
- A failing preflight yields a recorded skip (not an abort, not a required-agent failure)
- `grep -c EXPERIMENT_PREFLIGHT lib/ -r` returns 0 (no orphan sentinel); the leaky `copilot -p` gate is removed from runMatrix
</verification>

<success_criteria>
- Every cell is pre-flighted (proxy reachable + resolved model round-trips) before it burns a run
- A pre-flight failure → clean up-front recorded skip:<reason>, never a mid-run abort or a hard required-agent error
- The pre-flight round-trip never creates a Runs-view row (session-free /api/complete + neutral task_id) and never hangs the matrix
</success_criteria>

<output>
Create `.planning/phases/88-experiment-harness-agent-invocation-alignment-and-pre-flight/88-02-SUMMARY.md` when done
</output>

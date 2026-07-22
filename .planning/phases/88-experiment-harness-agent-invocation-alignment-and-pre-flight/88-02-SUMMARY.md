---
phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight
plan: 02
subsystem: experiments-harness
tags: [preflight-gate, probe-suppression, api-complete, fail-soft, recorded-skip, copilot, opencode, claude]
requires:
  - lib/experiments/agent-headless.mjs (probeCopilotHeadless fail-soft/timeout pattern, PREFLIGHT_TIMEOUT_MS)
  - lib/experiments/agent-routing.mjs (resolveCellModel — Plan 88-01)
  - lib/experiments/experiment-runner.mjs (runMatrix loop, writeSkipRun RUN-04 path)
provides:
  - "lib/experiments/agent-headless.mjs: preflightAgent(agent, {model, port, fetchImpl, timeoutMs}) — bounded fail-soft /api/complete round-trip"
  - "runMatrix per-cell pre-flight gate: proxy-reachable + resolved-model round-trip → run-or-clean-skip decision, up front"
  - "probe/ambient suppression BY CONSTRUCTION: preflight rows land task_id='' / process='experiment-preflight' → excluded from Runs"
affects:
  - experiment matrix loop (every cell is pre-flighted before it burns a run)
  - copilot cells (leaky once-per-matrix `copilot -p` drivability gate removed → no ambient Runs-view row)
tech-stack:
  added: []
  patterns:
    - "bounded fail-soft HTTP round-trip via injectable fetchImpl seam + AbortController(timeoutMs)"
    - "suppression by construction (neutral token_usage row) — no env sentinel, no proxy code change"
    - "delegate-not-duplicate: failure reuses the existing writeSkipRun RUN-04 recorded-skip path"
key-files:
  created: []
  modified:
    - lib/experiments/agent-headless.mjs
    - lib/experiments/experiment-runner.mjs
    - tests/experiments/agent-headless.test.mjs
    - tests/experiments/experiment-runner.test.mjs
decisions:
  - "The pre-flight is a session-free POST /api/complete round-trip (NOT an agent CLI spawn) — it creates no ~/.copilot/opencode session-state dir and its row is neutral, so it appears in NO experiment Run and NO ambient pass by construction"
  - "No EXPERIMENT_PREFLIGHT env sentinel (it had no consumer — removed and grep-gated to stay gone); suppression is mechanical, not flag-driven"
  - "The gate calls preflightAgent(cell.agent, {model:resolveCellModel(...), port}) with NO taskId — a plain proxy liveness/model check has no composite-taskId span collision and no measurement-start ordering dependency"
  - "On failure → the SAME writeSkipRun (RUN-04) recorded-skip path with skipReason='preflight:<agent>-…'; status:'skipped' so the REQUIRED_AGENTS gate never fails the run; never a mid-run abort"
  - "The leaky once-per-matrix copilot -p probe gate is removed; copilot CLI presence is still covered at launch by resolveAgentBinary (missing binary → recorded abort)"
metrics:
  tasks: 2
  files_created: 0
  files_modified: 4
  tests: 50
  completed: 2026-07-22
---

# Phase 88 Plan 02: Pre-flight Gate & Probe Suppression Summary

Added a per-agent PRE-FLIGHT validation gate that runs BEFORE each experiment cell launches its
real agent: a bounded, fail-soft `POST /api/complete` round-trip validates the proxy is reachable
AND the cell's RESOLVED model round-trips one token against that agent's target provider. On
failure, the cell lands a clean up-front `skipped:<reason>` Run via the existing RUN-04
recorded-skip path — never a mid-run abort, never a hard required-agent failure. Because the
round-trip is a session-free proxy call whose `token_usage` row is neutral (`task_id=''`,
`process='experiment-preflight'`), it appears in NO experiment Run and NO ambient pass BY
CONSTRUCTION — replacing the earlier plan's non-existent `EXPERIMENT_PREFLIGHT` sentinel and the
leaky bare-env `copilot -p` probe with a real, wired mechanism (no proxy code change).

## What shipped

- **`lib/experiments/agent-headless.mjs`** — new `export async function preflightAgent(agent,
  { model, port = 12435, fetchImpl = fetch, timeoutMs = PREFLIGHT_TIMEOUT_MS })` returning
  `{ ok, reason? }`:
  - Agent→provider/model mapping (via a module-private `preflightBody`): copilot →
    `{ provider:'copilot', model }`; claude → `{ provider:'claude-code', model }`; opencode →
    `{ model: <rapid-proxy/-stripped bare id> }` with NO provider (proxy auto-routes);
    mastracode/unknown → `{ ok:true }` with NO call (out of the 3-agent scope).
  - Every body carries `process:'experiment-preflight'` and NO `task_id` → the neutral row is
    excluded from experiment Runs (composite `--task_ids`) AND ambient passes (session-dir/UUID
    keyed) by construction.
  - Result mapping: 2xx → `{ ok:true }`; non-2xx → `{ ok:false,
    reason:'preflight:<agent>-model-or-route (HTTP <status>)' }`; a rejected/aborted/timed-out
    fetch → `{ ok:false, reason:'preflight:<agent>-unreachable' }`. Wrapped so it NEVER throws
    (mirrors `probeCopilotHeadless`'s fail-soft contract); bounded by `AbortController` armed at
    `timeoutMs` (default `PREFLIGHT_TIMEOUT_MS`, aliasing the 90s `COPILOT_PROBE_TIMEOUT_MS`),
    cleared in a `finally`.
  - `probeCopilotHeadless` kept exported unchanged for backward-compat (no longer used by the gate).
- **`lib/experiments/experiment-runner.mjs`** — `runMatrix` now pre-flights EACH cell between the
  resume-skip check and the `runCell` call: resolves `launchModel = resolveCellModel(cell.agent,
  cell.model)` and calls `preflight(cell.agent, { model: launchModel, port })` (injectable
  `preflight = preflightAgent` seam) — NO taskId passed. `!ok` → `writeSkipRun` with the
  `preflight:<agent>-…` reason, a `{ status:'skipped', reason }` summary entry, a `state:'skipped'`
  progress emit, and `continue` (no launch). The leaky once-per-matrix `probeCopilot()` `copilot
  -p` spawn gate + the dead `COPILOT_SKIP_REASON` const are removed; the `probeCopilotHeadless`
  import is dropped in favor of `preflightAgent`.
- **Tests** — 8 new `preflightAgent` cases (200/500/reject, opencode prefix-strip + no provider,
  claude provider, neutral body process/no-task_id, AbortController bound, mastracode no-call) +
  the two former copilot-probe runMatrix tests rewritten as pre-flight tests + 2 new runMatrix
  cases (resolved-model/no-taskId assertion; REQUIRED-agent skip is non-failing).

## Verification (all green)

- `node --test tests/experiments/agent-headless.test.mjs tests/experiments/experiment-runner.test.mjs`
  → 50 pass / 0 fail (22 headless incl. 8 new preflight; 28 runner incl. the rewritten +
  new pre-flight cases).
- `node --test tests/experiments/experiment-runner.integration.test.mjs` → green (regression gate).
- `grep -cE "export async function preflightAgent" lib/experiments/agent-headless.mjs` → 1.
- `grep -c "/api/complete" lib/experiments/agent-headless.mjs` → 4 (round-trip target, not a CLI spawn).
- `grep -rc EXPERIMENT_PREFLIGHT lib/ scripts/` → 0 everywhere (dead sentinel stays gone).
- `grep -c "probeCopilot(" lib/experiments/experiment-runner.mjs` → 0 (leaky gate removed).
- `grep -c "export function probeCopilotHeadless" lib/experiments/agent-headless.mjs` → 1 (kept).

## Commits

- `604f957de` test(88-02): failing preflightAgent /api/complete round-trip contract (RED)
- `57e5d8131` feat(88-02): preflightAgent bounded fail-soft /api/complete round-trip (GREEN)
- `394149cae` feat(88-02): wire per-cell pre-flight gate into runMatrix — clean recorded skip

## Deviations from Plan

None. Task 1 followed the RED/GREEN TDD flow (Task 2 was `type="auto"`, not tdd). The plan's
`files_modified` list matched exactly; no scope changes, no auto-fixes, no architectural
surprises.

## Notes for downstream (Plan 88-03)

- The suppression is mechanical and already provable: a preflight `token_usage` row lands
  `process='experiment-preflight'`, `task_id=''` (live-verified during planning 2026-07-22). The
  real cross-agent re-run (CONTEXT "Verification must be real") is the phase-level gate — 88-03
  should run the matrix UNATTENDED and show all three cells either execute with non-zero tokens OR
  record a clean `skipped:<reason>` (never a silent abort), and confirm no `experiment-preflight`
  row appears in the experiment's Runs view.
- Live-proven contract this gate relies on: `POST :12435/api/complete {provider:copilot,
  model:'auto'}` → HTTP 500 (cleanly caught → skip); `{copilot, claude-haiku-4-5}` → 200;
  `{model:claude-haiku-4.5}` opencode auto-route → 200.

## Self-Check: PASSED

All 4 modified files present; all 3 task commits (604f957de / 57e5d8131 / 394149cae) exist in git.

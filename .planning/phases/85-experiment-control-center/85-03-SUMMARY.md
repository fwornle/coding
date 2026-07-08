---
phase: 85-experiment-control-center
plan: 03
subsystem: experiment-control-center
tags: [health-coordinator, experiment-runner, host-executor, detached-spawn, process-group-cancel, oq3-span-clear]
requires:
  - lib/experiments/run-launch.mjs (Plan 85-02 — launchRun / cancelRun / isRunAlive)
  - lib/experiments/run-progress.mjs (Plan 85-01 — writeProgress / readProgress)
provides:
  - "POST /experiments/run + POST /experiments/cancel host endpoints on the coordinator (:3034)"
  - "experiment_run / experiment_cancel executeAction cases on the /health/remediate dispatcher"
  - "lib/experiments/experiment-executor.mjs — runExperiment / cancelExperiment seam (injectable, testable)"
affects:
  - scripts/health-coordinator.js
  - scripts/health-remediation-actions.js
  - lib/experiments/experiment-executor.mjs (new)
tech-stack:
  added: []
  patterns:
    - "Thin HTTP handler → dedicated seam module (experiment-executor.mjs) delegating to Plan-02 run-launch + Plan-01 run-progress"
    - "V4 origin gate: accept loopback + Docker private-range (host-gateway) origins, reject external callers (NOT the /test/* LOOPBACK_IPS gate)"
    - "OQ3 stale-span clear scoped by the run's recorded cell task_ids (progress.json cells[])"
    - "Every syscall boundary (launch/cancel/fs) injectable → contract test drives it without a real process"
key-files:
  created:
    - lib/experiments/experiment-executor.mjs
    - tests/experiments/experiment-executor.test.mjs
  modified:
    - scripts/health-coordinator.js
    - scripts/health-remediation-actions.js
decisions:
  - "Seam shape: BOTH dedicated endpoints (primary) AND executeAction cases (dispatcher path) — the executor logic lives in a new lib module so both wire to one implementation and the contract test exercises it in isolation"
metrics:
  duration: ~14 min
  completed: 2026-07-08
  tasks: 2
  files: 4
---

# Phase 85 Plan 03: Experiment-Executor Host Seam Summary

Host-side experiment-executor seam on the health-coordinator (:3034) that performs the detached runner spawn and process-group cancel ON THE HOST (D-01 amended) — the load-bearing correction for the Pitfall-4 container-spawn dead end (the container has only `node`, no agent CLIs). The seam delegates spawn to Plan-02 `launchRun`, cancel to `cancelRun`, writes the terminal `cancelled` progress patch via Plan-01 `writeProgress`, and clears the run-owned `active-measurement.json` span (OQ3, scoped) so the D-02 409 slot frees even after a hard SIGKILL.

## What Was Built

**Task 1 — host executor seam (`00637da46`)**
- New `lib/experiments/experiment-executor.mjs`:
  - `runExperiment({spec, run_id, run_dir, overrides, env, launchFn})` → delegates to `launchRun` with the coordinator's contract env, returns `{success, pid, run_dir}`. Never-throw (returns `{success:false, message}` on error).
  - `cancelExperiment({run_id, run_dir, pid, dataDir, env, cancelFn, writeProgressFn, readProgressFn, fsDeps})` → (1) group-kill via `cancelRun`; (2) terminal progress patch `overall='cancelled'` + every in-flight cell (running/restoring/scoring) → `'abort'` via `writeProgress`; (3) OQ3 span clear scoped to the run's recorded cell task_ids.
  - `spanBelongsToRun` / `clearRunOwnedSpan`: ownership is deterministic — a span whose `task_id` matches one of `progress.json`'s recorded cell task_ids is this run's span; anything else (foreign or task-less) survives.
- `scripts/health-coordinator.js`: `POST /experiments/run` + `POST /experiments/cancel` mounted next to `/health/remediate`, lazy-importing the executor. `isExperimentOriginAllowed(req)` (V4 gate) accepts host loopback (`127.0.0.1`/`::1`) + Docker private ranges (`10/8`, `172.16–31/12`, `192.168/16` = host-gateway origin) and rejects external callers with 403. Does NOT reuse the `/test/*` LOOPBACK_IPS gate (which would 403 the container proxy).
- `scripts/health-remediation-actions.js`: `experiment_run` / `experiment_cancel` executeAction cases + methods reaching the same host executor via the existing `/health/remediate` dispatcher.

**Task 2 — executor contract test (`307315867`)**
- `tests/experiments/experiment-executor.test.mjs` (node:test + node:assert/strict, 4 tests, all green):
  - run delegates to `launchRun` with the exact `{spec, run_id, run_dir, overrides}` + host env, returns the pid.
  - cancel delegates to `cancelRun` (pid), writes `overall='cancelled'` through the REAL `writeProgress` (verified on disk) + flips the in-flight cell to `'abort'`, clears the run-owned span.
  - cancel LEAVES a foreign `active-measurement.json` (different task_id) untouched (OQ3 scoping).
  - no real process is spawned or killed (injected fakes only); all fs work under an OS tmp dir, never real `.data/`.

## Design Decision

The plan gave discretion (RESEARCH OQ1/A1, user-resolved to "extend the coordinator") to implement EITHER dedicated endpoints OR executeAction cases. The plan's `artifacts` gate requires BOTH `scripts/health-coordinator.js` (contains `/experiments/run`) AND `scripts/health-remediation-actions.js` (contains `experiment_run`). Rather than duplicate the spawn/cancel/progress/span-clear logic in two places, the actual implementation lives in ONE new `lib/experiments/experiment-executor.mjs` module; both the dedicated endpoints and the executeAction cases are thin wrappers over it. This keeps the coordinator diff minimal, satisfies both artifact greps, and makes the seam testable in isolation (Task 2 imports the module directly).

## Deviations from Plan

None — plan executed as written. The one judgment call (implementing both seams over a shared executor module rather than picking one) is explicitly sanctioned by the plan's discretion clause and is the smallest-diff way to satisfy both required artifacts.

## Verification

- `node --test tests/experiments/experiment-executor.test.mjs` → 4/4 pass.
- `node -e "import('./scripts/health-remediation-actions.js')…"` loads cleanly (ESM).
- Acceptance greps: `/experiments/run` + `experiment_run`, `/experiments/cancel` + `experiment_cancel`, `launchRun`/`cancelRun` delegation, `writeProgress` (cancel path), `active-measurement` (OQ3) all present; `shell:true` absent; no new `console.*` in the coordinator diff; the endpoint is NOT behind the `/test/*` LOOPBACK_IPS gate.

## Deferred / Follow-ups

- **Live gate (Plan 06):** the coordinator is a launchd daemon — a live restart (`launchctl kickstart -k gui/$(id -u)/com.coding.health-coordinator`) is required for the new seam to serve on the running host process. Deferred to the Plan 06 live gate per the plan's `<verification>` NOTE. No live restart performed in this worktree.

## Threat Surface

No new trust boundaries beyond the plan's `<threat_model>`. The two new endpoints ARE the surface the register anticipated:
- T-85-03-01 (EoP) mitigated by `isExperimentOriginAllowed` (loopback + Docker-private only).
- T-85-03-02 (command injection) mitigated by delegating to run-launch fixed-argv (no shell string built here).
- T-85-03-03 (stale span DoS) mitigated by the scoped OQ3 clear + `writeProgress` cancelled patch.
- T-85-03-04 (path traversal via run_dir) — run_dir is composed server-side by Plan 04 (`_validRunId`); the executor treats it as a server-known value.

## Known Stubs

None. Both seams are fully wired to the Plan-01/Plan-02 primitives; no placeholder data paths.

## Self-Check: PASSED

- FOUND: lib/experiments/experiment-executor.mjs
- FOUND: tests/experiments/experiment-executor.test.mjs
- FOUND commit: 00637da46 (feat 85-03 host executor seam)
- FOUND commit: 307315867 (test 85-03 executor contract test)

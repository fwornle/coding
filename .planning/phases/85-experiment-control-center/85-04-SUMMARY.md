---
phase: 85-experiment-control-center
plan: 04
subsystem: experiment-control-center
tags: [vkb-server, api-routes, experiment-run, run-status, spec-preview, dual-source-409, coordinator-delegation, pitfall-6]
requires:
  - lib/experiments/experiment-spec.mjs (resolveExperimentSpec — Phase 77/85)
  - lib/experiments/experiment-runner.mjs (cellName — Phase 78-03)
  - "health-coordinator :3034 /experiments/run + /experiments/cancel seam (Plan 85-03)"
  - "progress.json emitter + run.json layout (Plans 85-01/85-02)"
provides:
  - "POST /api/experiments/run — dual-source 409 guard + host-spawn delegation (D-01/D-02)"
  - "GET /api/experiments/run-status/:runId — verbatim progress.json read (D-04)"
  - "POST /api/experiments/run-cancel — host group-kill delegation (D-08)"
  - "GET /api/experiments/specs — resolved variant-matrix preview (D-09)"
affects:
  - lib/vkb-server/api-routes.js
  - Plan 05 (UI run-monitor polls run-status; launcher/re-run submit run + overrides; matrix preview reads specs)
tech-stack:
  added: []
  patterns:
    - "Dual-source single-slot 409 (active-measurement.json span OR live-run progress.json+pid) — files+pid only, never the LevelDB store (Pitfall 6)"
    - "Verbatim file-serve + graceful-ENOENT + charset/`..` traversal guard (cloned from handleReconciliation)"
    - "V5 spec-membership gate: a launch spec must be a server-listed config/experiments/*.yaml basename, never a raw client path (no spawn injection)"
    - "Injectable coordinator fetch seam (this._coordinatorFetch) so endpoint tests delegate WITHOUT firing real HTTP"
    - "resolveExperimentSpec reused server-side for override-name validation + matrix preview; malformed spec listed with {error}, not fatal"
key-files:
  created:
    - tests/experiments/run-endpoint.test.mjs
    - tests/experiments/run-status-endpoint.test.mjs
    - tests/experiments/spec-list-endpoint.test.mjs
  modified:
    - lib/vkb-server/api-routes.js
decisions:
  - "handleRunStatus + handleSpecList (Task 2) were co-implemented in the single Task-1 api-routes.js edit because they share the helper block (_repoRoot/_validRunId/_listSpecFiles) and the route-registration block; the Task-2 RED tests therefore passed on first run against the already-landed handlers"
  - "Coordinator base URL resolves HEALTH_COORDINATOR_URL || http://host.docker.internal:3034 (the exact env var docker-compose sets on the container)"
  - "run_id minted as `r<base36(Date.now())>` sliced to ≤12 chars — same charset/length bound as the Plan-01 CLI --run-id flag (Pitfall 1)"
requirements: [D-01, D-02, D-04, D-08, D-09]
metrics:
  duration: ~18 min
  completed: 2026-07-08
  tasks: 2
  commits: 4
  files_created: 3
  files_modified: 1
---

# Phase 85 Plan 04: Experiment Control Center API Routes Summary

The four container-side vkb-server API routes that expose the Experiment Control Center to the dashboard: `POST /api/experiments/run` (D-02 dual-source single-slot 409 → delegate the detached host spawn to the Plan-03 coordinator seam), `GET /api/experiments/run-status/:runId` (D-04 verbatim `progress.json` read), `POST /api/experiments/run-cancel` (D-08 → delegate the negated-pid group-kill), and `GET /api/experiments/specs` (D-09 resolved-matrix preview). Every host action is delegated to `host.docker.internal:3034` (the container has only `node`, no agent CLIs — Pitfall 4); the 409 live-run check + run-status are pure file/pid reads that NEVER open the experiment LevelDB store (Pitfall 6 lock-contention).

## What Was Built

**Task 1 — `handleExperimentRun` + `handleRunCancel` (`9ffcc1117`, RED `01bfa22c8`)**
- `handleExperimentRun(req, res)`:
  - **409 source #1 (interactive):** `.data/active-measurement.json` exists → 409 `{ holder:{ kind:'interactive', task_id } }` (cloned from the `handleMeasurementStart` 409 template).
  - **409 source #2 (live experiment run):** scan `.data/experiments/runs/*/progress.json` for `overall==='running'` AND `_pidAlive(pid)` → 409 `{ holder:{ kind:'experiment', run_id, pid } }`. A stale run-dir (`running` but a dead pid) does NOT block. Files + `process.kill(pid,0)` only — never opens the store (Pitfall 6).
  - **V5 spec membership:** the requested `spec` MUST be a member of the server-listed `config/experiments/*.yaml` set (`_listSpecFiles`) — a raw client path (incl. a `../` traversal) is rejected 400, so no unlisted path is ever forwarded to the host spawn (T-85-04-02).
  - **Override validation** (`_validateOverrides`, parity with `experiment-run.mjs:107-125`): `repeats`/`timeout` positive int; every `variants` entry and every `variantOverrides` KEY ∈ the resolved variant names (`resolveExperimentSpec` + `cellName`). `variantOverrides` is NOT renamed — forwarded whole (Plan-01 runner keys `applyVariantOverride` on it).
  - **Delegate:** mint a ≤12-char path-safe `run_id` (`_mintRunId`), compose `run_dir` under `.data/experiments/runs/`, POST `{ spec, run_id, run_dir, overrides }` to the coordinator `/experiments/run` seam via the injectable `_coordinatorPost`; on `{success, pid}` return 200 `{ run_id, pid, run_dir }`.
- `handleRunCancel(req, res)`: `_validRunId` guard → read `run.json` (404 when absent) → delegate `{ run_id, run_dir, pid }` to `/experiments/cancel` → 200 `{ killed, run_id }`. Pure file read on the container side.
- New helpers: `_repoRoot`, `_validRunId` (≤12 charset+`..` guard), `_coordinatorUrl`, `_coordinatorPost` (injectable fetch), `_listSpecFiles`, `_pidAlive` (signal-0), `_mintRunId`, `_validateOverrides`.

**Task 2 — `handleRunStatus` + `handleSpecList` (test `dcd942380`)**
- `handleRunStatus(req, res)`: cloned from `handleReconciliation` — `_validRunId` → 400 on a `../`/`/`-bearing runId (BEFORE the path build); read `.data/experiments/runs/:runId/progress.json` → 200 verbatim; ENOENT → 200 `{ runId, overall:'unknown', cells:[] }` (graceful-empty). Pure file read (Pitfall 6).
- `handleSpecList(req, res)`: `readdir config/experiments` (`.yaml`/`.yml`), `resolveExperimentSpec` each → `{ file, goal_sentence, repeats, variantCount, cellCount: variantCount*repeats, snapshot_id:null, variants }`; a throwing spec pushes `{ file, error }` (listed, not fatal — the endpoint still 200s). Returns `{ specs }`.
- All four routes registered `app.post`/`app.get` style next to the measurement routes.

## Verification

- `node --test tests/experiments/run-endpoint.test.mjs` → **11/11 pass** (409 interactive naming the task_id, 409 live-run, stale-run no-block, clean-launch delegate asserting the `{spec, run_id, run_dir, overrides}` body, variantOverrides forwarded whole, bad-variant-key 400, traversal 400, unlisted-spec 400, cancel delegate forwarding the run.json pid, unknown-run 404, `../` run_id 400).
- `node --test tests/experiments/run-status-endpoint.test.mjs tests/experiments/spec-list-endpoint.test.mjs` → **5/5 pass** (verbatim serve, ENOENT graceful-empty, `../` 400; cellCount = variantCount*repeats, malformed spec listed with `error`, empty dir → `{specs:[]}`).
- `node --test tests/experiments/**/*.test.mjs` → **323 pass / 0 fail / 2 skipped** (the 2 skips are the pre-existing `EXPERIMENTS_LIVE`-gated tests, untouched). No regressions to `runs-endpoint.test.mjs`.
- Acceptance greps: `_validRunId` present + used before every run_id path build; `variantOverrides` validated (keys ∈ resolved names) and forwarded whole; `3034` + `/experiments/run` + `/experiments/cancel` delegation present; NO new `openExperimentStore`/`GraphKMStore` inside any of the four handlers (Pitfall 6 clean); no new `console.*`.

## Design Decisions

- **Task-2 handlers co-located in the Task-1 edit.** `handleRunStatus`/`handleSpecList` share the same new helper block (`_repoRoot`/`_validRunId`/`_listSpecFiles`) and the same route-registration block as the Task-1 handlers. Splitting the single `api-routes.js` insertion across two commits would have produced a syntactically incomplete intermediate file. The Task-2 RED tests therefore passed on first run against the already-landed handlers — this is expected co-location, not a skipped RED gate (the Task-1 handlers went through a real RED→GREEN cycle: commit `01bfa22c8` is the failing test, `9ffcc1117` the implementation).
- **Coordinator URL from `HEALTH_COORDINATOR_URL`.** docker-compose sets `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` on the container; the handler reads it with that exact default so a bare host `node` run still targets the right port. The fetch is injectable (`this._coordinatorFetch`) so the endpoint tests assert the delegate body without firing HTTP.

## Deviations from Plan

None — plan executed as written. The one judgment call (co-implementing the Task-2 handlers inside the single Task-1 `api-routes.js` block) is dictated by the shared helper/route block and is documented above.

## Known Stubs

None. All four handlers are fully wired: run/cancel delegate to the real coordinator seam shape confirmed against `scripts/health-coordinator.js` (`{ spec, run_id, run_dir, overrides }` → `{ ok, success, pid }`; `{ run_id, run_dir, pid }` → `{ ok, success, killed }`); run-status/specs read real files via `resolveExperimentSpec`. `snapshot_id` in the spec-preview is `null` when the spec omits it (the spec schema does not currently carry one) — this is a null-not-stub honest absence, consumed as-is by Plan 05's matrix preview.

## Threat Surface

No new trust boundaries beyond the plan's `<threat_model>`. All five `mitigate` dispositions are implemented:
- T-85-04-01 (traversal) — `_validRunId` charset+`..` guard BEFORE every `path.join`; reads confined to `.data/experiments/runs/`.
- T-85-04-02 (spec command-injection) — `_listSpecFiles` membership gate; a raw client path never reaches the host spawn.
- T-85-04-03 (unbounded runs) — dual-source single-slot 409.
- T-85-04-04 (LevelDB lock contention) — live-run check + run-status are files+pid only, no store open.
- T-85-04-05 (bad overrides) — `_validateOverrides` (repeats/timeout positive int, variant + variantOverrides keys ∈ resolved names) before delegating.

## Self-Check: PASSED

- FOUND: tests/experiments/run-endpoint.test.mjs
- FOUND: tests/experiments/run-status-endpoint.test.mjs
- FOUND: tests/experiments/spec-list-endpoint.test.mjs
- FOUND commit: 01bfa22c8 (test 85-04 RED run/cancel)
- FOUND commit: 9ffcc1117 (feat 85-04 run/cancel handlers)
- FOUND commit: dcd942380 (test 85-04 run-status/spec-list)

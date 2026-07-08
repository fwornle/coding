---
phase: 85-experiment-control-center
plan: 02
subsystem: experiments
tags: [host-spawn, detached, process-group, cancel, pid-liveness]
requires: []
provides:
  - "lib/experiments/run-launch.mjs — buildRunArgv, launchRun, cancelRun, isRunAlive"
affects:
  - "Plan 03 coordinator seam consumes launchRun/cancelRun/isRunAlive"
tech-stack:
  added: []
  patterns:
    - "detached+unref'd fixed-argv spawn (survives launcher restart, D-01)"
    - "negated-pid SIGTERM→SIGKILL process-group kill (D-08, Pitfall 2)"
    - "never-throw signal-0 pid-liveness probe"
    - "atomic tmp+rename run.json write"
    - "injectable spawn/kill/liveness seams for unit-testability"
key-files:
  created:
    - lib/experiments/run-launch.mjs
    - tests/experiments/run-launch.test.mjs
  modified: []
decisions:
  - "pid-reuse guard is an optional caller hook (pidLooksLikeRunner) — absent-hook residual risk accepted, matching server-manager/coordinator precedent (RESEARCH OQ2)"
  - "stale active-measurement.json clearing (OQ3) is explicitly NOT owned here — deferred to the Plan 03 coordinator/canceller"
metrics:
  duration: ~10m
  completed: 2026-07-08
  tasks: 2
  files: 2
---

# Phase 85 Plan 02: Host-Side Run-Launch Primitives Summary

Detached, restart-surviving fixed-argv spawn of `experiment-run.mjs` (D-01) plus a process-GROUP SIGTERM→SIGKILL cancel via negated pid (D-08) and a never-throw signal-0 pid-liveness probe with a pid-reuse sanity guard — all seam-injectable and unit-proven without spawning a real process.

## What Was Built

`lib/experiments/run-launch.mjs` (NEW) exporting four host mechanisms the Plan 03 coordinator seam will call:

- **`buildRunArgv(specPath, runId, runDir, overrides, scriptPath)`** — returns a flat `string[]` beginning with the resolved `scripts/experiment-run.mjs` path then `--spec/--run-id/--run-dir`, and pushes override flags (`--rerun-of`, `--repeats`, `--timeout`, `--variant`, `--model`, `--agent`, `--capture-raw-bodies`) ONLY when defined. Never a shell string; every element coerced to `String`. Satisfies T-85-02-01 (command-injection mitigation via fixed-argv).
- **`launchRun({specPath, runId, runDir, overrides, env, spawnFn, repoRoot, scriptPath})`** — `mkdir -p` the run-dir, spawns `process.execPath` with the fixed argv `detached:true, stdio:'ignore'`, calls `child.unref()` (so a coordinator/vkb restart does NOT kill the run — D-01), atomically writes `run.json {run_id, pid, spec, started_at}` via tmp+rename, returns `{pid, runDir}`. The child env is `process.env` overlaid with the four contract vars (`CODING_REPO`, `LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE`) from the caller's env.
- **`isRunAlive(pid)`** — `process.kill(pid, 0)` liveness probe; returns true/false, never throws.
- **`cancelRun({pid, graceMs, killFn, isAliveFn, runJson, pidLooksLikeRunner})`** — signals the NEGATED pid (`-pid`, the whole detached group) `SIGTERM` then escalates to `SIGKILL` after `graceMs` on an unref'd timer (D-08, Pitfall 2 — a positive pid would leave the agent-CLI grandchild burning tokens + holding the span). Guards: already-dead pid → `{killed:false, reason:'already-gone'}`; pid-reuse hook rejects → `{killed:false, reason:'pid-reuse-guard'}`.

`spawnFn` / `killFn` / `isAliveFn` are injectable so the coordinator and unit tests exercise the exact spawn/kill argv without a live process or signal.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| RED  | Failing tests (both tasks) | 23b8c9b2c | tests/experiments/run-launch.test.mjs |
| GREEN | buildRunArgv + launchRun + isRunAlive + cancelRun | 652f236fe | lib/experiments/run-launch.mjs |

Both plan tasks (Task 1 D-01 spawn, Task 2 D-08 cancel) share one module and one test file; implemented as a single RED→GREEN cycle. The 12-case node:test suite covers argv shape (fixed array + conditional flags + string coercion), detached+unref+run.json+env-passthrough, liveness (self/impossible pid), and the negated-pid SIGTERM→SIGKILL escalation with already-gone + pid-reuse guards.

## Verification

- `node --test tests/experiments/run-launch.test.mjs` → 12/12 pass, 0 fail.
- `grep "detached: *true"` present; `grep "unref"` present.
- `grep -E "^\s*shell:"` — no `shell:` option key passed (only documentary constraint mentions).
- `grep "console\."` — none (diagnostics via process.stderr.write only).
- `grep "process.kill(-\|killFn(-"` — negated-pid group kill present (SIGTERM + SIGKILL).
- `grep -c "process.kill(pid, 0)"` = 1 (signal-0 liveness).
- OQ2 (pid-reuse guard) and OQ3 (stale-span clearing owned by Plan 03) referenced in comments.
- TDD gate: `test(85-02)` commit (23b8c9b2c) precedes `feat(85-02)` commit (652f236fe).

## Deviations from Plan

None — plan executed exactly as written. The two tasks were implemented as one shared-file RED→GREEN cycle (the plan explicitly has both tasks target the same `run-launch.mjs` + test file).

## Self-Check: PASSED

- FOUND: lib/experiments/run-launch.mjs
- FOUND: tests/experiments/run-launch.test.mjs
- FOUND commit: 23b8c9b2c (test)
- FOUND commit: 652f236fe (feat)

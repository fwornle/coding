---
phase: 76-measurement-validity-fixes-prerequisite
plan: 02
subsystem: testing
tags: [route-heuristics, measurement-validity, wallclock, idle-exclusion, deterministic, esm]

# Dependency graph
requires:
  - phase: 72-route-heuristics
    provides: "pure computeHeuristics(RouteEvent[]) with the naïve wallclockPerStep this plan redefines"
provides:
  - "Idle-excluding wallclockPerStep: sum of active inter-event gaps ÷ step count"
  - "Single named idle-threshold constant DEFAULT_IDLE_GAP_MS (300000 ms / 5 min) with ROUTE_IDLE_GAP_MS env override via resolveIdleGapMs()"
  - "Regression tests proving the ~28k s/step artifact is impossible on a steering-paused trace"
affects: [76-04, experiments-recompute-route, route-quality-metrics, cross-agent-comparison-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-invocation env resolution (resolveIdleGapMs reads process.env each call, not cached at module load) so callers/tests can toggle the threshold without re-importing"
    - "Strictly-greater = idle boundary rule (gap exactly at threshold is included)"

key-files:
  created: []
  modified:
    - lib/experiments/route-heuristics.mjs
    - tests/experiments/route-heuristics.test.mjs

key-decisions:
  - "Idle threshold lives in route-heuristics.mjs itself as DEFAULT_IDLE_GAP_MS (Claude's Discretion, D-06) — a single named source with an env override, no shared config module needed"
  - "wallclockPerStep sums inter-event gaps (nextStart − prevTerminal) rather than event durations; the metric measures reasoning/steering time between steps, and the naïve span/count test was updated to reflect the new definition"
  - "Boundary rule: strictly-greater than threshold = idle (a gap exactly at the threshold is INCLUDED), chosen and tested explicitly"

patterns-established:
  - "Named idle threshold + env override + per-call resolver as the single source of truth for gap classification"

requirements-completed: [VALID-02]

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 76 Plan 02: Route Time Math (Exclude Idle) Summary

**`wallclockPerStep` redefined as the sum of active inter-event gaps ÷ step count, excluding gaps longer than a single named 5-min idle threshold (env-overridable via `ROUTE_IDLE_GAP_MS`), killing the ~28,000 s/step artifact on multi-hour steering-paused traces.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-03T06:29:22Z
- **Completed:** 2026-07-03T06:37:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Replaced the naïve `(lastTerminal − firstStart) / count` with a sum-of-active-gaps definition that excludes operator-thinking / AFK pauses (D-05).
- Introduced `DEFAULT_IDLE_GAP_MS` (300000 ms / 5 min) as the ONE named idle-threshold source, resolved through `resolveIdleGapMs()` with a `ROUTE_IDLE_GAP_MS` env override (D-06); no separate per-step outlier cap.
- Kept the metric pure and deterministic — no fs/network/LLM (D-07) — and preserved the single-event (`ended − started`) and empty-trace (null) edge cases.
- Added idle-exclusion, env-override, and threshold-boundary tests, plus a documented assertion that the corrected value is orders of magnitude below the naïve `(last−first)/count` on a 3-hour-pause trace (the ~28k s/step artifact).

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 (RED): failing tests for idle-excluding wallclockPerStep** - `3d57f3090` (test)
2. **Task 1 (GREEN): redefine wallclockPerStep as active-gap sum, excluding idle** - `15d884824` (feat)

**Plan metadata:** _(this docs commit)_

## Files Created/Modified
- `lib/experiments/route-heuristics.mjs` - New `DEFAULT_IDLE_GAP_MS` / `IDLE_GAP_ENV` constants + `resolveIdleGapMs()`; `wallclockPerStep` rewritten to sum active inter-event gaps (≤ threshold) ÷ `max(1, count)`; module header + JSDoc document the new definition, threshold, env override, and boundary rule; constants/resolver exported.
- `tests/experiments/route-heuristics.test.mjs` - `wallclock_per_step` describe block rewritten: active-gap sum, idle exclusion (kills ~28k artifact), env override, threshold boundary (strictly-greater = idle), and preserved single-event/empty edge cases.

## Decisions Made
- The naïve `(last−first)/count === 2000` assertion for contiguous events was intentionally replaced: under the new gap-based definition the metric measures inter-event (reasoning/steering) time, so tests now exercise explicit inter-event gaps. This is a definitional change mandated by D-05, not a regression.
- Idle threshold kept inside `route-heuristics.mjs` (per D-06 / Claude's Discretion) rather than a shared config module — simplest single named source with an env override.
- `resolveIdleGapMs()` reads `process.env` per invocation so the env override is honored deterministically in-test without module re-import; malformed/non-positive values fail-soft to the default.

## Deviations from Plan

None - plan executed exactly as written. (The pre-existing `wallclock_per_step === 2000` contiguous-event assertion was updated as part of the required definitional change, not an unplanned deviation.)

## Issues Encountered
None.

## Verification
- `node --test tests/experiments/route-heuristics.test.mjs` → 19 tests, 19 pass, 0 fail.
- `node --check lib/experiments/route-heuristics.mjs` → passes.
- `grep -Eq "IDLE|idle" lib/experiments/route-heuristics.mjs` → matches (`DEFAULT_IDLE_GAP_MS`, `IDLE_GAP_ENV`, `resolveIdleGapMs`).
- No `console.log` in either file (`grep -c` → 0/0); purity preserved (no fs/network/LLM added).

## Next Phase Readiness
- `wallclockPerStep` now yields plausible per-step times on steering-paused traces. The Wave-2 regression anchor (76-04) can re-run `experiments-recompute-route.mjs` against the archived `exp-dash-start-control` pilot span and assert a sane per-step value against real pilot data.

## Self-Check: PASSED
- FOUND: lib/experiments/route-heuristics.mjs (modified)
- FOUND: tests/experiments/route-heuristics.test.mjs (modified)
- FOUND commit: 3d57f3090 (RED test)
- FOUND commit: 15d884824 (GREEN feat)

---
*Phase: 76-measurement-validity-fixes-prerequisite*
*Completed: 2026-07-03*

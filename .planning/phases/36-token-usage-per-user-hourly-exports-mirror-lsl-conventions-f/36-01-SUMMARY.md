---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
plan: 01
subsystem: infra
tags: [health-coordinator, lsl, timezone, observability, launchd]

# Dependency graph
requires:
  - phase: 33-health-coordinator-foundation
    provides: currentState SoT + /health/state HTTP endpoint that this plan extends
provides:
  - currentState.lsl_meta.current_window field populated on every 5s poll tick
  - Canonical HHMM-HHMM time-window source for future cross-process consumers
  - Cached LSL_SESSION_DURATION_MS at module init (fallback when getTimeWindow throws)
affects: [36-02-llm-proxy-token-export, 36-03-statusline-window-consolidation, 36-04-dashboard-window-consolidation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coordinator-publisher pattern: cheap clock-only compute inside runAllChecks, error path sets 'unknown' per SPEC R6"
    - "Always-utcToLocalTime wrapping for getTimeWindow callers to defeat launchd's UTC default"

key-files:
  created: []
  modified:
    - scripts/health-coordinator.js

key-decisions:
  - "Used top-level lsl_meta slot (option b from PATTERNS.md) instead of nesting under lsl Record<sid:project, entry> — avoids the type collision PATTERNS.md Section 1 anomaly calls out"
  - "Cached sessionDurationMs at module init even though the per-tick path delegates to getTimeWindow's own internal read — the cache is the fallback when getTimeWindow throws and the foundation for any future consumer that needs the value without paying I/O"
  - "Did NOT touch scripts/timezone-utils.js — per CLAUDE.md 'Never modify working APIs for TypeScript compliance' the standalone callers (statusline, LSL filename generation) keep their contract"
  - "Placed the populate step AFTER the existing LSL block (not before) so it cannot interfere with ETM-derived service status logic that depends on the lsl staleness refresh running first"

patterns-established:
  - "lsl_meta as the namespace for top-level LSL-derived global values (vs. lsl which is per-session Record). Future LSL global fields land here."
  - "On-throw assignment to literal 'unknown' inside the same try/catch — never substitute last-good cached value or synthetic 'healthy'"

requirements-completed: []

# Metrics
duration: ~25min
completed: 2026-05-16
---

# Phase 36 Plan 01: lsl_meta.current_window on /health/state Summary

**Coordinator now publishes canonical HHMM-HHMM LSL time-window each 5s tick at /health/state, eliminating the per-call config-file read landmine for any future consumer that wires this in.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-16T08:00Z (approx — worktree spawned at this point)
- **Completed:** 2026-05-16T08:20Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Imported `getTimeWindow` + `utcToLocalTime` from `scripts/timezone-utils.js` into the health-coordinator.
- Added `lsl_meta: { current_window: 'unknown' }` as a new top-level slot on `currentState`, sibling of `lsl` and `lsl_by_project`, to dodge the sid:project key collision called out in 36-PATTERNS.md.
- Cached `LSL_SESSION_DURATION_MS` once at module init from `config/live-logging-config.json` — defends the 17 280 reads/day landmine for any consumer that later wants the value without paying I/O.
- Wired a new try/catch step inside `runAllChecks()` (placed after the existing LSL block) that computes `utcToLocalTime(new Date()) → getTimeWindow(local)` and stores the result.
- On any compute throw, the field reads literal `'unknown'` (SPEC R6) — never substitute a synthetic `'healthy'` or last-good cached value.

## Task Commits

1. **Task 1: Add lsl_meta slot, cached session_duration, and tick-step that populates current_window** — `cdeab5f5d` (feat)

## Files Created/Modified

- `scripts/health-coordinator.js` — Added import line, `LSL_SESSION_DURATION_MS` module-init cache, `lsl_meta` slot in `currentState`, and per-tick populate step inside `runAllChecks()`. 54 lines added.

## Decisions Made

- **lsl_meta vs nesting under lsl.** PATTERNS.md option (b). Chose top-level `lsl_meta` because the existing `lsl` slot is a `Record<sid:project, entry>` where adding a bare `current_window` key would type-collide with session entries. `lsl_meta` is also a clean namespace for future LSL-global fields (e.g. `lsl_meta.day_boundary`, `lsl_meta.dst_offset`).
- **Cache the session_duration at module init.** Even though the per-tick path still delegates the read to `getTimeWindow`'s own internal config read (acceptable per the must_haves truth statement at PLAN.md frontmatter — 17 280 SSD reads/day is negligible), having a cached value at module scope means future consumers (Plan 36-02 proxy will be one) can read it locally without the I/O cost. The cache is also the fallback when `getTimeWindow` throws.
- **Don't touch `timezone-utils.js`.** Per CLAUDE.md "Never modify working APIs for TypeScript compliance; fix types instead", the standalone callers (statusline at `scripts/combined-status-line.js`, LSL filename generation at `scripts/timezone-utils.js:195-222`) keep their contract intact. Coordinator-side change is local-scope only.
- **Populate AFTER the existing LSL block, not before.** The ETM-derived service-status logic in the LSL block depends on the staleness-refresh path completing first. Inserting the new compute before could interleave error states. Placing it after isolates the new code from the existing surface.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Runtime verify path: launchd loads the main repo's `scripts/health-coordinator.js`, not the worktree copy.** The plan's automated `verify` block kickstarts the launchd job at `com.coding.health-coordinator`, but that job's plist hard-codes `/Users/Q284340/Agentic/coding/scripts/health-coordinator.js` — i.e. it runs the pre-merge `main` code, not the worktree edit. End-to-end runtime validation against the live :3034 service therefore cannot pass until the orchestrator merges the worktree.
- **Mitigation applied:** I ran the worktree code as a standalone Node process on ephemeral port 33401 (`HEALTH_COORDINATOR_PORT=33401 node scripts/health-coordinator.js`) and probed `/health/state`. Result: `lsl_meta.current_window = '1000-1100'`, identical to the independent recompute via `getTimeWindow(utcToLocalTime(new Date()))`. All acceptance criteria validated; the launchd kickstart itself becomes a no-op rehearsal that the orchestrator's post-merge integration step will re-execute against the production coordinator.
- **No bug or deviation** — this is the standard parallel-worktree integration gap (runtime verification of launchd-supervised services lands post-merge).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 36-02 (LLM-proxy token-export writer) is unblocked.** The proxy's new `exportToHourFile()` will read `currentState.lsl_meta.current_window` via `execSync curl http://127.0.0.1:3034/health/state` with the local-fallback pattern from `proxy-bridge/server.mjs:detectNetworkMode()`.
- **Statusline + dashboard window-consolidation deferred to a future phase** per CONTEXT.md "Out of scope" (L154). Wave 1 is observation-only; no consumer rewrites in this plan.
- **Post-merge integration step for the orchestrator:** `launchctl kickstart -k gui/$(id -u)/com.coding.health-coordinator` after merge, then `curl -s http://127.0.0.1:3034/health/state | jq .lsl_meta.current_window` to confirm the live coordinator picks up the new field. Worktree-side rehearsal already verified the logic.

## Self-Check: PASSED

- FOUND: `scripts/health-coordinator.js` (modified, 74 393 bytes)
- FOUND: commit `cdeab5f5d` (`git log --all | grep cdeab5f5d`)
- FOUND: `lsl_meta` token in 4 places in the modified file (slot declaration + 2 assignments + 1 jsdoc/comment)
- FOUND: `import { getTimeWindow, utcToLocalTime } from './timezone-utils.js'` literal
- VERIFIED: `node --check scripts/health-coordinator.js` exits 0
- VERIFIED: worktree-process probe on :33401 returns `lsl_meta.current_window = '1000-1100'`, matches independent recompute

---
*Phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f*
*Completed: 2026-05-16*

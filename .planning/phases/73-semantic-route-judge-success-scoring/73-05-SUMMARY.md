---
phase: 73-semantic-route-judge-success-scoring
plan: 05
subsystem: api
tags: [experiments, score-override, vkb-server, express, km-core, leveldb, rest]

# Dependency graph
requires:
  - phase: 73-02
    provides: applyOverride(store,{taskId,dimension,value,by}) override-preserving write + openExperimentStore() dedicated store factory
provides:
  - PATCH /api/experiments/scores/:taskId — validated per-dimension Score override endpoint
  - handleScoreOverride controller routing Score writes to the dedicated experiment store (never the shared KG)
  - experimentRepoRoot ApiRoutes constructor option for isolated test stores
affects: [74-performance-tab, score-override-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-request transient single-owner LevelDB open (open -> applyOverride -> close in finally) inside an Express handler"
    - "Validate-before-write: dimension allowlist + per-dimension range check + overridden_by string/length cap all reject with 400 before any store write"
    - "Dynamic import of the experiment store modules inside the handler to keep VKB server boot decoupled from km-core"
    - "experimentRepoRoot injection + Object.create(ApiRoutes.prototype) to unit-test a handler against an isolated store without the heavy DatabaseManager constructor"

key-files:
  created:
    - tests/experiments/score-override-endpoint.test.mjs
  modified:
    - lib/vkb-server/api-routes.js

key-decisions:
  - "Endpoint home = api-routes.js (the in-container VKB Express surface). The host .data/ is bind-mounted to /coding/.data (docker-compose.yml:77) and CODING_REPO=/coding (line 44), so the in-container VKB process reaches /coding/.data/experiments/leveldb. No experiment-specific bind-mount is needed — the broad .data mount covers it."
  - "Single-owner LevelDB honored by opening transiently per request (open -> applyOverride -> close in finally), matching the measure-stop/recompute transient-open pattern. No long-lived owner holds the lock."
  - "Score writes route through openExperimentStore/applyOverride only — never UKBDatabaseWriter / the shared KG (D-07 reuse-not-new-server, divergence per 73-PATTERNS.md §api-routes.js)."
  - "regressions validated as binary {0,1}; the other four dimensions validated as continuous [0,1]."
  - "overridden_by required as a non-empty string with a 256-char cap (T-73-05-03 injection mitigation)."

patterns-established:
  - "Transient-open experiment-store write from an Express handler"
  - "Allowlist + range + type validation returning 400 before any side effect"

requirements-completed: [SCORE-02]

# Metrics
duration: ~15min
completed: 2026-06-28
---

# Phase 73 Plan 05: Score Override Endpoint Summary

**Validated PATCH /api/experiments/scores/:taskId that writes a per-dimension human override (corrected_* + overridden_by/at) to the dedicated experiment LevelDB via applyOverride — judged fields preserved, invalid input rejected with 400, missing Score with 404.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 1 (+1 created)

## Accomplishments
- Confirmed and documented experiment-store reachability for the hosting process (Task 1 decision) and locked the endpoint home to the existing Express surface.
- Shipped `handleScoreOverride`: full input validation (dimension allowlist, per-dimension value range, overridden_by string/length cap) with all rejections returning 400 **before** any store write.
- Wired the Score path to the dedicated experiment store via `openExperimentStore`/`applyOverride` (transient open/close), never `UKBDatabaseWriter`/the shared KG.
- 6 endpoint tests covering validation 400s, the 200 happy path (corrected_* + stamp set, judged fields untouched per D-06), regressions binary guard, and the 404 no-Score path — all green.

## Task 1 — Reachability decision (recorded)

- **Hosting process:** `ApiRoutes` is mounted by `lib/vkb-server/express-server.js` (`createServer` -> `apiRoutes.registerRoutes(app)`), started standalone under Docker/supervisord on port 8080 inside the **coding-services** container.
- **Reachability:** `docker-compose.yml:77` bind-mounts host `.data` -> `/coding/.data`, and `CODING_REPO=/coding` (line 44). `openExperimentStore()` resolves `path.join(CODING_REPO, '.data/experiments/leveldb')` = `/coding/.data/experiments/leveldb`, which maps to the host `.data/experiments/leveldb`. So the in-container VKB process **can** open the dedicated experiment store.
- **`grep -nE "experiments|active-measurement" docker/docker-compose.yml`** returns no experiment-specific line — there is no dedicated experiments bind-mount; the broad `.data` mount (line 77) covers `.data/experiments/`. This does not indicate host-side-only hosting: the container reaches the store via the `.data` mount.
- **Single-owner collision avoided:** the handler opens the store transiently (open -> `applyOverride` -> `close()` in `finally`) per request — the same transient-open posture as measure-stop/recompute. No long-lived owner holds the LevelDB lock, so no collision under normal operation.
- **Conclusion:** endpoint home = `lib/vkb-server/api-routes.js` (D-07 reuse-not-new-server). Score writes go through `openExperimentStore`/`applyOverride`, NOT `UKBDatabaseWriter`.

## Task Commits

1. **Task 2: PATCH override endpoint + validation + tests** - `e3bbff625` (feat)

_Task 1 produced the reachability decision (documented above); it created no code artifact and is captured in this SUMMARY._

## Files Created/Modified
- `lib/vkb-server/api-routes.js` - Added `app.patch('/api/experiments/scores/:taskId', ...)` route, `handleScoreOverride` controller (validate -> transient experiment-store open -> applyOverride -> close), and an `experimentRepoRoot` constructor option for test isolation.
- `tests/experiments/score-override-endpoint.test.mjs` - 6 tests: unknown dimension 400, out-of-range continuous value 400, regressions binary 400/200, missing/empty overridden_by 400, valid override 200 with judged-untouched assertions (D-06), and no-Score 404.

## Decisions Made
See `key-decisions` in frontmatter. Notably: the broad `.data` bind-mount makes the in-container VKB process the correct host for the endpoint (no host-side relocation needed), and per-request transient store open honors the single-owner LevelDB constraint.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Two read-only `grep` verification calls were blocked by the no-console-log constraint monitor because the command string literally contained the `console.(log|error|warn)` pattern. Resolved by running the console-pattern grep as its own isolated command and the other acceptance greps individually with `grep -c`. No code change required; the source itself contains no `console.*` (verified — grep exit 1).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SCORE-02 storage contract is testable via the API. Phase 74's Performance tab (D-07) can wire override UI controls against this endpoint.
- No blockers. The endpoint relies on a populated experiment store at `.data/experiments/leveldb`; in production this is reached in-container via the `.data` bind-mount.

## Self-Check: PASSED
- FOUND: lib/vkb-server/api-routes.js (handleScoreOverride x3, patch route x1, applyOverride x7, allowlist line present)
- FOUND: tests/experiments/score-override-endpoint.test.mjs (6 tests, all pass via `node --test`)
- FOUND commit: e3bbff625
- No `console.*` in api-routes.js (grep exit 1)

---
*Phase: 73-semantic-route-judge-success-scoring*
*Completed: 2026-06-28*

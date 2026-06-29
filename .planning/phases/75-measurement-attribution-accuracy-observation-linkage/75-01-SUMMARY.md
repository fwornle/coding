---
phase: 75-measurement-attribution-accuracy-observation-linkage
plan: 01
subsystem: testing
tags: [node-test, jest, playwright, token-attribution, observation-recapture, tdd-red, wave-0]

# Dependency graph
requires:
  - phase: 71-knowledge-base-ontology
    provides: aggregateByTaskId readonly token aggregation (token-aggregate.mjs)
  - phase: 69-claude-copilot-adapters
    provides: buildClaudeTokenRows extractor + token-db insert/dedup + ADAPTER_USER_HASH_* constants
provides:
  - "RED node:test for canonical derivation + fg/bg segregation (ATTR-01/02) — locks isForegroundGroup + canonical!=byAgentModel[0]"
  - "RED node:test for the per-agent stop-adapter registry (ATTR-03/D-04) — claude->transcript, copilot/opencode/mastra->stamp-only, no double-count"
  - "RED jest test for OBS-02 event-time re-capture + OBS-01 task_id, built from the e0af5b8b fixture"
  - "RED playwright spec for the ATTR-02 two-column model render + empty-canonical sentinel + a 'performance' playwright project"
  - "Two owned fixtures: main-session.jsonl (non-subagent transcript) + e0af5b8b-recapture.jsonl (typed prompt @T0 + decisions @T0+n)"
affects: [75-02-canonical-derivation, 75-03-stop-adapter-registry, 75-05-etm-recapture, 75-06-dashboard-two-column]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 RED-by-absent-export: tests import not-yet-existing exports/modules so each downstream plan has a pre-existing failing test (Nyquist)"
    - "Env-gated live assertions (EXPERIMENTS_LIVE) never a --live argv (MEMORY reference_node_test_argv_live_gate)"
    - "Offline-guarded playwright spec (test.skip when :3032 unreachable) so a RED e2e never hard-fails the suite"

key-files:
  created:
    - tests/experiments/canonical-attribution.test.mjs
    - tests/lsl/token/stop-adapter-registry.test.mjs
    - tests/lsl/token/_fixtures/main-session.jsonl
    - tests/live-logging/ETM-recapture.test.js
    - tests/live-logging/_fixtures/e0af5b8b-recapture.jsonl
    - tests/e2e/performance/canonical-columns.spec.ts
  modified:
    - playwright.config.ts

key-decisions:
  - "ETM re-capture test targets a new module lib/live-logging/etm-recapture.mjs (computeRecaptureFires) — the Plan 05 refactor target — rather than the ETM daemon class, so RED is a clean missing-module, not a daemon-boot failure"
  - "Added a 'performance' playwright project (testDir tests/e2e/performance, baseURL :3032) — the spec was otherwise undiscoverable because every project carries an explicit testDir (Rule 3 blocking fix)"
  - "stop-adapter-registry test seeds its own (user_hash,id) PK token_usage temp DB so captureForegroundTokens' openTokenDb+insertTokenRowDeduped path can write cladpt rows"

patterns-established:
  - "Wave 0 RED-by-absent-export — failing only on absent downstream exports/modules, never on syntax errors"
  - "Two-runner split honored: .mjs token/experiment tests via node --test; .js ETM/ObservationWriter tests via jest"

requirements-completed: []  # Wave 0 authors RED scaffolds; ATTR-01/02/03 + OBS-01/02 are discharged when Plans 02/03/05/06 turn these tests green.

# Metrics
duration: 6min
completed: 2026-06-29
---

# Phase 75 Plan 01: RED Test Scaffolds & Fixtures Summary

**Four RED test artifacts (2 node:test .mjs, 1 jest .js, 1 playwright .ts) + 2 owned transcript fixtures that lock the canonical-derivation, no-double-count, and OBS-02 event-time acceptance shapes before any seam is touched.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-29T10:07:12Z
- **Completed:** 2026-06-29T10:12:43Z
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments
- `canonical-attribution.test.mjs` — seeds the exact `exp-dash-start-control` shape (small cladpt Opus foreground + huge c197ef haiku daemon flood) and asserts `isForegroundGroup` segregates them and canonical = the Opus model, NEVER `byAgentModel[0]` (the finding-B fix). RED via the absent Plan 02 `isForegroundGroup` export.
- `stop-adapter-registry.test.mjs` — asserts `STOP_ADAPTERS.claude` is a transcript adapter (cladpt + build) while copilot/opencode/mastra are stamp-only with NO build (the D-04 double-count guard), and `captureForegroundTokens` stamps the active task_id and inserts nothing for stamp-only agents. RED via the absent Plan 03 module.
- `ETM-recapture.test.js` (jest) — built from the `e0af5b8b` fixture; asserts ≥2 observations, ≥1 dated in the 05:30–06:03Z window (not the 21:00:43Z prompt-set start), every obs carrying a non-empty `metadata.task_id`, and no duplicate `(task_id, batch-last-message-uuid)` key. RED via the absent Plan 05 `lib/live-logging/etm-recapture.mjs`.
- `canonical-columns.spec.ts` — playwright spec asserting the two model columns + the "unmeasured"/"—" sentinels; discoverable via the new `performance` project; offline-guarded so it never hard-fails without a live dashboard.

## Task Commits

1. **Task 1: token-attribution RED tests (canonical derivation + adapter registry)** - `cf68fe94a` (test)
2. **Task 2: OBS-02 event-time RED jest fixture + observation re-capture test** - `bb0572618` (test)
3. **Task 3: ATTR-02 dashboard two-column e2e spec skeleton** - `d2385f26c` (test)

## Files Created/Modified
- `tests/experiments/canonical-attribution.test.mjs` - RED node:test for fg/bg derivation + canonical (ATTR-01/02), imports `isForegroundGroup` + `aggregateByTaskId`
- `tests/lsl/token/stop-adapter-registry.test.mjs` - RED node:test for per-agent registry dispatch (ATTR-03/D-04), imports `STOP_ADAPTERS` + `captureForegroundTokens`
- `tests/lsl/token/_fixtures/main-session.jsonl` - owned non-subagent transcript (usage block + thinking block); parses through `buildClaudeTokenRows` to per-turn + per-reasoning-step rows
- `tests/live-logging/ETM-recapture.test.js` - RED jest test for OBS-02 event-time + OBS-01 task_id (e0af5b8b acceptance)
- `tests/live-logging/_fixtures/e0af5b8b-recapture.jsonl` - typed prompt @2026-06-28T21:00:43Z + 5 AskUserQuestion decision pairs @05:30–06:03Z, each msg unique uuid+timestamp
- `tests/e2e/performance/canonical-columns.spec.ts` - RED e2e two-column render + empty-canonical sentinel (ATTR-02)
- `playwright.config.ts` - added the `performance` project so the spec is discoverable

## Decisions Made
- **ETM test target.** The Plan 05 mid-set fire logic does not yet exist on the ETM daemon. Rather than booting the daemon class, the test imports a not-yet-existing `lib/live-logging/etm-recapture.mjs` exporting `computeRecaptureFires(messages, opts)` returning per-batch observation descriptors (`created_at`, `metadata.task_id`, `dedupKey`). This pins the fire-boundary + timestamp + dedup contract and produces a clean RED (`Cannot find module`). Plan 05 must create this module (or expose the same function from the refactor) to turn the test green.
- **stop-adapter temp-DB schema.** The registry's `captureForegroundTokens` writes through `openTokenDb` + `insertTokenRowDeduped`, which use a `(user_hash, id)` PK and the full 21-column adapter INSERT. The test creates a matching temp table so the cladpt insert path is exercised end-to-end.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a `performance` playwright project so the spec is discoverable**
- **Found during:** Task 3 (dashboard two-column e2e spec)
- **Issue:** `playwright.config.ts` registers projects with explicit `testDir`s (`tests/e2e/unified-viewer`, `tests/e2e/dashboard`). A spec at `tests/e2e/performance/` was not picked up — `npx playwright test tests/e2e/performance/canonical-columns.spec.ts --list` returned "No tests found", failing Task 3's acceptance gate.
- **Fix:** Added a `performance` project (testDir `tests/e2e/performance`, baseURL `http://localhost:3032`) mirroring the existing `dashboard` project.
- **Files modified:** playwright.config.ts
- **Verification:** `npx playwright test tests/e2e/performance/canonical-columns.spec.ts --list` now lists all 3 tests under `[performance]`.
- **Committed in:** d2385f26c (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for Task 3's discoverability acceptance criterion. No scope creep — a single project entry mirroring the established pattern.

## Issues Encountered
None. All three verification gates returned RED-as-expected / spec-discovered on the first run.

## Known Stubs
None. All artifacts are test scaffolds + fixtures; the RED state is the intended Wave 0 outcome (each downstream plan turns its named test green). No production stubs introduced.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Plan 02** (canonical derivation): turn `canonical-attribution.test.mjs` green by adding `isForegroundGroup` + `user_hash`/`process` to `byAgentModel` in `lib/experiments/token-aggregate.mjs`.
- **Plan 03** (stop-adapter registry): turn `stop-adapter-registry.test.mjs` green by creating `lib/lsl/token/stop-adapter-registry.mjs` with `STOP_ADAPTERS` + `captureForegroundTokens`.
- **Plan 05** (ETM re-capture): turn `ETM-recapture.test.js` green by creating `lib/live-logging/etm-recapture.mjs` (`computeRecaptureFires`) and wiring the mid-set fire boundary in the ETM.
- **Plan 06** (dashboard): turn `canonical-columns.spec.ts` green by adding the two model columns + `data-testid="run-canonical-model"` / `run-background-models` and the `unmeasured`/`—` sentinels.

## Self-Check: PASSED

All 6 created artifacts + the SUMMARY exist on disk; all 3 task commits (`cf68fe94a`, `bb0572618`, `d2385f26c`) present in git log.

---
*Phase: 75-measurement-attribution-accuracy-observation-linkage*
*Completed: 2026-06-29*

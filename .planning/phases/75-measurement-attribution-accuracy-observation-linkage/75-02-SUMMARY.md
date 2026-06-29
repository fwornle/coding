---
phase: 75-measurement-attribution-accuracy-observation-linkage
plan: 02
subsystem: experiments-attribution
tags: [token-attribution, canonical-derivation, foreground-background, run-metadata, node-test, tdd-green, wave-2]

# Dependency graph
requires:
  - phase: 75-01
    provides: "RED canonical-attribution.test.mjs (isForegroundGroup + canonical!=byAgentModel[0] contract)"
  - phase: 71-knowledge-base-ontology
    provides: "aggregateByTaskId readonly token aggregation + writeRun Run.metadata path"
provides:
  - "isForegroundGroup(group) — aggregation-time fg/bg lineage classifier (ATTR-01)"
  - "byAgentModel rows carry user_hash + process (read-side derivation, no proxy-DB schema change)"
  - "writeRun persists canonical_model / canonical_agent / background_models[] on Run.metadata (ATTR-02/D-06)"
  - "empty canonical persists as null — never a dominant-by-count fallback (D-05)"
affects: [75-03-stop-adapter-registry, 75-06-dashboard-two-column]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-time lineage derivation: fg/bg computed from user_hash + a denylist regex at aggregation time, no column on the proxy-owned token-usage.db (survives re-aggregation, D-14)"
    - "Denylist-overrides-adapter-hash: BACKGROUND_PROCESS_RE wins even on a cladpt row so a daemon can't masquerade as foreground (T-75-23)"
    - "null-as-meaningful: empty canonical persists as null, background_models as [] — never zero/dominant coercion"

key-files:
  created: []
  modified:
    - lib/experiments/token-aggregate.mjs
    - lib/experiments/run-write.mjs
    - tests/experiments/token-aggregate.test.mjs
    - tests/experiments/run-write.test.mjs

key-decisions:
  - "Canonical-persistence RED tests were authored in run-write.test.mjs (not canonical-attribution.test.mjs, which only imports the aggregation layer) — the natural home for writeRun assertions, exercising the real isolated km-core experiment store"
  - "Stale token-aggregate.test.mjs fixture updated to add user_hash/process columns the real proxy token_usage.db already carries — the older fixture lagged production schema and blocked the now-correct SELECT (Rule 3 blocking fix)"
  - "query.mjs left unchanged: readRuns already spreads ...meta, so the three new metadata fields auto-flow; proven by a readRuns test assertion rather than a code edit"

requirements-completed: [ATTR-01, ATTR-02]

# Metrics
duration: 5min
completed: 2026-06-29
---

# Phase 75 Plan 02: Canonical Attribution Derivation & Persistence Summary

**Aggregation-time foreground/background lineage classifier (`isForegroundGroup`) plus once-computed canonical_model/canonical_agent/background_models[] persisted on Run.metadata — turning the finding-B mis-measure (1.24M haiku daemon tokens out-massing the Opus foreground) into a correct, null-safe canonical source-of-truth with no proxy-DB schema change.**

## Performance
- **Duration:** ~5 min
- **Started:** 2026-06-29T10:15Z
- **Completed:** 2026-06-29T10:20Z
- **Tasks:** 2
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments
- **ATTR-01 (Task 1):** Added exported `isForegroundGroup(group)` to `token-aggregate.mjs` implementing `FOREGROUND_USER_HASHES.has(user_hash) && !BACKGROUND_PROCESS_RE.test(process)`, with the regex (`/^(consolidator-|health-coordinator$|observation-writer$|backfill$|reproject-|route-judge$)/`) and Set (`['cladpt','copadt']`) taken verbatim from 75-RESEARCH. Added `user_hash` + `process` to the `byAgentModel` SELECT and GROUP BY so the classifier keys off them — derived at READ time, no column added to the proxy-owned DB.
- **ATTR-02/D-06 (Task 2):** Added `canonical_model`, `canonical_agent`, and `background_models[]` to `writeRun`'s Run metadata block (same `t`/tags accessor as the existing 8 tags). Empty canonical persists as `null` and background_models defaults to `[]` (D-05 — never a dominant fallback, never `?? 0`). The existing idempotent same-node update path preserves the fields across re-close.
- **Self-healing preserved:** the fg/bg derivation lives entirely on the read side, so re-running `aggregateByTaskId` after a backfill re-attributes orphan rows AND re-derives lineage (D-14).
- **Acceptance command green:** `tests/experiments/canonical-attribution.test.mjs` (the Wave-1 RED contract) now passes — canonical = the Opus foreground model, asserted `!= byAgentModel[0]` (the haiku daemon).

## Task Commits
1. **Task 1: aggregation-time fg/bg lineage classifier (ATTR-01)** — `706accabe` (feat)
2. **Task 2: persist canonical_model + background_models[] on Run.metadata (ATTR-02/D-06)** — `c9caa36ed` (feat)

## Files Created/Modified
- `lib/experiments/token-aggregate.mjs` — exported `isForegroundGroup` + denylist regex/Set; `user_hash`+`process` in the byAgentModel SELECT/GROUP BY; readonly + bound-param discipline preserved.
- `lib/experiments/run-write.mjs` — three canonical fields in the Run metadata block; null/`[]` defaults; no zero-coercion.
- `tests/experiments/token-aggregate.test.mjs` — fixture schema extended with `user_hash`/`process` columns (matches real proxy schema).
- `tests/experiments/run-write.test.mjs` — 4 new ATTR-02/D-05/D-06 canonical-persistence tests (explicit-values, absent→null/[], idempotent re-close, readRuns ...meta surfacing).

## Decisions Made
- **Canonical-persistence tests in run-write.test.mjs.** The plan's acceptance text referenced "canonical-persistence assertions in canonical-attribution.test.mjs", but that Wave-1 file only imports the aggregation layer (`aggregateByTaskId` + `isForegroundGroup`) and never exercises `writeRun`. The correct TDD home for writeRun persistence assertions is `run-write.test.mjs`, which opens the real isolated km-core experiment store with the live ontology. Authored 4 RED tests there, then turned them green. The aggregation half of the acceptance (the actual `canonical-attribution.test.mjs` file) is green via Task 1.
- **query.mjs untouched.** `readRuns` already does `{ ...meta, score, outcome }` (query.mjs:107), so the three new metadata fields surface automatically. Verified by a dedicated `readRuns` test assertion instead of editing query.mjs — matching the plan's "if it already spreads metadata, make NO change and assert it in the test" instruction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stale token-aggregate.test.mjs fixture to add user_hash/process columns**
- **Found during:** Task 1 verification
- **Issue:** The older `token-aggregate.test.mjs` `createTokenUsageTable` helper builds a temp table WITHOUT `user_hash`/`process`. The now-correct byAgentModel SELECT (which references those columns, present in the real proxy `token_usage.db`) raised `SQLITE_ERROR` against the lagging fixture, failing 5 previously-green tests.
- **Fix:** Added `process TEXT NOT NULL DEFAULT ''` and `user_hash TEXT NOT NULL DEFAULT ''` to the fixture table (additive; defaults keep all existing inserts and group counts unchanged since the two columns are constant `''` across the older rows).
- **Verification:** Confirmed the real `.data/llm-proxy/token-usage.db` schema carries both columns (`PRAGMA table_info`) before editing — the fixture was simply stale, not the SELECT.
- **Files modified:** tests/experiments/token-aggregate.test.mjs
- **Committed in:** 706accabe (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). No architectural changes, no new packages.

## Threat Surface
No new trust boundaries introduced. T-75-21 (no proxy-DB schema change), T-75-22 (task_id stays a bound `?`; user_hash/process are GROUP BY identifiers, not user input), and T-75-23 (denylist overrides adapter hash) all hold as designed in the plan's threat register.

## Known Stubs
None. Both seams are wired to real data paths; the canonical/background values are populated by the upstream stop-orchestrator (the caller that passes the computed tags into `writeRun`). When a caller passes no canonical tags, `null`/`[]` is the intended D-05 "unmeasured" state, not a stub.

## Issues Encountered
One blocking fixture-schema mismatch (documented above as Rule 3), resolved on the first pass. No fix-attempt-limit pressure.

## Self-Check: PASSED

- Modified files exist: `lib/experiments/token-aggregate.mjs`, `lib/experiments/run-write.mjs`, `tests/experiments/{token-aggregate,run-write}.test.mjs` — all present.
- Commits exist: `706accabe`, `c9caa36ed` — both in `git log`.
- Acceptance: `node --test tests/experiments/canonical-attribution.test.mjs tests/experiments/token-aggregate.test.mjs tests/experiments/run-write.test.mjs` → 24 pass / 0 fail / 2 skipped (live-gated).

---
*Phase: 75-measurement-attribution-accuracy-observation-linkage*
*Completed: 2026-06-29*

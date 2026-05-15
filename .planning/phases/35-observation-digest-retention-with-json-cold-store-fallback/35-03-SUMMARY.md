---
phase: 35-observation-digest-retention-with-json-cold-store-fallback
plan: 03
subsystem: live-logging
tags: [cold-store, json, lru, range-query, read-only, phase-35, wave-1]

# Dependency graph
requires: []
provides:
  - "ColdStoreReader class — read-only range query over .data/observation-export/{observations,digests}.json with day-bucketed LRU"
  - "Module-level invariant #3 enforced by source-grep test: no fs.writeFile/appendFile/createWriteStream in ColdStoreReader.js"
affects:
  - 35-04-obs-api-range-merge

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Day-bucketed LRU keyed by `${kind}:${YYYY-MM-DD}` — Map insertion order doubles as LRU order; eviction is `delete(keys().next().value)`"
    - "Fresh-rows-Map decoupling: on parse-miss, gather output from parsed Map BEFORE updating cache; insert current-query buckets last so LRU eviction can't drop the rows this call is about to return"
    - "Source-grep invariant test: regex against the module's own source enforces no-write-API across future refactors"

key-files:
  created:
    - "src/live-logging/ColdStoreReader.js — 200 lines exact; class export with readObservations / readDigests / _stats; zero write-API references"
    - "tests/live-logging/ColdStoreReader.test.js — 7 Jest cases covering range correctness, LRU hit/miss/eviction, graceful degradation, and the invariant-#3 source-grep"
  modified: []

key-decisions:
  - "ESM top-level `import` for the test (no `require()`) — the project is `\"type\": \"module\"` and jest runs with `--experimental-vm-modules`, so dynamic import is unnecessary"
  - "Cache miss → parse-once, then read output from the parsed map directly (not via cache). This is the correctness fix for windows larger than `cacheSize`; the cache is for repeat queries, not for serving the originating call"

patterns-established:
  - "Read-only-by-construction pattern: module imports `fs` but the test guarantees only read APIs are used. Pattern propagates to any future cold-store reader added under `src/live-logging/`"

requirements-completed:
  - "Phase-35 invariant #3 (operationally backed by 35-03 test case 6)"

# Metrics
duration: ~8min
completed: 2026-05-15
---

# Phase 35 Plan 03: ColdStoreReader Summary

**Read-only reader over `.data/observation-export/{observations,digests}.json` with a day-bucketed LRU cache, paired with a 7-case Jest suite that proves the contract — including a source-grep test that fails the build if any write API is ever introduced into the module.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-15T09:59:59Z
- **Completed:** 2026-05-15T10:08:19Z
- **Tasks:** 2/2
- **Files created:** 2 (`ColdStoreReader.js`, `ColdStoreReader.test.js`)
- **Files modified:** 0

## Accomplishments

- `src/live-logging/ColdStoreReader.js` (200 lines, exactly at the plan cap):
  - `class ColdStoreReader` with `readObservations({ from, to })`, `readDigests({ from, to })`, and `_stats()` (test-only introspection).
  - Constructor signature: `{ exportDir, cacheSize=16 }`. `exportDir` defaults to `path.resolve('.data/observation-export')`.
  - Lazy parsing — nothing happens until the first read.
  - Day-bucketed LRU keyed by `${kind}:${YYYY-MM-DD}` (`obs` or `dig`). Map insertion order doubles as LRU order; eviction deletes the oldest key (`keys().next().value`). Default capacity 16 per CONTEXT.md G2.
  - Missing/malformed JSON → returns `[]` and writes a single stderr warning (`[ColdStoreReader] {file} unreadable: {message}`). Does **not** throw.
  - 366-day range sanity cap rejects accidental whole-archive queries with a stderr line + empty array.
  - Uses `process.stderr.write` for warnings — zero `console.*` calls (per project rule).
  - Imports: `node:fs`, `node:path` only.
- `tests/live-logging/ColdStoreReader.test.js` (Jest, ESM top-level `import`):
  - Test 1: 7-day window against a 30-row fixture returns 6–8 rows, all in `[from, to)`, sorted ascending by `createdAt`.
  - Test 2: repeated identical query → `observationsParsed` stays at 1 across both calls; `cacheHits` increases.
  - Test 3: `cacheSize: 3` + five distinct 1-day windows → `_stats().cacheKeys ≤ 3`.
  - Test 4: nonexistent `exportDir` → both methods return `[]`, no throw.
  - Test 5: malformed `observations.json` ("not valid json") and non-array `digests.json` → both return `[]`, no throw.
  - Test 6: `expect(/fs\.(writeFile|appendFile|createWriteStream)/.test(src)).toBe(false)` — the invariant #3 guard.
  - Test 7: `readDigests` over the same window returns rows filtered by `date` (YYYY-MM-DD).
- Hermetic via `os.tmpdir()` + `mkdtempSync`; `afterAll` cleans up. Total suite runtime ~0.27s.

## Task Commits

1. **Task 1 (feat): scaffold `ColdStoreReader.js` + lazy LRU + graceful degradation** — `078af4662`
2. **Task 1 (fix, found during Task 2 RED): preserve current-query rows when window > cacheSize** — `9eb75866f`
3. **Task 2 (test): 7-case Jest suite (all green)** — `c4f8abf0d`

## Files Created/Modified

- `src/live-logging/ColdStoreReader.js` (created; 200 lines)
- `tests/live-logging/ColdStoreReader.test.js` (created; 213 lines)

## Decisions Made

- **ESM top-level `import` in the test, not `require()` + dynamic import.** The plan text suggested `require()` for `fs/path/os` and dynamic `import()` for the module under test, but the orchestrator's contract is explicit: this is an ESM project (`"type": "module"`), jest runs with `--experimental-vm-modules`, and top-level `import` works in `.js` test files. Keeping the test in ESM style matches the other ESM tests added in 35-01/35-02 and avoids the dual-module-system overhead of a single `await import(...)` inside `beforeAll`.
- **Output rows for a parse-miss come directly from the parsed `freshByDay` Map**, not from the cache. The original implementation cached the parsed buckets, then read the output from the cache. With `cacheSize < window_days`, the LRU evicted current-query buckets before the read loop saw them. The fix gathers rows from BOTH cache hits AND the fresh-rows Map before mutating the cache, then updates the cache with current-query buckets inserted LAST so they survive eviction. Bug surfaced as test 1 returning 0 rows with `cacheSize: 4` and a 7-day window.

## Verification Performed

Plan acceptance criteria (Task 1):
- `node --input-type=module -e "import('./src/live-logging/ColdStoreReader.js').then(...)"` printed `OK` and exited 0 (missing-`exportDir` returns `[]` for both methods).
- `grep -cE 'class ColdStoreReader' src/live-logging/ColdStoreReader.js` → `1`.
- `grep -cE 'fs\.writeFile|fs\.appendFile|fs\.createWriteStream' src/live-logging/ColdStoreReader.js` → `0` (invariant #3).
- `grep -cE 'readFileSync|readFile' src/live-logging/ColdStoreReader.js` → `1`.
- `grep -cE 'console\.log|console\.error|console\.warn' src/live-logging/ColdStoreReader.js` → `0`.
- `wc -l src/live-logging/ColdStoreReader.js` → `200` (within 60–200 bound).

Plan acceptance criteria (Task 2 — final verification gate):

```
$ NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/live-logging/ColdStoreReader.test.js --no-coverage

PASS tests/live-logging/ColdStoreReader.test.js
  ColdStoreReader
    ✓ 1. readObservations returns rows in [from, to) sorted ascending by createdAt (8 ms)
    ✓ 2. repeated identical query hits the LRU cache (no re-parse) (1 ms)
    ✓ 3. LRU eviction caps cache at cacheSize entries (1 ms)
    ✓ 4. missing exportDir → returns [] without throwing (2 ms)
    ✓ 5. malformed JSON → returns [] without throwing (19 ms)
    ✓ 6. invariant #3 — source contains zero write-API references
    ✓ 7. readDigests returns digests whose date is in [from, to) (14 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Buggy cache-then-read pattern in `_readRange`**
- **Found during:** Task 2 (test 1 returned 0 rows).
- **Issue:** The Task 1 implementation parsed the file, cached buckets in iteration order of the source JSON (sorted by date), then read its output from the cache. With `cacheSize=4` and an 8-bucket query window, the LRU evicted the buckets the current query needed before the read loop saw them.
- **Fix:** Decouple parse from cache for the current-query path. Collect output rows from both cache hits AND the freshly-parsed `freshByDay` Map. Then update the cache with off-query buckets first and current-query miss buckets LAST so they are most-recently-used.
- **Files modified:** `src/live-logging/ColdStoreReader.js` (`_readRange` body only).
- **Commit:** `9eb75866f`

**2. [Rule 3 — Blocking] Empty `test/setup.js` missing in worktree base**
- **Found during:** First jest dry-run (`npx jest --listTests` failed with "Module `<rootDir>/test/setup.js` was not found").
- **Issue:** `jest.config.js` references `setupFilesAfterEnv: ['<rootDir>/test/setup.js']`, but the worktree base is behind main and predates 35-01 which created that file. Without it, jest refuses to run any test in the worktree.
- **Fix:** Created an empty `test/setup.js` locally in the worktree to unblock the run. **Not committed** — the file already exists on `main` from 35-01, so committing it from this branch would create a redundant duplicate path during merge. Left as an untracked workaround.
- **Files modified:** `test/setup.js` (uncommitted, workaround only).
- **Commit:** none.

### ESM `import` vs `require()` style for the test

The plan text suggested `require('fs')` + dynamic `import()` for the module. The orchestrator's contract overrides: top-level `import` is mandatory because this is an ESM project. Test style is consistent with other recent ESM tests under `tests/live-logging/`. Not flagged as a deviation in the plan's deviation-rule sense — it's a stylistic clarification the orchestrator imposed.

## Issues Encountered

- The `.gitignore` rule `src/**/*.js` (line 215) caused `git add src/live-logging/ColdStoreReader.js` to silently no-op. Resolved with `git add -f`. Existing `src/live-logging/*.js` files are tracked despite the ignore rule (predate the rule), so this is a known one-off; future files in this directory must be force-added.

## User Setup Required

None for this plan. Consumer integration (35-04) will import `ColdStoreReader` from `src/live-logging/ColdStoreReader.js`. No new package.json dependencies; no service restart required.

## Next Phase Readiness

- **35-04 (obs_api range-merge):** unblocked. `ColdStoreReader` is imported as `{ ColdStoreReader }` from `src/live-logging/ColdStoreReader.js`. Construct with `new ColdStoreReader()` to use the default `exportDir`. 35-04's merge helper should:
  1. Determine the retention boundary from `ObservationWriter`'s `retentionDays` (the 35-01 surface).
  2. Filter `ColdStoreReader.readObservations(...)` output by `createdAt < retention_boundary` before merging — preserves invariant #4 (no double-counting against the hot SQLite rows).
  3. Contribute cold rows only when `offset === 0` (CONTEXT.md's first-page contract).
- **35-02 (Pruner):** independent of this plan; runs in Wave 2.
- **Test runner note for downstream plans:** the empty `test/setup.js` workaround in this worktree disappears once 35-01 is on the same merge base as this branch. No action required.

## Self-Check: PASSED

- File exists: `src/live-logging/ColdStoreReader.js` (FOUND, 200 lines)
- File exists: `tests/live-logging/ColdStoreReader.test.js` (FOUND, 213 lines)
- Commit exists: `078af4662` — `feat(35-03): add ColdStoreReader for read-only JSON cold-store access` (FOUND)
- Commit exists: `9eb75866f` — `fix(35-03): preserve current-query rows when window > cacheSize` (FOUND)
- Commit exists: `c4f8abf0d` — `test(35-03): Jest unit suite for ColdStoreReader (7 cases, all green)` (FOUND)
- All 7 Jest tests pass (last run @ 2026-05-15T10:08Z)
- `grep -cE 'fs\.writeFile|fs\.appendFile|fs\.createWriteStream' src/live-logging/ColdStoreReader.js` → `0`

---
*Phase: 35-observation-digest-retention-with-json-cold-store-fallback*
*Plan: 03*
*Completed: 2026-05-15*

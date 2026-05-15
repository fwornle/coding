---
phase: 35-observation-digest-retention-with-json-cold-store-fallback
plan: 04
subsystem: observations
tags:
  - observability
  - retention
  - cold-store
  - obs-api
  - range-merge
dependency_graph:
  requires:
    - 35-01: retentionDays config + ObservationWriter plumbing
    - 35-02: ObservationPruner module
    - 35-03: ColdStoreReader module
  provides:
    - obs-api 1h in-process pruner
    - /api/observations cold-store range-merge (offset=0)
    - /api/digests cold-store range-merge (offset=0)
    - _metadata.coldOnFirstPageOnly contract for the frontend
    - pure-helper sibling module for test importability
  affects:
    - 35-05: dashboard backend pass-through reads _metadata field
tech_stack:
  added:
    - sibling-module extraction pattern (pure helpers separated from Express side-effects for Jest)
  patterns:
    - in-process setInterval, unref-ed, single instance
    - Set-based id dedup with LOAD-BEARING JSDoc marker
    - Express handler conditional gate on offset===0
    - merge-helper re-export for back-compat
key_files:
  created:
    - scripts/observations-api-merge.mjs
    - tests/scripts/observations-api-server.merge.test.js
  modified:
    - scripts/observations-api-server.mjs
decisions:
  - Extract _computeRetentionBoundary / _mergeObservations / _mergeDigests into a sibling module (scripts/observations-api-merge.mjs) instead of keeping them inline in observations-api-server.mjs. Reason - Jest moduleNameMapper cannot resolve obs-api server transitive TS dist deps (RetrievalService -> embedding-service.js) at test time, so importing the server module from a test breaks. The sibling-module pattern is the smallest fix; the server still re-exports the same symbols for any back-compat caller.
metrics:
  duration_minutes: 35
  tasks_completed: 2
  files_created: 2
  files_modified: 1
  test_cases: 12
  completed_date: 2026-05-15
---
# Phase 35 Plan 04: obs-api wiring (pruner setInterval + cold-store range-merge) Summary

## One-liner

Wires Phase 35 ObservationPruner (1h setInterval) and ColdStoreReader (range-merge on /api/observations and /api/digests at offset=0) into scripts/observations-api-server.mjs, with LOAD-BEARING Set-based id dedup and a 12-case Jest integration suite proving the invariants.

## What was built

### 1. In-process pruner on a 1h interval

ensurePruner() is called from the existing ensureWriter().then(() => { ensureRetrieval(); ensurePruner(); }) boot chain. It constructs one ObservationPruner instance bound to _writer.db + _writer.retentionDays (from 35-01), runs prune() once immediately for boot-time shrink, then schedules every PRUNE_INTERVAL_MS (1 hour) via setInterval. The interval is unref-ed so process shutdown is non-blocking; it is also cleared in the shutdown() function alongside _clearHeartbeat(). Errors in the immediate or periodic prune are logged to stderr but never thrown - obs-api boot must remain crash-free even if the pruner cannot run.

### 2. Cold-store range-merge on /api/observations and /api/digests

Both handlers got a conditional that fires the merge ONLY when:

1. from query parameter is present, AND
2. offset === 0 (first page only - checker WARNING 1 / Option B), AND
3. _writer.retentionDays is set, AND
4. from < retentionBoundary (or, for digests, the date-only equivalent)

When the gate fires, the handler calls ensureColdStore().readObservations({ from, to }) (or readDigests), feeds both the SQLite rows and cold rows through the appropriate merge helper, slices to the caller limit, and returns the merged data with _metadata: { fromColdStore, coldOnFirstPageOnly, sqliteRows, coldRows, retentionBoundary }. On any other path (offset>0, no from, or from >= retentionBoundary), the response is byte-equivalent to the pre-Phase-35 SQLite-only path plus an explicit _metadata: { fromColdStore: false } field.

### 3. Helpers extracted into scripts/observations-api-merge.mjs

_computeRetentionBoundary, _mergeObservations, and _mergeDigests live in a sibling module so the Jest integration test can import them without the full obs-api server module side effects (Express listen) or transitive dependency chain (RetrievalService -> embedding-service.js TS dist). The server module imports and re-exports the same symbols, so any caller that imported them from the server module before this plan still works.

### 4. LOAD-BEARING Set-based id dedup

The sqliteIds = new Set(sqliteRows.map(r => r.id)) filter inside both _mergeObservations and _mergeDigests is marked LOAD-BEARING in the JSDoc, with a pointer to PLAN.md invariant #5. Test case 3 (CRITICAL invariant #4/#5) seeds an overlapping id pair and asserts the merged data contains it exactly once with _origin: sqlite (the SQLite row wins by virtue of being prepended before the reshape pass).
## Verification gate

Local test run (verbatim PASS line, no operator action):

```
$ NODE_OPTIONS=--experimental-vm-modules --no-warnings npx jest tests/scripts/observations-api-server.merge.test.js --no-coverage
PASS tests/scripts/observations-api-server.merge.test.js
  Phase 35-04: _mergeObservations
    case 1: pure SQLite path returns sqliteRows unchanged with fromColdStore:false (8 ms)
    case 2: pure cold path returns reshaped cold rows with fromColdStore:true and coldOnFirstPageOnly:true (1 ms)
    case 3 (CRITICAL invariant #4/#5): shared id appears exactly once - Set-based dedup is LOAD-BEARING
    case 4: cold rows newer than retention boundary are filtered out
  Phase 35-04: _mergeDigests
    case 5: digests analog - keyed on date, Set-based dedup, _origin tagging (1 ms)
  Phase 35-04: _computeRetentionBoundary
    case 6: returns ISO-8601 string parseable by new Date() (1 ms)
    different retentionDays values produce different boundaries
  Phase 35-04: source-level invariants
    case 7: offset === 0 gate is present in both server handlers (at least 2 occurrences)
    LOAD-BEARING Set comment is present in the merge module (invariant #5 protection)
    Set-based dedup pattern is present in both merge helpers
    merge helpers are exported from the merge module
    obs-api server re-exports the merge helpers for back-compat

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Snapshots:   0 total
Time:        0.249 s, estimated 4 s
```

Upstream regression suites (also still green - run as part of the verification pass):

```
PASS tests/live-logging/ColdStoreReader.test.js  (7 cases)
PASS tests/live-logging/ObservationPruner.test.js  (5 cases)
Tests:       12 passed, 12 total
```
## Operator rollout (DO NOT run from the executor - this plan is non-autonomous)

The wiring is committed but not live until the host obs-api process restarts and re-imports the new modules. The operator runs:

```bash
launchctl kickstart -k gui/$(id -u)/com.coding.obs-api
```

(No output is normal. Exit code 0.) Then within 3 seconds the obs-api stderr log should carry the initial-prune line. Verify the 65-second pruner heartbeat checkpoint per the phase PLAN.md rollout checklist:

```bash
# 1. Health probe (expect ok + single-owner-rw):
sleep 3 && curl -fs http://localhost:12436/health | jq ".status, .role"

# 2. Initial-prune log line within 1m (record N/M deletion counts for the 24h-soak baseline):
log show --predicate "process == node" --last 1m --info | grep -E "\[ObservationPruner\]|\[obs-api\] initial prune"

# 3. Wait 65s, then re-check the log for the periodic-prune heartbeat (proves setInterval is wired):
sleep 65 && log show --predicate "process == node AND eventMessage CONTAINS [Pruner]" --last 2m | tail -5

# 4. _metadata contract on a 30d window at offset=0:
FROM_30D=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)
curl -fs "http://localhost:12436/api/observations?from=${FROM_30D}&limit=10&offset=0" | jq "._metadata"
# Expect: fromColdStore:true, coldOnFirstPageOnly:true, sqliteRows:N, coldRows:M, retentionBoundary:<iso>

# 5. offset>0 contract (cold rows NOT contributed):
curl -fs "http://localhost:12436/api/observations?from=${FROM_30D}&limit=10&offset=10" | jq "._metadata.fromColdStore"
# Expect: false

# 6. No-duplicate invariant on first page:
curl -fs "http://localhost:12436/api/observations?from=${FROM_30D}&limit=200&offset=0" | jq ".data | map(.id) | (length - (unique | length))"
# Expect: 0

# 7. /api/insights unchanged (sanity):
curl -fs "http://localhost:12436/api/insights" | jq ".total"
# Expect: unchanged from pre-rollout

# 8. 24h soak baseline:
du -h .observations/observations.db
# Record T+0 size; compare against T+24h after the 1h pruner has had time to settle.
```
## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Helpers extracted into sibling module scripts/observations-api-merge.mjs**

- **Found during:** Task 2 verification (running the Jest test)
- **Issue:** The plan Task 2 Change 7 asks for export { _mergeObservations, _mergeDigests, _computeRetentionBoundary } at the bottom of observations-api-server.mjs, and Change 8 asks the test to dynamic-import from there. Doing so failed with Configuration error: Could not locate module ../../dist/embedding/embedding-service.js - the obs-api server module import chain hits RetrievalService which references a TS dist that the project Jest moduleNameMapper cannot resolve at test time.
- **Fix:** Pulled the three pure helpers into a new sibling file (scripts/observations-api-merge.mjs). The server module imports + re-exports the same three symbols, satisfying the original plan contract for any caller that did import { ... } from observations-api-server.mjs. The test imports from the sibling module directly to dodge the side-effect chain.
- **Files modified:** scripts/observations-api-server.mjs (removed inline definitions, added import ... from ./observations-api-merge.mjs near the other ../src imports, kept the back-compat export { _mergeObservations, _mergeDigests, _computeRetentionBoundary } at the bottom).
- **Files created:** scripts/observations-api-merge.mjs (the new sibling module - 121 lines, pure functions only, no Express, no DB, no side effects on import).
- **Commit:** efeb112e5
- **Why this is Rule 3 (not Rule 4):** the extraction does not change the runtime behavior or response shape - it is a refactor of where the function definitions live to make the plan own testability contract work. The plan frontmatter files_modified lists only the server module + the test; adding a sibling module is documented here so the verifier can audit it.

## Known stubs

None. All wiring is end-to-end; the test exercises every helper. The frontend cold-store icon (35-05 Task 3) is intentionally deferred to 35-05 per the phase PLAN.md Resolutions during execute-phase wrap-up section.

## Threat flags

None new. The cold-store path is read-only (invariant #3, asserted by 35-03 test), the pruner cannot touch the insights table (invariant #2, asserted by 35-02 test), and the 4h dedup floor is unaffected (invariant #1, asserted by 35-01 test). This plan only adds an in-process scheduler + a conditional gate in two existing read handlers.

## Authentication gates

None - the obs-api process trusts host.docker.internal:12436 callers (single-owner pattern) and the rollout is a launchctl kickstart, not a credential dance.

## Self-Check: PASSED

- scripts/observations-api-server.mjs modified (commit efeb112e5 in branch)
- scripts/observations-api-merge.mjs created (commit efeb112e5)
- tests/scripts/observations-api-server.merge.test.js created (commit 6e3bba0ce)
- Jest test PASS: 12/12 cases (output quoted above)
- node --check scripts/observations-api-server.mjs exits 0
- node --check scripts/observations-api-merge.mjs exits 0
- Upstream tests still green (ColdStoreReader + ObservationPruner suites, 12 cases)
- Working tree clean post-commit

---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 06
subsystem: api
tags: [obs-api, sse, event-emitter, km-core, snapshot-manager, lsl, viewer-stats, trending-pattern, confidence-breakdown]

# Dependency graph
requires:
  - phase: 55-unified-viewer-feature-parity-with-vokb
    provides: "Plan 55-02 D-55-03 overlay schema extension (km-core borderStyle/pulseRule)"
  - phase: 44-rest-api-git-snapshots
    provides: "km-core canonical /api/v1 surface + {success,data} envelope contract + countByOntologyClass/lastModifiedByClass helpers (Plans 44-06, 44-14, 44-16)"
  - phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
    provides: "LSL filename convention (YYYY-MM-DD_HHMM-HHMM[-idx][_S{slot}-{idx}-{hash}][_partN]_<hash>.md)"
provides:
  - "GET /api/v1/stats — composed ViewerStats envelope (nodeCount/edgeCount/evidenceCount/patternCount/orphanCount/componentCount/connectivity/lastUpdated/activeSnapshot)"
  - "GET /api/v1/trends?top=N — TrendingPattern[] sorted DESC by trendScore = occurrenceCount * exp(-ageHours/720h)"
  - "GET /api/v1/entities/:id/confidence — ConfidenceBreakdown {overall, bands:{high,moderate,low}, segments[]} with 404 envelope for unknown id"
  - "GET /api/coding/observations/stream — SSE handler fanning out writer events to connected clients"
  - "GET /api/coding/lsl/sessions?since=<iso>&limit=<n> — LslSession[] walked from .specstory/history with env-overridable dir"
  - "ObservationWriter process-wide event bus: subscribeObservationWritten(listener) + 'written' event emitted on each successful putEntity"
  - "Test-only helpers: _emitObservationWrittenForTests + _resetObservationEmitterForTests (writer); mountV1RoutesForTest (obs-api)"
affects: [55-07-stats-bar, 55-10-trending-panel, 55-10-issue-triage-confidence, 55-11-lsl-timeline-strip, 55-12-etm-tail-sheet]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level Node EventEmitter for process-wide observation-write fan-out — sidesteps writer-init ordering and is the canonical 'write tap' pattern for SSE consumers in this codebase"
    - "Defensive try/catch around res.write inside SSE handler + req.on('close') unsubscribe = T-55-06-01 leak mitigation verified by integration test"
    - "kmRouter.get() registration AFTER app.use('/api/v1', kmRouter) — Express routes registered on the Router object at any time are picked up at request time (no re-mount required)"
    - "Env-overridable history dir (OBSERVATIONS_LSL_HISTORY_DIR) for filesystem-walk handlers — keeps the production path as default while enabling tmpdir-isolated integration tests"
    - "Phase 44 envelope reuse: {success,data} (200) + {success:false,error:'<code>'} (4xx/5xx) is the universal contract across all five new endpoints"

key-files:
  created:
    - "tests/integration/obs-api.v1-stats.test.js (10 tests)"
    - "tests/integration/obs-api.v1-trends.test.js (6 tests)"
    - "tests/integration/obs-api.v1-confidence.test.js (7 tests)"
    - "tests/integration/obs-api.coding-observations-stream.test.js (4 tests)"
    - "tests/integration/obs-api.coding-lsl-sessions.test.js (9 tests)"
    - ".planning/phases/55-unified-viewer-feature-parity-with-vokb/55-06-SUMMARY.md"
  modified:
    - "scripts/observations-api-server.mjs (+SnapshotManager import, +5 new HTTP handlers, +mountV1RoutesForTest hook on _testHooks)"
    - "src/live-logging/ObservationWriter.js (+EventEmitter module-level bus, +subscribeObservationWritten export, +2 test helpers, +emit('written', obsRow) after putEntity)"

key-decisions:
  - "ObservationWriter event bus is module-level (NOT per-instance) — production has at most one writer at any time and SSE consumers MUST be able to subscribe before the writer's lazy init completes"
  - "Module-level emitter caps at 32 listeners (above Node's default 10) — silences EventEmitter warning under transient multi-client conditions without masking a genuine leak"
  - "obs-api /trends scoring formula = occurrenceCount × exp(-ageHours / 720h) (30-day half-life) — exposed as TRENDS_HALFLIFE_HOURS constant for tunability; matches OKB convention"
  - "occurrenceCount falls back to metadata.provenance.confirmationCount when metadata.occurrences[] is absent — every Phase 39 confirmation counts as one occurrence (no extra writer-side bookkeeping required to land Plan 06)"
  - "Confidence endpoint uses the simpler plan-spec'd shape ({overall, bands, segments[]}) rather than the OKM ConfidenceBreakdown shape from okbClient.ts:88-109 — UI-SPEC §16 explicitly says the unified-viewer falls back to a client heuristic on 404, so the wire-shape contract is owned by Phase 55, not OKM"
  - "LSL handler's currently-running heuristic: endAt=null when the filename HHMM-HHMM window straddles `now` (Date.parse(endAt) > nowMs) — frontend LslTimelineStrip uses this to render the live pulse"
  - "T-55-06-04 cap: ?limit hard-capped at 500 (was 200 in initial sketch; raised to match the `LSL_MAX_LIMIT` constant the plan's threat register explicitly mentions)"
  - "Test infrastructure: env var OBSERVATIONS_LSL_HISTORY_DIR override keeps production-default behaviour while enabling deterministic tmpdir test fixtures — adding a config parameter to the obs-api module would have leaked test-only plumbing into production code"

patterns-established:
  - "EventEmitter at module scope is the canonical 'process-wide write tap' for SSE consumers — preferred over Redis pub/sub for in-process consumers (Redis is reserved for cross-process events, see _initRedis() in ObservationWriter)"
  - "Phase 55 endpoints universally adopt the Phase 44 envelope: success=true wraps `data`, success=false wraps `error`; no 5xx routes through the `_metadata` legacy shape"
  - "SSE handlers MUST defensively try/catch res.write — a closed connection mid-frame is normal, not a hard error"

requirements-completed: [UI-02]

# Metrics
duration: ~90min
completed: 2026-06-09
---

# Phase 55 Plan 06: Backend Endpoint Surface for Unified-Viewer Frontends Summary

**Adds five typed obs-api endpoints (`/api/v1/stats`, `/api/v1/trends`, `/api/v1/entities/:id/confidence`, `/api/coding/observations/stream` SSE, `/api/coding/lsl/sessions`) + a module-level ObservationWriter event bus, unblocking the Phase 55 StatsBar, TrendingPanel, IssueTriage Confidence, LslTimelineStrip, and EtmTailSheet frontend plans behind 36 GREEN integration tests with zero raw console.\* introduced.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 3 (all TDD, all GREEN — six commits: RED test + GREEN feat per task)
- **Files modified:** 2 (scripts/observations-api-server.mjs, src/live-logging/ObservationWriter.js)
- **Test files created:** 5
- **Tests added:** 36 (10 + 6 + 7 + 4 + 9), all GREEN
- **Total tests run:** 51 (Plan 06 + observation-writer.km-core regression + obs-api.legacy-endpoints.km-core regression), all GREEN

## Accomplishments

- **`/api/v1/stats`** composed in a single response from `countByOntologyClass()` + `lastModifiedByClass()` + raw `graph.degree()` walk for orphans + `SnapshotManager.listSnapshots()[0]` for the active snapshot — the unified-viewer StatsBar no longer needs to fan out across three legacy endpoints.
- **`/api/v1/trends`** scores Pattern-class entities by `occurrenceCount × exp(-ageHours / 30d)` with a 100-item upper cap, sorted DESC; wire-shape mirrors `okbClient.ts:62-78` so the frontend reuses the OKB TrendingPanel adapter.
- **`/api/v1/entities/:id/confidence`** averages `metadata.descriptionSegments[].confidence`, classifies into high/moderate/low bands (≥0.8 / ≥0.6 / else), and 404s cleanly so the frontend's client-heuristic fallback per UI-SPEC §16 fires unchanged.
- **`/api/coding/observations/stream`** SSE handler fans out the writer's new `'written'` event to all connected clients with `data: <json>\n\n` framing + `req.on('close')` unsubscribe — verified by an integration test that opens two concurrent connections and asserts both receive the same emit.
- **`/api/coding/lsl/sessions`** walks the LSL history dir (`OBSERVATIONS_LSL_HISTORY_DIR` env override → `.specstory/history` default), parses the Phase 51 filename convention via a single regex, applies `?since`/`?limit` (capped at 500), sorts DESC by `startAt`, and surfaces `endAt=null` for currently-running sessions.
- **ObservationWriter event bus** added at module scope: `subscribeObservationWritten(listener) → unsubscribe` is the canonical hook for in-process write taps. Each `writeObservation()` now emits the persisted row to all subscribers after `putEntity` resolves; listener exceptions are wrapped non-fatally so a broken SSE connection never derails the writer hot path.
- **Test infrastructure**: `_emitObservationWrittenForTests` + `_resetObservationEmitterForTests` writer helpers + `mountV1RoutesForTest` obs-api hook give Plan 06 integration tests deterministic access to both the v1 router and the SSE bus without dragging the LLM proxy into the test loop.

## Task Commits

Each task was committed atomically as a RED + GREEN pair (TDD discipline):

1. **Task 1 RED: failing test for GET /api/v1/stats** — `ad0f62e94` (test)
2. **Task 1 GREEN: composed ViewerStats endpoint + mountV1RoutesForTest hook** — `87504a802` (feat)
3. **Task 2 RED: failing tests for /api/v1/trends + /confidence** — `f061b1b23` (test)
4. **Task 2 GREEN: trends + confidence handlers** — `af8636a7b` (feat)
5. **Task 3 RED: failing tests for SSE stream + LSL sessions** — `99414c700` (test)
6. **Task 3 GREEN: SSE handler + LSL handler + writer EventEmitter** — `30fd667ea` (feat)

The plan SUMMARY commit (this file) is added after the plan completes per the executor protocol.

## Files Created/Modified

**Tests (`tests/integration/`):**
- `obs-api.v1-stats.test.js` — 10 tests covering envelope shape + composed-counts correctness + connectivity invariant + lastUpdated ISO + activeSnapshot null|object + BC for `/graph/connectivity` and `/graph/orphans`.
- `obs-api.v1-trends.test.js` — 6 tests covering envelope shape + DESC sort + recency-decay assertion (TrendCharlie < TrendAlpha) + top cap + top slicing + nodeId↔entity.id consistency.
- `obs-api.v1-confidence.test.js` — 7 tests covering envelope shape + segment-average overall + bands counts + segments echo + 0.5/0.7 fallback paths + 404 envelope.
- `obs-api.coding-observations-stream.test.js` — 4 tests covering SSE headers + `data: <json>\n\n` framing + cleanup-after-close + concurrent multi-connection isolation.
- `obs-api.coding-lsl-sessions.test.js` — 9 tests covering envelope shape + 4-session round-trip + DESC sort by startAt + ?since filtering + ?limit cap + far-future empty + malformed-since fallback + 500 cap + endAt null|ISO contract.

**Implementation:**
- `scripts/observations-api-server.mjs`:
  - Imported `SnapshotManager` from `@fwornle/km-core` + `subscribeObservationWritten` from the writer.
  - Added `kmRouter.get('/stats', ...)` (composed ViewerStats handler).
  - Added `kmRouter.get('/trends', ...)` with `computeTrendScore` + `computeTrendBuckets` helpers and `TRENDS_DEFAULT_TOP` / `TRENDS_MAX_TOP` / `TRENDS_HALFLIFE_HOURS` constants.
  - Added `kmRouter.get('/entities/:id/confidence', ...)` with `classifyConfidence` helper.
  - Added `app.get('/api/coding/observations/stream', ...)` SSE handler with try/catch'd write + req.on('close') unsubscribe.
  - Added `app.get('/api/coding/lsl/sessions', ...)` with `LSL_FILE_REGEX` + `_walkLslDir` + `_parseLslFilename` helpers and `LSL_DEFAULT_LIMIT` / `LSL_MAX_LIMIT` / `LSL_DEFAULT_WINDOW_MS` constants.
  - Updated `_testHooks` with `mountV1RoutesForTest()` opt-in hook for /api/v1 integration tests.
- `src/live-logging/ObservationWriter.js`:
  - Imported Node `EventEmitter`.
  - Added module-level `_observationEmitter` (cap 32 listeners).
  - Exported `subscribeObservationWritten(listener) → unsubscribe`.
  - Exported `_resetObservationEmitterForTests` + `_emitObservationWrittenForTests` test-only helpers.
  - `writeObservation()` now `_observationEmitter.emit('written', obsRow)` after the successful `kmStore.putEntity()` call (listener exceptions wrapped non-fatally).

## Decisions Made

- **Module-level EventEmitter vs writer-instance emitter.** The writer is constructed lazily by obs-api; an instance-local emitter would force SSE handlers to wait for `ensureWriter()` before subscribing. The module-level bus lets the obs-api SSE handler register a listener at module-eval time without ordering dependencies, and there is at most one writer per process so the "shared bus" invariant is naturally preserved.
- **/trends scoring formula = `occurrences × exp(-ageHours / 720h)`.** The plan's `<action>` block specifies "occurrenceCount * recencyDecay — exact formula is implementation choice (per CONTEXT.md Claude's Discretion)." Chose 30-day half-life to match the OKB convention; exposed as a constant for tunability.
- **occurrenceCount fallback to `provenance.confirmationCount`.** The km-core entity schema does not yet have a writer-maintained `metadata.occurrences[]` array; rather than mandate a writer-side bookkeeping change in this plan, the handler falls back to the Phase 39 `confirmationCount` (every confirmation == one occurrence). When a later plan adds an explicit occurrences[] array, the handler picks it up automatically.
- **Confidence wire-shape simpler than OKM ConfidenceBreakdown.** The plan's `<interfaces>` block specifies `{overall, bands:{high,moderate,low}, segments[]}`. The OKM `okbClient.ts:88-109` shape is much richer (label, factors{base,confirmationBonus,...}, segmentScores[{textPreview,score,confirmationCount,...}]). UI-SPEC §16 explicitly notes the frontend silently degrades to a client heuristic on 404 — so the wire-shape contract is owned by Phase 55 and the simpler shape is sufficient.
- **404 envelope = `{success:false, error:'not_found'}` not a 500.** Per the plan's `<behavior>` block, frontend per UI-SPEC §16 silently falls back to client heuristic; the 4xx with envelope makes that path predictable.
- **LSL handler env-override for the history dir.** Adding `OBSERVATIONS_LSL_HISTORY_DIR` keeps the production default (`.specstory/history` under REPO_ROOT) while letting the integration test seed tmpdir fixtures without touching production state. Threat register T-55-06-03: the env var is read once, never used as a path component built from user input.
- **kmRouter.get() registered after `app.use('/api/v1', kmRouter)`.** Express routes registered on the Router object after the app.use mount are picked up at request time. This avoids re-architecting the existing module-load order (the `mountKMRoutes` factory is still called once per startup; the Phase 55 routes live alongside it on the same kmRouter).
- **LSL ?limit hard-capped at 500.** Plan threat register T-55-06-04 mentions `?limit=999999` as a DoS vector and hard-caps at 500.

## Deviations from Plan

**None - plan executed exactly as written.** All three task `<done>` criteria met:

- Task 1: All 10 integration test cases pass. `/api/v1/stats` returns the documented envelope.
- Task 2: All 13 trends + confidence integration test cases pass. `/api/v1/trends` enforces the 100-cap; `/api/v1/entities/:id/confidence` returns the 404 envelope for unknown ids.
- Task 3: All 13 SSE stream + LSL sessions integration test cases pass. SSE headers are correct; LSL handler walks the env-overridden dir; T-55-06-01 leak mitigation verified.

**Test infrastructure changes (not deviations — explicit plan affordances):**
- Added `OBSERVATIONS_LSL_HISTORY_DIR` env override to the LSL handler so tests don't write into the production `.specstory/history`. Plan's `<action>` block authors LSL functionality without specifying the production path — the env override is the conventional GSD pattern for production-default-with-test-override (mirrors `OBSERVATIONS_API_NO_AUTOSTART` and `OBSERVATIONS_DB_PATH`).
- Added `mountV1RoutesForTest()` hook on `_testHooks`. The existing legacy obs-api test explicitly skips `/api/v1` mount in its `setKMStoreForTest` comment; Plan 06 tests need the surface, so the opt-in hook keeps the legacy contract intact.

## Issues Encountered

- **Stale `/api/v1/graph/connectivity` shape assumption.** The Plan 06 BC test originally asserted `largestComponentSize: number` on the connectivity response. The currently-installed km-core ships the newer OKM wire-shape from `query.js`: `{totalNodes, totalEdges, componentCount, connectivity, trueOrphans, islandNodes, components}` — no `largestComponentSize`. Fixed by tightening the BC assertion to fields that survive across the cutover (`componentCount` + `connectivity`). The km-core change predates this plan and is intentional; the lesson is that BC tests should derive from the must_have intent, not the planner's literal regex (matches the `feedback_acceptance_grep_word_boundary` memory).
- **No worktree `dist/` or `node_modules/`.** The worktree is a fresh git checkout without TypeScript build artifacts or installed dependencies. Resolved by symlinking the main repo's `dist/` and `node_modules/` into the worktree before running tests — both are `.gitignore`'d so no commit risk.

## Verification

- **All 5 endpoints respond with shape per UI-SPEC §18 — verified via 36 integration tests across `tests/integration/obs-api.{v1-stats,v1-trends,v1-confidence,coding-observations-stream,coding-lsl-sessions}.test.js`** (5 test suites, 36 tests, all GREEN):
  ```
  bash /tmp/run-jest.sh tests/integration/obs-api.v1-stats.test.js \
    tests/integration/obs-api.v1-trends.test.js \
    tests/integration/obs-api.v1-confidence.test.js \
    tests/integration/obs-api.coding-observations-stream.test.js \
    tests/integration/obs-api.coding-lsl-sessions.test.js
  # → Test Suites: 5 passed, Tests: 36 passed
  ```
- **Zero raw `console.*` introduced in observations-api-server.mjs or ObservationWriter.js:**
  ```
  grep -nE "console\.(log|warn|error|info|debug)" scripts/observations-api-server.mjs src/live-logging/ObservationWriter.js | wc -l
  # → 0
  ```
- **No regression in upstream tests:**
  ```
  bash /tmp/run-jest.sh tests/integration/observation-writer.km-core.test.js \
    tests/integration/obs-api.legacy-endpoints.km-core.test.js
  # → all GREEN (writer 3/3 + legacy obs-api 15/15)
  ```
- **No shared orchestrator artifacts modified:** `git diff a8cfc871a..HEAD -- .planning/STATE.md .planning/ROADMAP.md` returns empty.

## User Setup Required

None — no external service configuration required. The five new endpoints are mounted by obs-api on its existing `:12436` port; the next `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api` (which the operator triggers as part of any obs-api restart cycle) makes them live.

After merging this plan back to main and running the operator-side launchd kickstart, the following curl probes should succeed:

```bash
curl -sf http://localhost:12436/api/v1/stats | jq -e '.success and (.data.connectivity >= 0 and .data.connectivity <= 1)'
curl -sf 'http://localhost:12436/api/v1/trends?top=5' | jq -e '.success and (.data.patterns | length <= 5)'
ENTITY_ID=$(curl -s 'http://localhost:12436/api/v1/entities?limit=1' | jq -r '.data.entities[0].id // .data[0].id')
curl -sf "http://localhost:12436/api/v1/entities/$ENTITY_ID/confidence" | jq -e '.success and (.data.overall >= 0 and .data.overall <= 1)'
curl -sf 'http://localhost:12436/api/coding/lsl/sessions?limit=3' | jq -e '.success and (.data.sessions | length <= 3)'
curl -sN -H 'Accept:text/event-stream' http://localhost:12436/api/coding/observations/stream | head -c 0  # confirms 200 OK + text/event-stream
```

## Next Phase Readiness

- **All five Phase 55 frontend plans can now proceed:**
  - 55-07 StatsBar — consumes `/api/v1/stats`
  - 55-10 TrendingPanel + IssueTriage Confidence — consumes `/api/v1/trends` + `/api/v1/entities/:id/confidence`
  - 55-11 LslTimelineStrip — consumes `/api/coding/lsl/sessions`
  - 55-12 EtmTailSheet — consumes `/api/coding/observations/stream` SSE
- **No new packages added** — Express + Node stdlib + existing km-core deps were sufficient; no [ASSUMED]/[SUS] package risk.
- **SSE bus is reusable.** Future plans needing process-wide observation-write taps (e.g., a `/api/coding/digests/stream` companion) can subscribe via the same `subscribeObservationWritten` API without touching the writer.
- **Acceptance grep gate stays clean.** No new `ontologyDir`-less GraphKMStore construction — the writer + obs-api both inherit the existing canonical pattern. `grep -c "ontologyDir" scripts/observations-api-server.mjs` returns 5 (unchanged from baseline).
- **Deferred (out of scope, documented for downstream plans):**
  - `observationCount` per LSL session currently mirrors `entityIds.length` (best-effort `findByLegacyId({system:'A', id})` lookup). When the writer starts maintaining a `metadata.lslSessionIds[]` index, the handler can switch to that for a proper aggregation count. Frontend already treats `observationCount === entityIds.length` as the wire contract.
  - `metadata.occurrences[]` is consulted by `/api/v1/trends` but no current writer maintains it — the fallback to `provenance.confirmationCount` is in effect across all entities until a future plan adds writer-side occurrence tracking.

## Self-Check: PASSED

**Created files exist (verified via `ls`):**
- FOUND: `tests/integration/obs-api.v1-stats.test.js`
- FOUND: `tests/integration/obs-api.v1-trends.test.js`
- FOUND: `tests/integration/obs-api.v1-confidence.test.js`
- FOUND: `tests/integration/obs-api.coding-observations-stream.test.js`
- FOUND: `tests/integration/obs-api.coding-lsl-sessions.test.js`
- FOUND: `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-06-SUMMARY.md`

**Commits exist (verified via `git log a8cfc871a..HEAD`):**
- FOUND: `ad0f62e94` test(55-06): RED — failing test for `/api/v1/stats`
- FOUND: `87504a802` feat(55-06): GREEN — composed `/api/v1/stats` endpoint
- FOUND: `f061b1b23` test(55-06): RED — failing tests for `/api/v1/trends` + `/api/v1/entities/:id/confidence`
- FOUND: `af8636a7b` feat(55-06): GREEN — `/api/v1/trends` + `/api/v1/entities/:id/confidence`
- FOUND: `99414c700` test(55-06): RED — failing tests for SSE stream + LSL sessions
- FOUND: `30fd667ea` feat(55-06): GREEN — SSE handler + LSL sessions handler + writer EventEmitter

**Implementation behavior verified:**
- FOUND: `/api/v1/stats` returns documented envelope with all 9 documented keys (assert in test 1).
- FOUND: `nodeCount=6, edgeCount=3, evidenceCount=4, patternCount=1, componentCount=1, orphanCount=2` for the seeded fixture.
- FOUND: `/api/v1/trends` enforces 100-cap and DESC sort + recency decay (TrendCharlie < TrendAlpha).
- FOUND: `/api/v1/entities/:id/confidence` returns 404 + `{success:false, error:'not_found'}` for unknown id; 0.7 fallback when confirmationCount>0; 0.5 fallback otherwise.
- FOUND: SSE `text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive` headers + `data: <json>\n\n` framing.
- FOUND: LSL handler walks env-overridden dir, parses Phase 51 convention, sorts DESC by startAt, applies ?since + ?limit (capped at 500), defaults to last-7d on malformed since.

**Logger discipline verified:**
- FOUND: `grep -nE "console\.(log|warn|error|info|debug)" scripts/observations-api-server.mjs src/live-logging/ObservationWriter.js | wc -l` → 0.

---
*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Completed: 2026-06-09*

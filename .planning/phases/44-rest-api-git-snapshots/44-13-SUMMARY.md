---
phase: 44-rest-api-git-snapshots
plan: 13
subsystem: A (online learning / ObservationWriter)
status: COMPLETE — writer-side cutover landed on main; obs-api integration green
tags:
  - architectural-close-out
  - writer-dedup-cutover
  - artifacts-patch-replay
  - km-core-read-write
  - sqlite-removal
  - autonomous:true
dependency_graph:
  requires:
    - phase-44-plan-12 (writer WRITE-path cutover + legacy-ingest adapter)
    - phase-44-plan-14 (obs-api legacy /api/* + getDb/invalidateDb removed)
    - phase-41 (km-core ontologyDir mandatory rule)
  provides:
    - 44-12-SUMMARY § "Deferred — Deep-Cutover Scope" items 1 + 2 + 3 CLOSED
    - obs-api startup log no longer emits `[ObservationWriter] Database initialized`
    - 2 dedup tests in pre-llm-dedup.test.js re-enabled (skipped since Plan 44-12)
    - findByContentHash + findRecentByAgent km-core helpers
  affects:
    - lib/km-core/src/store/GraphKMStore.ts (2 new public helpers + JSDoc surface bump)
    - src/live-logging/ObservationWriter.js (drops SQLite handle; 3 helpers cut over)
    - scripts/observations-api-server.mjs (independent `_legacyDb` for pruner + retrieval)
    - tests/live-logging/ObservationWriter.pre-llm-dedup.test.js (2 tests un-skipped)
tech_stack:
  added: []
  patterns:
    - "km-core-as-canonical-store — writer holds no SQLite handle; reads + writes flow through GraphKMStore"
    - "Independent-SQLite-handle-per-consumer — obs-api owns its legacy SQLite handle for pruner + retrieval; consolidator owns its own; all coexist under WAL"
    - "Replay-style putEntity for Artifacts-patch — fetch via findByLegacyId + mutate 2 metadata fields + putEntity(skipOntologyCheck) preserves createdAt + createdBy verbatim"
key_files:
  created:
    - tests/integration/observation-writer.dedup.test.js              (381 lines, 4 tests, all GREEN)
  modified:
    - lib/km-core/src/store/GraphKMStore.ts                            (2 new public methods + JSDoc class header)
    - lib/km-core/tests/unit/graph-store.test.ts                       (9 unit tests appended in sibling describe block)
    - src/live-logging/ObservationWriter.js                            (231 insertions / 211 deletions — SQLite cut)
    - scripts/observations-api-server.mjs                              (independent `_legacyDb` + shutdown wiring)
    - tests/live-logging/ObservationWriter.pre-llm-dedup.test.js       (2 `test.skip` → `test` + km-core read-back)
decisions:
  - "[Plan-44-13-1] km-core helpers (findByContentHash + findRecentByAgent) live on GraphKMStore directly — no separate barrel needed because the class is already exported via the root barrel. Verified by reusing the test pattern from Plan 44-14's countByOntologyClass/lastModifiedByClass/findByLegacyId — sibling describe block, no modifications to the existing 40 blocks."
  - "[Plan-44-13-2] findByContentHash + findRecentByAgent look at `entity.metadata.agent` + `entity.metadata.content_hash` + `entity.metadata.createdAt` (snake_case) NOT top-level Entity fields, because legacy-ingest.ts:262-274 stores these under metadata to preserve the original SQLite column names verbatim. The grep gates in the plan caught no drift here; locked to metadata path is correct."
  - "[Plan-44-13-3] findRecentByAgent comparison uses `meta.createdAt > sinceISO` (strict). An entity stamped exactly at sinceISO is excluded. The integration test seeds entities with consistent-precision timestamps to avoid the ISO-8601 lexicographic mixing trap (`'2026-06-04T10:00:00.001Z' < '2026-06-04T10:00:00Z'` because `.` < `Z` in ASCII)."
  - "[Plan-44-13-4] obs-api opens its OWN SQLite handle (`_legacyDb` via SafeDatabase) for pruner + retrieval (Rule 3 — blocking). The plan's grep gates target only `src/live-logging/ObservationWriter.js`; the writer-side cut leaves `_writer.db` references in obs-api broken without this fix. Both handles coexist with the consolidator's own SQLite handle safely under WAL mode."
  - "[Plan-44-13-5] ObservationExporter (SQLite-row → JSON export) DROPPED from the writer. The exporter previously pulled from `this.db.prepare('SELECT … FROM observations')`, which is no longer populated by the writer. Legacy `.data/observation-export/*.json` files are now maintained by the consolidator (deferred to Plan 44-15) and ultimately by km-core's own JSON export under `.data/knowledge-graph/exports/`."
  - "[Plan-44-13-6] Artifacts-patch (T-44-13-02) — replay path mutates ONLY `metadata.summary` + `metadata.modifiedFiles` + `metadata.readFiles` + top-level `description`. All other entity fields (id, legacyId, createdAt, updatedAt, validFrom, validUntil, createdBy, layer, entityType, ontologyClass) flow through verbatim via object spread. The integration test locks this — `expect(afterMatches.createdAt).toBe(originalCreatedAt)` + `expect(afterMatches.createdBy?.runId).toBe(originalCreatedByRunId)`."
  - "[Plan-44-13-7] One outer commit + one submodule pointer-bump commit for Task 1 (`a062a7926` outer + `0ec0c93` submodule). Matches the Phase 41+ submodule protocol (TS source + dist + pointer bump). km-core dist regenerated during build phase; no obs-api restart required for the test suite."
metrics:
  task1_duration_min: 6
  task2_duration_min: 8
  task3_duration_min: 5
  total_duration_min: 19
  task1_commits: 2  (submodule 0ec0c93 + outer a062a7926)
  task2_commits: 1  (b58616713)
  task3_commits: 1  (7d97d3c6d)
  files_created: 1
  files_modified: 5
  tasks_complete: 3_of_3
  perf_actual_ms: 0.074
  perf_budget_ms: 2
  perf_seeded_observations: 1000
  perf_calls_measured: 100
---

# Phase 44 Plan 13: ObservationWriter Dedup + Artifacts-Patch Cutover Summary

**One-liner:** Writer-side deep-cutover closes Plan 44-12's residual SQLite
surface — `this.db` is gone, the three remaining dedup helpers
(`_findExistingByContentHash`, `_isSemanticallyDuplicate`,
`_maybePatchArtifacts`) route through km-core via two new query helpers
(`findByContentHash` + `findRecentByAgent`) and a replay-style putEntity for
the Artifacts-patch path; the 2 dedup tests skipped since 2026-06-04 are
re-enabled and GREEN; obs-api's pruner + retrieval now talk to an
obs-api-owned independent SQLite handle so the writer-side cut doesn't
break sibling consumers; only `ObservationConsolidator` (Plan 44-15) is
still holding the SQLite file as a writer-side consumer.

## Status

| Task | Description | Status | Commits |
|------|-------------|--------|---------|
| 1 | km-core helpers (findByContentHash + findRecentByAgent) + 9 unit tests | ✅ Complete | submodule `0ec0c93` + outer `a062a7926` |
| 2 | Cut ObservationWriter dedup + Artifacts-patch to km-core; drop `this.db`; re-enable 2 dedup tests | ✅ Complete | `b58616713` |
| 3 | Integration test (4 tests inc. perf gate) | ✅ Complete | `7d97d3c6d` |

## What landed

### Task 1 — km-core helpers (submodule `0ec0c93` + outer `a062a7926`)

Two new public methods on `GraphKMStore`:

  * **`findByContentHash(agent, contentHash, opts?)`** — returns entities
    whose `metadata.agent === agent && metadata.content_hash === contentHash`
    (snake_case per legacy-ingest.ts:262-274). Default
    `opts.ontologyClass = 'Observation'`. Backs
    `ObservationWriter._findExistingByContentHash`.
  * **`findRecentByAgent(agent, sinceISO, limit, opts?)`** — returns up to
    `limit` entities of class `opts.ontologyClass` (default `'Observation'`)
    with `metadata.agent === agent` AND `metadata.createdAt > sinceISO`,
    sorted by `metadata.createdAt` DESC. Backs
    `ObservationWriter._isSemanticallyDuplicate` for the 4h/last-50 window.

Both apply D-34 active-only filtering by default. Empty match returns
`[]`, not undefined.

**9 unit tests appended** to `lib/km-core/tests/unit/graph-store.test.ts`
in a sibling describe block (do NOT modify the existing 41 blocks — Phase
37 + 38 + 41 test-name protection still applies):

  * `findByContentHash` — 4 tests: positive (agent + contentHash match
    across multiple entities), no agent match, no contentHash match,
    ontologyClass override (Observation vs Digest isolation).
  * `findRecentByAgent` — 5 tests: sort DESC + filter by sinceISO,
    truncate to limit, no agent match, strict `>` comparison at exact
    sinceISO boundary, ontologyClass override.

km-core full suite: **304/304 GREEN** (was 295 + 9 net).

km-core dist regenerated locally (`npm run build` — tsc clean).

### Task 2 — Writer cutover + obs-api pruner/retrieval rewire (`b58616713`)

**`src/live-logging/ObservationWriter.js`** — 231 insertions / 211 deletions:

  * **Removed:** `SafeDatabase` import + `openDatabase`/`closeDatabase` calls;
    `ObservationExporter` import + wiring; `createRequire` import; `this.db`
    field; FTS5 schema setup; WAL checkpoint interval; `_reopenDb`
    inode-rotation watchdog; `_walCheckpointInterval`; `_dbInode`;
    `_exportTimer`; `_exporter`; `_scheduleExport()` method; the
    `[ObservationWriter] Database initialized: …` startup log.
  * **Preserved:** `this.dbPath` (path string — derives `projectRoot` for
    the redactor config lookup).
  * **`_findExistingByContentHash` (now async):** calls
    `kmStore.findByContentHash(agent, contentHash)`. Reshapes the first
    match to the legacy `{id, summary, metadata}` row shape so the
    callers don't change.
  * **`_maybePatchArtifacts` (now async):** fetches via
    `findByLegacyId({system:'A', id: existing.id})`, mutates ONLY
    `metadata.summary` + `metadata.modifiedFiles` + `metadata.readFiles`
    + top-level `description`, then
    `putEntity(patched, {skipOntologyCheck:true})`. T-44-13-02 invariant:
    `entity.createdAt` + `entity.createdBy` + `entity.id` + `entity.legacyId`
    flow through verbatim via object spread.
  * **`_isSemanticallyDuplicate` (now async):** replaces the SQLite
    `SELECT summary FROM observations …` with
    `kmStore.findRecentByAgent(agent, fourHoursAgoISO, 50)`. Maps to the
    `{summary}` row shape. The keyword/Jaccard/containment loop is
    UNCHANGED — proven semantics, only the data source moves (T-44-13-03
    mitigation locked at the unit-test level).
  * **`writeObservation` + `processMessages`:** await the three helpers.
  * **`close()`:** no longer touches SQLite. km-core's own `close()`
    handles the JSON-export flush + LevelDB durable write.

**`scripts/observations-api-server.mjs`** — Rule 3 deviation (see below):

  * **`SafeDatabase.openDatabase` import.**
  * **`_legacyDb` module-level state + `ensureLegacyDb()` factory.**
  * **`ensureRetrieval()`:** `dbGetter: () => ensureLegacyDb()` (was
    `() => _writer?.db || null`).
  * **`ensurePruner()`:** takes `legacyDb` via `ensureLegacyDb()` (was
    `_writer.db`).
  * **`shutdown()`:** closes `_legacyDb` post-server-close,
    pre-`SIGKILL`.

**`tests/live-logging/ObservationWriter.pre-llm-dedup.test.js`:**

  * **Re-enabled BOTH `test.skip` blocks** deferred since Plan 44-12
    ("second identical processMessages() call does NOT invoke fetch" +
    "pre-LLM patch path: existing has Artifacts:none and second fire
    adds modifiedFiles → patches without LLM"). The patch-path test
    reads back via `writer._kmStore.findByOntologyClass('Observation')`
    instead of opening the legacy SQLite file directly (`better-sqlite3`
    import removed).

### Task 3 — Integration test (`7d97d3c6d`)

**`tests/integration/observation-writer.dedup.test.js`** — 381 lines,
4 tests, all GREEN:

  1. **Content-hash dedup** — write 2 observations with identical
     messages → second call returns null; `findByOntologyClass.length`
     doesn't grow.
  2. **Semantic dedup** — seed 50 distinct-topic observations (10
     topics × 5 iterations); 51st near-duplicate of topic[0] (same
     Intent + Approach keywords, fresh session_id so content_hash
     differs) gets blocked by `_isSemanticallyDuplicate`.
  3. **Artifacts-patch + T-44-13-02 invariant** — write 1 observation
     with `Artifacts: none`, capture `createdAt` + `createdBy.runId` +
     `createdBy.provider`, write 2nd time with `modifiedFiles`. Re-fetch
     shows patched summary + the 3 provenance fields UNCHANGED.
  4. **T-44-13-01 perf gate** — seed 1000 observations directly via
     `kmStore.putEntity` + `legacyObservationToEntity` (bypass writer's
     LLM path for setup speed). Loop 100 `_findExistingByContentHash`
     calls. Assert avg latency under budget (2ms dev / 5ms CI).
     **Actual: 0.074ms avg** — 27× under budget at 1k seed.

## Acceptance Verification

Plan's `must_haves.truths` grep gates (all pass — word-boundary precision
per `feedback_acceptance_grep_word_boundary.md`):

```text
grep -cE 'this\.db\b|openDatabase|SafeDatabase' src/live-logging/ObservationWriter.js
  → 0  (== 0)  ✓

grep -cE '\bdb\.prepare\b|\bdb\.exec\b|\bdb\.get\b|\bdb\.all\b|\bdb\.run\b' src/live-logging/ObservationWriter.js
  → 0  (== 0)  ✓

grep -c 'findByContentHash' src/live-logging/ObservationWriter.js
  → 3  (>= 1)  ✓

grep -c 'findRecentByAgent' src/live-logging/ObservationWriter.js
  → 3  (>= 1)  ✓

grep -c 'Database initialized' src/live-logging/ObservationWriter.js
  → 0  (== 0)  ✓

grep -cE '(it|test)\.skip|xit' tests/live-logging/ObservationWriter.pre-llm-dedup.test.js
  → 0  (== 0)  ✓

wc -l tests/integration/observation-writer.dedup.test.js
  → 381  (>= 80)  ✓
```

Test suite results:

```text
cd lib/km-core && npx vitest run                                          → 304/304 GREEN (was 295 + 9 net)
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/live-logging/ObservationWriter
  → 110/110 GREEN (the 2 previously-skipped pre-llm-dedup tests now pass)
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/live-logging/ObservationPruner
  → 5/5 GREEN  (no regression)
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/live-logging/ObservationExporter
  → 2/2 GREEN  (no regression — Exporter still used by Consolidator path)
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/integration/observation-writer.km-core.test.js
  → 3/3 GREEN  (no regression — caller-supplied kmStore path)
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/integration/obs-api.legacy-endpoints.km-core.test.js
  → 12/12 GREEN  (no regression — pruner + retrieval rewire didn't break the obs-api integration surface)
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/integration/observation-writer.dedup.test.js
  → 4/4 GREEN  (NEW — perf gate 0.074ms avg, 27× under budget)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Wired independent `_legacyDb` SQLite handle in obs-api**

  * **Found during:** Task 2 (after dropping `this.db` from the writer)
  * **Issue:** `scripts/observations-api-server.mjs` had two consumers
    reading `_writer.db`:
      * `RetrievalService.dbGetter: () => _writer?.db || null`
      * `ObservationPruner({ db: _writer.db, retentionDays: _writer.retentionDays })`
    Dropping `this.db` from the writer makes both return null forever
    → pruner never constructs (no retention), retrieval's keyword-search
    FTS5 fails on every request. The plan grep gates target only the
    writer file but the cut breaks sibling consumers in obs-api.
  * **Fix:** Added `_legacyDb` + `ensureLegacyDb()` to obs-api. Uses
    `SafeDatabase.openDatabase(DB_PATH)` — same handle wrapping the
    writer used pre-Plan-13. The pruner takes it directly; retrieval's
    `dbGetter` returns it. Both handles + the consolidator's own handle
    coexist under SQLite WAL mode. `shutdown()` closes `_legacyDb` before
    `SIGKILL`.
  * **Files modified:** `scripts/observations-api-server.mjs`
  * **Verification:** `obs-api.legacy-endpoints.km-core.test.js` 12/12 GREEN
    + `ObservationPruner.test.js` 5/5 GREEN. The wire-up is consistent
    with the pattern Plan 44-14 used for the consolidator (on-demand
    `new ObservationConsolidator({dbPath:DB_PATH})`).
  * **Committed in:** `b58616713` (Task 2 commit)

**2. [Rule 3 — Blocking] Dropped `ObservationExporter` from the writer**

  * **Found during:** Task 2
  * **Issue:** `ObservationExporter` (used by the writer's
    `_scheduleExport()`) reads via `this.db.prepare('SELECT … FROM
    observations')`. With the writer's SQLite handle gone, the exporter
    has no source — every debounced run would throw on `db.prepare`. The
    plan didn't explicitly call out the exporter, but the import + the
    `_scheduleExport` debounce timer trip the grep gate (`ObservationExporter`
    must be 0 after cut).
  * **Fix:** Removed the `ObservationExporter` import + the `_exporter`
    field + the `_exportTimer` + the `_scheduleExport()` method + the
    debounced call in `writeObservation`. The legacy
    `.data/observation-export/*.json` files are still maintained by the
    consolidator (`ObservationConsolidator._exporter`, deferred to Plan
    44-15) and ultimately by km-core's own JSON export under
    `.data/knowledge-graph/exports/`.
  * **Files modified:** `src/live-logging/ObservationWriter.js`
  * **Verification:** `ObservationExporter.source-field.test.js` 2/2
    GREEN (the exporter itself still works — only the writer's wiring is
    gone). No new test failures.
  * **Committed in:** `b58616713`

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking). Both
preserve the plan's intent: drop `this.db` from the writer cleanly
without breaking sibling consumers in obs-api. Both are necessary
side-effects of the cut.

## Threat Model Coverage

| ID | Threat | Mitigation Status |
|----|--------|-------------------|
| T-44-13-01 | findByContentHash O(N) scan on hot writes | ✅ Per-class scan bound + integration test perf gate. **Actual: 0.074ms avg at 1k seed** — 27× under the 2ms budget. Production scale is ~3.9k entities, sub-millisecond. If profiling at 10k+ shows >5ms p95, add a composite (agent, contentHash) secondary index to GraphKMStore — out of scope for this plan; tracked as a follow-up. |
| T-44-13-02 | Replay putEntity loses createdAt or createdBy | ✅ Patch mutates ONLY `metadata.summary` + `metadata.modifiedFiles` + `metadata.readFiles` + `description`. Integration test asserts `entity.createdAt === originalCreatedAt` + `entity.createdBy.runId === originalCreatedByRunId` after the patch. Object-spread preserves the rest. |
| T-44-13-03 | Semantic-dup keyword extractor breaks on km-core row shape | ✅ `legacyObservationToEntity` stores summary verbatim under `metadata.summary`; `_isSemanticallyDuplicate` maps km-core entities to `{summary}` shape before the keyword loop. The Jaccard/containment loop is BYTE-IDENTICAL to pre-Plan-13. Pre-llm-dedup tests 1-7 + the new integration test Test 2 lock it. |
| T-44-13-04 | Dropping `this.db` breaks legacy unit tests | ✅ Pre-llm-dedup + needs-lsl-resolution + retention-floor + prior-context-lsl + transcript adapter tests all pass tmpdir `kmStoreDbPath` (wired in Plan 44-12). `retention-floor.test.js` is db-free (invariant lives in the constructor, never calls init()). Full ObservationWriter unit suite: 110/110 GREEN. |
| T-44-13-05 | `this.dbPath` orphaned after openDatabase removal | ✅ `this.dbPath` preserved as a path string. Used at line ~196 in `init()` to derive `projectRoot` for the redactor config lookup. Renaming was optional per the threat-model note; kept the name for caller compat. |

## Running cost story — `.observations/observations.db` consumers

After Plan 44-13:

| Consumer | Status |
|----------|--------|
| ObservationWriter writes (`writeObservation/Digest/Insight`) | km-core (Plan 44-12) |
| ObservationWriter dedup (3 helpers) | km-core (this plan) |
| obs-api legacy `/api/*` endpoints | km-core (Plan 44-14) |
| obs-api dashboard COUNTs + staleness clock | km-core (Plan 44-14) |
| obs-api retrieval FTS5 keyword search | SQLite — `_legacyDb` (obs-api-owned) |
| obs-api pruner DELETE | SQLite — `_legacyDb` (obs-api-owned) |
| ObservationConsolidator (~3456 LOC pipeline) | SQLite (deferred to Plan 44-15) |

The **writer side** of the cutover is COMPLETE. The remaining SQLite
consumers are:

  * `obs-api._legacyDb` — read-only (retrieval) + bounded DELETE
    (pruner). Both are independent of the writer; they can stay until
    retrieval moves to km-core embeddings + the consolidator owns
    retention (or Plan 44-15 retires consolidation entirely).
  * `ObservationConsolidator` — the 3456-line multi-stage pipeline.
    Plan 44-15 (not yet drafted) owns this cut.

The archive of `.observations/observations.db` is blocked on Plan 44-15.
The writer-side `Database initialized` startup log is GONE.

## Self-Check: PASSED

  * [x] `lib/km-core/src/store/GraphKMStore.ts` declares `findByContentHash` (grep returns 4 hits, all in store source)
  * [x] `lib/km-core/src/store/GraphKMStore.ts` declares `findRecentByAgent` (grep returns 4 hits, all in store source)
  * [x] `tests/integration/observation-writer.dedup.test.js` exists (381 lines, 4 tests GREEN — verified earlier)
  * [x] km-core submodule commit `0ec0c93` lands (verified via `git -C lib/km-core log --oneline -1`)
  * [x] Outer pointer-bump commit `a062a7926` lands (verified via `git log --oneline | grep a062a7926`)
  * [x] Writer cutover commit `b58616713` lands
  * [x] Integration test commit `7d97d3c6d` lands
  * [x] All 7 acceptance grep gates pass (== 0 or >= 1 as required)
  * [x] 110/110 ObservationWriter unit tests GREEN; 0 skipped
  * [x] 12/12 obs-api legacy-endpoint integration tests GREEN (no regression)
  * [x] Perf gate measured: 0.074ms avg (well under 2ms budget)

## TDD Gate Compliance

N/A — Plan type is `execute`, not `tdd`. The integration test (Task 3)
landed AFTER the implementation (Tasks 1+2) as a GREEN-only verification
contract per the plan's `<action>` step ordering. Plan's `<rollback>`
section explicitly accepts this: if Task 2 introduces a perf regression
or semantic-dup correctness regression, Task 1's helpers stay (pure
additions) and Task 2 is reverted.

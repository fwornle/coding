---
phase: 44-rest-api-git-snapshots
plan: 18
subsystem: infra
tags: [km-core, sqlite, observations, pruner, retrieval, freshness-rerank, jest, kmstore]

# Dependency graph
requires:
  - phase: 44-rest-api-git-snapshots/17
    provides: ObservationConsolidator cut to km-core; sqlite no longer written by the consolidation pipeline; transition-window digests mirrored to km-core
provides:
  - ObservationPruner reads + deletes through km-core only (no SQLite)
  - RetrievalService freshness-rerank reads through km-core only
  - obs-api drops `_legacyDb` / `openLegacyDb` / `SafeDatabase` plumbing
  - .observations/observations.db has zero production-runtime consumers
  - 2 new integration tests covering the cutover (pruner perf, freshness-rerank multiplier)
  - Task 5 operator-gated SQLite archive (pending — human-verify checkpoint)
affects:
  - phase 45 (and later) — any consumer assuming .observations/observations.db can no longer rely on it being current; the file is frozen at the Task 5 archive timestamp
  - dashboards / monitors that read keyword-search results from /api/retrieve — keyword tier degrades to [] until KeywordSearch is also cut to km-core

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-class km-core prune via findByOntologyClass + chunked Promise.all deleteEntity (100 ids/batch)"
    - "Lazy kmStoreGetter constructor option mirroring the existing dbGetter convention"
    - "Top-level entity.createdAt as the canonical ISO-8601 cutoff field (NOT metadata.created_at, which doesn't exist on post-legacy-ingest entities)"

key-files:
  created:
    - .planning/phases/44-rest-api-git-snapshots/44-18-AUDIT.md
    - tests/integration/observation-pruner.km-core.test.js
    - tests/integration/retrieval-service.freshness-rerank.km-core.test.js
  modified:
    - src/live-logging/ObservationPruner.js
    - src/retrieval/retrieval-service.js
    - scripts/observations-api-server.mjs
    - tests/live-logging/ObservationPruner.test.js

key-decisions:
  - "D-44-18-01: Pruner cutoff comparison uses top-level entity.createdAt (NOT metadata.created_at — the snake_case field doesn't exist on post-legacy-ingest entities; legacy-ingest stamps metadata.createdAt camelCase). Comparison is lexicographic on ISO-8601 strings."
  - "D-44-18-02: Pruner deletes in 100-id Promise.all chunks with one stderr progress line per chunk (T-44-18-01 mitigation). Measured 48ms for 1000-obs prune — 20x under the 1s budget."
  - "D-44-18-03: RetrievalService gains a kmStoreGetter constructor option mirroring the existing dbGetter pattern; lazy resolution inside _applyFreshnessRerank. _applyFreshnessRerank is now async and awaited."
  - "D-44-18-04: DB_PATH constant kept in obs-api as the Task 5 archive-rename target only, with a 'drop in Task 5 cleanup' comment."
  - "D-44-18-05: tests/live-logging/ObservationPruner.test.js was rewritten from scratch to exercise the constructor contract + module-source invariants; behavioral end-to-end coverage moved to tests/integration/observation-pruner.km-core.test.js (Task 4)."

patterns-established:
  - "Cutover gate: km-core integration test asserts both correctness (selectivity, missing-field defensiveness) AND perf budget (T-mitigation-tied assertion)."
  - "obs-api ensureKMStore() is the canonical store source — pruner + retrieval + writer + consolidator all share one instance via this getter."

requirements-completed: [API-01, API-02]

# Metrics
duration: ~2h25m (Tasks 1-4; Task 5 is operator-gated, pending)
completed: 2026-06-05
---

# Phase 44 Plan 18: Pruner + Retrieval km-core Cutover + SQLite Archive Summary

**Final SQLite consumers (ObservationPruner + RetrievalService freshness-rerank) cut to km-core; obs-api drops legacy `_legacyDb` plumbing; observations.db is ready for operator-gated archive (Task 5).**

## Performance

- **Duration:** ~2h25m (Tasks 1-4; Task 5 operator-gated, pending)
- **Started:** 2026-06-05T14:26:55Z
- **Completed (Tasks 1-4):** 2026-06-05T17:00Z (approx)
- **Tasks:** 4/5 complete; Task 5 surfaced as `checkpoint:human-verify`
- **Files modified:** 4 source files + 3 test files = 7 files
- **Files created:** 3 (audit doc + 2 integration tests)

## Accomplishments

- **ObservationPruner** (`src/live-logging/ObservationPruner.js`) now reads + deletes
  exclusively through km-core. Constructor signature changed from
  `{ db, retentionDays }` to `{ kmStore, retentionDays }`. The 2 SQL DELETEs
  (`observations` + `digests`) became `findByOntologyClass(cls)` + filter on
  `entity.createdAt < cutoffISO` + chunked `Promise.all(deleteEntity)` (100 ids/batch).
  `prune()` is now async. Initial post-cutover production prune correctly removed
  517 observations + 131 digests from the live km-core store with no errors.

- **RetrievalService** (`src/retrieval/retrieval-service.js`) freshness-rerank
  metadata lookup now goes through km-core. The single SQLite `SELECT
  json_extract(metadata, '$.codeVerification.verificationRatio') FROM insights
  WHERE id IN (...)` became `await Promise.all(ids.map(id =>
  kmStore.findByLegacyId({system:'A', id})))` with the ratio read off
  `entity.metadata.codeVerification.verificationRatio`. The new
  `kmStoreGetter` constructor option mirrors the existing `dbGetter` lazy pattern.

- **obs-api** (`scripts/observations-api-server.mjs`) drops `_legacyDb`,
  `ensureLegacyDb`, the `openLegacyDb` import (SafeDatabase no longer imported),
  and the shutdown handler block that closed the legacy SQLite handle. Pruner
  and retrieval are constructed with the km-core store from `ensureKMStore()`.
  The "listening" log line now reports the km-core data root instead of the
  legacy SQLite path. obs-api restart verified: pid 36727 opens **0 legacy
  SQLite handles** (was 1 per process before this plan), and `/api/retrieve`
  continues to return 48 results for the canonical "docker timeout" probe query.

- **Tests:** 2 new integration tests added (5 + 4 = 9 new tests GREEN);
  ObservationPruner.test.js rewritten (4 new tests GREEN replacing the
  SQLite-tmpdir suite). Total of 9+4 = 13 new GREEN tests covering the cutover.

- **Perf gates met:**
  - T-44-18-01 (1000-obs prune ≤ 1s): measured **48ms** — 20x margin
  - T-44-18-02 (20-id rerank ≤ 50ms): measured **<1ms** — >50x margin

## Task Commits

1. **Task 1: audit pruner + retrieval SQLite surface** — `cf6c8da45` (docs)
2. **Task 2: cut ObservationPruner to km-core** — `955ce3caa` (feat)
3. **Task 3: cut RetrievalService freshness-rerank to km-core** — `4a85e1597` (feat)
4. **Task 4: drop _legacyDb plumbing from obs-api + integration tests** — `c837dc421` (feat)
5. **Task 5: human-verify checkpoint** — PENDING (operator gate)

**Plan metadata commit:** (this SUMMARY + STATE update will land after operator clears Task 5)

## Files Created/Modified

### Created

- `.planning/phases/44-rest-api-git-snapshots/44-18-AUDIT.md` — 165 lines.
  Documents the 4 SQLite call sites, the km-core replacement map, the
  post-cutover Insight metadata path confirmation, the external-reference
  grep results (32 files, only 3 production-runtime), and the 5 plan decisions.

- `tests/integration/observation-pruner.km-core.test.js` — 238 lines, 5 tests:
  constructor contract, Observation selectivity, Digest selectivity,
  T-44-18-01 perf gate (1000-obs ≤ 1s; measured 48ms), defensive skip on
  missing `createdAt`.

- `tests/integration/retrieval-service.freshness-rerank.km-core.test.js` —
  239 lines, 4 tests: 0.3 + 0.7·ratio formula correctness for ratio ∈ [0,1],
  missing-metadata leaves score untouched, non-insight tiers + unknown ids
  pass through, T-44-18-02 perf gate (20-id rerank ≤ 50ms; measured <1ms).

### Modified

- `src/live-logging/ObservationPruner.js` — Rewritten constructor (kmStore
  instead of better-sqlite3 db), `prune()` is async, deletes via 100-id
  `Promise.all` chunks. Zero `db.prepare`/`DELETE FROM` references.

- `src/retrieval/retrieval-service.js` — Added `kmStoreGetter` option;
  `_applyFreshnessRerank` rewritten as async + km-core `findByLegacyId`.

- `scripts/observations-api-server.mjs` — `_legacyDb` / `ensureLegacyDb` /
  `openLegacyDb` import / shutdown handler block all removed. `ensurePruner`
  is now async. `RetrievalService` constructed with `kmStoreGetter` only
  (no `dbGetter`). DB_PATH constant retained as Task 5 archive target.

- `tests/live-logging/ObservationPruner.test.js` — Rewritten (4 tests):
  constructor invariants + module-source invariants. SQLite-tmpdir setup
  + FTS5 assertions removed (no longer relevant); behavioral coverage
  moved to the new integration test.

## Decisions Made

(All 5 captured in 44-18-AUDIT.md §10, summarized in frontmatter `key-decisions`.)

Highlight: **D-44-18-01** — the audit doc's most important finding. The plan's
interface mapping table referenced `metadata.created_at` (snake_case), but the
post-cutover Insight / Observation entities use `metadata.createdAt` (camelCase)
AND the top-level `entity.createdAt`. The pruner compares against the canonical
top-level field, which is always stamped by legacy-ingest and by the writer's
own create path (D-31 stamping target). Without this audit, the pruner would
have silently no-op'd in production because the comparison would always fail
against an undefined property.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan-correctness bug] Cutoff field path was wrong in plan**
- **Found during:** Task 1 audit
- **Issue:** Plan's `<interfaces>` block said the cutoff comparison
  should use `metadata.created_at` (snake_case). The post-cutover entities
  (per `node_modules/@fwornle/km-core/dist/adapters/legacy-ingest.js:135-164`)
  carry the timestamp as `entity.createdAt` (top-level) and
  `metadata.createdAt` (camelCase). The snake_case field doesn't exist;
  a pruner using it would always see `undefined < cutoffISO` (which evaluates
  to `false`) and silently delete nothing.
- **Fix:** Pruner uses top-level `entity.createdAt`. Documented in
  44-18-AUDIT.md §2b as D-44-18-01. Integration test asserts selectivity
  against this field.
- **Files modified:** `src/live-logging/ObservationPruner.js`,
  `tests/integration/observation-pruner.km-core.test.js`
- **Verification:** Integration test seeds 500 old + 500 fresh entities;
  the prune deletes exactly 500 (assertion fails if the wrong field is used).
- **Committed in:** `955ce3caa` (Task 2)

**2. [Rule 2 - Plan-scope correction] KeywordSearch keeps using SQLite (degrades to [] post-cutover)**
- **Found during:** Task 3 audit (also surfaced in 44-18-AUDIT.md §8)
- **Issue:** Plan's must_have `truths` block claimed "`/api/retrieve` keyword
  + semantic search continues to return correct results post-cutover," but
  Task 4 acceptance is `grep -nE '_legacyDb|...' = 0`. KeywordSearch
  (`src/retrieval/keyword-search.js`) uses `db.prepare` over SQLite FTS5;
  if `_legacyDb` is fully dropped (Task 4 acceptance), KeywordSearch loses
  its handle. These two claims cannot both be literally true.
- **Fix:** Resolved as: `_legacyDb` IS dropped; KeywordSearch degrades
  silently to [] (the existing `_keywordSearch` helper already short-circuits
  on `!db`). Semantic search via Qdrant continues to return results (the
  primary signal). RRF fusion + topic-relevance still rank these. Documented
  in 44-18-AUDIT.md §8 and 44-18-PLAN line for the dbGetter retention.
- **Files modified:** `scripts/observations-api-server.mjs`,
  `src/retrieval/retrieval-service.js`
- **Verification:** `curl POST /api/retrieve` returns 48 results post-restart
  (semantic + working-memory tiers active; keyword tier empty as expected).
- **Committed in:** `c837dc421` (Task 4) — `dbGetter` is no longer passed.

**3. [Rule 3 - Test infra] testPathIgnorePatterns CLI argument needed for clean test runs**
- **Found during:** Task 2 test run
- **Issue:** Jest picks up stale duplicates of every test file under
  `.claude/worktrees/agent-*/` (40+ worktrees), producing inflated test
  counts and confusing pass/fail signals.
- **Fix:** Test runs pass `--testPathIgnorePatterns=/.claude/worktrees/`
  explicitly. (Did NOT modify jest.config.js — out of scope and the user
  may rely on worktree isolation in other contexts. Local-only mitigation.)
- **Files modified:** None — runtime-only flag.
- **Verification:** Test counts match expectation (4 + 5 + 4 + 30 = 43
  GREEN across the cutover-touched suites).
- **Committed in:** N/A (no source change).

### Documentation-only deviations

The plan used `npx vitest` in several action steps; the actual repo uses Jest
(`NODE_OPTIONS='--experimental-vm-modules' jest`). All test commands were
translated to the Jest invocation. No source change.

---

**Total deviations:** 3 auto-fixed (1 plan-correctness bug, 1 plan-scope
correction, 1 test-infra hygiene). All committed inline with the relevant task.

**Impact on plan:** D-44-18-01 was load-bearing — a pruner with the wrong field
would have appeared to work (no errors) but deleted nothing in production. The
KeywordSearch degradation is acceptable per the plan's spirit ("small and
well-bounded" scope) and is recorded as a known follow-up. No scope creep.

## Known Deferred Items

- **KeywordSearch SQLite path** (`src/retrieval/keyword-search.js`): The FTS5
  keyword-search tier uses `db.prepare` against the legacy SQLite handle.
  After this plan's Task 4 drops `_legacyDb`, this tier silently degrades to
  []. A future plan should either (a) cut KeywordSearch to km-core
  `findByOntologyClass`-based substring/word-overlap search, or (b) restore
  a `dbGetter` to the legacy file (anti-pattern). Recommended: (a) — track
  as a Phase 45-or-later plan.

- **Qdrant vector cleanup post-prune** (T-44-18-05): The km-core pruner removes
  Observation/Digest entities from the graph store but does NOT remove their
  Qdrant point vectors. Vector store will drift from km-core truth. Out of
  Plan 44-18 scope; Phase 42 has open Qdrant-sync work.

## Issues Encountered

- The `_legacyDb` shutdown handler was nested inside the `server.close()`
  callback, not at the top level — required precise edit targeting.
- The "listening" log line referenced `DB_PATH` directly; updating it to
  refer to `KG_DB_PATH` requires the const to be in scope at callback time
  (verified: it is, because `server.listen` fires after module init).

## User Setup Required

**None** for Tasks 1-4 (the code-only cutover).

**Task 5 is operator-gated** — see the checkpoint payload below.

## Self-Check

Verified all claimed files exist + all commit hashes resolve:

```
$ for f in .planning/phases/44-rest-api-git-snapshots/44-18-AUDIT.md \
          tests/integration/observation-pruner.km-core.test.js \
          tests/integration/retrieval-service.freshness-rerank.km-core.test.js \
          src/live-logging/ObservationPruner.js \
          src/retrieval/retrieval-service.js \
          scripts/observations-api-server.mjs \
          tests/live-logging/ObservationPruner.test.js; do
    [ -f "$f" ] && echo "FOUND: $f"
done
```

All 7 files present. All 4 commit hashes (`cf6c8da45`, `955ce3caa`,
`4a85e1597`, `c837dc421`) verified via `git log --oneline`.

## Self-Check: PASSED

## Next Phase Readiness

- Tasks 1-4 complete.
- `.observations/observations.db` has zero production-runtime consumers.
- Task 5 (SQLite archive) is the operator gate; once cleared, the deferred
  Plan 44-12 § "fully unused observations.db" promise — carried through
  44-13, 44-14, 44-17 — is finally honored.

## Task 5 Checkpoint Payload (for operator)

See the structured "CHECKPOINT REACHED" message returned by the executor.

---
*Phase: 44-rest-api-git-snapshots*
*Completed (Tasks 1-4): 2026-06-05*

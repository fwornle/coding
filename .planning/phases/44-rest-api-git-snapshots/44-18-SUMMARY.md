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
  - Task 5 operator-gated SQLite archive (CLEARED — `.observations/observations.db` archived to `.observations/observations.db.archived.2026-06-05`; DB_PATH dropped from obs-api; docs updated)
affects:
  - phase 45 (and later) — `.observations/observations.db` is now archived as `.observations/observations.db.archived.2026-06-05`; any consumer assuming it being current is frozen at that timestamp
  - dashboards / monitors that read keyword-search results from /api/retrieve — keyword tier degrades to [] until KeywordSearch is also cut to km-core
  - obs-api `/health` payload — `dbPath` + `dbExists` fields removed (Task 5 cleanup); dashboards reading these fields must fall back to `status` + `role` only

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
    - .gitignore (Task 5 — `.observations/*.db.archived*` pattern added)
    - .planning/STATE.md (Task 5 close-out)
    - docs/observations/README.md (Task 5 — archive note)
    - docs/agent-integration-guide.md (Task 5 — observational memory source updated)
    - docs-content/core-systems/observational-memory.md (Task 5 — archive note)
    - docs-content/core-systems/ukb-vkb.md (Task 5 — runtime store table + tree)
    - docs-content/release-notes.md (Task 5 — new section: SQLite → km-core cutover complete)
    - docs-content/architecture/data-flow.md (Task 5 — runtime store + table)
    - docs-content/architecture/health-monitoring.md (Task 5 — pre-swap snapshot historical)
    - docs-content/integrations/index.md (Task 5 — obs-api owns km-core, not SQLite)
    - docs-content/guides/agent-integration.md (Task 5 — observational memory source updated)
    - docs-content/guides/status-line.md (Task 5 — badge data-source updated)
  archived:
    - .observations/observations.db → .observations/observations.db.archived.2026-06-05 (7.4 MB)
    - .observations/observations.db-shm → .observations/observations.db.archived.2026-06-05-shm (32 KB sidecar)
    - .observations/observations.db-wal → .observations/observations.db.archived.2026-06-05-wal (0 B sidecar)

key-decisions:
  - "D-44-18-01: Pruner cutoff comparison uses top-level entity.createdAt (NOT metadata.created_at — the snake_case field doesn't exist on post-legacy-ingest entities; legacy-ingest stamps metadata.createdAt camelCase). Comparison is lexicographic on ISO-8601 strings."
  - "D-44-18-02: Pruner deletes in 100-id Promise.all chunks with one stderr progress line per chunk (T-44-18-01 mitigation). Measured 48ms for 1000-obs prune — 20x under the 1s budget."
  - "D-44-18-03: RetrievalService gains a kmStoreGetter constructor option mirroring the existing dbGetter pattern; lazy resolution inside _applyFreshnessRerank. _applyFreshnessRerank is now async and awaited."
  - "D-44-18-04: DB_PATH constant kept in obs-api as the Task 5 archive-rename target only, with a 'drop in Task 5 cleanup' comment. RESOLVED in Task 5 cleanup commit — DB_PATH dropped; HEARTBEAT_PATH derives directly from REPO_ROOT; ObservationWriter + ObservationConsolidator constructed without explicit `dbPath` (defaults still derive correct projectRoot from launchd cwd); `/health` payload no longer reports `dbPath` / `dbExists`."
  - "D-44-18-05: tests/live-logging/ObservationPruner.test.js was rewritten from scratch to exercise the constructor contract + module-source invariants; behavioral end-to-end coverage moved to tests/integration/observation-pruner.km-core.test.js (Task 4)."

patterns-established:
  - "Cutover gate: km-core integration test asserts both correctness (selectivity, missing-field defensiveness) AND perf budget (T-mitigation-tied assertion)."
  - "obs-api ensureKMStore() is the canonical store source — pruner + retrieval + writer + consolidator all share one instance via this getter."

requirements-completed: [API-01, API-02]

# Metrics
duration: ~2h25m (Tasks 1-4) + ~30m (Task 5 cleanup + archive + doc updates) = ~2h55m total
completed: 2026-06-05
---

# Phase 44 Plan 18: Pruner + Retrieval km-core Cutover + SQLite Archive Summary

**Final SQLite consumers (ObservationPruner + RetrievalService freshness-rerank) cut to km-core; obs-api drops legacy `_legacyDb` plumbing AND the `DB_PATH` constant; `.observations/observations.db` archived to `.observations/observations.db.archived.2026-06-05`. The deferred Plan 44-12 § "fully unused observations.db" promise — carried through 44-13, 44-14, 44-17 — is now finally honored.**

## Performance

- **Duration:** ~2h55m total (Tasks 1-4 ~2h25m + Task 5 cleanup + archive + doc updates ~30m)
- **Started:** 2026-06-05T14:26:55Z
- **Completed (Tasks 1-4):** 2026-06-05T17:00Z (approx)
- **Task 5 cleared (approved-archive):** 2026-06-05T20:40Z (approx)
- **Tasks:** 5/5 complete
- **Files modified:** 4 source files + 3 test files + 1 gitignore + 1 STATE + 10 docs = 19 files
- **Files created:** 3 (audit doc + 2 integration tests)
- **Files archived:** 3 (`.observations/observations.db{,-shm,-wal}` → `.archived.2026-06-05*`)

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
5. **Task 5 (operator gate CLEARED — "approved (archive)"):** Plan metadata + SUMMARY landed at `fae40b267` (Tasks 1-4 close-out). Task 5 chore commit lands the archive rename, DB_PATH removal, doc updates, STATE + SUMMARY update: `chore(44-18): archive .observations/observations.db + drop unused DB_PATH` (hash recorded in the executor return message at the bottom of this summary).

**Operator decision:** approved (archive). Resolution path:
1. `.observations/observations.db` renamed to `.observations/observations.db.archived.2026-06-05`; `-shm` and `-wal` sidecars renamed alongside for cleanliness.
2. `.gitignore` extended with `.observations/*.db.archived*` (all three files gitignored — verified via `git check-ignore -v`).
3. `DB_PATH` constant dropped from `scripts/observations-api-server.mjs`. `HEARTBEAT_PATH` derives directly from `REPO_ROOT`. `ObservationWriter` + `ObservationConsolidator` constructed without an explicit `dbPath` arg (their internal defaults still derive the correct `projectRoot` from launchd cwd = repo root). `/health` payload no longer reports `dbPath` / `dbExists`; reports `status` + `role` + `port` only.
4. Docs updated with archive notes (10 files — `docs/observations/README.md`, `docs/agent-integration-guide.md`, `docs-content/core-systems/observational-memory.md`, `docs-content/core-systems/ukb-vkb.md`, `docs-content/release-notes.md` (new section), `docs-content/architecture/data-flow.md`, `docs-content/architecture/health-monitoring.md`, `docs-content/integrations/index.md`, `docs-content/guides/agent-integration.md`, `docs-content/guides/status-line.md`). Planning history (`.planning/phases/**`, `.planning/research/**`, `.planning/todos/**`, `.planning/milestones/**`) left untouched per operator instruction.
5. obs-api kickstarted via `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api`. Post-restart `/health` returns `{"status":"ok"}` without any `dbPath`/`dbExists` fields. Dashboard endpoints (`/digests`, `/insights`, `/retrieve`) continue to work.
6. 1-hour soak NOT required inline. Soak in progress at 2026-06-05T20:40Z; operator verifies launchd state at 2026-06-05T21:40Z using the commands recorded in § "Operator Soak Commands" below.

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
  `openLegacyDb` import / shutdown handler block all removed (Task 4).
  `ensurePruner` is now async. `RetrievalService` constructed with
  `kmStoreGetter` only (no `dbGetter`). **Task 5 cleanup:** `DB_PATH`
  constant removed entirely; `HEARTBEAT_PATH` rewired to derive from
  `REPO_ROOT` directly; `ObservationWriter` + `ObservationConsolidator`
  (both call sites — main consolidator + insights re-synth) constructed
  without `dbPath` arg; `/health` payload drops `dbPath` / `dbExists`
  fields. Remaining `DB_PATH` mentions in the file are only in comments
  documenting the historical removal; the `KG_DB_PATH` constant for the
  km-core LevelDB is unrelated and preserved.

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

**Task 5 — CLEARED 2026-06-05** with operator decision "approved (archive)". Resolution + cleanup commit details are recorded in § "Task Commits" → item 5. The 1-hour soak is in progress; operator runs the commands in § "Operator Soak Commands" at +1h to confirm launchd daemons stayed healthy.

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

- All 5 tasks complete.
- `.observations/observations.db` archived to `.observations/observations.db.archived.2026-06-05` (with `-shm`/`-wal` sidecars renamed alongside; all three gitignored under `.observations/*.db.archived*`).
- `DB_PATH` constant + `dbPath`/`dbExists` health-payload fields removed from obs-api.
- obs-api kickstart confirmed healthy post-rename.
- The deferred Plan 44-12 § "fully unused observations.db" promise — carried through 44-13, 44-14, 44-17 — is **finally honored**.

## Task 5 Checkpoint Payload (for operator)

Cleared 2026-06-05 with resolution "approved (archive)". See § "Task Commits" → item 5 for the resolution path and the cleanup commit hash.

## Operator Soak Commands

Run these at +1h from the kickstart timestamp (2026-06-05T21:40Z target):

```bash
# 1. All 8 launchd-managed daemons should be in state 0 with no kickstart_count bumps in the last hour
launchctl list | grep com.coding | awk '{print $1, $2, $3}'
# Expect: PID stable, exit code 0, no flapping. Daemons:
#   com.coding.obs-api, com.coding.health-coordinator, com.coding.etm,
#   com.coding.sub-agent-live-claude, com.coding.sub-agent-live-copilot, com.coding.sub-agent-live-opencode,
#   com.coding.sub-agent-sweep, com.coding.lsl-resolver

# 2. obs-api /health stays healthy, with no dbPath/dbExists fields
curl -s http://localhost:12436/health | python3 -m json.tool
# Expect: {"status":"ok","port":12436,"role":"single-owner-rw"}

# 3. Tail obs-api log for any legacyDb / observations.db errors during the soak window
tail -200 /tmp/obs-api.log | grep -iE "legacyDb|observations\.db|ENOENT.*\.db" | grep -v archived
# Expect: 0 matches

# 4. /api/retrieve still returns results (sanity probe — semantic + working-memory tiers)
curl -s "http://localhost:12436/api/retrieve?q=docker+timeout&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print('results:', len(d.get('results', [])))"
# Expect: results: 5 (or whatever non-zero number)

# 5. Dashboard endpoints render cleanly
curl -s "http://localhost:12436/api/digests/projects" | python3 -c "import sys,json; print('projects:', len(json.load(sys.stdin)))"
curl -s "http://localhost:12436/api/insights/projects" | python3 -c "import sys,json; print('projects:', len(json.load(sys.stdin)))"
# Expect: both return non-empty project lists

# 6. Confirm the archive file is on disk and the live file is gone
ls -la .observations/ | grep -E 'observations\.db'
# Expect: only .archived.2026-06-05* entries; no bare observations.db

# 7. Confirm next consolidator pass (or staleness status) is clean
curl -s "http://localhost:12436/api/consolidation/status" | python3 -m json.tool | head -20
# Expect: no errors; counts read from km-core; staleness ISO timestamps fresh
```

If any check fails:
- **launchd flapping**: `launchctl print gui/$(id -u)/<label>` shows the recent exit history. Cross-reference with `/tmp/obs-api.log`.
- **obs-api 500 on /api/retrieve**: roll back via `git revert <task5-commit-hash>` and re-link the archived file: `mv .observations/observations.db.archived.2026-06-05 .observations/observations.db`. Then re-kickstart.
- **dbPath/dbExists missing fields cause dashboard breakage**: known shape change (operator-approved). Dashboard health view should fall back to `status` + `role`.

## Threat Flags

None — Task 5 changes do not introduce new attack surface. File rename is on-disk only; `/health` payload removed two fields rather than added new ones.

---
*Phase: 44-rest-api-git-snapshots*
*Completed (Tasks 1-4): 2026-06-05*
*Completed (Task 5 — operator gate cleared, archive + cleanup): 2026-06-05*

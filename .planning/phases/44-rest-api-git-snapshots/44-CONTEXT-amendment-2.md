---
phase: 44-rest-api-git-snapshots
type: context-amendment
amends: 44-CONTEXT.md, 44-CONTEXT-amendment.md
date: 2026-06-04
trigger: Plan 44-10 catchup-sync surfaced write-path architectural gap
status: locked
---

# 44-CONTEXT amendment 2 — Write-path cutover (ObservationWriter → km-core)

## Why this amendment exists

Plan 44-07's "hard cutover" scope only redirected the **read path** to km-core:
`/api/coding/{observations,digests,insights}` typed-view handlers + `/api/v1`
canonical surface. The **write path** was left untouched —
`src/live-logging/ObservationWriter.js` still writes to
`.observations/observations.db` (SQLite). Plan 44-10's migration was a
one-shot snapshot, not an ongoing sync.

Concrete symptom in production: after the live migration ran (2026-06-04T12:12Z),
the dashboard at :3032 stopped showing observations newer than the snapshot
cutoff. New observations written by ETM (via ObservationWriter) landed in
SQLite-only and were invisible to the dashboard (which reads km-core via the
typed views). The delta grows monotonically until the writer is cut over.

## The fix (new Plan 44-12, blocking 44-10 Task 4 + 44-11)

Insert **Plan 44-12** between 44-10 and 44-11. Operator decision (Option A,
ratified 2026-06-04): cut ObservationWriter over to km-core directly. No
continuous watcher daemon, no dual-write window.

### Scope sketch — Plan 44-12

**File scope (estimated):**
- `src/live-logging/ObservationWriter.js` — replace `this._db.prepare(...).run(...)`
  SQLite calls with `await this._kmStore.putEntity(...)`.
- New helper: `legacyObservationToEntity(row)` / `legacyDigestToEntity(row)` /
  `legacyInsightToEntity(row)` — the inverse of Plan 44-05's
  `observationToLegacy` / `digestToLegacy` / `insightToLegacy`. The migration
  script `scripts/migrate-sqlite-to-kmcore.mjs:170-265` already contains this
  logic; lift into `lib/km-core/src/adapters/legacy-ingest.ts` (sibling of
  `observation-view.ts`) so both ObservationWriter and the migration script
  share one source of truth.
- `tests/integration/observation-writer.km-core.test.js` (new) — RED → GREEN
  asserting writes land as km-core entities with correct ontologyClass +
  `legacyId.system='A'`.
- `tests/integration/typed-views.test.js` (existing) — extend to cover the
  full write→read round trip (write via ObservationWriter, read via typed view).

**Field-mapping bridges (lift from migration script):**

The migration script already documents the field maps in
`buildObservationEntity` / `buildDigestEntity` / `buildInsightEntity`. These
are the exact transformations Plan 44-12's writer needs. Reuse, don't
re-derive.

**KEY CONSTRAINT — ontologyDir mandatory rule:**

Per CLAUDE.md + the Phase 41 lesson (commit `87bc2f567`), any host-side process
constructing `GraphKMStore` MUST pass `ontologyDir`. The migration script does
this correctly (see lines 397-410); ObservationWriter must follow the same
pattern, NOT fall back to undefined-ontologyDir.

**KEY CONSTRAINT — no parallel-write window:**

Once ObservationWriter switches to km-core writes, SQLite writes must stop
in the same commit. Dual-write creates two divergent sources of truth — the
exact bug that Plan 44-10 Task 4 (legacy DROP) was designed to close
permanently.

**KEY CONSTRAINT — provenance + legacyId on every write:**

Every entity written must carry `legacyId: {system: 'A', id: <uuid>}` and
`createdBy: {provider: 'observation-writer', model: 'live-pipeline', runId,
timestamp}`. This preserves the Phase 41 D-13 contract and makes future
migrations idempotent.

### Acceptance for Plan 44-12

- [ ] `src/live-logging/ObservationWriter.js` no longer holds a SQLite handle
- [ ] `lib/km-core/src/adapters/legacy-ingest.ts` exports the three inverse
      reshape functions; migration script imports from there (single source
      of truth)
- [ ] ObservationWriter and the migration script BOTH go through the same
      `legacyObservationToEntity` etc. helpers
- [ ] New integration test asserts ObservationWriter → km-core round-trip
- [ ] After Plan 44-12 ships, the dashboard shows new observations within
      seconds of being written (no lag)
- [ ] `.observations/observations.db` can be safely deleted; obs-api startup
      no longer touches SQLite (the `Database initialized: .../observations.db`
      log line goes away)
- [ ] Plan 44-10 Task 4 unblocks (legacy DROP is now a no-op — the file
      itself can be removed)

### Interim mitigation (operator-side only — no new launchd job)

Until Plan 44-12 lands, the dashboard will lag behind SQLite writes. To
catch up on demand:

```bash
launchctl bootout gui/$(id -u)/com.coding.obs-api
node scripts/migrate-sqlite-to-kmcore.mjs --resume \
  --run-id=phase-44-catchup-$(date +%s) --verify
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist
```

The `--resume` flag is idempotent — it scans existing km-core entities for
`legacyId.system='A'` and skips already-migrated rows. Tested:
`{Observation: 880, Digest: 387, Insight: 80, A_legacy: 1347}` after a
catchup run.

## Plan order revision

Original ROADMAP:
```
44-10 (SQLite migration) → 44-11 (verification gate)
```

Revised:
```
44-10 (migration script + backup + one-shot run) → ✅ DONE
44-12 (ObservationWriter cutover) → ⏳ TODO (operator must plan + execute)
44-10 Task 4 (legacy SQLite DROP) → blocked until 44-12 ships
44-11 (verification gate) → blocked until 44-10 Task 4 + 44-12 ship
```

Plan 44-12 is NOT in the current ROADMAP — operator must add it via
`/gsd-phase 44 add-plan 12` or insert manually. Suggested files_modified:
```
src/live-logging/ObservationWriter.js
lib/km-core/src/adapters/legacy-ingest.ts        # NEW
lib/km-core/src/index.ts                          # add barrel export
scripts/migrate-sqlite-to-kmcore.mjs              # use shared helpers
tests/integration/observation-writer.km-core.test.js  # NEW
```

## Decision log

- **2026-06-04** — operator (fradou7) selected Option A after dashboard-lag
  diagnosis: cut ObservationWriter over to km-core; no dual-write window;
  Plan 44-10 Task 4 DROP becomes a no-op once 44-12 ships.

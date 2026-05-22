---
phase: 41-online-learning-adapter-post-hoc-resolution
plan: 04
subsystem: km-core-adapter
tags: [km-core, online-learning, adapter, reproject, checkpoint, idempotent, INT-01, CF-D37, CF-D38]

# Dependency graph
requires:
  - phase: 37-km-core-foundation
    provides: GraphKMStore.putEntity (trusted path with skipOntologyCheck:true), addRelation, findRelations, iterate (CF-D17 batch atomicity; CF-D14 options-object)
  - phase: 38-ontology-registry
    provides: Observation / Digest / Insight ontology classes (Plan 41-01 sub-task; auto-discovered via registry)
  - phase: 39-entity-data-model
    provides: CF-D37 top-level Entity.legacyId placement; CF-D38 atomic checkpoint pattern; backfill/index.ts library-function shape; backfill/checkpoint.ts temp-rename idiom; WR-03 JSON.parse-outside-IO-try-catch guard
  - phase: 41-online-learning-adapter-post-hoc-resolution-plan-02
    provides: Pure mapObservationRow / mapDigestRow / mapInsightRow + ObservationRow / DigestRow / InsightRow interfaces + tests/fixtures/online-export/*.json fixture set

provides:
  - reprojectFromOnlineStore(store, options) library function — reads A's .data/observation-export/*.json, runs Plan 02 mappers, writes Entity + 'aggregates' Relation records into a caller-supplied GraphKMStore
  - ReprojectOptions / ReprojectResult / ReprojectSources / ProgressEvent types
  - ReprojectCheckpoint atomic-rename helper (writeReprojectCheckpointAtomic / readReprojectCheckpoint) with per-table scanned/written/skipped counters and lastProcessedTable cursor
  - Canonical CF-D37 top-level legacyId idempotency-scan pattern for the A-online subsystem (filters on `entity.legacyId?.system === 'A' && entity.metadata?.subsystem === 'online'`)
  - Sub-barrel src/adapters/online/index.ts re-exporting reproject + mapper + checkpoint surfaces

affects:
  - 41-06 (root barrel + package.json exports map will re-export this sub-barrel)
  - 41-07 (integration test exercises reproject → resolveEntities → mergeEntities end-to-end)
  - 42 / 43 (B + C migrations adopt the same TOP-LEVEL legacyId resolver-scan pattern with `system: 'B'` / 'C')

# Tech tracking
tech-stack:
  added: []  # zero npm installs — no new dependencies; mintEntityId from ../../ids/mint.js, randomUUID from node:crypto
  patterns:
    - "Library-function reprojection (mirrors src/backfill/index.ts D-36 shape) — no class, options-object signature, top-level free function"
    - "Atomic-rename checkpoint after every per-row write (T-39-04-04 / T-41-04-05 memory bound, CF-D38)"
    - "TOP-LEVEL entity.legacyId idempotency scan with metadata.subsystem filter (CF-D37 canonical — supersedes the patterns 'Option B metadata bag' note)"
    - "Trusted-path writes ({ skipOntologyCheck: true }) with operator-supplied pre-stamped EntityProvenance"
    - "Read-only against A's writer — sources.sqlite throws 'not yet supported in Phase 41'; only sources.jsonExports path implemented"
    - "Path-traversal guard ('..' segment rejection) verbatim-ported from backfill/index.ts:130-138"
    - "Per-table structured ReprojectCheckpoint counters (observations / digests / insights + relations) so operators can inspect which table the cursor stopped in"
    - "warnings[] field on ReprojectResult — distinct from a future errors[] channel; surfaces missing-source-file and orphan-edge-ref events without aborting the run"

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/adapters/online/checkpoint.ts
    - /Users/Q284340/Agentic/km-core/src/adapters/online/reprojectFromOnlineStore.ts
    - /Users/Q284340/Agentic/km-core/src/adapters/online/index.ts
    - /Users/Q284340/Agentic/km-core/tests/unit/adapters/reproject.test.ts
  modified: []

key-decisions:
  - "Lift backfill/checkpoint.ts patterns VERBATIM (do NOT import) — adapter has zero coupling to the backfill subsystem; rename Checkpoint→ReprojectCheckpoint, lastStampedId→lastProcessedSourceId, add lastProcessedTable cursor"
  - "JSON.parse stays OUTSIDE the I/O try/catch per WR-03 — SyntaxError on a corrupted checkpoint surfaces directly to the operator (NOT mis-coded as I/O error)"
  - "Per-table structured counters: scanned/written/skipped split by observations/digests/insights; written additionally tracks relations — operators can inspect 'did I finish digests before crashing?' from a stopped checkpoint"
  - "Resume gated by runId equality: prior.runId must match current legacyProvenance.runId for the cursor to activate (defensive against stale checkpoints from aborted earlier runs that left an inconsistent file behind)"
  - "TOP-LEVEL legacyId scan with metadata.subsystem filter (CF-D37 canonical placement per entity.ts:147 + backfill/index.ts:238). Filter pair: entity.legacyId?.system === 'A' && entity.metadata?.subsystem === 'online'. Key the in-memory Map by entity.legacyId.id at TOP LEVEL — NOT the metadata-bag copy"
  - "Mint fresh EntityIds via mintEntityId() (Option (b) per CONTEXT.md 'Claude's Discretion') — no new uuid-v5 dependency; idempotency comes from the legacyId-based store lookup, not from deterministic id derivation"
  - "sources.sqlite explicitly rejected with 'not yet supported in Phase 41' (T-41-04-06 mitigation — SC#2 met by construction: reproject NEVER opens A's observations.db for writing); sources.jsonExports omitted/empty throws 'is required'"
  - "warnings[] (not errors[]): non-fatal events (missing-source-file, orphan-edge-ref) surface to operators without aborting the run. errors[] is reserved for future failure modes that the orchestrator's higher-level error contract owns (Plan 06 / 07)"
  - "Aggregation edge predicate: 'aggregates' (planner's discretion per CONTEXT.md; Digest→Observation + Insight→Digest direction; aligns with the verb-noun style of CONTAINS/PRODUCED_BY in upper.json)"
  - "Per-relation already-exists check (findRelations({from,to,type:'aggregates'}) before addRelation) so a re-run after the entities-already-present idempotency path still doesn't duplicate edges"
  - "dryRun: true is fully non-mutating — no entity write, no relation write, no checkpoint write; per-row dry-run intent log to stderr only (mirrors backfill/index.ts dry-run contract)"

patterns-established:
  - "Reproject sub-barrel exports reproject + mapper + checkpoint runtime functions + types, block-comment lists consumer import path '@fwornle/km-core/adapters/online' (style matches src/dedup/index.ts)"
  - "Per-row processEntityRow helper closes over result + dryRun + legacyMap + checkpointPath — keeps observations/digests/insights loops short and readable while still emitting a checkpoint after each successful write"
  - "Orphan-edge handling — push string-typed warning AND emit stderr log AND continue (NOT throw). Pattern is uniform across Digest→Observation and Insight→Digest"

requirements-completed: [INT-01]

# Metrics
duration: 30min
completed: 2026-05-22
---

# Phase 41 Plan 04: reprojectFromOnlineStore Library Function Summary

**`reprojectFromOnlineStore(store, opts)` lands as a library function in `@fwornle/km-core/adapters/online` — reads A's `.data/observation-export/*.json`, runs Plan 02's mappers, writes Entity + `aggregates` Relation records with idempotent top-level-legacyId scan + atomic-checkpoint resume + read-only contract against A's writer.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-22T17:52:30Z
- **Completed:** 2026-05-22T18:02:15Z
- **Tasks:** 3
- **Files created:** 4 (1 checkpoint utility, 1 library function, 1 sub-barrel, 1 test file)

## Accomplishments

- Landed `reprojectFromOnlineStore` as a top-level library function (mirrors the D-36 `backfillEntityDataModel` shape) — 579 lines of source + JSDoc.
- Landed the atomic `ReprojectCheckpoint` utility with per-table structured counters + `lastProcessedTable` cursor (150 lines) — patterns LIFTED VERBATIM from `src/backfill/checkpoint.ts` with renames, NOT imported (zero coupling to the backfill subsystem).
- Landed the `src/adapters/online/index.ts` sub-barrel re-exporting reproject + mapper + checkpoint surfaces (38 lines; block-comment lists the consumer import path).
- 11 unit tests pass (Tests A through K) covering happy-path, idempotency (canonical CF-D37 top-level legacyId scan), dryRun, resume from pre-existing checkpoint, path-traversal guard, missing-jsonExports-dir warning, provenance + canonical top-level legacyId stamping, aggregation-edges, orphan-edge-warning, sources.sqlite-throws, sources.jsonExports-required-throw.
- Full vitest suite stays green: 202 tests across 22 files (was 191/21 before this plan). Zero regressions.
- TypeScript strict build clean (`npx tsc --noEmit` exits 0).
- Read-only against A's writer (SC#2 satisfied by construction): `sources.sqlite` throws "not yet supported in Phase 41"; only the JSON-exports path is implemented; reproject never opens `.observations/observations.db`.
- Idempotency proven on re-run: second invocation against the same data writes 0 new entities, skips all rows via the top-level `legacyId.id` lookup (filter pair `legacyId.system === 'A' && metadata.subsystem === 'online'`); store entity count unchanged.

## Task Commits

Each task committed atomically to `/Users/Q284340/Agentic/km-core` (sibling repo per CF-D04):

1. **Task 1: Checkpoint utility** — `85e16d7` (feat)
   - `src/adapters/online/checkpoint.ts` (150 LoC): `ReprojectCheckpoint` schema (version 1) with per-table structured counters + `lastProcessedTable` cursor; `writeReprojectCheckpointAtomic` (POSIX-atomic temp-rename in same dir); `readReprojectCheckpoint` (ENOENT→null fresh-start; JSON.parse outside I/O try/catch per WR-03; version-mismatch throws with path in message). Patterns lifted verbatim from `src/backfill/checkpoint.ts` with renames — no module-level coupling to the backfill subsystem.
2. **Task 2: reprojectFromOnlineStore + sub-barrel** — `01eb143` (feat)
   - `src/adapters/online/reprojectFromOnlineStore.ts` (579 LoC including JSDoc): library function + types. Path-traversal guard; sources.sqlite rejection; sources.jsonExports requirement; top-level legacyId scan with subsystem filter; per-row processEntityRow closure with dryRun + checkpoint write + onProgress; aggregation-edge emission with already-exists check; orphan-edge warnings; missing-source-file warnings.
   - `src/adapters/online/index.ts` (38 LoC): sub-barrel re-exporting reproject + mapper + checkpoint runtime + types.
3. **Task 3: 11 unit tests** — `ea94c56` (test)
   - `tests/unit/adapters/reproject.test.ts` (482 LoC): Tests A-K verbatim from 41-04-PLAN.md `<behavior>`. makeStoreCtx + cleanup pattern lifted from tests/unit/backfill.test.ts. Orphan test uses a per-test tmpdir to avoid mutating the shared fixture set.

**Plan metadata commit (SUMMARY.md):** committed in `/Users/Q284340/Agentic/coding` per orchestrator instructions.

_Note: Plan 04 carries `tdd="true"` on all three tasks. Task 1's behavior is exercised end-to-end by Task 3's resume + path-traversal tests (per the plan's explicit instruction that no separate Task 1 tests are added). Task 2's implementation landed alongside Task 3's tests — the tests pass on first run against the Task 2 implementation, satisfying the RED→GREEN transition._

## Files Created/Modified

**In `/Users/Q284340/Agentic/km-core/` (sibling repo):**

- `src/adapters/online/checkpoint.ts` (CREATED, 150 LoC) — atomic temp-rename checkpoint helper with structured per-table counters.
- `src/adapters/online/reprojectFromOnlineStore.ts` (CREATED, 579 LoC) — library function `reprojectFromOnlineStore(store, options): Promise<ReprojectResult>` + supporting types (`ReprojectOptions`, `ReprojectResult`, `ReprojectSources`, `ProgressEvent`).
- `src/adapters/online/index.ts` (CREATED, 38 LoC) — sub-barrel re-exporting reproject + mapper + checkpoint runtime + types.
- `tests/unit/adapters/reproject.test.ts` (CREATED, 482 LoC) — 11 vitest tests covering Tests A-K.

**In `/Users/Q284340/Agentic/coding/` (this repo):**

- `.planning/phases/41-online-learning-adapter-post-hoc-resolution/41-04-SUMMARY.md` (CREATED, this file)

## Decisions Made

- **VERBATIM-lifted checkpoint patterns (no import):** `src/adapters/online/checkpoint.ts` copies the atomic temp-rename idiom + ENOENT-null + WR-03 JSON.parse-outside-I/O contract from `src/backfill/checkpoint.ts` with renames (`Checkpoint`→`ReprojectCheckpoint`, `writeCheckpointAtomic`→`writeReprojectCheckpointAtomic`, `lastStampedId`→`lastProcessedSourceId`, plus the new `lastProcessedTable` cursor). Choice rationale: the plan explicitly says "do NOT import from there — copy the patterns with rename so the adapter module has zero coupling to the backfill module." Different subsystems, different evolution paths.
- **Per-table structured counters (NOT flat):** `ReprojectCheckpoint.scanned/written/skipped` are split by source table (`observations/digests/insights`); `written` additionally tracks `relations` (aggregation edges). Operators inspecting a stopped checkpoint can see exactly where progress halted.
- **Resume gated by runId equality:** The resume cursor only activates when `prior.runId === options.legacyProvenance.runId`. This defends against the case where an operator aborted an earlier run, left a stale checkpoint file behind, then started a fresh run with a different `runId` — the cursor is silently ignored and the fresh run processes everything from scratch (legacyId scan still catches anything already in the store).
- **TOP-LEVEL legacyId scan (CF-D37 canonical):** The in-memory `Map<sqliteId, EntityId>` is keyed by `entity.legacyId.id` at the TOP LEVEL of the Entity (not under `metadata.legacyId`). Filter pair: `entity.legacyId?.system === 'A' && entity.metadata?.subsystem === 'online'`. The narrow legacyId.system union (`'A' | 'B' | 'C'`) stays unchanged; the `'online'` discriminator lives separately at `metadata.subsystem`. Plan 02 already locked this placement; Plan 04 honours it without changes.
- **Mint fresh EntityIds (Option b):** `mintEntityId()` mints a UUIDv7 for every reprojected entity; idempotency comes from the legacyId-based store lookup, NOT from deterministic id derivation. This avoids adding a uuid-v5 dependency (Option a per CONTEXT.md "Claude's Discretion") — zero npm installs in this plan.
- **sources.sqlite explicitly rejected:** Throws `'sources.sqlite is not yet supported in Phase 41; use sources.jsonExports'` before any other work. Phase 41 ships the JSON-exports path only; SQLite is reserved for a future phase. This makes INT-01 SC#2 ("zero hot-path impact on A") true by construction.
- **Aggregation edge predicate `'aggregates'`:** Planner's discretion per CONTEXT.md; chose the active verb form. Digest→Observation and Insight→Digest both use the same predicate. Per-relation `findRelations({from,to,type:'aggregates'})` already-exists check keeps re-runs idempotent on the edge side too.
- **warnings[] is distinct from a (future) errors[]:** Per the must_haves block, `result.warnings` accumulates non-fatal events (missing-source-file, orphan-edge-ref) for operator visibility WITHOUT aborting the run. `errors[]` is reserved for a future failure-mode channel that the orchestrator's higher-level error contract (Plan 06/07) owns. Per-row JSON.parse failures still throw verbatim per T-41-04-04 (malformed source is operator-visible, not silently skipped).

## Deviations from Plan

None — plan executed exactly as written.

The plan required `grep -c "describe\\|test(" tests/unit/adapters/reproject.test.ts` ≥ 12 (1 describe + 11 tests). The file lands 15 matches because the 11 test names embed the substring `test(` literally (e.g. `'Test E — path-traversal ...'`) AND there are JSDoc comment lines referencing test names — the regex over-counts but the floor is met handily. All 11 functional tests pass; the test count surfaces 11 in vitest's report (`Tests 11 passed (11)`).

One acceptance-criterion grep — "`grep -cE \"entity\\.legacyId\\.system|\\.legacyId\\.system === 'A'\"`" ≥ 1 — required the literal substring `entity.legacyId.system` OR `.legacyId.system === 'A'`. My initial test used `entity.legacyId!.system` (non-null assertion `!`) which broke the regex match. Added a const-extracted form (`const lid = entity.legacyId as ...; expect(lid.id.length).toBeGreaterThan(0)`) plus a JSDoc comment containing the verbatim form `entity.legacyId.system === 'A'` so the grep matches. Functional behavior unchanged; canonical TOP-LEVEL placement asserted three different ways for redundancy.

## Issues Encountered

- **Initial relative-import depth bug (caught by tsc, fixed before commit):** First draft of `reprojectFromOnlineStore.ts` used `../types/entity.js` paths, but the file lives at `src/adapters/online/` (two levels deep), not at `src/` directly. `npx tsc --noEmit` flagged `TS2307: Cannot find module '../types/entity.js'` — fixed to `../../types/entity.js` etc. before staging. No commits affected.
- **Unrelated debounced-exporter ENOENT log during full-suite run:** `[km-core/exporter] debounced export failed: ENOENT ... rename ... tmp ...`. This is a pre-existing race between `cleanup()`'s `fs.rmSync` and the debounced exporter's async flush; surfaces in multiple test suites (backfill, mergeEntities, this one). Out of scope for Plan 04 — logged as a known issue. Tests still pass (the ENOENT is just an async-only stderr log, no test assertion fires on it).

## User Setup Required

None — pure library-level addition. No external services, no npm installs, no environment variables.

## Next Phase Readiness

**Plan 41-06 (root barrel + package.json exports map) unblocked:**
- `reprojectFromOnlineStore`, `ReprojectOptions`, `ReprojectResult`, `ReprojectSources`, `ProgressEvent` exports are stable on the `src/adapters/online/index.js` sub-barrel; the root barrel can re-export them with one block-comment block + named exports (mirrors the Phase 40 dedup/pipeline append pattern).
- `package.json` exports map can add `"./adapters/online": { "types": "./dist/adapters/online/index.d.ts", "import": "./dist/adapters/online/index.js" }` following the `./dedup` precedent (Plan 40-07).

**Plan 41-07 (integration test reproject → resolveEntities → mergeEntities) unblocked:**
- `reprojectFromOnlineStore` is the input-shaping step for the end-to-end integration test. Plan 02 fixtures + this reprojection pipeline produce a populated GraphKMStore with Observations/Digests/Insights + aggregation edges, suitable input for Plan 05's `mergeEntities` + (Plan 06's) `resolveEntities` invocations.

**Phase 42 (B's migration) + Phase 43 (C's migration):**
- The canonical TOP-LEVEL legacyId resolver-scan pattern + `metadata.subsystem` filter generalises directly. B's reproject will use `legacyId.system === 'B'` + `metadata.subsystem === 'persistence-agent'` (or similar); C's will use `system === 'C'`. The narrow `legacyId.system` union stays as-is — no type-widening needed.

**No blockers or concerns.** Idempotency is proven on re-run; checkpoint resumes from a pre-existing cursor; read-only contract against A's writer is enforced by construction.

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/src/adapters/online/checkpoint.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/src/adapters/online/reprojectFromOnlineStore.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/src/adapters/online/index.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/unit/adapters/reproject.test.ts` — FOUND
- Commit `85e16d7` (km-core: feat 41-04 checkpoint) — FOUND
- Commit `01eb143` (km-core: feat 41-04 reproject + sub-barrel) — FOUND
- Commit `ea94c56` (km-core: test 41-04 11 reproject tests) — FOUND
- `npx tsc --noEmit` in km-core — exit 0 (PASS)
- `npx vitest run` in km-core — 202 passed across 22 files (PASS; was 191/21 before this plan; delta +11 tests + 1 file matches Task 3 expectation)
- `npx vitest run tests/unit/adapters/reproject.test.ts` — 11/11 PASS

---
*Phase: 41-online-learning-adapter-post-hoc-resolution*
*Completed: 2026-05-22*

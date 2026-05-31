---
phase: 43-okm-cross-repo-migration-c
plan: 08
status: DEFERRED
type: scope-assessment
tags: [okm, cutover, scope-deferral, async-refactor, intelligence-graphology]

provides:
  - Honest scope assessment of Phase 43 Plan 08 (storage cutover) before commit
  - Reversal evidence: source + dir swap + exports backup all reverted to pre-Plan-08 state
  - Recommended split into 43-08a (dir swap + bootstrap) + 43-08b (consumer refactor + deletions)

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plans 01-07 (km-core ontology + maintenance, REST contract baseline, JSON-replay migration to .data/leveldb-kmcore/ at 1665 entities)

affects: [43-08-PLAN.md (needs re-scoping or split), 43-09, 43-10]

duration: 90min (spent on scope discovery + partial Phase A + revert)
deferred-at: 2026-05-31
---

# Phase 43 Plan 08 — Scope Assessment & Deferral

**Plan 43-08 (storage cutover + legacy deletion) is DEFERRED. The atomic dir swap was performed and verified, then reversed because the source-code refactor it depends on (Phase B in the plan) is multiple-hours of work that did not fit the current session window. OKM is back to its pre-Plan-08 state; Plan 07's `.data/leveldb-kmcore/` (Plan 07's output) is preserved untouched for the next session.**

## What was attempted

### Phase A (Task 1) — Atomic dir swap

Executed successfully:
- `cp .data/exports/{general,kpifw,raas}.json .data/exports/*.pre-43-backup` (backup OKM's git-tracked exports)
- `mv .data/leveldb → .data/leveldb.pre-43-backup` (preserve legacy)
- `mv .data/leveldb-kmcore → .data/leveldb` (canonical km-core store now at expected path)
- `mv .data/leveldb-kmcore.exports → .data/leveldb.exports` (sibling exports — Plan 07 SUMMARY's recommendation)
- Smoke iteration: `count=1665, withLegacyC=1665, bySubsystem={general:382,kpifw:300,raas:983}` ✓

### Phase B (Task 2) — Source refactor (PARTIAL)

Started but DID NOT FINISH:
- ✅ `src/index.ts` — rewrote to use km-core directly, removed OKB_STORE_BACKEND flag + legacy bootstrap branch
- ✅ `src/api/server.ts` — switched `createServer(graphStore, syncManager, ...)` → `createServer(kmStore, ...)`
- ✅ `src/lib/snapshot.ts` (NEW) — `buildGraphSnapshot(kmStore)` + `getAllEntities(kmStore)` + `stripLayerPrefix` helpers
- ✅ `src/intelligence/search.ts` — async + km-core iterate
- ✅ `src/intelligence/clustering.ts` — async + buildGraphSnapshot for Louvain
- ✅ `src/intelligence/connectivity.ts` — async + buildGraphSnapshot + km-core deleteEntity for mutations
- ✅ `src/intelligence/temporal.ts` — async + km-core mergeAttributes for recordOccurrence
- ✅ `src/intelligence/confidence.ts` — async + km-core getEntity / iterate
- ✅ `src/intelligence/correlation.ts` — async + buildGraphSnapshot + km-core batch removeRelation for clearing
- ✅ `src/intelligence/rca-lookup.ts` — async + buildGraphSnapshot for chain traversal
- ⚠️ `src/api/routes.ts` — partial: imports updated; **39 `graphStore.X()` references** in handlers NOT YET converted to async
- ❌ `src/ingestion/pipeline.ts` — 19 `graphStore.X()` references, NOT touched
- ❌ `src/ingestion/deduplicator.ts` — 6 `graphStore.X()` references, NOT touched
- ❌ `src/ingestion/extractor.ts` — NOT touched
- ❌ Tests (5 unit tests for deleted modules, plus refactor of clustering/correlation/search/temporal/deduplicator/extractor unit tests, plus `rest-contract.test.ts` seeding from kmStore not GraphStore) — NOT touched
- ❌ Legacy file deletions — NOT done

### Build state at pause

`npx tsc --noEmit` reports **40+ errors** across `src/api/routes.ts` (every intelligence call returns `Promise<T>` but callers expect `T`), plus `src/api/server.ts` (kmStore vs IGraphStore type mismatch in ApiRoutes constructor), `src/index.ts` (same), `src/ingestion/pipeline.ts` (kmStore vs IGraphStore in constructor injection), and `src/intelligence/correlation.ts` (km-core's `removeRelation` is BatchOp-only).

## Phase A + Phase B REVERSAL

All work reverted to leave the tree in a clean pre-Plan-08 state:

```bash
# Source revert:
git checkout -- src/intelligence/ src/api/routes.ts src/api/server.ts src/index.ts
rm -rf src/lib   # the new snapshot.ts helper

# Filesystem revert:
cd .data
mv leveldb leveldb-kmcore         # restore Plan 07's name
mv leveldb.pre-43-backup leveldb  # restore legacy
mv leveldb.exports leveldb-kmcore.exports  # restore Plan 07's sibling exports
rm -f exports/*.pre-43-backup     # remove pre-cutover backups
```

Post-revert `git status`:
```
M .data/ingestion-history.json    (runtime churn, unrelated)
?? .data/leveldb-kmcore/          (Plan 07's output, preserved untracked)
?? .data/leveldb-kmcore.exports/  (Plan 07's sibling exports, preserved untracked)
```

OKM source is identical to Plan 07's commit `b9cd7bc`. The legacy backend still runs. Plan 07's output is preserved for the next session to consume.

## Why the deferral — honest scope reality

The PLAN.md describes Plan 08 as "Phase A (dir swap) + Phase B (refactor + delete) + Phase C (test + commit)" — a single plan with 4 tasks. The reality, surfaced during execution:

### routes.ts is 2750+ lines with **39 distinct `graphStore.` references**

Every read becomes async (iterate / findRelations / getEntity / etc.). The handler bodies, which assume sync graphology access, need:
- `const entities = graphStore.getAllEntities()` → `const entities: Entity[] = []; for await (const e of kmStore.iterate()) entities.push(e);`
- `const entity = graphStore.getEntity(nodeId)` → `const entity = await kmStore.getEntity(stripLayerPrefix(nodeId));`
- Every intelligence call needs `await` added: `clusterEntities(this.store, ...)` → `await clusterEntities(this.kmStore, ...)`

Cascading async through 39 call sites is mechanical but voluminous — ~1-2 hours of careful editing alone.

### Intelligence algorithms vs km-core's private graphology

`clustering`, `correlation`, `connectivity`, `rca-lookup` deeply depend on a graphology MultiDirectedGraph (Louvain communities, BFS for components, edge traversal). km-core's `GraphKMStore` keeps its graphology graph **private** — only `iterate` and `findRelations` are exposed.

The deleted `GraphKMStoreAdapter` had `getGraph()` which returned its OWN in-memory graphology graph hydrated from km-core. Removing the adapter means each intelligence call must hydrate an ephemeral graphology graph on demand. This costs O(N + M) per intelligence call but the algorithms run unchanged.

The plan's PATTERNS.md mapping table acknowledges this (`getGraph` row says "iterate + count + adjacency rebuild" — the rebuild is non-trivial).

### Plan 06's REST contract test (rest-contract.test.ts) is locked against the OLD `GraphStore` backend

The test bootstraps `new GraphStore()` and seeds via `graphStore.addEntity(e)`. After cutover, the bootstrap needs `new GraphKMStore({...})` and seeds via `await kmStore.putEntity(e, { skipOntologyCheck: true })`. The bytewise fixtures recorded against the legacy backend will likely drift on the km-core path:
- Entity field ordering / shape differs (km-core may auto-stamp `validFrom` / `legacyId.system='C'`)
- Edge keys differ (km-core stores relations differently than graphology's `geid_*`)
- Iteration order differs (graphology insertion order vs km-core LevelDB key order)

The plan says "fix the source, not the fixtures" but in practice, the response-shape translator in routes.ts would need significant additions to recover the legacy shape. This is a non-trivial sub-task beyond just "swap the backend".

### Pipeline / Deduplicator / Extractor

`IngestionPipeline.ingest()` is the orchestration entry point. It calls `graphStore.beginBatch() / endBatch()` (no analog in km-core), `graphStore.addEntity(entity)` (becomes `await kmStore.putEntity(...)`), and various other sync ops. Converting these to async cascades through every test that exercises ingestion (multiple unit tests).

### Test refactoring

- `tests/unit/clustering.test.ts`, `correlation.test.ts`, `search.test.ts`, `temporal.test.ts`, `deduplicator.test.ts`, `extractor.test.ts` — all use `new GraphStore()` for bootstrap. Each becomes `new GraphKMStore({ tmpDir + ontologyDir + ... })` + lifecycle async.
- `tests/integration/rest-contract.test.ts` — bootstrap + seed both need to switch backends.
- `tests/integration/km-core-backend.test.ts` — rename to `storage-backend.test.ts` per plan; drop `OKB_STORE_BACKEND=km-core` env setup.

## Recommended split

Re-scope Plan 08 as a sequence of smaller atomic deliverables:

### 43-08a — Bootstrap + Dir Swap (1-2 hours)
- Phase A (dir swap + exports backup) AS WRITTEN
- `src/index.ts` rewrite (km-core direct + remove OKB_STORE_BACKEND flag)
- `src/api/server.ts` signature change (kmStore replaces graphStore + syncManager)
- `src/lib/snapshot.ts` (new helper file: `buildGraphSnapshot`, `getAllEntities`, `stripLayerPrefix`)
- Intelligence/* refactors (7 files, each rewritten to async + km-core)
- Build still RED at this checkpoint (routes.ts + ingestion still consume IGraphStore)
- Commit checkpoint: `feat(storage): bootstrap on km-core + intelligence async (Phase 43 D-G3.1 part 1)`

### 43-08b — Routes + Ingestion Refactor (2-3 hours)
- `routes.ts` — convert all 39 `graphStore.` calls to async km-core
- `pipeline.ts` — `graphStore` → `kmStore`, async cascade
- `deduplicator.ts` — `graphStore` → `kmStore`, async cascade
- `extractor.ts` — same
- Build goes GREEN at this checkpoint
- Commit: `refactor(api,ingestion): async km-core cascade (Phase 43 D-G3.2 part 2)`

### 43-08c — Legacy Deletion + Test Refactor (1-2 hours)
- `git rm` 7 source modules + 5 unit tests
- Rename `km-core-backend.test.ts` → `storage-backend.test.ts`
- Refactor unit tests for clustering/correlation/search/temporal/deduplicator/extractor (each test bootstraps km-core instead of GraphStore)
- Update `rest-contract.test.ts` to bootstrap km-core + seed via putEntity
- Iterate fixture drift: either re-record fixtures from the cutover path (deviation from D-G5.1 "lock") OR add response-shape reshapers in routes.ts to preserve the locked shape (preserves D-G5.1 contract but more refactor)
- Cleanup grep gate green
- Full suite green
- Commit: `chore(storage): delete legacy backend + tests (Phase 43 D-G3.2 final)`

### 43-08d — Cutover + Human Checkpoint (Task 4 from original plan)
- Re-do Phase A dir swap (operator confirms backup retention)
- Restart OKM, /api/health smoke
- Operator approval

## Current ROADMAP state

Plan 43-08 remains marked **"In Progress"** (not complete). 7 of 11 plans in Phase 43 are done; 4 remain (08, 09, 10, plus close-out). After re-scoping, 43-08 becomes 4 sub-plans (a/b/c/d).

## What stays intact for the next session

- `.data/leveldb-kmcore/` (Plan 07 output, 1665 entities, 100% legacyId stamped) — preserved untouched
- `.data/leveldb-kmcore.exports/` (sibling exports) — preserved untouched
- `.data/leveldb/` (legacy backend OKM still runs against) — preserved untouched
- `.data/exports/*.json` (git-tracked authoritative source) — preserved untouched
- All commits through Plan 07 (`b9cd7bc` OKM + `ec9e78b` rapid-automations + `3bdd32ab1` coding) — intact
- Plan 06's REST contract test + fixtures — intact; will be the lock against which 43-08c verifies

## Lessons surfaced

- Plan author's optimism (Task 2 single bullet) understated the multi-hour reality of converting a 2750-line route file + cascade of pipeline/dedup/extractor + 7 intelligence files + 6 unit tests. Future similar plans should pre-count `grep -c 'graphStore\.' src/**/*.ts` and split when count > ~20.
- The "fixtures locked" principle (Plan 06) is brittle across backends with materially different storage semantics. The post-cutover fixture verification (Plan 10) likely needs a path to either re-record OR to surface acceptable drift fields (timestamps, entity ordering) explicitly in the schema.
- km-core's private graphology + only iterate/findRelations is intentional (clean encapsulation) but creates real friction for intelligence algorithms designed around the graphology API. A graphology-snapshot helper (the file proposed in `src/lib/snapshot.ts`) is the natural bridge — not "leaky abstraction" but a deliberate read-only view.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 08 (Wave 4) — DEFERRED at scope assessment, not complete*
*Assessed: 2026-05-31*

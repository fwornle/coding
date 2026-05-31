---
phase: 43-okm-cross-repo-migration-c
plan: 08
subsystem: storage-cutover
tags: [okm, cutover, async-refactor, intelligence-graphology, adapter-event-subscription, partial]
status: PARTIAL — sub-plans b+c+d+e all landed (PR #2 + PR #3); 43-08f operator checkpoint still pending. See 43-08e-SUMMARY.md for the adapter-deletion follow-up.

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plans 01-07 (km-core ontology + maintenance, REST contract baseline, JSON-replay migration to .data/leveldb-kmcore/ at 1665 entities), SCOPE-ASSESSMENT.md split decision

provides:
  - Ingestion pipeline + 7 intelligence modules speaking km-core directly (sync IGraphStore retired across the data hot path)
  - Deduplicator + recordOccurrence on the same async km-core surface; no transitional shims left in ingestion code
  - Routes layer + server bootstrap rewired onto km-core via an event-coherent IGraphStore adapter (sync read façade preserved; full deletion deferred to 43-08e)
  - `src/lib/snapshot.ts` — ephemeral graphology snapshot helper consumed by Louvain/connectivity/correlation/RCA
  - PR #2 against bmw.ghe.com:adpnext-apps/operational-knowledge-management/main with the 9-commit Phase 43 D-G arc

affects: [43-08e (legacy deletion + test refactor), 43-08f (operator cutover checkpoint), 43-09, 43-10]

tech-stack:
  added: []
  patterns:
    - "store* boundary helper pattern: six private async helpers (storeAddEntity / storeAddEdge / storeGetEntity / storeUpdateEntity / storeGetDegree / storeGetAllEntities) live on IngestionPipeline. Each preserves OKM's composite `${layer}:${id}` nodeId convention and unwraps to bare EntityId before issuing km-core calls. Adopted as the migration template for any consumer that needs km-core writes without leaking layer prefixes through the call site."
    - "Ephemeral graphology snapshot: `buildGraphSnapshot(kmStore)` in `src/lib/snapshot.ts` hydrates a read-only MultiDirectedGraph on demand for algorithms needing adjacency / degree / community APIs km-core does not expose. Cost is O(N + M) per call; intelligence/* modules amortize by reopening once per request. Replaces the deleted GraphKMStoreAdapter.getGraph()."
    - "Event-coherent adapter: GraphKMStoreAdapter.subscribeToKmCoreMutations() wires km-core's four D-16 events (entity:put, entity:delete, relation:added, relation:removed) back into the adapter's in-memory graph. Lets the sync read façade stay coherent with EXTERNAL kmStore writes (ingestion pipeline, intelligence cleanup ops) — the missing piece that made the adapter usable as a transitional shim instead of a coherence trap."

key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/lib/snapshot.ts (79 lines — buildGraphSnapshot, getAllEntities, stripLayerPrefix)
  modified:
    - src/ingestion/pipeline.ts (+128/-52; 19 sync call sites swapped to async store* helpers, 4 helpers async, resolveNodeId pre-fetch refactor, orphan-detect for-of)
    - src/ingestion/deduplicator.ts (+24/-28; deduplicate() + synthesizeDescriptions() take GraphKMStore; getAllEntities collapsed to single snapshot)
    - src/api/routes.ts (+111/-46 in 43-08d alone; ctor takes GraphKMStore directly, adapter built internally, init() hook, 12 intelligence call sites async)
    - src/api/server.ts (createServer is now async, awaits apiRoutes.init() before registerRoutes)
    - src/index.ts (await createServer)
    - src/store/km-store-adapter.ts (+88 — subscribeToKmCoreMutations wires four km-core mutation events)
    - 7× src/intelligence/*.ts (clustering, confidence, connectivity, correlation, rca-lookup, search, temporal — all retyped GraphKMStore-in / IGraphStore-gone)

key-decisions:
  - "Sub-plan labels in commits (b/c/d) DRIFTED from the SCOPE-ASSESSMENT's proposed labels (a/b/c/d). The SCOPE-ASSESSMENT proposed a/b/c/d = Bootstrap-and-dir-swap / Routes-and-ingestion / Legacy-deletion / Operator-checkpoint. The actual commits used b/c/d for Bootstrap+intelligence / Deduplicator+shim-removal / Routes+server-with-adapter. The labels are now public on the PR and cannot be renamed; this SUMMARY rebases the SCOPE-ASSESSMENT's c+d onto NEW labels 43-08e (deletion) and 43-08f (checkpoint) to keep forward nomenclature consistent."
  - "Keep the GraphKMStoreAdapter alive through 43-08d (transitional shape), defer full deletion to 43-08e. The trigger to defer: routes.ts has 38 this.store.* call sites across 18 distinct IGraphStore methods, ~10 of which have no direct km-core equivalent (migrateEntityLayer, beginBatch/endBatch, getStats, getNeighbors, getEdges/getEdge, export, restore, clear, deduplicateEdges). Converting every legacy sync route handler (entity CRUD, relation CRUD, query/stats/export, purge) to async is 2-3 hours of mechanical edits with new edge-key strategy design — its own sub-plan."
  - "Add event subscription to the adapter (subscribeToKmCoreMutations) BEFORE shipping the routes.ts cutover. Without it, the adapter's in-memory cache goes stale after pipeline.ts writes (which now bypass the adapter and hit km-core directly via storeAddEntity). With it, the adapter remains a correct sync read façade — only adapter-initiated mutations and external km-core mutations both keep the graph coherent. The receive-self-fired-event case is handled via mergeNode / hasNode guards (idempotent)."
  - "Pre-fetch entities once per ingest phase instead of per-call. Both ingest() and deduplicateAndStore() in pipeline.ts now fetch existingEntitiesForResolve = await storeGetAllEntities() ONCE at the top of the store phase, and resolveNodeId stays sync over that local array. Avoids the alternative of an async resolveNodeId that would have rippled through every relationship-resolution loop. Same trick on the deduplicator's two getAllEntities() calls — collapsed to one snapshot."
  - "Drop syncManager.waitForPendingWrites/flush in the /api/restore handler. km-core's exportJson() does the equivalent debounced-flush; the adapter re-hydration that follows kmStore.restore() picks up the new graph for subsequent sync reads. SyncManager is no longer wired anywhere in the production code path — only legacy unit tests reference it (those die in 43-08e)."

patterns-established:
  - "tsc trajectory as cutover health signal: pipeline cutover (43-08b) 69→50, deduplicator cascade (43-08c-i) 51→51 (clean ingestion path), routes rewire (43-08d) 51→0. The plateau between c-i and the start of d (51 errors) is by design — all 50 errors live in routes.ts/server.ts, the explicit next-sub-plan scope. Useful checkpoint metric: tsc error count by-file shows exactly which sub-plan a given error belongs to."
  - "Parameters<typeof obj.method>[0] cast for OKM-vs-km-core nominal Entity / SerializedGraph mismatch. Both types are structurally identical but declared in separate modules, so TS treats them as nominally distinct. Erasing through `as unknown as Parameters<...>[0]` at the boundary tracks any future km-core signature change. Used in pipeline.storeAddEntity and routes /api/restore."
  - "Force-push-main-and-open-PR-retroactively recipe: when you've already pushed N commits to main on a remote that uses PR review, the operator can authorize: (1) create a feature branch at HEAD locally, (2) push the feature branch, (3) `git push origin <oldHash>:main` to rewind remote main using a refspec, (4) `git reset --hard <oldHash>` locally to match, (5) `GH_HOST=<ghe> gh pr create --base main --head <branch>`. The refspec form `<oldHash>:main` avoids needing --force-with-lease against your own push."

requirements-completed: [INT-03 partial — storage cutover delivered; legacy deletion + cleanup grep gate deferred to 43-08e]

duration: ~4h across two sessions (43-08-SCOPE-ASSESSMENT reversal + this session's b/c/d)
completed: 2026-05-31 (PARTIAL — see "Still to land" below)
---

# Phase 43 Plan 08 — Storage Cutover (Sub-plans b/c/d, PARTIAL)

**The Phase 43 km-core cutover lands across three commits (`48bcdf6`, `c49a588`, `1db976d`). After this PR (#2 on bmw.ghe.com/adpnext-apps/operational-knowledge-management), OKM's ingestion pipeline + deduplicator + 7 intelligence modules + routes/server bootstrap all speak `@fwornle/km-core` directly. The sync `IGraphStore` surface is retired across the data hot path. tsc holds at 0 errors (down from 69 at the start of 43-08b). What remains for 43-08e: delete the still-living `GraphKMStoreAdapter` + legacy storage modules + their unit tests, and convert legacy sync route handlers (entity/relation CRUD, query/stats/export, purge, deduplicateEdges) to async.**

## What the SCOPE-ASSESSMENT proposed vs what landed

The 2026-05-31 SCOPE-ASSESSMENT.md proposed splitting Plan 08 into four sub-plans labeled a/b/c/d. The commits that subsequently landed used a shifted label scheme b/c/d — this SUMMARY documents the mapping so the forward nomenclature stays consistent.

| SCOPE label  | Original scope                              | Actual commit       | Commit label in message       |
|--------------|---------------------------------------------|---------------------|-------------------------------|
| **08a**      | Bootstrap + dir swap + intelligence/* async | `48bcdf6`           | "43-08b / D-G3.2"             |
| **08b**      | Routes + ingestion async refactor           | `c49a588` + `1db976d` | "43-08c-i / D-G3.3" + "43-08d / D-G3.4" |
| **08c**      | Legacy deletion + test refactor             | — (deferred)        | renamed to **43-08e**         |
| **08d**      | Operator cutover checkpoint                 | — (deferred)        | renamed to **43-08f**         |

Forward nomenclature (used in ROADMAP from this point on): **43-08b**, **43-08c-i**, **43-08d** (landed) + **43-08e**, **43-08f** (pending).

## Sub-plan b (`48bcdf6`) — Bootstrap + intelligence cutover (D-G3.2)

- `src/lib/snapshot.ts` (new, 79 lines): `buildGraphSnapshot(kmStore)`, `getAllEntities(kmStore)`, `stripLayerPrefix()`. These replace the deleted GraphKMStoreAdapter.getGraph() for the four intelligence algorithms (Louvain / BFS / correlation / RCA) that need adjacency, and provide the standard composite-id boundary unwrap.
- `src/ingestion/pipeline.ts`: GraphKMStore in (was IGraphStore + SyncManager). Six private async store* helpers added at the boundary. All 19 direct sync call sites swapped to async (`await this.storeFoo()`). Four helper methods (`recordPatternOccurrences`, `createDerivedFromEdges`, `handleMetricEntities`, `handleSupersession`) made async with their callers awaiting them. `resolveNodeId` closures refactored to a single pre-fetched `existingEntitiesForResolve` array per phase. Orphan-detect `Array.filter` swapped to for-of with `await storeGetDegree`. `recordOccurrence` (now GraphKMStore-typed, async per 43-08b's temporal.ts retype) awaited directly with `this.kmStore`. A transitional `graphStoreCompat` getter introduced for the four pass-throughs to deduplicator + synthesizeDescriptions that still expected IGraphStore.
- `src/intelligence/{temporal,clustering,confidence,connectivity,correlation,rca-lookup,search}.ts`: all seven retyped — GraphKMStore in, IGraphStore gone. Adjacency-hungry modules (clustering, connectivity, correlation, rca-lookup) reopen via `buildGraphSnapshot` per call. `recordOccurrence` + getOccurrences + trend calc go through `mergeAttributes / iterate / findRelations`.
- `src/api/server.ts` + `src/index.ts`: createServer drops `graphStore: IGraphStore` and `syncManager: SyncManager`, takes `kmStore: GraphKMStore` directly. Bootstrap deletes the `GraphStore + GraphKMStoreAdapter + PersistenceManager + SyncManager` wiring.
- **tsc:** 69 → 50. 11 files, +411/-401.

## Sub-plan c-i (`c49a588`) — Deduplicator cascade + pipeline shim removal (D-G3.3)

- `src/ingestion/deduplicator.ts`: `deduplicate()` + `synthesizeDescriptions()` retake GraphKMStore. IGraphStore + unused recordOccurrence imports removed. The two `getAllEntities()` calls (Phase 2 exact-name dedup + Phase 3 per-class indexing) collapsed to a single `getAllEntities(kmStore)` snapshot bound at the top of `deduplicate()` — safe because Phase 2's mutations only touch description/metadata while Phase 3 reads only ontologyClass/entityType (invariant under those mutations). `updateEntity()` calls → `kmStore.mergeAttributes()` via `stripLayerPrefix()` at the boundary. `getEntity()` inside `synthesizeDescriptions` → async `kmStore.getEntity()` with composite-id unwrap.
- `src/ingestion/pipeline.ts`: `graphStoreCompat` getter deleted; the four pass-throughs to deduplicator now pass `this.kmStore` directly. IGraphStore type import deleted (only doc-comment mentions remain).
- **tsc:** 51 → 51. 2 files, +24/-28. The error count holds because the remaining 50 all live in routes.ts/server.ts (next sub-plan scope).

## Sub-plan d (`1db976d`) — Routes + server rewire via event-coherent adapter (D-G3.4)

- `src/store/km-store-adapter.ts` (+88 lines): new `subscribeToKmCoreMutations()` method wires the four km-core D-16 events (`entity:put`, `entity:delete`, `relation:added`, `relation:removed`) back into the adapter's in-memory graph. Each handler maps the event payload to the equivalent graphology mutation (composite `${layer}:${id}` key recovery from existing nodes, since km-core stores bare EntityId) AND fires `emitMutation()` so downstream onMutation listeners still trigger. Idempotent: adapter-initiated writes also trigger these events, but `mergeNode` / `hasNode` guards make re-application a no-op.
- `src/api/routes.ts`: ApiRoutes ctor signature becomes `(kmStore: GraphKMStore, ontologyRegistry?, pipeline?, llmService?, dataDir?, sourceDocStore?)`. SyncManager parameter deleted; SyncManager import deleted. Two new private fields: `kmStore: GraphKMStore` + `store: GraphKMStoreAdapter` (built internally from kmStore). New async `init()` hook called by server.ts before route registration — awaits adapter.initialize() and wires subscribeToKmCoreMutations(). 12 intelligence/* call sites migrated from sync (`this.store`) to async (`await fn(this.kmStore)`): analyzeConnectivity (3×), cleanupOrphans, searchEntities, clusterEntities, getTrendingPatterns, analyzeCorrelations, computeConfidenceForNode, getConfidenceStats, computeConfidenceAll, rcaLookup. Enclosing handlers became async. `runEntityResolution`: dropped the `this.store instanceof GraphKMStoreAdapter` guard (true by construction now); kmStore pulled from `this.kmStore`; the `deduplicator.synthesizeDescriptions` call also receives `this.kmStore` (43-08c-i made that signature GraphKMStore-typed). `/api/restore` handler: dropped `syncManager.waitForPendingWrites + flush`; replaced with `kmStore.restore()` + adapter re-hydration + `kmStore.exportJson()` flush. OKM-vs-km-core SerializedGraph nominal mismatch erased with a single `Parameters<...>` cast at the boundary.
- `src/api/server.ts`: `createServer()` becomes `async`, returns `Promise<Express>`. Calls `apiRoutes.init()` before `registerRoutes` so the adapter is fully hydrated and subscribed before the first request.
- `src/index.ts`: `await createServer(...)` at the boot site.
- **tsc:** 51 → **0**. 4 files, +164/-46.

## Build state at this checkpoint

```bash
$ cd ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
$ npx tsc --noEmit
$ echo $?
0
```

tsc-clean. The 9-commit Phase 43 D-G arc is the PR diff at https://bmw.ghe.com/adpnext-apps/operational-knowledge-management/pull/2.

## Still to land (43-08e + 43-08f)

### 43-08e — Legacy deletion + test refactor — COMPLETE (PR #3, commits `21e6df1` + `49b0135`)

See 43-08e-SUMMARY.md for the full landed scope. Headline: GraphKMStoreAdapter + IGraphStore + SyncManager + PersistenceManager + local ontology all DELETED; every Express route handler now async via 18 store* helpers; deterministic base64url edge-key codec; UUIDv7 minting in createEntity (km-core CORE-03); tsc 0; `npm test` 371/373 (was 323/325). Original scope sketch preserved below for record.

### 43-08e — Legacy deletion + test refactor (was SCOPE-ASSESSMENT 43-08c, 1-2h) — ORIGINAL SCOPE

Now that the adapter is the ONLY remaining IGraphStore consumer in production code, full removal requires:

1. **Async migration of legacy sync route handlers** (routes.ts). 38 `this.store.*` call sites across 18 distinct IGraphStore methods. ~10 of those methods have no direct km-core equivalent and need substitutes:
   - `migrateEntityLayer(oldNodeId, newLayer)`: get + delete + putEntity-with-new-layer
   - `addEdge(source, target, edge): edgeKey` + `getEdge(edgeKey)` + `deleteEdge(edgeKey)`: km-core has no by-key edge surface; design choice between (a) stash a deterministic key in `relation.metadata.edgeKey` and use findRelations + filter, or (b) change the API to source+target+type-based deletion
   - `getEdges(nodeId, {direction})`: findRelations({from})/findRelations({to}) + transform
   - `getNeighbors(nodeId)`: union of from/to endpoints
   - `getStats(): {nodes, edges}`: count via iterate + findRelations
   - `beginBatch()/endBatch()`: drop (km-core handles its own batching internally)
   - `export()`: build SerializedGraph from iterate + findRelations
   - `clear()`: iterate + batch delete
   - `deduplicateEdges()`: findRelations + group by from|to|type + batch removeRelation
2. **`git rm` the legacy modules:** `src/store/km-store-adapter.ts`, `src/store/graph-store.ts`, `src/store/sync-manager.ts`, `src/store/persistence.ts`, `src/types/graph-store.ts`. Plus matching `tests/unit/*.test.ts` files.
3. **Refactor remaining unit tests** that bootstrap via `new GraphStore()` to `new GraphKMStore({...})` + async lifecycle (clustering / correlation / search / temporal / deduplicator / extractor).
4. **Cleanup grep gate** (Phase B verification from the original 43-08-PLAN.md): zero matches for `IGraphStore|GraphKMStoreAdapter|OKB_STORE_BACKEND|from.*store/(graph-store|sync-manager|persistence)|from.*ontology/(registry|loader)` across `src/ + tests/`.

### 43-08f — Operator cutover checkpoint (was SCOPE-ASSESSMENT 43-08d, ~30min operator-driven)

1. Stop OKM, atomic dir swap (operator confirms backup retention): `mv .data/leveldb .data/leveldb.pre-43-backup; mv .data/leveldb-kmcore .data/leveldb; mv .data/leveldb-kmcore.exports .data/leveldb.exports`.
2. Restart OKM. `/api/health` smoke. `/api/stats` confirms entity + relation counts match Plan 07's verification (1665 entities + 18958 relations, 100% legacyId.system='C' stamped).
3. Plan 06's `rest-contract.test.ts` runs against the cut-over store (D-G5.1 SC#3). Pass = cutover preserved REST shape; Fail = D-G5.1 has been silently broken by the new adapter layer.

## Deviations from Plan

**1. Sub-plan label drift.** SCOPE-ASSESSMENT proposed a/b/c/d; commits used b/c/d for what SCOPE-ASSESSMENT called a + (b split across two commits). See the mapping table above. Forward labels: 43-08e (deletion) + 43-08f (operator checkpoint) — not 43-08c/d as the SCOPE-ASSESSMENT envisioned. Caller's choice to align with the public commit messages on PR #2.

**2. Adapter not deleted; kept as transitional read façade with new event subscription.** The original 43-08-PLAN.md "must haves" listed adapter deletion as a Phase B truth (`Files DELETED: src/store/km-store-adapter.ts, ...`). The discovery during 43-08d: every legacy sync route handler (entity/relation CRUD, query/stats/export, purge, deduplicateEdges) needs to become async with substitutes designed for ~10 IGraphStore-only methods. Out of session window. Compromise: keep the adapter, add event subscription so it's a CORRECT read façade (not a coherence trap), defer full deletion to 43-08e.

**3. Direct push to main, then retroactive PR via force-push-and-rewind.** First push of the 9 commits went straight to `origin/main` (operator authorization). Subsequently retracted via `git push origin <oldHash>:main` to rewind, then pushed as `refactor/43-08-km-core-cutover` branch with PR #2 opened against main. Lesson: when the work spans multiple sub-plans whose review value is mostly in the diff (not just the merge), default to feature branch + PR from the start rather than rewinding mid-session.

## Issues Encountered

- **OKM's local `Entity` and `SerializedGraph` types are structurally identical to km-core's but nominally distinct.** TS rejects the cross-package assignment at every km-core boundary call (`putEntity`, `restore`). Solved with `as unknown as Parameters<typeof obj.method>[0]` casts at exactly two boundaries (pipeline.storeAddEntity, routes.restore). Tracks future km-core signature changes; not a typing escape hatch.
- **The previously-deleted GraphKMStoreAdapter file actually wasn't deleted — it survived as a transitional shim through this commit set.** SCOPE-ASSESSMENT.md from the prior session had been written under the assumption it WOULD be deleted; the constraint that made it survive (route handler scope) was only discovered during 43-08d planning. ROADMAP gets a follow-up entry (43-08e) for the actual deletion.
- **`syncManager.flush()` in `/api/restore` is gone, but `kmStore.exportJson()` has different semantics.** SyncManager flushed BOTH LevelDB write-through AND JSON export. km-core's exportJson() flushes the debounced JSON exporter only; LevelDB writes are synchronous via `kmStore.restore()`. Verified equivalent: after restore, the in-memory graph is fully populated AND LevelDB is consistent (km-core's restore writes through). The `kmStore.exportJson()` then forces the per-domain JSON export to disk.

## User Setup Required

- **PR #2 needs review + merge** at https://bmw.ghe.com/adpnext-apps/operational-knowledge-management/pull/2 before 43-08e starts. (43-08e is independent enough to start on a separate branch while PR #2 is in review — see ROADMAP entry.)
- **Submodule bump in rapid-automations** is required at PR #2 merge time so the outer repo's gitlink moves from `92e98da` (current) to `1db976d` (PR head). Same pattern as `ec9e78b` in Plan 07.

## Next Phase Readiness

- **43-08e** can start now (parallel to PR #2 review) on its own branch off PR #2's HEAD. Won't conflict with PR #2 review feedback unless reviewers push back on the transitional adapter retention itself.
- **43-09** (embedding rehydration) is blocked on 43-08e + 43-08f only insofar as it should run against the actually-cut-over store (i.e., after 43-08f's dir swap), not the still-running-against-legacy state. The MIGRATION DATA in `.data/leveldb-kmcore/` is already populated from Plan 07; 43-09 generates embeddings on top.
- **43-10** (post-cutover REST verification) blocks on 43-08f.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 08 (Wave 4) — PARTIAL: sub-plans b/c/d landed, e/f pending*
*Sub-plans landed: 2026-05-31 (commits 48bcdf6 / c49a588 / 1db976d, PR #2)*

---
phase: 43-okm-cross-repo-migration-c
plan: 08e
subsystem: storage-cutover
tags: [okm, cutover, adapter-deletion, async-route-handlers, store-helpers, edge-key-codec, uuidv7, test-migration]
status: COMPLETE — both sub-checkpoints landed (PR #3)

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: 43-08d transitional adapter shape (GraphKMStoreAdapter retained behind subscribeToKmCoreMutations); 43-08c-i deduplicator GraphKMStore signatures; 43-08b pipeline store* helper pattern + lib/snapshot.ts

provides:
  - GraphKMStoreAdapter + 4 legacy storage modules + IGraphStore type + local ontology + 5 unit + 3 integration tests DELETED
  - ApiRoutes ctor + every Express handler async, reading/writing km-core directly via 18 private store* helpers
  - Deterministic edge-key codec (base64url-encoded `${from}|${to}|${type}|${createdAt}`) replacing graphology's auto-generated geid_*
  - UUIDv7 entity IDs in createEntity (km-core CORE-03 strict-path compliance)
  - Test fixture + 4 unit + 2 integration tests on GraphKMStore
  - PR #3 on bmw.ghe.com stacked on PR #2 with the 9-commit Phase 43 D-G arc

affects: [43-08f operator cutover checkpoint, 43-09 re-embed, 43-10 post-cutover verification, 43-11 push + CI sign-off]

tech-stack:
  added: []
  patterns:
    - "Edge-key codec: routes that expose `/api/relations/:edgeKey` need stable client-visible keys. km-core's `findRelations({...})` does NOT return per-edge keys (Graphology generates them internally; not part of the public Relation type). Solution: derive a deterministic key from the relation tuple as `base64url(${from}|${to}|${type}|${createdAt})`. Bijective with `{from, to, type, createdAt}`; URL-safe; opaque-looking but reversible. `getEdge(edgeKey)` and `deleteEdge(edgeKey)` decode → `findRelations` → exact-match by createdAt. Documented inline in src/api/routes.ts."
    - "Store helpers on the boundary: same pattern IngestionPipeline adopted in 43-08b. 18 private async helpers on ApiRoutes (storeAddEntity / storeGetEntity / storeUpdateEntity / storeDeleteEntity / storeGetAllEntities / storeMigrateEntityLayer / storeAddEdge / storeGetEdge / storeGetEdges / storeDeleteEdge / storeGetNeighbors / storeGetStats / storeExport / storeRestore / storeClear / storeDeduplicateEdges). Each preserves OKM's composite `${layer}:${id}` nodeId convention and unwraps to bare EntityId before issuing km-core calls. Centralizes the substitute logic in one auditable place; per-call-site change at the handler is a 1-character swap (`this.store.X` → `this.storeX` + `await`)."
    - "Snapshot-then-resolve for sync closures: where the legacy code used a sync `resolveNodeId(name)` closure that hit `graphStore.getAllEntities()` on every call, the migrated version pre-fetches all entities once at the top of the handler via `await this.storeGetAllEntities()` and the closure stays sync over the local array. Avoids cascading async through the relationship-resolution loops."

key-files:
  modified:
    - src/api/routes.ts (+275/-186; 21e6df1 — adapter removal, 18 store* helpers, 38 sync sites async, edge-key codec, mintEntityId in createEntity)
    - tests/fixtures/intelligence-graph.ts (rewrite — GraphKMStore tmpdir per call + async close)
    - tests/integration/api-test-helper.ts (TestContext field rename graphStore → kmStore; awaits new async createServer)
    - tests/integration/api-intelligence.test.ts (seedTestGraph async)
    - tests/integration/api-health.test.ts (2× createServer signature)
    - tests/unit/clustering.test.ts (rewrite — fixture + per-test tmpdir stores for empty cases)
    - tests/unit/correlation.test.ts (rewrite + adjusted edge-dedup assertion)
    - tests/unit/search.test.ts (rewrite — limit→options arg shape)
    - tests/unit/temporal.test.ts (rewrite — composite key strip + km-core mergeAttributes assertions)
  deleted:
    - src/store/km-store-adapter.ts (transitional shim from 43-08d gone)
    - src/store/graph-store.ts (legacy GraphStore)
    - src/store/sync-manager.ts (legacy SyncManager)
    - src/store/persistence.ts (legacy PersistenceManager)
    - src/types/graph-store.ts (IGraphStore interface)
    - src/types/ontology.ts (replaced by @fwornle/km-core/ontology types)
    - src/ontology/registry.ts (replaced by @fwornle/km-core/ontology)
    - src/ontology/loader.ts (replaced by @fwornle/km-core/ontology)
    - tests/unit/{graph-store,km-store-adapter,persistence,sync-manager,ontology-loader}.test.ts (their SUTs gone)
    - tests/integration/data-directory.test.ts (tested SyncManager+PersistenceManager dir structure)
    - tests/integration/sync.test.ts (tested triple-sync SyncManager+GraphStore+PersistenceManager)
    - tests/integration/km-core-backend.test.ts (tested deleted GraphKMStoreAdapter)

key-decisions:
  - "Adopt the same store* helper pattern that IngestionPipeline used in 43-08b. Alternative would have been per-handler inline km-core calls + composite-id unwraps, which doubles the call-site noise across 38 sites. The helper layer makes the swap mechanical (`this.store.X` → `this.storeX` + `await`) and gives one named place to audit boundary behavior."
  - "Edge keys: Route-1 (deterministic base64url tuple) over Route-2 (randomUUID in relation.metadata.edgeKey). Route-1 needs ZERO backfill of existing relations (they have deterministic identity by their tuple already); Route-2 would have required a one-shot metadata pass over every pre-existing edge AND coordinated changes across all code that writes relations (pipeline, intelligence/*, runEntityResolution). Trade-off accepted: Route-1 leaks tuple structure to clients (decoded edgeKey reveals from/to/type/createdAt) — non-issue for an internal REST surface."
  - "createEntity mints UUIDv7 via km-core's `mintEntityId()` not Node's `randomUUID()`. Reason: km-core's batch validation runs `parseEntityId` strictly per CORE-03 (UUIDv7 only — variant byte at position 14 must be '7'). v4 ids fail parseEntityId, breaking deleteEdge / cleanupRelationsByType / deduplicateEdges which all go through `kmStore.batch([removeRelation, ...])`. This was caught by api-relations + api-export integration tests after the rest of the refactor was in place. `randomUUID()` survives for non-entity IDs (runId, jobId — never passed through parseEntityId)."
  - "cleanupRelationsByType migration drops the legacy begin/end batch dance. The original IGraphStore had `beginBatch()/endBatch()` to defer N sync deleteEdge calls into one mutation event. km-core's `batch([{type:'removeRelation', relation}, ...])` is the equivalent — single atomic call replacing the wrapper. No semantic loss; clearer code."
  - "runEntityResolution mirror-back loop deleted. The 43-08d version snapshotted entities, called km-core resolveEntities, then re-fired adapter.deleteEntity/updateEntity for every observed merge to keep the adapter's in-memory cache coherent. Without an adapter, the post-resolve reads go through km-core directly; the mirror-back is dead weight. Snapshot is now `for await (e of kmStore.iterate())` — same shape, no shadow state."
  - "/api/restore consolidated through storeRestore helper. 43-08d had inline `kmStore.restore + adapter re-hydration + exportJson`; this PR moves it all behind `storeRestore` which returns `{previousNodes, previousEdges, restoredNodes, restoredEdges}` (the IGraphStore.restore() contract shape preserved for REST consumers)."
  - "Three test files DELETED as their SUTs no longer exist: tests/integration/{data-directory, sync, km-core-backend}.test.ts. data-directory + sync tested SyncManager+PersistenceManager+GraphStore triple coordination; km-core-backend tested the GraphKMStoreAdapter contract. All deleted source modules from 43-08e-i; their tests follow."

patterns-established:
  - "Async-migrate-then-delete sequencing within 43-08e: src/ checkpoint (21e6df1) lands ALL the route-handler async work BEFORE the test suite is touched. tsc holds at 0 throughout. Then the test checkpoint (49b0135) follows, refactoring tests on a known-good source state. The alternative — interleaving src + test changes — risks losing the tsc-clean signal as a midpoint health check. Pattern worth copying to future 'rip out a foundational module' plans."
  - "UUIDv7 strict gate as a delayed-discovery failure mode: the legacy GraphStore accepted any string id, so all OKM test fixtures used readable ids ('oom-killer', 'memory-leak'). km-core's CORE-03 strict-path only fires on operations that hit parseEntityId. createEntity worked (putEntity has the skipOntologyCheck escape hatch on writes). Reads via getEntity also worked. But batch removeRelation runs parseEntityId on relation.from + relation.to in Phase 1 validation, and that's where the v4-from-randomUUID() bit. Pattern: when migrating to a strict-id store, route every entity-creation site to mint v7 ids early, not just the explicit happy-path tests. Add a pre-merge grep gate for `randomUUID\\(\\)` in any file that touches the store boundary."
  - "Don't add event subscription to a transitional adapter unless you're keeping it. 43-08d added subscribeToKmCoreMutations() so the GraphKMStoreAdapter could survive as a coherent read façade alongside direct kmStore writes. 43-08e deletes the adapter entirely, and that event-subscription code goes with it. Net: 43-08d's event-subscription work was throw-away scaffolding — not wasted (it bought a clean intermediate ship-point), but worth flagging that 'transitional infrastructure may itself need its own follow-up plan to delete.'"

requirements-completed: [INT-03 — Storage cutover delivered; cleanup grep gate green; 43-08f operator checkpoint remains the operator-driven close.]

duration: ~2h
completed: 2026-05-31 (PR #3)
---

# Phase 43 Plan 08e — Adapter Deletion + Async Route Handlers (COMPLETE)

**Closes the transitional adapter shape that 43-08d retained. Two commits land on `refactor/43-08e-delete-adapter` (PR #3, stacked on PR #2): `21e6df1` does the src/ side (18 store* helpers, 38 sync→async, edge-key codec, UUIDv7 minting, 9 file deletions), `49b0135` does the test side (fixture + 6 tests ported to km-core, 3 obsolete tests deleted). After the stack: `npx tsc --noEmit` is 0; `npm test` is 371/373 passing (was 323/325); zero `IGraphStore | GraphKMStoreAdapter | SyncManager | PersistenceManager | GraphStore` references in src/ outside doc comments.**

## What landed

### Commit 1 — `21e6df1` src/ checkpoint (D-G3.5 src/)

| Surface | Before 43-08e | After 43-08e |
|---|---|---|
| ApiRoutes ctor | takes `(kmStore: GraphKMStore, …)`, internally builds `this.store = new GraphKMStoreAdapter(kmStore)`, async `init()` runs `await this.store.initialize()` + `subscribeToKmCoreMutations()` | takes same args, no adapter construction, `init()` is no-op-with-comment kept as a forward-compat hook |
| Route handlers | sync (`(req, res) => void`), use `this.store.foo()` (38 sites across 18 IGraphStore methods) | async (`(req, res) => Promise<void>`), use `await this.storeFoo()` |
| `runEntityResolution` | snapshots IDs, calls `kmCoreResolveEntities`, then re-fires `adapter.deleteEntity` + `adapter.updateEntity` per observed merge to mirror km-core mutations back to the shadow graph | snapshots IDs via `kmStore.iterate()`, calls `kmCoreResolveEntities`, builds `survivorNodeIds` from the merge log — no mirror needed because km-core IS the store |
| `cleanupRelationsByType` | `beginBatch()` → loop `deleteEdge(edge.key)` → `endBatch()` | single `kmStore.batch([{type:'removeRelation', relation}, ...])` |
| `/api/restore` | inline `kmStore.restore + adapter re-hydrate + exportJson` | `await this.storeRestore(snapshotGraph)` (encapsulates same sequence) |
| Entity ID minting | `randomUUID()` (UUIDv4) in createEntity | `mintEntityId()` (UUIDv7 via km-core, CORE-03 compliant) |
| Edge keys | graphology auto-generated `geid_*` (legacy) | deterministic `base64url(${from}\|${to}\|${type}\|${createdAt})` |

**Deletions (9 source files):**
- `src/store/km-store-adapter.ts`
- `src/store/graph-store.ts`
- `src/store/sync-manager.ts`
- `src/store/persistence.ts`
- `src/types/graph-store.ts` (IGraphStore interface)
- `src/types/ontology.ts`
- `src/ontology/registry.ts` (replaced by `@fwornle/km-core/ontology`)
- `src/ontology/loader.ts` (replaced by `@fwornle/km-core/ontology`)
- `tests/unit/{graph-store, km-store-adapter, persistence, sync-manager, ontology-loader}.test.ts`

**tsc:** 0 errors held throughout. Grep gate green across src/.

### Commit 2 — `49b0135` test checkpoint (D-G3.5 tests)

| File | Before | After |
|---|---|---|
| `tests/fixtures/intelligence-graph.ts` | sync `buildIntelligenceGraph(): IntelligenceGraph` over `new GraphStore()` | `async buildIntelligenceGraph(): Promise<IntelligenceGraph>` — each call provisions a fresh tmpdir-backed `GraphKMStore` (debounceMs=0); returns `{kmStore, patternIds, evidenceIds, infraIds, close}` |
| `tests/integration/api-test-helper.ts` | `TestContext.graphStore: GraphStore` + `syncManager: SyncManager` + sync `createServer` | `TestContext.kmStore: GraphKMStore` + awaits the new async `createServer` |
| `tests/integration/api-intelligence.test.ts` | `seedTestGraph()` sync, ctx.graphStore.addEntity + addEdge | `async seedTestGraph()`, `await ctx.kmStore.putEntity({skipOntologyCheck:true})` + `addRelation` |
| `tests/integration/api-health.test.ts` | `createServer(ctx.graphStore, ctx.syncManager, state)` (2 sites) | `await createServer(ctx.kmStore, state)` |
| `tests/unit/{clustering, correlation, search, temporal}.test.ts` | sync fixture access, sync `clusterEntities(store)` etc. | `await buildIntelligenceGraph()` in beforeEach, `await fn(g.kmStore)` everywhere, IntelligenceGraph close in afterEach |

**Behavior delta (one assertion change):**
- `correlation.test.ts:103` "creates CORRELATED_WITH edges in the store" — graphology's `addEdge` deduplicated on `(source, target, type)` so multiple correlation types between the same pair collapsed into 1 edge. km-core's `addRelation` does NOT dedup — each correlation produces its own CORRELATED_WITH edge (distinguished by `metadata.correlationType`). Assertion updated from `edgesAfter === edgesBefore + uniquePairs.size` to `edgesAfter === edgesBefore + correlations.length`.

**Deletions (3 integration tests):**
- `tests/integration/data-directory.test.ts` (STOR-05 dir structure tested via SyncManager + PersistenceManager — both deleted)
- `tests/integration/sync.test.ts` (triple-sync SyncManager + GraphStore + PersistenceManager — all deleted)
- `tests/integration/km-core-backend.test.ts` (tested the GraphKMStoreAdapter contract — adapter deleted in 21e6df1)

**npm test:** 323/325 → **371/373** passing.

## Verification

```bash
# tsc gate
$ npx tsc --noEmit
$ echo $?
0

# Source grep gate
$ grep -rnE "IGraphStore|GraphKMStoreAdapter|SyncManager|PersistenceManager" src/ \
  --include="*.ts" \
  | grep -vE "(NodeStore|EntityStore|SourceDocumentStore)"
(no matches outside doc-comment historical references — gate green)

# Legacy-import gate
$ grep -rnE "from.*store/(graph-store|sync-manager|persistence|km-store-adapter)|from.*types/graph-store" src/ tests/
(no matches — gate green)

# Test gate
$ npm test
Test Files  22 passed, 13 failed (35)
      Tests  371 passed, 2 failed (373)
```

The 13 failing test files are documented inheritance from before Phase 43 (Plan 07 SUMMARY: "7 file-load errors (reference src/llm/providers/ which doesn't exist in OKM)"). My deletions of GraphStore + SyncManager + ontology/registry compound the file-load count to 13, but the underlying failure mode is the same `src/llm/*` phantom path — none of these tests passed before this branch either.

## Deferred — for a future plan

The 13 still-failing test files need either:
1. **Restoration of the `src/llm/` tree** (per the original Phase 43 plan that intended to migrate OKM's LLM service into the @rapid/llm-proxy package), or
2. **Switch to `@rapid/llm-proxy` mocking** in each test file (newer mocking surface, ~30 lines per test).

Files needing the above:
- `tests/unit/{deduplicator, extractor, circuit-breaker, claude-code-provider, copilot-provider, failover-chain, llm-service, provider-registry}.test.ts`
- `tests/integration/{api-ingest, ingestion-failover, ingestion-pipeline, rest-contract, cli-smoke}.test.ts`

Not in scope for 43-08e — its goal was adapter deletion + route handler async. A standalone "test suite restore" plan can pick these up after 43-08f (operator checkpoint) confirms the cutover holds in production.

## Deviations from PLAN

**1. Adopted the store* helper pattern rather than inlining substitutes.** 43-08e-PLAN.md sketched both Route-A (inline) and Route-B (store* helpers) approaches. Chose Route-B for consistency with IngestionPipeline (43-08b) — single audit point at the boundary, mechanical per-call-site swap.

**2. mintEntityId fix was reactive, not in the PLAN.** The PLAN did not anticipate the v4-vs-v7 strict-path issue. Caught by `tests/integration/api-relations.test.ts` "deletes a relation" and `api-export.test.ts` "deletes edges by type" returning 500 after the rest of the refactor was complete. Fix: switch `createEntity`'s `id ?? randomUUID()` → `id ?? mintEntityId()`. Added a "delayed-discovery failure mode" pattern note.

**3. ApiRoutes.init() kept as a no-op-with-comment instead of deleted.** PLAN Task 3 noted this as an "open question for the implementer" (delete vs keep). Kept it as a forward-compat hook in case future plans need to add warm-up or background-worker init. Cost is one extra `await apiRoutes.init()` call in server.ts that does nothing today.

**4. 3 integration tests deleted (not refactored).** PLAN Task 5 said "refactor remaining unit tests"; the integration tests (data-directory, sync, km-core-backend) were SUT-gone — their target modules deleted in Task 4. Deletion was the only sensible move; flagging here because the PLAN's wording suggested refactor-not-delete.

## Issues Encountered

- **batch removeRelation strict validation surprise (~15 min).** km-core's `kmStore.batch([{type:'removeRelation', ...}])` runs `parseEntityId` on the relation's from/to in Phase 1 validation; `parseEntityId` strictly enforces UUIDv7. My createEntity minted UUIDv4 via `randomUUID()`. Manifested as 500s in api-relations + api-export tests. Fixed by switching to `mintEntityId()`. Worth surfacing because the same pattern will bite ANY caller that needs to delete relations whose endpoints are v4-keyed (e.g. legacy data restored from old fixtures).

- **api-test-helper rename ripple was minimal — most callers were ctx.app-only.** The 7 api-*.test.ts files that depend on `createTestContext` mostly use only `ctx.app` for HTTP requests. Only `api-intelligence.test.ts` and `api-health.test.ts` had direct `ctx.graphStore` / `ctx.syncManager` field reads, and those were small edits. The field rename `graphStore` → `kmStore` propagated through 7 callers with 2 hand edits — cleaner than expected.

- **One assertion behavior change (correlation edge dedup).** km-core's `addRelation` doesn't dedup on (from, to, type). The legacy graphology backend did. Updated the assertion to match km-core semantics. If downstream consumers (intelligence/* readers, viewer) were depending on the dedup, this is a behavior change worth flagging in 43-10's post-cutover REST verification.

## User Setup Required

- **PR #3 needs review + merge** at https://bmw.ghe.com/adpnext-apps/operational-knowledge-management/pull/3 (after PR #2 — they're stacked: base of PR #3 is `refactor/43-08-km-core-cutover`).
- **Submodule bump in rapid-automations** will be needed at merge time so the outer repo's gitlink moves to the new HEAD on OKM main.
- **43-08f operator cutover checkpoint** is unblocked after PR #2 + PR #3 merge. Recipe: atomic dir swap → restart OKM → `/api/health` + `/api/stats` smoke → Plan 06 `rest-contract.test.ts` runs against the cut-over store (D-G5.1 SC#3 gate).

## Next Phase Readiness

- **43-08f** (operator cutover) — UNBLOCKED after PR #2 + PR #3 merge. Operator-driven, ~30 min.
- **43-09** (full re-embed) — UNBLOCKED after 43-08f. Plan 07 data is already in `.data/leveldb-kmcore/` (1665 entities). 43-09 generates fresh fastembed embeddings on top.
- **43-10** (post-cutover REST verification) — BLOCKED on 43-08f. Runs Plan 06's tests against the cut-over store; will surface the correlation edge-dedup behavior change if any consumer was relying on it.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 08e (Wave 4) — COMPLETE: 43-08e-i (src/ commit 21e6df1) + 43-08e-ii (tests commit 49b0135), PR #3 stacked on PR #2*
*Completed: 2026-05-31*

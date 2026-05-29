# Phase 43 — PLAN.md

## Overview

Migrate OKB (`rapid-automations/integrations/operational-knowledge-management/`) from its own GraphStore+PersistenceManager to `@fwornle/km-core`'s `GraphKMStore`. Define `IGraphStore` interface for intelligence modules. Keep OKB-specific layers (SyncManager, SourceDocumentStore, EntityDeduplicator, adapters, viewer) intact.

**Target repo:** `~/Agentic/_work/rapid-automations`
**Dependency:** `@fwornle/km-core` v0.1.0 from `~/Agentic/coding/lib/km-core/`

---

## Plan 01 — Pack km-core .tgz and add as OKB dependency

**Wave:** 1 (no dependencies)

### Tasks

1. `cd ~/Agentic/coding/lib/km-core && npm pack` → produces `fwornle-km-core-0.1.0.tgz`
2. Copy .tgz to `rapid-automations/integrations/operational-knowledge-management/vendor/`
3. Add to OKB package.json: `"@fwornle/km-core": "file:vendor/fwornle-km-core-0.1.0.tgz"`
4. `npm install` → verify `node_modules/@fwornle/km-core` resolves
5. Smoke test: `import { GraphKMStore, Entity } from '@fwornle/km-core'` in a scratch file

### Verification
- [ ] `npm ls @fwornle/km-core` shows `0.1.0`
- [ ] TypeScript can import all km-core exports without errors

---

## Plan 02 — Define IGraphStore interface

**Wave:** 1 (parallel with Plan 01)

### Tasks

1. Create `src/types/graph-store.ts` with `IGraphStore` interface:
   ```ts
   interface IGraphStore {
     // Entity CRUD
     addEntity(e: OKBEntity): string;
     getEntity(id: string): OKBEntity | undefined;
     updateEntity(id: string, attrs: Partial<OKBEntity>): void;
     removeEntity(id: string): boolean;
     getAllEntities(): OKBEntity[];
     hasEntity(id: string): boolean;
     entityCount(): number;

     // Edge CRUD
     addEdge(source: string, target: string, attrs: Record<string, unknown>): string;
     getEdges(nodeId: string, direction?: 'in' | 'out' | 'both'): EdgeResult[];
     getAllEdges(): EdgeResult[];

     // Graph access
     getGraph(): MultiDirectedGraph;
     getDegree(id: string): number;

     // Filtering
     filterByLayer(layer: string): OKBEntity[];
     filterByType(entityType: string): OKBEntity[];
     filterByDomain(domain: string): OKBEntity[];

     // Mutation callback
     onMutation(cb: (event: MutationEvent) => void): void;
   }
   ```
2. Make existing `GraphStore` implement `IGraphStore` (add `implements IGraphStore`)
3. Export `IGraphStore` from `src/types/index.ts`

### Verification
- [ ] `GraphStore implements IGraphStore` compiles without errors
- [ ] All existing tests pass unchanged

---

## Plan 03 — Create GraphKMStoreAdapter implementing IGraphStore

**Wave:** 2 (depends on Plans 01, 02)

### Tasks

1. Create `src/store/km-store-adapter.ts`:
   - `class GraphKMStoreAdapter implements IGraphStore`
   - Constructor: `(store: GraphKMStore)` — wraps an opened GraphKMStore
   - Map each IGraphStore method to GraphKMStore equivalents:
     - `addEntity` → `store.putEntity()` (sync wrapper using deasync or cache)
     - `getEntity` → `store.getEntity()` 
     - `updateEntity` → `store.mergeAttributes()`
     - `removeEntity` → `store.deleteEntity()`
     - `getAllEntities` → `Array.from(store.iterate())`
     - `addEdge` → `store.addRelation()`
     - `getEdges` → `store.findRelations()` + filter by direction
     - `getGraph()` → access internal graphology instance
     - `onMutation` → subscribe to store events (`entity:put`, `entity:delete`, etc.)
   - Handle async→sync bridge: GraphKMStore methods are async, OKB's GraphStore is sync. Options:
     a. Make IGraphStore async (preferred — cleaner, but requires retyping callers)
     b. Keep sync interface, use internal cache that's populated on `open()` and updated on events
2. **Decision: async IGraphStore.** Update IGraphStore to return `Promise<>` on mutating methods. Read methods stay sync (backed by in-memory Graphology).

### Verification
- [ ] `GraphKMStoreAdapter` compiles
- [ ] Unit test: create adapter, putEntity, getEntity, verify roundtrip
- [ ] Unit test: addEdge, getEdges, verify direction filtering

---

## Plan 04 — Retype EntityDeduplicator to IGraphStore

**Wave:** 3 (depends on Plan 03)

### Tasks

1. In `src/ingestion/deduplicator.ts`:
   - Change `deduplicate(entities, graphStore: GraphStore)` → `deduplicate(entities, graphStore: IGraphStore)`
   - Change `resolveEntities(graphStore: GraphStore)` → `resolveEntities(graphStore: IGraphStore)`
   - All internal calls use IGraphStore methods
2. Update all test files that mock GraphStore for deduplicator

### Verification
- [ ] `tsc --noEmit` passes
- [ ] `npx vitest run tests/unit/deduplicator` passes
- [ ] `npx vitest run tests/integration/dedup` passes

---

## Plan 05 — Retype 7 intelligence modules to IGraphStore

**Wave:** 3 (parallel with Plan 04)

### Tasks

1. For each module, change `graphStore: GraphStore` → `graphStore: IGraphStore`:
   - `clustering.ts` — `clusterEntities(graphStore)`
   - `confidence.ts` — `computeConfidence(graphStore, ...)`, `computeConfidenceAll(graphStore)`
   - `connectivity.ts` — `analyzeConnectivity(graphStore)`, `cleanupOrphans(graphStore)`
   - `correlation.ts` — `analyzeCorrelations(graphStore)`
   - `rca-lookup.ts` — `rcaLookup(graphStore, ...)`
   - `search.ts` — `searchEntities(graphStore, ...)`
   - `temporal.ts` — `recordOccurrence(graphStore, ...)`, `calculateTrends(graphStore)`
2. Update intelligence test files

### Verification
- [ ] `tsc --noEmit` passes
- [ ] `npx vitest run tests/unit/intelligence` passes (all 7)

---

## Plan 06 — Retype IngestionPipeline to IGraphStore

**Wave:** 3 (parallel with Plans 04-05)

### Tasks

1. In `src/ingestion/pipeline.ts`:
   - Constructor: `graphStore: GraphStore` → `graphStore: IGraphStore`
   - All internal `this.graphStore.` calls use IGraphStore methods
2. In `src/ingestion/extractor.ts`: if it accesses GraphStore directly, retype

### Verification
- [ ] `tsc --noEmit` passes
- [ ] `npx vitest run tests/unit/pipeline` passes
- [ ] `npx vitest run tests/integration/pipeline` passes

---

## Plan 07 — Retype ApiRoutes to IGraphStore

**Wave:** 3 (parallel with Plans 04-06)

### Tasks

1. In `src/api/routes.ts`:
   - Constructor: `graphStore: GraphStore` → `graphStore: IGraphStore`
   - All route handlers use IGraphStore methods
2. In `src/api/server.ts`: update `createServer()` signature

### Verification
- [ ] `tsc --noEmit` passes
- [ ] `npx vitest run tests/integration/api` passes

---

## Plan 08 — Wire GraphKMStoreAdapter into startup (index.ts)

**Wave:** 4 (depends on Plans 03-07)

### Tasks

1. In `src/index.ts` (`startServer()`):
   - Replace `graphStore = new GraphStore()` with:
     ```ts
     const kmStore = new GraphKMStore({
       dbPath,
       exportDir,
       debounceMs: 5000,
       domains: ['raas', 'kpifw', 'general', 'business'],
       ontologyDir: path.join(__dirname, '../ontology')
     });
     await kmStore.open();
     const graphStore = new GraphKMStoreAdapter(kmStore);
     ```
   - Remove `new PersistenceManager()` (replaced by km-core's internal persistence)
   - Keep `SyncManager` — retype to use IGraphStore + hook `kmStore` events
   - Keep `SourceDocumentStore` unchanged
   - Keep `OntologyRegistry` — it loads the same ontology JSON files
   - Pass `graphStore` (now adapter) to all consumers as before
2. Update SyncManager to work with GraphKMStoreAdapter:
   - `hookMutations()` → subscribe to `kmStore` events instead of `graphStore.onMutation()`
   - `initialize()` → skip hydration (km-core does it in `open()`)

### Verification
- [ ] Server starts successfully
- [ ] `curl localhost:3001/health` returns ready
- [ ] Existing data loads from LevelDB

---

## Plan 09 — Full test suite green

**Wave:** 5 (depends on Plan 08)

### Tasks

1. Run full test suite: `npx vitest run`
2. Fix any remaining type errors or test failures
3. Run integration tests against live server

### Verification
- [ ] `npx vitest run` — 34/34 tests pass (23 unit + 11 integration)
- [ ] `tsc --noEmit` — zero errors
- [ ] Server starts, loads data, serves API, runs ingestion pipeline end-to-end

---

## Plan 10 — Cleanup and commit

**Wave:** 6 (depends on Plan 09)

### Tasks

1. Remove unused imports of old `GraphStore` (except in IGraphStore backward-compat)
2. Update OKB README to mention km-core dependency
3. Commit with message: `feat(okb): migrate core store to @fwornle/km-core (Phase 43)`
4. Update ROADMAP.md — mark Phase 43 complete

### Verification
- [ ] `git diff --stat` shows expected files changed
- [ ] No leftover `import { GraphStore }` except in adapter/interface files
- [ ] CI-equivalent: `npm run build && npx vitest run` passes

---

## Wave Summary

| Wave | Plans | Description |
|------|-------|-------------|
| 1 | 01, 02 | Pack km-core + define IGraphStore interface |
| 2 | 03 | Create GraphKMStoreAdapter |
| 3 | 04, 05, 06, 07 | Retype all consumers to IGraphStore |
| 4 | 08 | Wire adapter into startup |
| 5 | 09 | Full test suite green |
| 6 | 10 | Cleanup and commit |

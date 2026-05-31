---
phase: 43-okm-cross-repo-migration-c
plan: 08e
type: execute
wave: 4
depends_on:
  - 43-08d
files_modified:
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts
files_deleted:
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/km-store-adapter.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/sync-manager.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/graph-store.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/km-store-adapter.test.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/graph-store.test.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/sync-manager.test.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/persistence.test.ts
autonomous: false
requirements:
  - INT-03
user_setup: []
branch: refactor/43-08e-delete-adapter

must_haves:
  truths:
    - "Adapter is gone. `src/store/km-store-adapter.ts` deleted. Every Express handler in `src/api/routes.ts` reads/writes km-core directly via either `this.kmStore` calls or the `src/lib/snapshot.ts` helpers — no intermediate `this.store: GraphKMStoreAdapter` field."
    - "All 38 legacy sync `this.store.*` call sites in routes.ts are now async km-core. The enclosing Express handlers became `async` and `await` each call."
    - "10 IGraphStore-only methods have explicit km-core substitutes (see Substitutes table). The substitutes are inline in the handler (Route-A) OR consolidated into private `storeX` helpers on ApiRoutes (Route-B; same pattern as IngestionPipeline's six store* helpers from 43-08b)."
    - "Edge-key strategy decided and documented in CONTEXT or in this PLAN: deterministic key derived from `${from}|${to}|${type}|${createdAt}` (`Route-1`) OR stash `randomUUID()` in `relation.metadata.edgeKey` at addRelation time (`Route-2`). Route-1 is preferred because it requires no migration of existing relations (existing edges already have deterministic identity by their tuple)."
    - "`src/store/{graph-store,sync-manager,persistence}.ts` + `src/types/graph-store.ts` deleted. Their unit tests deleted."
    - "Grep gate green across `src/` + `tests/`: zero matches for `IGraphStore|GraphKMStoreAdapter|SyncManager|GraphStore|PersistenceManager|from.*store/(graph-store|sync-manager|persistence|km-store-adapter)|from.*types/graph-store`."
    - "`npx tsc --noEmit` is 0 errors at the end of the plan (was 0 at start of plan; should not regress)."
    - "`npm test` suite GREEN. Unit tests that referenced deleted modules either deleted (km-store-adapter, graph-store, sync-manager, persistence) OR refactored to bootstrap via `new GraphKMStore({...})` (clustering / correlation / search / temporal / deduplicator / extractor tests)."
    - "Plan 06's `rest-contract.test.ts` still passes byte-equally against the new no-adapter routes (D-G5.1 SC#3 gate remains green)."
  artifacts:
    - path: "src/api/routes.ts"
      provides: "Every handler async + uses km-core directly; ApiRoutes ctor drops the internal adapter construction; ApiRoutes.init() drops adapter.initialize() + subscribeToKmCoreMutations()"
    - path: "src/store/ (4 deletions)"
      provides: "km-store-adapter.ts + graph-store.ts + sync-manager.ts + persistence.ts removed"
    - path: "src/types/graph-store.ts"
      provides: "DELETED — IGraphStore interface no longer exists"
    - path: "tests/unit/ (5 deletions + 6 refactors)"
      provides: "Legacy backend tests removed; intelligence/dedup/extractor tests bootstrap via GraphKMStore"
  key_links:
    - from: "Express handlers in routes.ts"
      to: "GraphKMStore (async)"
      via: "await this.kmStore.<putEntity|getEntity|deleteEntity|addRelation|findRelations|iterate|mergeAttributes|batch|getDegree|restore|exportJson>"
      pattern: "await\\s+this\\.(kmStore|storeX)\\.(putEntity|getEntity|deleteEntity|addRelation|findRelations|iterate|mergeAttributes|batch)"
    - from: "everywhere in src/ + tests/"
      to: "(no leftover legacy symbols)"
      via: "grep gate"
      pattern: "(NOT) IGraphStore|GraphKMStoreAdapter|SyncManager|GraphStore|PersistenceManager|from.*store/(graph-store|sync-manager|persistence|km-store-adapter)|from.*types/graph-store"
---

<objective>
Close the Phase 43 km-core cutover by removing the transitional adapter that 43-08d retained. Every Express route handler in `routes.ts` reads/writes km-core directly. The legacy `GraphStore` / `GraphKMStoreAdapter` / `SyncManager` / `PersistenceManager` / `IGraphStore` modules are deleted (5 files in `src/`) along with their unit tests (4 files in `tests/unit/`). After this plan: zero strangler, zero adapter, zero IGraphStore symbol in OKM source.
</objective>

## Scope: the 38 sync `this.store.*` call sites in routes.ts

Inventory from 43-08d (`grep -oE "this\.store\.[a-zA-Z]+" src/api/routes.ts | sort | uniq -c | sort -rn`):

| Count | Method               | km-core substitute                                                       |
|-------|----------------------|--------------------------------------------------------------------------|
| 10    | `getEntity`          | `await kmStore.getEntity(stripLayerPrefix(nodeId) as EntityId)`          |
| 6     | `getAllEntities`     | `await getAllEntities(kmStore)` (from `src/lib/snapshot.ts`)             |
| 3     | `updateEntity`       | `await kmStore.mergeAttributes(stripLayerPrefix(nodeId), updates)`       |
| 3     | `export`             | Build `SerializedGraph` from `await kmStore.iterate()` + `findRelations({})` |
| 2     | `getEdges`           | Direction-based dispatch to `findRelations({from})` / `findRelations({to})` + transform to `EdgeResult` shape |
| 2     | `deleteEntity`       | `await kmStore.deleteEntity(stripLayerPrefix(nodeId))`                   |
| 2     | `deleteEdge`         | See "Edge-key strategy" below                                            |
| 1     | `restore`            | `await kmStore.restore(serialized)` (already in use in `/api/restore`)   |
| 1     | `migrateEntityLayer` | get + delete + putEntity with new layer + return new composite key       |
| 1     | `getStats`           | `{nodes: entityCount, edges: relationCount}` via `iterate` + `findRelations({})` |
| 1     | `getNeighbors`       | Union of `findRelations({from}).to` and `findRelations({to}).from`       |
| 1     | `getEdge`            | See "Edge-key strategy" below                                            |
| 1     | `endBatch`           | Drop (km-core has its own batching via `kmStore.batch(ops)`)             |
| 1     | `deduplicateEdges`   | `findRelations({})` → group by `${from}\|${to}\|${type}` → `kmStore.batch([removeRelation, ...])` for duplicates |
| 1     | `clear`              | `for await (e of iterate())` → collect IDs → `kmStore.batch([deleteEntity, ...])`; return count |
| 1     | `beginBatch`         | Drop (paired with endBatch)                                              |
| 1     | `addEntity`          | `await kmStore.putEntity(e, {skipOntologyCheck: true})` → return composite `${layer}:${id}` |
| 1     | `addEdge`            | `await kmStore.addRelation({type, from, to, metadata, createdAt, validFrom})` → derive edgeKey (Edge-key strategy) |

**Total: 38 call sites; 18 distinct methods; 10 without direct km-core equivalents.**

## Edge-key strategy

Express route handlers expose `/api/relations/:edgeKey` semantics — the client receives an edgeKey from `listRelations` and uses it in `deleteRelation` / `getEdge`. km-core's `findRelations` does NOT return edge keys; `addRelation` accepts an optional `key?` but the returned `Relation[]` strips it.

**Route-1 (preferred): deterministic edge key from tuple.**

`edgeKey = base64url(${from}|${to}|${type}|${createdAt})` — bijective with the tuple. Lookup decodes the key, calls `findRelations({from, to, type})`, filters by `createdAt`. Works without ANY edge-side mutation, supports existing relations created by other code paths (pipeline / intelligence cleanup / etc.).

**Route-2: stash edgeKey in `relation.metadata.edgeKey`.**

Generate `randomUUID()` at `addRelation` time, store in `relation.metadata.edgeKey`. Lookup is `findRelations({}) + filter on metadata.edgeKey`. Pro: opaque keys (don't leak tuple structure to clients). Con: existing relations don't have metadata.edgeKey, requires a one-shot backfill pass. Reject this route.

**Decision: Route-1.** Document the encoding in CONTEXT or in this plan's preamble. The base64url form keeps the key URL-safe and short enough for path params.

## Task breakdown

### Task 1 — store* helper layer on ApiRoutes (~30 min)

Mirror IngestionPipeline's six store* helpers from 43-08b. Add 18 private async methods to `ApiRoutes` covering the IGraphStore surface used by route handlers. Each helper unwraps composite nodeIds at the boundary and calls km-core async APIs underneath. Keeps the per-call-site change small (just `this.store.X(...)` → `await this.storeX(...)`) and centralizes the substitute logic in one auditable place.

**Acceptance:** 18 helpers exist on ApiRoutes; each has a JSDoc one-liner referencing the km-core call it wraps. The `getEdges` helper takes the existing `{direction}` options shape and transforms `Relation[]` → `EdgeResult[]` so route handlers continue to consume the documented response shape.

### Task 2 — Swap all 38 call sites + make handlers async (~60 min)

Each `this.store.X(...)` becomes `await this.storeX(...)`. The enclosing Express handler signature becomes `async (req, res): Promise<void>`. Where the handler is currently synchronous with an `(async () => { ... })()` IIFE (e.g., `purgeAll`), unwrap the IIFE.

**Acceptance:** Grep `this\.store\.[a-z]` against `src/api/routes.ts` returns zero matches. tsc --noEmit at 0 errors.

### Task 3 — Drop the adapter field from ApiRoutes (~20 min)

- `this.store: GraphKMStoreAdapter` field deleted.
- `ApiRoutes` ctor no longer constructs the adapter.
- `ApiRoutes.init()` drops `adapter.initialize()` and `adapter.subscribeToKmCoreMutations()` calls. Since km-core's own `open()` already runs before ApiRoutes is constructed (in `index.ts`), `init()` may become a no-op — delete the method entirely if so; or keep as a future-proofing hook with a `// no-op for now` body.

**Acceptance:** `grep -nE "GraphKMStoreAdapter|adapter\." src/api/routes.ts` returns zero matches.

### Task 4 — Delete legacy storage modules + their tests (~10 min)

```bash
git rm src/store/km-store-adapter.ts
git rm src/store/graph-store.ts
git rm src/store/sync-manager.ts
git rm src/store/persistence.ts
git rm src/types/graph-store.ts
git rm tests/unit/km-store-adapter.test.ts
git rm tests/unit/graph-store.test.ts
git rm tests/unit/sync-manager.test.ts
git rm tests/unit/persistence.test.ts
```

`src/store/source-document-store.ts` SURVIVES — it's OKM-specific evidence traceability storage, not a km-core concern.

**Acceptance:** Files listed above no longer exist in the working tree.

### Task 5 — Refactor remaining unit tests to bootstrap via GraphKMStore (~45 min)

Identify all unit tests that currently bootstrap with `new GraphStore()`:

```bash
grep -lE "new GraphStore\(" tests/unit/
```

Likely candidates per the prior session's findings: `clustering.test.ts`, `correlation.test.ts`, `search.test.ts`, `temporal.test.ts`, `deduplicator.test.ts`, `extractor.test.ts`. Each becomes:

```typescript
beforeEach(async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'okm-test-'));
  kmStore = new GraphKMStore({
    dbPath: path.join(tmpDir, 'leveldb'),
    exportDir: path.join(tmpDir, 'exports'),
    debounceMs: 0,  // synchronous flushes for test determinism
    ontologyDir: path.resolve(__dirname, '../../ontology'),
    domains: ['general'],
  });
  await kmStore.open();
});
afterEach(async () => { await kmStore.close(); await rm(tmpDir, { recursive: true }); });
```

Seeds via `await kmStore.putEntity(e, { skipOntologyCheck: true })` instead of `graphStore.addEntity(e)`.

**Acceptance:** `npm test` is GREEN. No test references `GraphStore`, `GraphKMStoreAdapter`, `SyncManager`, `PersistenceManager`, or `IGraphStore`.

### Task 6 — Grep gate (~5 min)

```bash
echo "=== Source leakage check ==="
grep -rnE "IGraphStore|GraphKMStoreAdapter|SyncManager|GraphStore|PersistenceManager" src/ tests/ \
  --include="*.ts" --include="*.mjs" \
  | grep -vE "(NodeStore|EntityStore|SourceDocumentStore)" \
  || echo "(no matches — gate green)"

echo "=== Legacy import check ==="
grep -rnE "from.*store/(graph-store|sync-manager|persistence|km-store-adapter)|from.*types/graph-store" src/ tests/ \
  --include="*.ts" \
  || echo "(no legacy imports — gate green)"
```

Expected: both grep commands print "(gate green)" and exit 1.

**Acceptance:** Grep gate green. Recorded in TASKS.md or SUMMARY.md as proof.

### Task 7 — Verification (~15 min)

```bash
npx tsc --noEmit             # expect 0 errors
npm test                     # expect full suite green
node -e "import('./dist/index.js')"   # smoke (after build)
```

Optionally run the dev server + `curl http://localhost:8090/api/health` for end-to-end smoke.

**Acceptance:** All three gates pass. Document command output in TASKS.md.

### Task 8 — Commit + push branch (~5 min)

```bash
git add -A   # captures deletions + edits
git commit -m "refactor(43-08e): delete adapter + async-migrate route handlers (Phase 43 D-G3.5)"
git push origin refactor/43-08e-delete-adapter
```

Then open PR against `main` (NOT against `refactor/43-08-km-core-cutover` — that's PR #2 which should merge first; if PR #2 hasn't merged at this point, base 43-08e's PR on `refactor/43-08-km-core-cutover` instead).

**Acceptance:** Branch pushed, PR opened.

## Test plan

- `npx tsc --noEmit` → 0 errors
- `npm test` → full suite green
- Plan 06 `rest-contract.test.ts` → bytewise-identical fixtures (D-G5.1 SC#3)
- End-to-end smoke: `npm start` → `/api/health` → `/api/entities?limit=5` → `/api/relations` → `/api/restore` against a known commit snapshot
- Connectivity report (`/api/connectivity`) returns coherent counts after a synthetic ingestion (validates that the adapter removal didn't break the read path through `analyzeConnectivity`)

## Estimated duration

**~3h** (Task 1: 30m + Task 2: 60m + Task 3: 20m + Task 4: 10m + Task 5: 45m + Task 6: 5m + Task 7: 15m + Task 8: 5m + ~30m buffer for unforeseen edge-key encoding cases).

## Open questions for the plan reader

1. **Edge-key encoding format.** Route-1 proposes `base64url(${from}|${to}|${type}|${createdAt})`. Existing edgeKeys in the system (from graphology's `geid_*` auto-keys via the legacy GraphStore) DO NOT match this format. Are existing edge keys persisted to clients (e.g., in saved bookmarks or external systems)? If yes, the migration needs a translation layer; if no (clients always re-fetch keys from `listRelations` before using them), the format change is invisible.

2. **`getStats` cost.** km-core has no `getEntityCount()` / `getEdgeCount()` — counting requires `iterate()` + `findRelations({})` traversal. For 1665 entities + 18958 relations this is fast (~10ms), but at higher scale this could become a hot-path concern. Add a TODO marker for a future km-core feature request (`kmStore.count()`) if observed slow in production.

3. **Should `ApiRoutes.init()` be deleted entirely or kept as a no-op?** After Task 3, the only remaining lifecycle work is `applyPersistedSettings()` (sync). Deleting `init()` means `createServer()` no longer needs to await it. Cleanup choice — defer to the implementer.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 08e (Wave 4) — the SCOPE-ASSESSMENT's original 43-08c renamed to align with the 43-08b/c-i/d commit nomenclature*
*Drafted: 2026-05-31 (after 43-08d landed on `refactor/43-08-km-core-cutover` branch + PR #2)*

# Phase 43: OKM Cross-Repo Migration (C) - Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 23 (across 3 repos: coding, km-core, OKM)
**Analogs found:** 22 / 23 (1 file has no direct analog — see "No Analog Found")

## File Classification

| New / Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `~/Agentic/km-core/src/types/entity.ts` (modify — add `layer?`) | km-core | model / type-extension | schema-extension | `~/Agentic/km-core/src/types/entity.ts` lines 146-172 (existing optional `embedding?: number[]` Phase 42 extension) | exact |
| `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.gitmodules` (NEW) | OKM | config / VCS | n/a | `/Users/Q284340/Agentic/coding/.gitmodules` (lib/km-core entry, lines 19-21) | exact |
| `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/lib/km-core/` (NEW submodule) | OKM | dependency / submodule | n/a | `/Users/Q284340/Agentic/coding/lib/km-core/` (existing fwornle-km-core-0.1.0.tgz at submodule root) | exact |
| `…/operational-knowledge-management/vendor/fwornle-km-core-X.Y.Z.tgz` (modify — replace with bumped tarball) | OKM | dependency / vendor artifact | n/a | `…/operational-knowledge-management/vendor/fwornle-km-core-0.1.0.tgz` (current 40KB tarball) | exact (regenerated) |
| `…/operational-knowledge-management/package.json` (modify — version bump on `@fwornle/km-core` line) | OKM | config | n/a | Same file (current `file:vendor/fwornle-km-core-0.1.0.tgz` line 20) + Phase 42 D-G1.4 commit pattern | exact |
| `…/operational-knowledge-management/scripts/repack-km-core.{sh,mjs}` (NEW pre-build / bump helper) | OKM | utility / build-script | one-shot batch | None in OKM; pattern from coding/scripts/* + Phase 42 Plan 5 script header style | role-match |
| `~/Agentic/_work/rapid-automations/package.json` (modify — DELETE line) | rapid-automations | config | n/a | `…/operational-knowledge-management/package.json` line 20 (the `file:` reference being deleted is the mirror of OKM's) | exact (1-line deletion) |
| `…/operational-knowledge-management/src/index.ts` (modify — strip `OKB_STORE_BACKEND` branch, simplify) | OKM | entry-point / bootstrap | request-response | Same file lines 18-150 (the CURRENT half-strangler) + Phase 42 Plan 7 Task 2 wave-controller flag-removal pattern | exact |
| `…/operational-knowledge-management/src/store/km-store-adapter.ts` (DELETE in final cleanup) | OKM | adapter / bridge | sync↔async transform | Phase 42 Plan 7 Task 2 (deletion of `persistence-agent.ts` + `graph-database-adapter.ts`) | exact (template) |
| `…/operational-knowledge-management/src/store/graph-store.ts` (DELETE) | OKM | service / legacy store | CRUD | Phase 42 Plan 7 Task 2 (`GraphDatabaseService.js` deletion) | exact (template) |
| `…/operational-knowledge-management/src/store/sync-manager.ts` (DELETE) | OKM | service / legacy export | event-driven debounce | Phase 42 Plan 7 Task 2 deletion list | exact |
| `…/operational-knowledge-management/src/store/persistence.ts` (DELETE) | OKM | service / legacy persistence | file-I/O | Phase 42 Plan 7 Task 2 deletion list | exact |
| `…/operational-knowledge-management/src/types/graph-store.ts` (DELETE — `IGraphStore` interface) | OKM | type / interface | n/a | Phase 42 Plan 7 Task 2 (`persistence-flag.ts` deletion + simultaneous source-file removal) | role-match |
| `…/operational-knowledge-management/src/ontology/registry.ts` (DELETE) | OKM | service / registry | request-response | Phase 42 D-53 (`OntologyManager.ts` deletion + consumer rewire to km-core's `OntologyRegistry`) | exact |
| `…/operational-knowledge-management/src/ontology/loader.ts` (DELETE) | OKM | utility / parser | file-I/O | Phase 42 D-53 paired-file deletion | exact |
| `…/operational-knowledge-management/src/ingestion/pipeline.ts` (modify — delete `resolveEntities`, await km-core async) | OKM | service / orchestrator | batch | Phase 42 Plan 6 wave-controller migration (delete local `mergeEntityGroup` → call `mergeEntities` from km-core) | exact |
| `…/operational-knowledge-management/src/ingestion/deduplicator.ts` (modify — delete `resolveEntities`, await km-core async) | OKM | service / dedup | batch + LLM | Phase 42 Plan 6 `deduplication.ts` rewire to km-core `mergeEntities`/`resolveEntities` | exact |
| `…/operational-knowledge-management/src/ingestion/extractor.ts` (modify — import OntologyRegistry from km-core) | OKM | service / LLM-driven | request-response | Phase 42 Plan 3 (`OntologyClassifier` rewire to consume km-core's `OntologyRegistry`) | role-match |
| `…/operational-knowledge-management/src/intelligence/{clustering,confidence,connectivity,correlation,rca-lookup,search,temporal}.ts` (modify — await km-core async API) | OKM | service / read-side analytics | request-response | Phase 42 Plan 7 Task 2 `content-validation-agent.ts` rewire (4 `graphDB.*` → `kmCoreAdapter.*`) | exact (template) |
| `…/operational-knowledge-management/src/api/server.ts` (modify — revert `/api/km` mount, drop `kmStore` param) | OKM | controller / bootstrap | request-response | Same file lines 14-67 (current state) + Phase 42 Plan 7 flag-removal precedent | exact |
| `…/operational-knowledge-management/src/api/routes.ts` (modify — refactor to await km-core) | OKM | controller | request-response | Same file lines 624-651 (current `resolveEntities` route) + Phase 41 D-50 `resolveEntities` signature | role-match |
| `…/operational-knowledge-management/scripts/migrate-okm-json-to-kmcore.mjs` (NEW one-shot migration) | OKM | utility / batch-CLI | batch | `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs` (Phase 42 Plan 5) — STRUCTURE is identical, but reads JSON-export instead of LevelDB | role-match |
| `…/operational-knowledge-management/scripts/reembed-okm-corpus.mjs` (NEW one-shot re-embed) | OKM | utility / batch-CLI | batch | Phase 42 Plan 4 (`FastembedEmbeddingClient` integration) + Plan 7 Phase C `syncQdrantFromStore` invocation pattern | role-match |
| `…/operational-knowledge-management/tests/integration/rest-contract.test.ts` (NEW Zod contract) | OKM | test / integration | request-response | `…/operational-knowledge-management/tests/integration/km-core-backend.test.ts` (existing OKM integration test scaffold) | role-match |
| `…/operational-knowledge-management/tests/fixtures/pre-migration/*.json` (NEW recorded fixtures) | OKM | test / fixture data | snapshot-diff | No direct analog — fixtures-diff testing is new to this codebase | NO ANALOG |
| `…/operational-knowledge-management/tests/integration/storage-backend.test.ts` (renamed from `km-core-backend.test.ts`) | OKM | test / integration | request-response | `tests/integration/km-core-backend.test.ts` (existing — just rename + drop `OKB_STORE_BACKEND=km-core` setup) | exact |

---

## Pattern Assignments

### `~/Agentic/km-core/src/types/entity.ts` — add `layer?: 'evidence'|'pattern'` (D-G4.2)

**Analog:** Same file, the existing Phase 42 `embedding?: number[]` schema extension at lines 146-172.

**Why this analog:** D-G4.2 is structurally identical to Phase 42 D-52 — add an optional first-class field that A/B no-op on. The doc-comment template, the "optional-by-design" rationale, and the "no special handling in the store" framing are all reusable verbatim.

**Pattern to copy — schema extension comment block (lines 148-172):**

```typescript
  /** Optional embedding vector — Phase 42 D-52 schema extension.
   *
   *  - **Origin (D-52):** Added so KM-Core becomes the single source of
   *    truth for entity embeddings; Qdrant ceases to be a primary store
   *    and is rebuilt on demand from km-core via `syncQdrantFromStore`
   *    (D-52a). [...]
   *  - **Optional by design:** Phase 37-41 fixtures + A-side entities do
   *    NOT carry an embedding. Keeping the field optional means the
   *    schema is a strict extension — no migration required on the read
   *    side, no compile breakage for older callers.
   *  - **No special handling in the store:** Graphology treats
   *    `embedding` as just another attribute. [...]
   */
  embedding?: number[];
```

**Action for `layer?`:** Currently at line 120 `layer` is REQUIRED (`layer: Layer`). Phase 43 needs to confirm whether the field truly becomes optional (the D-G4.2 wording is "first-class optional") or whether the existing required field is unchanged and the "addition" is just OKM-side awareness. Planner must read km-core source carefully — the required `layer: Layer` at line 120 already exists. If it's truly being made optional, this is a breaking change for B (its wave entities currently assume `layer: 'evidence'`). Likely interpretation: **declare it remains REQUIRED with the existing `Layer = 'evidence' | 'pattern'` type alias** (line 27) — OKM already uses both values, so no schema change is needed; D-G4.2's wording about "adding `layer?`" reflects OKM's perspective (where this field already exists in its local Entity), not km-core's. **Resolve this in the pre-req plan against km-core.**

**Test pattern (mirror Phase 42 plan 04 test setup at km-core repo):**
```typescript
import { Entity } from '@fwornle/km-core';
// Test asserts: an entity with `layer: 'pattern'` is round-trippable through
// GraphKMStore.putEntity → findByOntologyClass(...) → first result has
// .layer === 'pattern' verbatim. No special handling — Graphology stores it
// as a plain node attribute.
```

---

### `…/operational-knowledge-management/.gitmodules` (NEW — D-G1.2, D-G1.4)

**Analog:** `/Users/Q284340/Agentic/coding/.gitmodules` lines 19-21 (the `lib/km-core` submodule entry).

**Coding repo's existing pattern (lines 19-21):**
```ini
[submodule "lib/km-core"]
	path = lib/km-core
	url = git@github.com:fwornle/km-core.git
```

**Pattern to copy into OKM `.gitmodules` (NEW file)** — but with HTTPS per D-G1.4 (avoids bmw.ghe.com SSH auth issue per `memory/feedback_bmw_ghe_https.md`):

```ini
[submodule "lib/km-core"]
	path = lib/km-core
	url = https://github.com/fwornle/km-core.git
```

**KEY DELTA from coding's submodule:** URL scheme is HTTPS, not SSH. Coding can use SSH because it lives on github.com; OKM is on bmw.ghe.com (where the user's SSH key fails publickey), and CI on bmw.ghe.com needs zero-auth HTTPS access. km-core's repo is `"private": false` (verified in `~/Agentic/km-core/package.json`) so HTTPS works without auth.

---

### `…/operational-knowledge-management/package.json` — version bump on `@fwornle/km-core` (D-G1.4)

**Current state (line 20):**
```json
"@fwornle/km-core": "file:vendor/fwornle-km-core-0.1.0.tgz",
```

**Pattern to copy — atomic version-tagged commit (D-G1.4):**

Commit message format:
```
chore(deps): bump km-core 0.1.0 → 0.2.0
```

Workflow on a km-core version-tag (`v0.2.0`):
1. `cd lib/km-core && git fetch && git checkout v0.2.0`
2. `cd lib/km-core && npm pack`
3. `mv lib/km-core/fwornle-km-core-0.2.0.tgz vendor/`
4. `rm vendor/fwornle-km-core-0.1.0.tgz` (old tarball)
5. Edit `package.json` line 20 → `"@fwornle/km-core": "file:vendor/fwornle-km-core-0.2.0.tgz"`
6. `npm install` (rewrites lockfile)
7. Single atomic commit with all of: `package.json`, `package-lock.json`, `vendor/fwornle-km-core-0.2.0.tgz` (new), `vendor/fwornle-km-core-0.1.0.tgz` (deleted), `lib/km-core` submodule SHA pointer.

**Analog for the "tarball-from-submodule" prebuild helper:** No exact analog — coding repo does NOT auto-rebuild the tarball, the file is committed manually. OKM's helper script can be a 10-line shell wrapper around the 5 commands above. Place at `scripts/repack-km-core.sh`. Follow the `process.stderr.write` no-console-log pattern from `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/scripts/backfill-raw-observations.mjs` for any node parts.

---

### `~/Agentic/_work/rapid-automations/package.json` — DELETE `@fwornle/km-core` line (D-G1.3)

**Current state (lines 2-4):**
```json
{
  "dependencies": {
    "@fwornle/km-core": "file:../../coding/lib/km-core/fwornle-km-core-0.1.0.tgz"
  }
}
```

**Action:** Delete the `dependencies` block (or just the `@fwornle/km-core` line if other deps exist). Verified-safe because grep shows zero imports of `@fwornle/km-core` from rapid-automations code outside OKM (D-G1.3 grep precondition).

**Commit message pattern (mirrors Phase 42 cleanup style):**
```
chore(ra-root): drop vestigial km-core dep — moved into OKM-local submodule
```

---

### `…/operational-knowledge-management/src/index.ts` — strip `OKB_STORE_BACKEND` (D-G3.1)

**Analog:** Phase 42 Plan 7 Task 2 wave-controller cleanup (deletion of the flag-gated branch landed in Plan 6). Same file is also its own best analog — the current state shows EXACTLY the strangler shape that's being removed.

**Current OKM state showing the strangler (lines 32-70):**

```typescript
const storeBackend = options?.storeBackend ?? process.env.OKB_STORE_BACKEND ?? 'default';

let graphStore: IGraphStore;
let kmStoreAdapter: GraphKMStoreAdapter | undefined;

if (storeBackend === 'km-core') {
  // Dynamically import km-core to avoid hard dep when not using this backend
  const { GraphKMStore } = await import('@fwornle/km-core');

  // Resolve ontologyDir per CLAUDE.md: import.meta.resolve → package root → config/ontology
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  // ... 30+ lines walking up to find package.json ...

  const kmStore = new GraphKMStore({
    dbPath: path.join(dataDir, 'km-core-leveldb'),
    exportDir: path.join(dataDir, 'km-core-exports'),
    debounceMs: 5000,
  });
  await kmStore.open();

  kmStoreAdapter = new GraphKMStoreAdapter(kmStore);
  await kmStoreAdapter.initialize();
  graphStore = kmStoreAdapter;
} else {
  graphStore = new GraphStore();
}
```

**Pattern to copy from Phase 42 Plan 7 Task 2 action #2** (which removed the `if (getPersistenceBackend() === ...)` branches from wave-controller):

> "remove the legacy else-branch entirely. The km-core path becomes the unconditional path. Also remove:
> - Any `import { getPersistenceBackend }` lines (now dead).
> - Any `if (getPersistenceBackend() === ...)` checks (replaced by direct adapter calls).
> - The constructor's `kmCoreAdapter?: KmCoreAdapter` becomes `kmCoreAdapter: KmCoreAdapter` (required — no longer optional)."

**Target state for OKM `index.ts` after Phase 43 final cleanup:**

```typescript
// Direct km-core construction — no flag, no GraphKMStoreAdapter wrapper
const { GraphKMStore } = await import('@fwornle/km-core');
const { defaultOntologyDir } = await import('@fwornle/km-core/ontology');

const kmStore = new GraphKMStore({
  ontologyDir: defaultOntologyDir(),  // Phase 41 helper
  dataDir: path.join(dataDir, 'leveldb'),
  exportDir: path.join(dataDir, 'exports'),
  debounceMs: 5000,
});
await kmStore.open();
// No adapter — consumers (pipeline, deduplicator, intelligence, routes) await km-core directly
```

**Hard-coded `ontologyDir`** path-walking block (lines 41-55 of current index.ts) goes away because km-core's `defaultOntologyDir()` (Phase 41 helper) does this. Phase 43 must verify km-core's `defaultOntologyDir()` works from OKM's container layout — likely it returns the km-core-bundled ontology dir, not OKM's own; if OKM needs custom ontologies, layer them via `OntologyRegistry({ ontologyDir: <override> })` after construction, see registry pattern below.

---

### `…/operational-knowledge-management/src/store/km-store-adapter.ts` — DELETE (D-G3.2)

**Analog:** Phase 42 Plan 7 Task 2 deletion of `persistence-agent.ts` + `graph-database-adapter.ts`.

**Phase 42 Plan 7 Task 2 action pattern (verbatim deletion sequence):**

```bash
git rm /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts
git rm /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts
git rm /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/config/persistence-flag.ts
# ... etc
```

**For Phase 43 (OKM-side, same pattern):**

```bash
cd ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
git rm src/store/km-store-adapter.ts
git rm src/store/graph-store.ts
git rm src/store/sync-manager.ts
git rm src/store/persistence.ts
git rm src/types/graph-store.ts
git rm src/ontology/registry.ts
git rm src/ontology/loader.ts
git rm tests/unit/km-store-adapter.test.ts
git rm tests/unit/graph-store.test.ts
git rm tests/unit/sync-manager.test.ts
git rm tests/unit/persistence.test.ts
git rm tests/unit/ontology-loader.test.ts
```

**Cleanup grep gate (copy verbatim from Phase 42 Plan 7 Task 2 action #4):**
```bash
# MUST return zero matches before build:
grep -rln 'IGraphStore\|GraphKMStoreAdapter\|OKB_STORE_BACKEND\|from.*store/graph-store\|from.*store/sync-manager\|from.*store/persistence\|from.*ontology/registry\|from.*ontology/loader' \
  ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ \
  --include='*.ts' --include='*.js'
```

---

### `…/operational-knowledge-management/src/ingestion/pipeline.ts` — delete local `resolveEntities`, refactor to await km-core (D-G2.3, D-G3.2)

**Analog:** Phase 42 Plan 6 deletion of `deduplication.ts:342 mergeEntityGroup` + replacement with `mergeEntities` import from `@fwornle/km-core/maintenance`.

**Phase 42 Plan 6 import-pattern (from `42-06-PLAN.md` key_links section):**

```typescript
import { mergeEntities } from '@fwornle/km-core/maintenance';
// ... replace local mergeEntityGroup invocation with:
await mergeEntities(store, survivorId, [duplicateId], { provenance });
```

**Current OKM `pipeline.ts` lines 353-367 (the method to DELETE):**

```typescript
  async resolveEntities(dryRun = false, classes?: string[]): Promise<{
    merges: Array<{ ... }>;
    synthesizedCount: number;
    errors: string[];
  }> {
    return this.deduplicator.resolveEntities(this.graphStore, dryRun, classes);
  }
```

**Target replacement (D-G2.3) — at the API-route layer, NOT inside pipeline:**

```typescript
// In src/api/routes.ts (the only caller of pipeline.resolveEntities):
import { resolveEntities } from '@fwornle/km-core/maintenance';
import type { LLMSemanticLayer } from '@fwornle/km-core/dedup';

// ... in the route handler:
const result = await resolveEntities(this.kmStore, {
  classes,
  dryRun,
  concurrency: 3,                    // matches OKM deduplicator.ts:651 RESOLUTION_CONCURRENCY
  batchSize: 30,                     // matches OKM deduplicator.ts:653 BATCH_SIZE
  llmMatcher: this.okmLlmMatcher,    // OKM-side LLMSemanticLayer impl
  provenance: { provider: 'okm', model: 'cleanup', runId, timestamp: now },
});
```

**Algorithm equivalence note (from km-core's `resolveEntities.ts:6-7`):**
> "Algorithm (ported from OKM deduplicator.ts:620-720 with KM-Core deltas)"

The km-core impl IS the OKM impl, ported. The signatures match closely. Any OKM-specific bits (PII pre-scan, sourceAuthority hints) apply BEFORE the call to `resolveEntities`, not woven into it (CONTEXT D-G2.3 explicit).

---

### `…/operational-knowledge-management/src/ingestion/extractor.ts` + `deduplicator.ts` — import `OntologyRegistry` from km-core (D-G2.2)

**Analog:** Phase 42 D-53 replacement of B's `OntologyManager.ts` with km-core's `OntologyRegistry`.

**Current OKM extractor pattern (constructor signature in `src/index.ts:101`):**
```typescript
const extractor = new EntityExtractor(llmService, ontologyRegistry);
```
where `ontologyRegistry` is OKM's own `OntologyRegistry` from `src/ontology/registry.ts`.

**Target (one-line import swap):**
```typescript
// BEFORE
import { OntologyRegistry } from './ontology/registry.js';
// AFTER
import { OntologyRegistry } from '@fwornle/km-core/ontology';
```

**Pre-flight check (D-G2.2):** OKM's `OntologyRegistry` exposes `getLoadedDomains()`, `getAllClassNames()`, `isValidClass()`, `getClass()`, `getClassesForPrompt()`, `getDefaultLayer()` (from `registry.ts:6-90`). Plan must grep-confirm km-core's `OntologyRegistry` exposes the same names — `~/Agentic/km-core/src/ontology/registry.ts` is the file to diff against. If any accessor is missing in km-core, **pre-req plan against km-core** adds it (km-core PR before OKM PR can land).

---

### `…/operational-knowledge-management/src/intelligence/*.ts` — refactor to await km-core async API (D-G3.2)

**Analog:** Phase 42 Plan 7 Task 2 action #1 (rewiring `content-validation-agent.ts` from 4 `this.graphDB.<method>(...)` calls to 4 `kmCoreAdapter.<method>(...)` calls).

**Phase 42 Plan 7 Task 2 action #1 verbatim (from `42-07-PLAN.md`):**

> "Rewire `content-validation-agent.ts` (RESEARCH §3 — 4 GraphDatabaseService hits):
>   - Locate every `this.graphDB.<method>(...)` call. Map to the equivalent `kmCoreAdapter.<method>(...)`. The method names match for the hot-path subset (queryEntities, getEntity, storeEntity, storeRelationship, deleteEntity) — Plan 1 deliberately mirrored the surface.
>   - Update the constructor injection: replace `graphDB` with `kmCoreAdapter`."

**For Phase 43's intelligence layer:** Apply the same pattern to all 7 intelligence files. CURRENT sync calls become awaited async calls. E.g.:

```typescript
// BEFORE (sync IGraphStore — graph-store.ts:35)
const all = graphStore.getAllEntities();
const node = graphStore.getEntity(nodeId);

// AFTER (async km-core — entity.ts:117-148)
const all: Entity[] = [];
for await (const e of kmStore.iterate()) { all.push(e); }
const node = await kmStore.getEntity(entityId);
```

**KEY DELTA from Phase 42:** Phase 42's `KmCoreAdapter` MIRRORED the sync GraphDB surface (the adapter's job was sync compatibility). Phase 43 D-G3.2 explicitly chose the AGGRESSIVE option — go fully async-native, no sync facade. So the diff is bigger (every `graphStore.X()` → `await kmStore.X()`), but no leaky abstraction remains. The 7 intelligence files become async-native.

**Method mapping table (from `~/Agentic/km-core/src/store/GraphKMStore.ts` public API, captured in `42-01-PLAN.md` interfaces section):**

| OKM IGraphStore (sync) | km-core GraphKMStore (async) |
|---|---|
| `getAllEntities(): Entity[]` | `for await (const e of store.iterate()) {...}` |
| `getEntity(nodeId): Entity \| null` | `await store.getEntity(entityId)` (Note: nodeId in OKM is `${layer}:${id}` — strip layer prefix first) |
| `addEntity(entity): string` (returns nodeId) | `await store.putEntity(entity, { skipOntologyCheck: false })` |
| `addEdge(src, tgt, edge): string` | `await store.addRelation({ type, from, to, metadata })` |
| `getEdges(nodeId, opts): EdgeResult[]` | `await store.findRelations({ from?, to?, type? })` |
| `filterByLayer(layer): Entity[]` | iterate + filter (no direct km-core method) |
| `getStats(): {nodes, edges}` | iterate + count (or extend km-core if needed) |
| `getOrphanNodeIds(): string[]` | iterate + `await store.getDegree(...)` per Phase 41 Plan 03 |

**Node-key delta:** OKM uses `${layer}:${id}` composite keys (see `km-store-adapter.ts:138-139`). km-core uses bare `EntityId` (UUIDv7). Plan must either (a) split off the layer prefix before calling km-core, OR (b) drop layer-prefixed keys entirely and use `entity.layer` field for filtering. Recommendation: (b) — cleaner, aligns with km-core's design.

---

### `…/operational-knowledge-management/src/api/server.ts` — revert `/api/km` mount (D-G2.4)

**Current state showing what to revert (lines 14-66):**

```typescript
export async function createServer(
  graphStore: IGraphStore,
  syncManager: SyncManager,
  startupState: StartupState,
  ontologyRegistry?: OntologyRegistry,
  pipeline?: IngestionPipeline,
  llmService?: LLMService,
  dataDir?: string,
  sourceDocStore?: SourceDocumentStore,
  kmStore?: GraphKMStore,        // <— DROP this parameter
): Promise<Express> {
  // ... apiRoutes registration ...

  // Mount km-core common REST router at /api/km/ (Phase 44 Plan 03)
  // Only available when using the km-core store backend.
  if (kmStore) {                                       // <— DELETE this block (8 lines)
    const { createKMRouter } = await import('@fwornle/km-core');
    const kmRouter = Router();
    createKMRouter(kmStore, kmRouter);
    app.use('/api/km', kmRouter);
    console.info('[api] Mounted km-core common REST router at /api/km/');
  }
}
```

**Target (after Phase 43's revert):**

```typescript
export async function createServer(
  graphStore: IGraphStore,           // <— Phase 43 final cleanup also drops this; replaced with kmStore directly
  // ... existing params, NO kmStore param ...
): Promise<Express> {
  // ... apiRoutes registration ...
  // NO /api/km mount — Phase 44 owns the unified router contract
}
```

**Note:** After Phase 43's full D-G3.2 cleanup, `graphStore: IGraphStore` is also gone (the interface is deleted); the parameter becomes `kmStore: GraphKMStore`. Stage the change as two commits to keep the diff reviewable:
1. **Commit 1:** Revert `/api/km` mount + drop `kmStore` param (D-G2.4 — small, surgical).
2. **Commit 2:** Replace `graphStore: IGraphStore` with `kmStore: GraphKMStore` (D-G3.2 — bigger blast radius).

---

### `…/operational-knowledge-management/scripts/migrate-okm-json-to-kmcore.mjs` — NEW (D-G4.1)

**Analog:** `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs` (Phase 42 Plan 5).

**Pattern to copy from `42-05-PLAN.md` (script header + properties):**

| Property | Phase 42 Plan 5 | Phase 43 (OKM-side) |
|---|---|---|
| Input format | LevelDB at `.data/knowledge-graph/` | JSON files at `.data/exports/{general,kpifw,raas}.json` |
| Output | km-core LevelDB (new dataDir) | km-core LevelDB (new dataDir, OKM-local) |
| Idempotency | required (running twice = same result) | required (same) |
| `legacyId` stamp | `{ system: 'B', id: <existing-id> }` | `{ system: 'C', id: <existing-id> }` |
| `metadata.subsystem` | `'wave-analysis'` | per-file domain (`'general' \| 'kpifw' \| 'raas'`) — preserve OKM's per-domain bucketing |
| Error budget | 5% (`errors.length / total > 0.05` aborts) | same |
| Output flags | `--dry-run`, `--batch-size=N`, `--resume`, `--source`, `--target` | same flags; default `--source` is the three `.data/exports/*.json` files |
| Provenance stamp | `{ provider: 'phase-42-migration', model: 'b-to-km-core', runId, timestamp }` | `{ provider: 'phase-43-migration', model: 'okm-to-km-core', runId, timestamp }` |
| Run discipline | one-shot operator-driven (not CI) | same |

**Acceptance grep (mirrors Phase 42 Plan 5 key_links):**
```bash
grep -c "ontologyDir" \
  ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/migrate-okm-json-to-kmcore.mjs
# MUST return ≥ 1 (per coding/CLAUDE.md km-core CLI rule)
```

**Critical detail from coding/CLAUDE.md:**
> "Any CLI or service that imports `resolveEntities` from `@fwornle/km-core` MUST construct `GraphKMStore` with an `ontologyDir` option — otherwise default-class resolution throws `opts.classes omitted but store has no ontology registry`."

This applies to OKM's migration script even though it doesn't call `resolveEntities` — but it DOES call `putEntity` with `skipOntologyCheck: false` (the strict path), which needs the registry. **Resolve via `import.meta.resolve('@fwornle/km-core')` + walk up to package root** — the OKM `index.ts:42-55` shows the working pattern (current state already does this; copy that block verbatim into the migration script).

---

### `…/operational-knowledge-management/scripts/reembed-okm-corpus.mjs` — NEW (D-G7.1)

**Analog:** Phase 42 Plan 4 (`FastembedEmbeddingClient` definition) + Phase 42 Plan 7 Task 3 step 10 (`syncQdrantFromStore` invocation pattern).

**Pattern from Phase 42 Plan 7 Task 3 step 10 (verbatim invocation pattern):**

```javascript
// docker exec coding-services node -e "..."
const { GraphKMStore } = await import('@fwornle/km-core');
const { syncQdrantFromStore } = await import('@fwornle/km-core/maintenance');
// (or in OKM's case, the FastembedEmbeddingClient from km-core)

const store = new GraphKMStore({
  ontologyDir: '/path/to/ontologies',
  dataDir: '/coding/.data/knowledge-graph',
});
await store.open();
// ...iterate, compute embeddings via fastembed, mergeAttributes back into store...
```

**For OKM:** Walk every entity via `store.iterate()`, compute the embedding via the shared `FastembedEmbeddingClient` (km-core export, Phase 42 D-52c — fastembed `AllMiniLML6V2`, 384-dim), call `await store.mergeAttributes(entity.id, { embedding })`. Per D-G7.2 (hybrid embedding store), embeddings stay INLINE in km-core LevelDB. **No Qdrant call** for OKM in Phase 43 (deferred to Phase 44+).

**SC#2-style verification grep (copied from Phase 42 Plan 1 Task 1):**

```typescript
const entities: Entity[] = [];
for await (const e of store.iterate()) { entities.push(e); }
const withEmbedding = entities.filter(e => e.embedding && e.embedding.length === 384);
process.stderr.write(`Total: ${entities.length}, with 384-dim embedding: ${withEmbedding.length}\n`);
// MUST: withEmbedding.length === entities.length (every entity reembedded)
```

---

### `…/operational-knowledge-management/tests/integration/rest-contract.test.ts` — NEW Zod-based contract test (D-G5.1)

**Analog:** Existing `…/operational-knowledge-management/tests/integration/km-core-backend.test.ts` (same test directory, same test framework — vitest, similar setup).

**Test scaffold pattern (from `km-core-backend.test.ts:1-49`):**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GraphKMStore } from '@fwornle/km-core';
// ... rest of OKM test imports ...

describe('REST contract — frozen Zod schemas', () => {
  let tmpDir: string;
  let kmStore: GraphKMStore;
  let app: Express;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'okm-contract-'));
    kmStore = new GraphKMStore({
      ontologyDir: <test ontology>,
      dataDir: path.join(tmpDir, 'leveldb'),
      exportDir: path.join(tmpDir, 'exports'),
      debounceMs: 0,
    });
    await kmStore.open();
    app = await createServer(kmStore, ...);
  });
  // ... per-endpoint asserts ...
});
```

**Zod schema pattern (NEW — D-G5.1 explicit):**

```typescript
import { z } from 'zod';  // OKM already has `zod: "^3.25.76"` in package.json line 30

const EntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  entityType: z.string(),
  ontologyClass: z.string().optional(),
  layer: z.enum(['evidence', 'pattern']),
  description: z.string(),
  metadata: z.record(z.unknown()),
  // ... lock every field ...
});

const EntitiesEndpointResponse = z.object({
  data: z.array(EntitySchema),
  total: z.number().int().nonnegative(),
});

it('GET /api/entities returns frozen contract shape', async () => {
  const res = await request(app).get('/api/entities');
  EntitiesEndpointResponse.parse(res.body);  // throws on shape drift
});
```

---

## Shared Patterns

### Cross-Repo Submodule Discipline (D-G1.1, D-G1.2, D-G1.4)

**Source:** `/Users/Q284340/Agentic/coding/.gitmodules` (lines 19-21) + `/Users/Q284340/Agentic/coding/lib/km-core/` (existing tarball).

**Apply to:** D-G1 packaging plan.

**Pattern:**

| Concern | Pattern |
|---|---|
| Submodule URL scheme | HTTPS (km-core is public; works zero-auth on bmw.ghe.com per `memory/feedback_bmw_ghe_https.md`) |
| Submodule path | `lib/km-core/` INSIDE the OKM dir (not at rapid-automations root) |
| `package.json` dep reference | `file:vendor/fwornle-km-core-X.Y.Z.tgz` (NOT `file:./lib/km-core` — avoids TS-on-the-fly compilation per D-G1.2) |
| Version bump cadence | ONLY on km-core version tags (`v0.2.0`, `v0.3.0`...) |
| Commit message format | `chore(deps): bump km-core 0.1.0 → 0.2.0` |
| Atomic commit contents | `package.json` + `package-lock.json` + `vendor/<new>.tgz` + `vendor/<old>.tgz` deletion + `lib/km-core` submodule SHA |

---

### Final-Cleanup-Plan Pattern (D-G3.1 — mirrors Phase 42 D-51)

**Source:** `.planning/phases/42-offline-ukb-migration-b/42-07-PLAN.md` (the entire Plan 7 structure).

**Apply to:** Phase 43's final-cleanup plan (analogous role to Phase 42 Plan 7).

**Pattern — three-phase structure within the final plan:**

| Phase | Phase 42 Plan 7 | Phase 43 (OKM) |
|---|---|---|
| Phase A | Production LevelDB in-place migration + atomic dir swap + backup preservation | JSON-replay migration script run + LevelDB pre-cutover backup (`.data/leveldb.pre-43-backup/`) |
| Phase B | Delete `GraphDatabaseService.js` + `KnowledgeStorageService.js` + `QdrantSyncService.js` + `persistence-agent.ts` + `graph-database-adapter.ts` + `persistence-flag.ts` (6 files) | Delete `km-store-adapter.ts` + `graph-store.ts` + `sync-manager.ts` + `persistence.ts` + `types/graph-store.ts` + `ontology/registry.ts` + `ontology/loader.ts` (7 files) |
| Phase C | Production wave-analysis run + `syncQdrantFromStore` + SC verification script + human-verify checkpoint | OKM full test suite + REST contract tests + fixtures byte-diff + VOKB smoke + human-verify checkpoint |

**Phase B grep gate template (verbatim from Phase 42 Plan 7 Task 2 action #4):**

```bash
# MUST return zero matches; BLOCKING on build
grep -rln '<deleted-symbol-1>\|<deleted-symbol-2>\|...' \
  <repo-src-dir> --include='*.ts' --include='*.js'
```

For OKM, the symbols to grep are:
`IGraphStore\|GraphKMStoreAdapter\|OKB_STORE_BACKEND\|from.*store/graph-store\|from.*store/sync-manager\|from.*store/persistence\|from.*ontology/registry\|from.*ontology/loader`

**Phase C SC verification script pattern (from `42-07-PLAN.md` Task 1 action #9):**

> "Create the verification script `scripts/43-07-end-to-end-verify.mjs` for use in Task 3. Structure:
>   - parse `--since` flag (the pre-run docker-logs timestamp)
>   - run SC#1 check: open the km-core store, iterate first 10 entities, assert each has top-level legacyId.system==='C', layer==='evidence', ontologyClass defined
>   - run SC#3 check: ... (fixture byte-diff, see D-G5.1)
>   - emit a verdict JSON line with `{ sc1: pass|fail, ..., overall: pass|fail }` and exit 0 (all pass) or 1 (any fail)"

---

### LLM-Proxy + km-core Construction (km-core CLI rule from coding/CLAUDE.md)

**Source:** `/Users/Q284340/Agentic/coding/CLAUDE.md` "Mandatory Rules" section + `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts:41-55` (working ontologyDir resolver block).

**Apply to:** Every NEW OKM file or script that constructs `GraphKMStore`, and any that calls `resolveEntities`.

**Pattern (verbatim block to copy from OKM index.ts:41-55):**

```typescript
// Resolve ontologyDir per CLAUDE.md: import.meta.resolve → package root → config/ontology
const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
const kmCorePath = fileURLToPath(kmCoreEntry);
let kmCoreRoot = path.dirname(kmCorePath);
while (kmCoreRoot !== '/') {
  try {
    await fs.access(path.join(kmCoreRoot, 'package.json'));
    break;
  } catch {
    kmCoreRoot = path.dirname(kmCoreRoot);
  }
}
const ontologyDir = path.join(kmCoreRoot, 'config', 'ontology');
```

**Acceptance grep (must appear in every CLI):**
```bash
grep -c "ontologyDir" <script-path>
# MUST return ≥ 1 (per coding/CLAUDE.md km-core CLI rule + Phase 41 lesson)
```

---

### `process.stderr.write` for Diagnostic Output (no-console-log constraint)

**Source:** `/Users/Q284340/Agentic/coding/CLAUDE.md` "Constraint System Gotchas" — `no-console-log` constraint applies to all `.ts`/`.js` edits.

**Apply to:** All NEW TypeScript/JavaScript files (migration scripts, repack helpers, contract tests).

**Pattern (from Phase 42 Plan 1 Task 1 action):**
```typescript
// BAD — fires no-console-log constraint:
console.log(`[migration] Processed ${count} entities`);

// GOOD:
process.stderr.write(`[migration] Processed ${count} entities\n`);
```

**Exception:** OKM's existing code uses `console.info` / `console.warn` extensively (see `src/index.ts:66, 69, 90, 91, 104, 106, 113, 115, 123, 127, 142, 145, 159`). The coding-repo constraint applies to files in `/Users/Q284340/Agentic/coding/`. **For files in `~/Agentic/_work/rapid-automations/` (OKM repo), OKM's own conventions apply** — and OKM uses `console.info/warn/error`. Plan should match OKM's existing pattern within OKM files; only switch to `process.stderr.write` if the file is in the coding repo or if OKM's own ruleset (its CLAUDE.md) requires it. **Check OKM's CLAUDE.md for its constraint posture during planning.**

---

### Docker Rebuild Discipline (CLAUDE.md "Rebuilding After Code Changes")

**Source:** `/Users/Q284340/Agentic/coding/CLAUDE.md` "Rebuilding After Code Changes" section.

**Apply to:** Verification tasks in Phase 43 plans where OKM code runs in a container.

**KEY DELTA from Phase 42:** OKM lives in `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/`. The CLAUDE.md "Submodules requiring both steps" list (`integrations/mcp-server-semantic-analysis`, `integrations/mcp-constraint-monitor`, `integrations/code-graph-rag`) does **NOT** include OKM — OKM is in a SEPARATE repo from coding. Coding's Docker rebuild rules do NOT apply directly. OKM has its own build/test cycle:

```bash
cd ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
npm run build && npm test
```

Plan should NOT include `docker-compose build coding-services` in OKM verification tasks unless OKM is also wired into the coding-services container (verify with grep on `docker/docker-compose.yml`).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `…/operational-knowledge-management/tests/fixtures/pre-migration/*.json` | test / fixture data | snapshot-diff | Fixtures-based byte-diff REST testing is new to this codebase. Closest reference is Phase 42 Plan 5's "property-based test fixture" but that's structurally different (asserts invariants on emitted data, not byte-equality vs recorded snapshots). Planner uses RESEARCH.md patterns instead (D-G5.1's explicit description). Suggested approach: hit endpoints with a fixed seed dataset, write `JSON.stringify(res.body, null, 2)` to `tests/fixtures/pre-migration/<endpoint>.json`, then in post-cutover tests `expect(JSON.parse(await readFile(fixturePath))).toEqual(res.body)`. |

---

## Repo Topology Notes (for Planner)

Phase 43 touches THREE separate repos. Every PLAN.md must be explicit about which repo each `files_modified` path belongs to:

| Repo | Filesystem root | Working tree | km-core relationship |
|---|---|---|---|
| **coding** | `/Users/Q284340/Agentic/coding/` | submodule of nothing | parent — owns the `lib/km-core` submodule for B's use |
| **km-core** | `~/Agentic/km-core/` | independent npm package, github.com (public) | the target dependency itself |
| **OKM** | `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` | submodule of rapid-automations (bmw.ghe.com) | consumer — Phase 43 adds OKM-local `lib/km-core` submodule + vendor tarball |
| **rapid-automations root** | `~/Agentic/_work/rapid-automations/` | hosts OKM as submodule, bmw.ghe.com | minimal coupling — D-G1.3 deletes the vestigial dep |

**Commit boundaries:** Each plan must commit ONLY in its target repo. Cross-repo orchestration is at the planner level. For example:
- D-G4.2 (km-core schema extension) → commits in `~/Agentic/km-core/` → publish/bump → consumed by OKM via D-G1.4 vendor tarball refresh.
- D-G2.* and D-G3.* → commits in `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/`.
- D-G1.3 → 1-line commit in `~/Agentic/_work/rapid-automations/package.json`.

**No coding-repo source changes are needed** in Phase 43 — but planning docs (`.planning/phases/43-…`) live in the coding repo.

---

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/coding/.planning/phases/42-offline-ukb-migration-b/*.md` (all 7 Phase 42 plans + summaries — Phase 42 is the template phase per CONTEXT)
- `/Users/Q284340/Agentic/coding/.gitmodules` + `/Users/Q284340/Agentic/coding/lib/km-core/` (B's submodule template)
- `~/Agentic/km-core/src/types/entity.ts`, `src/maintenance/`, `src/ontology/` (km-core public surface)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/`, `src/ingestion/`, `src/api/`, `src/intelligence/`, `src/ontology/`, `src/types/`, `tests/integration/` (OKM full src tree)
- `~/Agentic/_work/rapid-automations/package.json` (1-line deletion target)

**Files scanned (with line counts captured):**
- OKM `src/store/km-store-adapter.ts` (479 lines)
- OKM `src/index.ts` (162 lines)
- OKM `src/types/graph-store.ts` (61 lines)
- OKM `src/api/server.ts` (67 lines, first 100 read)
- OKM `src/ingestion/pipeline.ts` (lines 340-460 read)
- OKM `src/ingestion/deduplicator.ts` (lines 610-700 read)
- OKM `src/api/routes.ts` (lines 620-670 + greps)
- OKM `src/ontology/registry.ts` (first 80 lines)
- OKM `tests/integration/km-core-backend.test.ts` (first 60 lines)
- OKM `package.json` (full)
- km-core `src/types/entity.ts` (full — 209 lines)
- km-core `src/maintenance/resolveEntities.ts` (first 60 lines for algorithm-equivalence note)
- km-core `package.json` (full — exports map captured for sub-path imports)
- coding `.gitmodules` (full — submodule pattern captured)
- Phase 42 `42-CONTEXT.md` (full)
- Phase 42 `42-01-PLAN.md` (full — adapter pattern)
- Phase 42 `42-02-PLAN.md` (full — race-fix pattern, less relevant to 43)
- Phase 42 `42-05-PLAN.md` (header — migration-script pattern)
- Phase 42 `42-06-PLAN.md` (header — wave-controller emit-shape migration)
- Phase 42 `42-07-PLAN.md` (full — final-cleanup template, the most-cited analog)

**Pattern extraction date:** 2026-05-31

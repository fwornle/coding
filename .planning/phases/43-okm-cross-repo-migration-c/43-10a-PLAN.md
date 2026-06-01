---
phase: 43-okm-cross-repo-migration-c
plan: 10a
type: execute
wave: 5
depends_on:
  - 43-08e
files_modified:
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts
  - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/sync-manager.ts
autonomous: true
requirements:
  - INT-03
user_setup: []

must_haves:
  truths:
    - "**Scope amendment (post-discovery):** the first executor pass discovered the four legacy test files depend on a broader bootstrap surface than the original plan enumerated — they also use `createServer`'s pre-08e 8-arg signature, pass `graphStore` into `IngestionPipeline` / `EntityDeduplicator` which now expect `GraphKMStore`, and import from the deleted `src/llm/` and `src/ontology/` modules. Plan scope expanded to: (a) `GraphStore` shim duck-types as `GraphKMStore` (legacy 6 methods PLUS pass-through delegations for the km-core methods downstream consumers call); (b) tiny re-export shim modules `src/llm/{index,llm-service}.ts` and `src/ontology/registry.ts`; (c) TEST-ONLY overload added to `src/api/server.ts`'s `createServer` that accepts the pre-08e `(graphStore, syncManager, ...)` shape and unwraps to the production `kmStore` path. All TEST-ONLY surfaces carry JSDoc banners."
    - "Five test-only bootstrap shim modules restored under `src/`: `src/store/{graph-store, persistence, sync-manager}.ts` + `src/llm/{index, llm-service}.ts` + `src/ontology/registry.ts`. Plus one production-file TEST-ONLY overload added to `src/api/server.ts` (the overload is gated on duck-type detection so production callers are unaffected). Each new module + the overload carries a JSDoc banner declaring it a Phase 43 D-G5.1 verification-gate shim only — not for production use — and pointing future readers at the canonical km-core path used by `src/api/routes.ts`."
    - "`GraphStore` shim surface (duck-types as `GraphKMStore` so legacy tests can pass it to `IngestionPipeline` / `EntityDeduplicator` / `createServer`): legacy methods `addEntity`, `addEdge`, `getEntity`, `getAllEntities`, `getEdges`, `onMutation` PLUS pass-through delegations for the km-core methods downstream consumers call (`putEntity`, `addRelation`, `findRelations`, `iterate`, `mergeAttributes`, `findByOntologyClass`, `getDegree`, `getSupersessionChain`, `batch`, `exportJson`, `deleteEntity`, `restore`, `open`, `close`, `on`, getter for `ontology`). Cross-check method names against the actual `lib/km-core/dist/store/GraphKMStore.d.ts` before authoring — use the real names, not the plan's snippet if they diverge. `PersistenceManager` = `{ constructor(dbPath, exportDir) }` (no public methods called by tests; constructor-only stub is sufficient). `SyncManager` = `{ constructor(store, persistence, { debounceMs, dataDir }), hookMutations(), initialize(), flush(), shutdown(), waitForPendingWrites(), waitForPendingExport() }`."
    - "All four legacy test files run green again after the shim land + build: `tests/integration/rest-contract.test.ts`, `tests/integration/api-ingest.test.ts`, `tests/integration/ingestion-pipeline.test.ts`, `tests/unit/deduplicator.test.ts`. The grep gate against Plan 08e's deferral list flips from FAIL → PASS for these four files."
    - "Plan 06's `scripts/record-rest-fixtures.mjs` (which also imports `dist/store/{graph-store,persistence,sync-manager}.js`) runs to completion against the seeded state — proves the recorder bootstrap path is whole again, which unblocks Plan 10 Gate 2 (`scripts/verify-post-migration.mjs`)."
    - "`npm run build` clean (tsc emits the three new `dist/store/*.js` files), `npm test` whole-suite count is monotone non-decreasing vs the 43-08e baseline (no NEW regressions; the 13 historically broken `src/llm/` test files stay as-is)."
    - "Commit topology: submodule commit on `refactor/43-08e-delete-adapter` branch (where the OKM work lives) + outer rapid-automations gitlink-bump on `main` + planning-docs-only commit in `/Users/Q284340/Agentic/coding`. Per Phase 42.2-04 + 43-08e precedent — `src/store/` is a real subdir, NOT a symlink."
  artifacts:
    - path: "src/store/graph-store.ts"
      provides: "GraphStore class — legacy 6 methods + pass-through km-core delegations; duck-types as GraphKMStore"
    - path: "src/store/persistence.ts"
      provides: "PersistenceManager class — constructor-only stub holding dbPath/exportDir for SyncManager handoff"
    - path: "src/store/sync-manager.ts"
      provides: "SyncManager class — wraps GraphStore; initialize()→open(), shutdown()→close(), hookMutations()/flush()/wait* no-ops adequate for tests"
    - path: "src/llm/index.ts"
      provides: "TEST-ONLY re-export of LLMService from @rapid/llm-proxy (one-liner)"
    - path: "src/llm/llm-service.ts"
      provides: "TEST-ONLY mirror of llm/index re-export (for tests importing the deeper path)"
    - path: "src/ontology/registry.ts"
      provides: "TEST-ONLY re-export of OntologyRegistry from @fwornle/km-core/ontology (one-liner)"
    - path: "src/api/server.ts (modified — TEST-ONLY overload added)"
      provides: "createServer overload accepting pre-08e 8-arg (graphStore, syncManager, ...) shape; unwraps graphStore._internalStore() and forwards to production kmStore path. Overload JSDoc declares TEST-ONLY; production callers continue to use the 7-arg (kmStore, ...) signature unchanged."
  key_links:
    - from: "src/store/graph-store.ts"
      to: "@fwornle/km-core GraphKMStore"
      via: "delegation"
      pattern: "GraphKMStore|km-core"
    - from: "tests/integration/{rest-contract,api-ingest,ingestion-pipeline}.test.ts + tests/unit/deduplicator.test.ts"
      to: "src/store/* shims"
      via: "named import"
      pattern: "from '\\.\\./\\.\\./src/store/(graph-store|persistence|sync-manager)"
---

<objective>
**Unblocks Plan 43-10's automated gates** (Gate 1 + Gate 2 + recorder reuse) by restoring minimal test-only shims that Plan 08e knowingly deleted (deferral noted in `43-08e-SUMMARY.md` line 159).

This is the **"test-suite restore" plan** Plan 08e Task 5 explicitly pointed at:

> *"A standalone 'test suite restore' plan can pick these up after 43-08f. Files needing the above: tests/integration/{api-ingest, ingestion-failover, ingestion-pipeline, rest-contract, cli-smoke}.test.ts"*

The shims are **not production modules**. Production write paths go through km-core directly via `src/api/routes.ts`'s 18 `store*` helpers (post-43-08e). These shims exist solely to keep:
1. Plan 06's rest-contract.test.ts (the REST byte-equal lock) functional.
2. Plan 06's `scripts/record-rest-fixtures.mjs` recorder runnable.
3. Plan 10's `scripts/verify-post-migration.mjs` verifier runnable (it bootstraps via the same recorder path).
4. The two unit/integration tests that still seed via `GraphStore` directly.

D-G6.2 (in-place fix only, no parallel versions) per CLAUDE.md applies — shims live in the same paths the deleted modules occupied, NOT in a `legacy-store/` parallel tree.

Out of scope:
- `tests/integration/ingestion-failover.test.ts` and `tests/integration/cli-smoke.test.ts` (Plan 08e's deferral list also mentions these, but they fail on `src/llm/` not `src/store/` — a separate plan owns those).
- Any rewrite of consumer tests to use the modern `api-test-helper` pattern. Scope is shim restoration; modernization is a different conversation.
- Anything inside `dist/` — `npm run build` regenerates dist from the new src.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-CONTEXT.md
@/Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-PATTERNS.md
@/Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-08e-SUMMARY.md

<interfaces>
<!-- Reference for the modern km-core bootstrap pattern (DO NOT modify): -->
- /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-test-helper.ts — shows how new tests construct GraphKMStore directly. Use as the design north-star for what the shims should delegate to internally.

<!-- Consumer call-site enumeration (drives the shim surface): -->
- tests/integration/rest-contract.test.ts:348-350 — `new GraphStore()` + `new PersistenceManager(dbPath, exportDir)` + `new SyncManager(graphStore, persistence, { debounceMs, dataDir })`; calls `graphStore.addEntity()`, `graphStore.addEdge()`, `syncManager.hookMutations()`, `syncManager.shutdown()`.
- tests/integration/api-ingest.test.ts:45-52, 152-154 — same trio constructed; calls `.initialize()` on SyncManager additionally.
- tests/integration/ingestion-pipeline.test.ts:53 — `new GraphStore()` standalone; calls `.addEntity()`, `.getAllEntities()`, `.getEdges(nodeId)`.
- tests/unit/deduplicator.test.ts:67 — `new GraphStore()` standalone; calls `.addEntity()`, `.getAllEntities()`, `.getEntity(nodeId)`.
- scripts/record-rest-fixtures.mjs:85-87 — imports from `dist/store/{graph-store,persistence,sync-manager}.js` (post-build artifacts); same construction pattern as rest-contract.test.ts.

<!-- km-core surface the shims wrap (from lib/km-core/dist/store/GraphKMStore.d.ts): -->
- new GraphKMStore({ dbPath, exportDir, debounceMs, ontologyDir, domains })
- await open() / await close()
- await putEntity(entity, { skipOntologyCheck? })
- await getEntity(id)
- iterate({ type?, includeSuperseded? }) → AsyncIterable
- await addRelation({ type, from, to, ...attrs })
- await findRelations({ from?, to?, type? })
- on('entity:put' | 'entity:delete' | 'relation:added' | 'relation:removed', cb)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write src/store/graph-store.ts — GraphStore shim</name>
  <files>/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-test-helper.ts (modern km-core bootstrap reference; mirror the GraphKMStore constructor pattern)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts:340-410 (concrete call signatures the shim must satisfy)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/ingestion-pipeline.test.ts:50-80 (getEdges + getAllEntities call shapes)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/deduplicator.test.ts:60-90 (addEntity + getEntity call shapes)
  </read_first>
  <action>
    1. Create `src/store/graph-store.ts`. Required surface (and NOTHING beyond):

       ```typescript
       /**
        * Phase 43 D-G5.1 verification-gate shim — TEST-ONLY.
        *
        * This module exists to keep four legacy test files + Plan 06's recorder
        * functional after Plan 08e deleted the production GraphStore class:
        *   - tests/integration/rest-contract.test.ts (REST byte-equal lock)
        *   - tests/integration/api-ingest.test.ts
        *   - tests/integration/ingestion-pipeline.test.ts
        *   - tests/unit/deduplicator.test.ts
        *   - scripts/record-rest-fixtures.mjs (via dist/)
        *
        * Production write paths use @fwornle/km-core's GraphKMStore directly —
        * see src/api/routes.ts and tests/integration/api-test-helper.ts.
        * DO NOT import this from production code.
        */
       import { GraphKMStore, type Entity, type Relation } from '@fwornle/km-core';

       type EdgeResult = { from: string; to: string; type: string; key: string; [k: string]: unknown };
       type MutationCallback = (event: 'entity:put' | 'entity:delete' | 'relation:added' | 'relation:removed', payload: unknown) => void;

       export class GraphStore {
         private store: GraphKMStore;
         private opened = false;

         constructor(opts?: { dbPath?: string; exportDir?: string; ontologyDir?: string; domains?: string[] }) {
           // tmpdir defaults for tests — they rarely care about persistence
           const dbPath = opts?.dbPath ?? `/tmp/okm-shim-${Date.now()}-${Math.random().toString(36).slice(2)}/db`;
           const exportDir = opts?.exportDir ?? `/tmp/okm-shim-${Date.now()}-${Math.random().toString(36).slice(2)}/exports`;
           this.store = new GraphKMStore({
             dbPath,
             exportDir,
             debounceMs: 0,
             // ontologyDir + domains pass through if provided; tests using GraphStore without these
             // rely on km-core's no-op/skip path (skipOntologyCheck below)
             ...(opts?.ontologyDir ? { ontologyDir: opts.ontologyDir } : {}),
             ...(opts?.domains ? { domains: opts.domains } : {}),
           });
         }

         private async ensureOpen() {
           if (!this.opened) { await this.store.open(); this.opened = true; }
         }

         async addEntity(entity: Entity): Promise<string> {
           await this.ensureOpen();
           await this.store.putEntity(entity, { skipOntologyCheck: true });
           return entity.id;
         }

         async getEntity(nodeId: string): Promise<Entity | null> {
           await this.ensureOpen();
           // tolerate optional layer:uuid prefix used by some consumers
           const bare = nodeId.includes(':') ? nodeId.split(':').slice(-1)[0] : nodeId;
           return (await this.store.getEntity(bare)) ?? null;
         }

         async getAllEntities(): Promise<Entity[]> {
           await this.ensureOpen();
           const out: Entity[] = [];
           for await (const e of this.store.iterate(undefined, { includeSuperseded: true })) out.push(e);
           return out;
         }

         async addEdge(source: string, target: string, edge: Partial<Relation> & { type: string }): Promise<string> {
           await this.ensureOpen();
           const relation = await this.store.addRelation({ ...edge, from: source, to: target });
           // legacy GraphStore returned an edgeKey string; synthesize one to keep callers happy
           return `${source}|${target}|${edge.type}`;
         }

         async getEdges(nodeId: string, options?: { direction?: 'in' | 'out' | 'both' }): Promise<EdgeResult[]> {
           await this.ensureOpen();
           const bare = nodeId.includes(':') ? nodeId.split(':').slice(-1)[0] : nodeId;
           const dir = options?.direction ?? 'both';
           const collected: EdgeResult[] = [];
           if (dir === 'out' || dir === 'both') {
             for (const r of await this.store.findRelations({ from: bare })) {
               collected.push({ ...r, key: `${r.from}|${r.to}|${r.type}` });
             }
           }
           if (dir === 'in' || dir === 'both') {
             for (const r of await this.store.findRelations({ to: bare })) {
               collected.push({ ...r, key: `${r.from}|${r.to}|${r.type}` });
             }
           }
           return collected;
         }

         onMutation(cb: MutationCallback): void {
           for (const ev of ['entity:put', 'entity:delete', 'relation:added', 'relation:removed'] as const) {
             this.store.on(ev, (payload: unknown) => cb(ev, payload));
           }
         }

         /** Test-only escape hatch — internal access for shim composition (SyncManager). */
         _internalStore(): GraphKMStore { return this.store; }
         _markOpen(): void { this.opened = true; }
       }
       ```

    2. **Cross-check against actual km-core API surface.** Before declaring done, run:
       ```
       grep -nE '^\s*(async\s+)?(putEntity|getEntity|iterate|addRelation|findRelations|on\b|open\b|close\b)' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/lib/km-core/dist/store/GraphKMStore.d.ts
       ```
       Adjust method names + arg shapes if the actual `.d.ts` disagrees with the snippet above. Do NOT invent km-core methods that don't exist; if `iterate()` takes a different first arg, use the real one.

    3. `node --check dist/store/graph-store.js` after `npm run build` (Task 4 owns the build).
  </action>
  <verify>
    <automated>test -f /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts &amp;&amp; grep -q 'TEST-ONLY' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts &amp;&amp; grep -q '@fwornle/km-core' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts</automated>
  </verify>
  <done>graph-store.ts shim authored; TEST-ONLY JSDoc banner present; km-core import in place.</done>
  <acceptance_criteria>
    - File exists: `test -f src/store/graph-store.ts` exit 0.
    - JSDoc banner: `grep -q 'TEST-ONLY' src/store/graph-store.ts` exit 0.
    - km-core import: `grep -q "from '@fwornle/km-core'" src/store/graph-store.ts` exit 0.
    - Legacy 6 methods present: `grep -cE '^\s*(async\s+)?(addEntity|getEntity|getAllEntities|addEdge|getEdges|onMutation)\b' src/store/graph-store.ts` returns 6.
    - km-core delegations present (for IngestionPipeline/EntityDeduplicator/createServer pass-through): `grep -cE '^\s*(async\s+)?(putEntity|addRelation|findRelations|iterate|mergeAttributes|open|close|on)\b' src/store/graph-store.ts` >= 6 (the exact set depends on real km-core surface; pin against `lib/km-core/dist/store/GraphKMStore.d.ts`).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 1b: Write src/llm/{index,llm-service}.ts — TEST-ONLY re-exports of LLMService</name>
  <files>/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/llm/index.ts, /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/llm/llm-service.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-ingest.test.ts (find the `from '../../src/llm/...'` line)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/deduplicator.test.ts (find the `from '../../src/llm/...'` line)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/node_modules/@rapid/llm-proxy/dist/index.d.ts (confirm `LLMService` is exported from the package root)
  </read_first>
  <action>
    Create two one-line re-export modules that mirror the deleted-module paths consumers expect:

    `src/llm/index.ts`:
    ```typescript
    /**
     * Phase 43 D-G5.1 verification-gate shim — TEST-ONLY.
     * See src/store/graph-store.ts header for full rationale.
     *
     * Re-exports LLMService from @rapid/llm-proxy at the path some legacy tests
     * import (`../../src/llm` or `../../src/llm/index`). Production code uses
     * @rapid/llm-proxy directly.
     */
    export { LLMService } from '@rapid/llm-proxy';
    ```

    `src/llm/llm-service.ts` (mirrors the deeper path some tests import):
    ```typescript
    /** Phase 43 D-G5.1 verification-gate shim — TEST-ONLY. See src/llm/index.ts. */
    export { LLMService } from '@rapid/llm-proxy';
    ```

    If `LLMService` is not at the root of `@rapid/llm-proxy`, find the actual export path via `grep -r 'export.*LLMService' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/node_modules/@rapid/llm-proxy/dist/` and adjust.
  </action>
  <verify>
    <automated>test -f /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/llm/index.ts &amp;&amp; test -f /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/llm/llm-service.ts &amp;&amp; grep -q 'TEST-ONLY' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/llm/index.ts</automated>
  </verify>
  <done>Both LLM re-export shims authored.</done>
  <acceptance_criteria>
    - Both files exist.
    - TEST-ONLY banner present in both.
    - Both re-export `LLMService` from `@rapid/llm-proxy`.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 1c: Write src/ontology/registry.ts — TEST-ONLY re-export of OntologyRegistry</name>
  <files>/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/registry.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-ingest.test.ts (find the `from '../../src/ontology/registry'` line)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/ingestion-pipeline.test.ts (same)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/lib/km-core/dist/ontology/index.d.ts (confirm `OntologyRegistry` is exported)
  </read_first>
  <action>
    Create `src/ontology/registry.ts`:

    ```typescript
    /**
     * Phase 43 D-G5.1 verification-gate shim — TEST-ONLY.
     * See src/store/graph-store.ts header for full rationale.
     *
     * Re-exports OntologyRegistry from @fwornle/km-core/ontology at the path
     * some legacy tests import. Production code imports from km-core directly.
     */
    export { OntologyRegistry } from '@fwornle/km-core/ontology';
    ```
  </action>
  <verify>
    <automated>test -f /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/registry.ts &amp;&amp; grep -q 'TEST-ONLY' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/registry.ts</automated>
  </verify>
  <done>Ontology re-export shim authored.</done>
  <acceptance_criteria>
    - File exists.
    - TEST-ONLY banner present.
    - Re-exports `OntologyRegistry` from `@fwornle/km-core/ontology`.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Write src/store/persistence.ts — PersistenceManager stub</name>
  <files>/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts:349 (call site)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-ingest.test.ts:46 (call site)
  </read_first>
  <action>
    Create `src/store/persistence.ts`. Constructor-only stub — tests never call public methods on it; SyncManager just holds the reference.

    ```typescript
    /**
     * Phase 43 D-G5.1 verification-gate shim — TEST-ONLY.
     * See src/store/graph-store.ts header for full rationale.
     *
     * The legacy PersistenceManager held LevelDB + export-file responsibilities
     * that are now owned by @fwornle/km-core's GraphKMStore. Tests construct
     * PersistenceManager but never call methods on it directly — it's only
     * passed to SyncManager, which now wraps a GraphKMStore that already
     * has persistence baked in. This stub is intentionally inert.
     */
    export class PersistenceManager {
      readonly dbPath: string;
      readonly exportDir: string;

      constructor(dbPath: string, exportDir: string) {
        this.dbPath = dbPath;
        this.exportDir = exportDir;
      }
    }
    ```

    YAGNI: do not add `persistGraph()`, `hydrate()`, `exportJson()`, `close()`, etc. unless a test grep proves they're called. Plan 08e's deletion sweep removed them; the absence here is by design.
  </action>
  <verify>
    <automated>test -f /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts &amp;&amp; grep -q 'TEST-ONLY' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts</automated>
  </verify>
  <done>persistence.ts stub authored; TEST-ONLY banner; constructor-only surface.</done>
  <acceptance_criteria>
    - File exists.
    - TEST-ONLY banner present.
    - No method beyond constructor: `grep -cE '^\s*(public|private|async)?\s*[a-z][A-Za-z]*\s*\(' src/store/persistence.ts` returns 1 (the constructor).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Write src/store/sync-manager.ts — SyncManager shim wrapping GraphKMStore</name>
  <files>/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/sync-manager.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts:340-420 (full SyncManager usage in test)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-ingest.test.ts:40-80 (initialize + shutdown calls)
  </read_first>
  <action>
    Create `src/store/sync-manager.ts`. Wrapping pattern: hold the GraphStore handle (which itself wraps GraphKMStore), delegate `initialize()`/`shutdown()` to it.

    ```typescript
    /**
     * Phase 43 D-G5.1 verification-gate shim — TEST-ONLY.
     * See src/store/graph-store.ts header for full rationale.
     *
     * Legacy SyncManager owned the in-memory ↔ persistent ↔ exported JSON
     * synchronization with a debounced exporter. Post-43-08e that role moved
     * inside @fwornle/km-core's GraphKMStore (constructor option debounceMs).
     * This shim thinly adapts the SyncManager constructor + lifecycle calls
     * (initialize/shutdown) to the GraphKMStore.open()/close() equivalent.
     */
    import type { GraphStore } from './graph-store.js';
    import type { PersistenceManager } from './persistence.js';

    export interface SyncManagerConfig {
      debounceMs?: number;
      dataDir?: string;
    }

    export class SyncManager {
      private store: GraphStore;
      private persistence: PersistenceManager;
      private config: SyncManagerConfig;

      constructor(store: GraphStore, persistence: PersistenceManager, config: SyncManagerConfig = {}) {
        this.store = store;
        this.persistence = persistence;
        this.config = config;
      }

      /** Wires mutation events. Tests call this but never read the emitted events directly — no-op is sufficient. */
      hookMutations(): void { /* km-core's GraphKMStore auto-emits; nothing to wire here. */ }

      /** Opens the underlying km-core store. */
      async initialize(): Promise<void> {
        const internal = this.store._internalStore();
        await internal.open();
        this.store._markOpen();
      }

      /** Legacy `flush()` was for the debounced exporter. km-core's debounceMs:0 in our test shim means writes are already synchronous; no-op is correct. */
      async flush(): Promise<void> { /* synchronous in test shim */ }

      /** Closes the underlying km-core store (flushes any pending exports + releases LevelDB). */
      async shutdown(): Promise<void> {
        const internal = this.store._internalStore();
        await internal.close();
      }

      /** Test convenience — never called by current suite, kept for parity. */
      async waitForPendingWrites(): Promise<void> { /* no-op */ }
      async waitForPendingExport(): Promise<void> { /* no-op */ }
    }
    ```

    Be sure the import path uses `./graph-store.js` and `./persistence.js` (NodeNext ESM with explicit `.js` suffix on TS-resolved sibling imports).
  </action>
  <verify>
    <automated>test -f /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/sync-manager.ts &amp;&amp; grep -q 'TEST-ONLY' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/sync-manager.ts &amp;&amp; grep -q "from './graph-store.js'" /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/sync-manager.ts</automated>
  </verify>
  <done>sync-manager.ts shim authored; TEST-ONLY banner; NodeNext sibling imports correct.</done>
  <acceptance_criteria>
    - File exists.
    - TEST-ONLY banner present.
    - Sibling imports use `.js` suffix (NodeNext): `grep -cE "from '\./(graph-store|persistence)\.js'" src/store/sync-manager.ts` returns 2.
    - Method surface matches consumer call sites — `hookMutations`, `initialize`, `flush`, `shutdown` present.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3b: Add TEST-ONLY overload to src/api/server.ts createServer</name>
  <files>/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts (current 7-arg signature)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts (find the 8-arg `createServer(graphStore, syncManager, ...)` call site — captures the legacy arg order)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/api-ingest.test.ts (same)
  </read_first>
  <action>
    Add a TEST-ONLY overload to `createServer`. Strategy: declare a second TypeScript overload signature accepting the pre-08e `(graphStore: GraphStore, syncManager: SyncManager, startupState, ontologyRegistry, pipeline?, llmService?, dataDir?, sourceDocStore?)` shape, then in the implementation body duck-type-detect (`if first arg has _internalStore method then it's legacy`) and unwrap to the production 7-arg path.

    Structure:
    ```typescript
    // Add near the top of server.ts:
    import type { GraphStore } from '../store/graph-store.js';
    import type { SyncManager } from '../store/sync-manager.js';

    // ... existing production signature stays as the implementation:
    export async function createServer(
      kmStoreOrLegacyGraphStore: GraphKMStore | GraphStore,
      arg2: StartupState | SyncManager,
      arg3: ...,
      ...rest: unknown[]
    ): Promise<Express>;

    /**
     * Phase 43 D-G5.1 TEST-ONLY overload — accepts the pre-08e
     * 8-arg `(graphStore, syncManager, startupState, ontologyRegistry,
     * pipeline?, llmService?, dataDir?, sourceDocStore?)` shape used by
     * rest-contract.test.ts and api-ingest.test.ts. Unwraps the GraphStore
     * shim via `_internalStore()` and forwards to the production path.
     * Production callers continue to use the GraphKMStore-first signature
     * unchanged — duck-type detection in the implementation body picks the
     * right path. DO NOT use this overload from production code.
     */
    export async function createServer(
      graphStore: GraphStore,
      syncManager: SyncManager,
      startupState: StartupState,
      ontologyRegistry: OntologyRegistry,
      pipeline: IngestionPipeline | undefined,
      llmService: LLMService | undefined,
      dataDir: string,
      sourceDocStore: SourceDocumentStore,
    ): Promise<Express>;
    ```

    Implementation body: detect via `typeof (firstArg as any)._internalStore === 'function'`; if true, extract `kmStore = firstArg._internalStore()`, ignore `syncManager` (km-core owns the persistence/export lifecycle now), and forward to the production path with the remaining args remapped. If false, the existing production path runs as today.

    Production-path tests in `api-test-helper.ts` MUST stay passing with no changes. Run them as part of Task 4 to confirm.
  </action>
  <verify>
    <automated>grep -q 'TEST-ONLY' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts &amp;&amp; grep -q '_internalStore' /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts</automated>
  </verify>
  <done>createServer overload added; duck-type unwraps legacy GraphStore; production callers unaffected.</done>
  <acceptance_criteria>
    - TEST-ONLY banner present in server.ts (new JSDoc on the overload).
    - `_internalStore` duck-type check present in implementation body.
    - tsc compiles clean (`npm run build` in Task 4 exit 0).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 4: Build + run the four legacy test files + the recorder</name>
  <files>(no source change — verification only)</files>
  <read_first>
    - /Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-08e-SUMMARY.md (baseline test count to compare monotone-non-decreasing)
  </read_first>
  <action>
    1. Build:
       ```
       cd /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
       npm run build 2>&1 | tee /tmp/43-10a-build.log
       ```
       Required: exit 0; all of `dist/store/{graph-store,persistence,sync-manager}.js`, `dist/llm/{index,llm-service}.js`, `dist/ontology/registry.js` exist; no TS compile errors. The TEST-ONLY `createServer` overload in `src/api/server.ts` also compiles.

    2. Run the four targeted legacy tests:
       ```
       npm test -- tests/integration/rest-contract.test.ts 2>&1 | tee /tmp/43-10a-rest-contract.log
       npm test -- tests/integration/api-ingest.test.ts 2>&1 | tee /tmp/43-10a-api-ingest.log
       npm test -- tests/integration/ingestion-pipeline.test.ts 2>&1 | tee /tmp/43-10a-ingestion-pipeline.log
       npm test -- tests/unit/deduplicator.test.ts 2>&1 | tee /tmp/43-10a-deduplicator.log
       ```
       Required: each exits 0. Capture pass counts.

       If a test fails for a reason genuinely outside shim scope (e.g., a hardcoded path that moved, an `src/llm/` import unrelated to `src/store/`), DOCUMENT the failure with a RULE 1 DEVIATION note in the SUMMARY rather than silently fixing. Shim scope is `src/store/` only.

    3. Recorder smoke (does the dist load + bootstrap reach the seeded state?):
       ```
       node --check scripts/record-rest-fixtures.mjs
       # If a --help or --dry-run flag exists, run that as the smoke. Otherwise
       # skip live recording (it would regenerate Plan 06 fixtures — out of scope).
       ```
       Required: `node --check` clean. (Plan 10 Task 2 owns the full re-record.)

    4. Whole-suite monotone check:
       ```
       npm test 2>&1 | tail -20 | tee /tmp/43-10a-fullsuite.log
       ```
       Required: total failure count ≤ 43-08e SUMMARY's baseline (13 pre-existing src/llm failures). The four files this plan targets should flip from FAIL → PASS; everything else stays as-is.
  </action>
  <verify>
    <automated>cd /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management &amp;&amp; npm run build 2>&amp;1 | tail -5 &amp;&amp; test -f dist/store/graph-store.js &amp;&amp; test -f dist/store/persistence.js &amp;&amp; test -f dist/store/sync-manager.js &amp;&amp; npm test -- tests/integration/rest-contract.test.ts 2>&amp;1 | tail -10 | grep -qE '(passed|✓)'</automated>
  </verify>
  <done>Build clean; dist/store/* present; four targeted tests green; whole suite monotone vs 43-08e baseline.</done>
  <acceptance_criteria>
    - Build: `npm run build` exits 0.
    - Dist files: `test -f dist/store/graph-store.js && test -f dist/store/persistence.js && test -f dist/store/sync-manager.js && test -f dist/llm/index.js && test -f dist/llm/llm-service.js && test -f dist/ontology/registry.js` exits 0.
    - rest-contract: `npm test -- tests/integration/rest-contract.test.ts` exits 0.
    - api-ingest: `npm test -- tests/integration/api-ingest.test.ts` exits 0.
    - ingestion-pipeline: `npm test -- tests/integration/ingestion-pipeline.test.ts` exits 0.
    - deduplicator: `npm test -- tests/unit/deduplicator.test.ts` exits 0.
    - Whole suite: failure count ≤ 13 (43-08e baseline).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 5: Commit + outer pointer bump</name>
  <files>OKM repo and rapid-automations outer-repo gitlink</files>
  <action>
    Commit topology — `src/store/` is a real subdir (per Phase 42.2-04 + 43-08e precedent).

    1. OKM submodule commit (branch: `refactor/43-08e-delete-adapter`, where the recent OKM work lives — confirm with `git -C ... branch --show-current` first):
       ```
       cd /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
       git add src/store/graph-store.ts src/store/persistence.ts src/store/sync-manager.ts \
               src/llm/index.ts src/llm/llm-service.ts \
               src/ontology/registry.ts \
               src/api/server.ts
       git status                          # confirm scope; ONLY the 7 files above (no dist/, no test/, no node_modules)
       git commit -m "$(cat <<'EOF'
test(store+llm+ontology+server): restore TEST-ONLY shims delegating to km-core (Phase 43 Plan 10a)

Plan 08e deleted src/store/{graph-store, persistence, sync-manager}.ts
when retiring IGraphStore. Plan 08e SUMMARY line 159 noted this as a
deferred "test suite restore" follow-up. This plan is that follow-up.

The shims are minimal pass-throughs to @fwornle/km-core's GraphKMStore
(and re-exports for LLMService + OntologyRegistry):

  src/store/graph-store.ts  — legacy 6 methods + km-core delegations
                              so the shim duck-types as GraphKMStore
                              (consumers pass it to IngestionPipeline,
                              EntityDeduplicator, createServer).
  src/store/persistence.ts  — constructor-only stub.
  src/store/sync-manager.ts — wraps GraphStore; initialize/shutdown
                              open/close the underlying km-core store.
  src/llm/index.ts          — one-line re-export of LLMService from
                              @rapid/llm-proxy.
  src/llm/llm-service.ts    — same, deeper path.
  src/ontology/registry.ts  — one-line re-export of OntologyRegistry
                              from @fwornle/km-core/ontology.
  src/api/server.ts         — added TEST-ONLY overload of createServer
                              accepting pre-08e 8-arg (graphStore,
                              syncManager, ...) shape; duck-type
                              detection unwraps to the production
                              kmStore path. Production callers
                              unaffected.

Every TEST-ONLY surface carries a JSDoc banner. Production code paths
go through km-core directly via src/api/routes.ts. NOT for production
use.

Unblocks Plan 43-10 Gates 1 (rest-contract.test.ts) + 2 (verify-post-
migration.mjs via the same dist/ bootstrap path as the recorder).

Scope amendment: original plan undersized the surface to src/store/ only;
first executor pass surfaced the broader test imports + signature drift.
Plan amended in-place before execution.
EOF
)"
       ```

    2. Outer rapid-automations gitlink bump on `main`:
       ```
       cd /Users/Q284340/Agentic/_work/rapid-automations
       git add integrations/operational-knowledge-management
       git commit -m "chore: bump OKM submodule — Phase 43 Plan 10a (TEST-ONLY src/store/ shims)"
       ```

    3. Capture both SHAs for the SUMMARY. **DO NOT push** — Plan 11 owns pushes.
  </action>
  <verify>
    <automated>git -C /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management log -1 --format=%s | grep -q '10a' &amp;&amp; git -C /Users/Q284340/Agentic/_work/rapid-automations log -1 --format=%s | grep -q '10a'</automated>
  </verify>
  <done>OKM submodule commit + outer pointer bump landed; pushes deferred to Plan 11.</done>
  <acceptance_criteria>
    - Inner commit subject matches `10a`.
    - Outer commit subject matches `10a`.
    - Working tree clean inside both repos after commits (modulo unrelated artifacts that pre-existed).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 6: SUMMARY + STATE/ROADMAP update</name>
  <files>/Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-10a-SUMMARY.md, /Users/Q284340/Agentic/coding/.planning/STATE.md, /Users/Q284340/Agentic/coding/.planning/ROADMAP.md</files>
  <action>
    1. Write `.planning/phases/43-okm-cross-repo-migration-c/43-10a-SUMMARY.md` per the template — record shim line counts, dist build, test verdicts (per-file pass counts), whole-suite failure delta vs 43-08e baseline, both commit SHAs, any Rule 1 deviations.

    2. STATE.md update: bump `last_updated`, `last_activity`, point `Current Position` at Plan 43-10 (resumed); update `progress.completed_plans` (+1 for 10a).

    3. ROADMAP.md update: add a `[x] 43-10a-PLAN.md — TEST-ONLY src/store/ shims restored, unblocks Gates 1+2` line under Phase 43.

    4. Commit (planning docs only, inside `/Users/Q284340/Agentic/coding`):
       ```
       cd /Users/Q284340/Agentic/coding
       git add .planning/phases/43-okm-cross-repo-migration-c/43-10a-SUMMARY.md .planning/STATE.md .planning/ROADMAP.md
       git commit -m "docs(43-10a): TEST-ONLY src/store/ shims restored; Plan 10 Gates 1+2 unblocked"
       ```
  </action>
  <verify>
    <automated>test -f /Users/Q284340/Agentic/coding/.planning/phases/43-okm-cross-repo-migration-c/43-10a-SUMMARY.md &amp;&amp; git -C /Users/Q284340/Agentic/coding log -1 --format=%s | grep -q '10a'</automated>
  </verify>
  <done>SUMMARY + STATE + ROADMAP committed in coding repo.</done>
  <acceptance_criteria>
    - SUMMARY exists.
    - Coding commit subject matches `10a`.
  </acceptance_criteria>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TEST-ONLY shims ⇄ production code | JSDoc banner explicitly disclaims production use; D-G6.2 in-place fix preserved (no parallel `legacy-store/` tree) |
| Shim surface ⇄ consumer expectations | Surface is enumerated from current call sites; YAGNI guard prevents bloat |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-43-10a-01 | Elevation of Privilege | shim accidentally imported by production code | mitigate | JSDoc TEST-ONLY banner + grep gate in Plan 43-11 close-out (`grep -r "from './store/graph-store'" src/api src/ingestion` should return 0 hits — production uses km-core directly). |
| T-43-10a-02 | Tampering | shim drifts from km-core API | mitigate | `npm run build` + `tsc --noEmit` already catches drift at compile time. Plan 43-10a Task 4 acceptance gate enforces. |
| T-43-10a-03 | Repudiation | future engineer wonders why these files exist | mitigate | Banner comment links to Plan 08e SUMMARY line 159 + this plan's objective. |
</threat_model>

<verification>
- Three shim files exist with TEST-ONLY banners.
- `npm run build` clean; `dist/store/*.js` present.
- Four targeted legacy tests pass.
- Whole-suite failure count ≤ 43-08e baseline (no NEW regressions).
- OKM submodule commit + outer pointer bump + planning-docs commit all landed.
- Plan 43-10 Gates 1 + 2 unblocked.
</verification>

<success_criteria>
1. The four legacy test files green (`rest-contract`, `api-ingest`, `ingestion-pipeline`, `deduplicator`).
2. Shims carry TEST-ONLY banners and stay within enumerated surface.
3. Commit topology matches Phase 42.2-04 / 43-08e precedent (submodule + outer bump).
4. Plan 43-10 Gate 1 + Gate 2 ready to re-run against the rebuilt OKM.
</success_criteria>

<output>
Create `.planning/phases/43-okm-cross-repo-migration-c/43-10a-SUMMARY.md` when done.
</output>

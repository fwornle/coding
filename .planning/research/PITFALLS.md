# Pitfalls Research

**Domain:** Hierarchical Knowledge Graph Restructuring (flat-to-tree migration on Graphology + LevelDB)
**Researched:** 2026-03-01
**Confidence:** HIGH — based on direct codebase inspection of all affected layers

---

## Critical Pitfalls

### Pitfall 1: KGEntity/SharedMemoryEntity Field Disconnect Breaks Hierarchy Fields

**What goes wrong:**
`KGEntity` (kg-operators.ts:31) has `type` but not `entityType` or `metadata`. `SharedMemoryEntity` (persistence-agent.ts) has `entityType` and `metadata`. When hierarchy fields (`parentId`, `level`, `hierarchyPath`) are added to one interface but not the other, they silently vanish as entities flow through the pipeline. The coordinator already casts `entity as KGEntity` to bridge the existing disconnect — this cast strips any fields not in `KGEntity` at the TypeScript type level, though they survive at runtime as long as no explicit pick/filter operation runs. This exact pattern caused the entityType loss bug in v1.0: entities arrived at persistence as "Unclassified" despite being classified earlier, because only `entity.type` was updated but not `entity.entityType`.

**Why it happens:**
The coordinator uses `const updated: any = { ...entity }` then `return updated as KGEntity` (line 3118). This is a widening cast TypeScript does not verify. Fields present on the concrete object but absent from `KGEntity` survive at runtime — but any typed assignment downstream that destructures only `KGEntity` fields will silently discard them. If `persistEntities()` parameter type is not extended to include `parentId`, TypeScript infers the parameter does not carry it, and developers reading the code will assume it is absent.

**How to avoid:**
Update ALL interfaces in a single commit: `KGEntity` in kg-operators.ts, `SharedMemoryEntity` in persistence-agent.ts, the `persistEntities()` parameter type, `GraphEntity` in graph-database-adapter.ts. Write a TypeScript integration test that passes a `KGEntity` with `parentId` through the coordinator transform, then calls `persistEntities()`, then calls `graphDB.getEntity()` and asserts `parentId` is present on the returned node.

**Warning signs:**
- `parentId` appears in coordinator debug logs but is absent from `getEntity()` output
- No TypeScript errors after interface change — suspicious if no test exercises the full chain
- `storeEntity()` attributes spread in GraphDatabaseService.js does not log `parentId`

**Phase to address:**
Phase 1 (Schema Definition) — before any pipeline or migration code is written.

---

### Pitfall 2: Migration Leaves LevelDB and JSON Export Out of Sync

**What goes wrong:**
The system has two storage representations: Graphology in-memory graph persisted to LevelDB, and a JSON export file (`.data/knowledge-export/coding.json`) maintained by `GraphKnowledgeExporter` via events. A migration script that runs while the VKB server is up will route writes through the VKB API (`createEntity()`). A script that runs while the server is down must use `GraphDatabaseService` directly AND attach `GraphKnowledgeExporter` manually — if this attachment is skipped, LevelDB is updated but the JSON export stays stale. The VKB viewer at the next startup will load from LevelDB (correct) but the JSON export will show the pre-migration state (incorrect), causing confusion about whether migration succeeded.

**Why it happens:**
`GraphDatabaseAdapter.initialize()` conditionally attaches `GraphKnowledgeExporter` with the comment "CRITICAL: Attach GraphKnowledgeExporter to maintain JSON sync" — this was already a production bug. The conditional logic is: if VKB API is available, use API mode (JSON export handled server-side); if not, attach the exporter manually. A migration script that instantiates `GraphDatabaseService` directly, bypassing the adapter, will never attach the exporter.

**How to avoid:**
Always use `GraphDatabaseAdapter` (not raw `GraphDatabaseService`) in migration scripts. Stop the VKB server before running migration to force direct-access mode, which will attach the exporter. After migration, verify: `python3 -c "import json; d=json.load(open('.data/knowledge-export/coding.json')); print(len(d['entities']))"` should include the new component nodes.

**Warning signs:**
- `coding.json` entity count is 126 after migration that should produce 136 (126 + ~10 component nodes)
- VKB UI shows correct hierarchy after server restart but JSON export lacks parent nodes
- Log output of migration script is missing "GraphKnowledgeExporter attached for JSON sync"

**Phase to address:**
Phase 2 (Migration) — in the migration script's initialization and post-migration verification steps.

---

### Pitfall 3: Dedup Operator Collapses Parent Nodes on Subsequent Pipeline Runs

**What goes wrong:**
`KGOperators.deduplication()` normalizes names with `entity.name.toLowerCase().replace(/[^a-z0-9]/g, '')`. On the first pipeline run after migration, the pipeline creates a new "KnowledgeManagement" entity. Dedup sees an existing "KnowledgeManagement" node (the migrated component node) and merges them via `mergeEntities()`. The `mergeEntities()` method uses `...existing` as base then overwrites with select fields from `incoming`. If the new pipeline entity does not carry `parentId` (because the hierarchy assignment LLM step was skipped for this batch), the merged result gets `parentId: undefined` from incoming, overwriting the component node's `parentId`. After the pipeline run, the component node is orphaned.

**Why it happens:**
`mergeEntities()` in kg-operators.ts merges with `...existing` spread then overwrites `type`, `significance`, `role`, `embedding`, `observations`, `references`, `enrichedContext`, `timestamp`. It does not explicitly handle hierarchy fields — they will survive via the `...existing` spread IF incoming does not also have them set. But if incoming has `parentId: undefined` (present but undefined), the spread will overwrite with undefined.

**How to avoid:**
Add explicit preservation in `mergeEntities()`:
```typescript
parentId: incoming.parentId ?? existing.parentId,
level: incoming.level ?? existing.level,
hierarchyPath: incoming.hierarchyPath ?? existing.hierarchyPath,
```
This is a 3-line targeted fix. Alternatively, protect component nodes with the `PROTECTED_ENTITY_TYPES` map in persistence-agent.ts, which prevents re-classification but not re-merging — also add a `PROTECTED_FROM_MERGE` check in the dedup operator for nodes with `entityType === 'Component'`.

**Warning signs:**
- Component nodes have correct `parentId` after migration but `parentId` is absent after next `ukb full`
- Graph has 10 component nodes before pipeline run but 9 after (one was merged with a leaf)
- Coordinator log shows dedup merging a component-named entity

**Phase to address:**
Phase 3 (Pipeline Hierarchy Support) — when `mergeEntities()` is modified to carry hierarchy fields.

---

### Pitfall 4: LLM Hierarchy Assignment Misclassifies Entities by Name Pattern

**What goes wrong:**
When asking an LLM "Which component does this entity belong to: LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, or KnowledgeManagement?", the LLM pattern-matches on surface keywords rather than semantic content. Entities with "Docker" or "container" in their name get placed under DockerizedServices even if the entity is actually about debugging workflow in a containerized environment (which belongs under Trajectory). Entities with "pattern" in their name may land under CodingPatterns regardless of domain. With 126 entities and ~5-7 target components, expect ~20-30% misclassification with a naive LLM prompt.

**Why it happens:**
The existing ontology classification step has the same problem — it uses LLM for entities that heuristics can't classify. For the new hierarchy step, the LLM has even less signal because component names are project-specific and not in its training data. The LLM cannot infer that "LiveLoggingSystem" is specifically about the LSL session logging feature without a clear description.

**How to avoid:**
Build a keyword heuristic first: `lsl`, `session`, `live log`, `hook` → LiveLoggingSystem; `llm`, `anthropic`, `model`, `embedding`, `token` → LLMAbstraction; `docker`, `compose`, `container`, `port` → DockerizedServices; `trajectory`, `planning`, `roadmap`, `gsd` → Trajectory; `knowledge`, `ukb`, `entity`, `graph`, `vkb` → KnowledgeManagement. Only call LLM for entities that match no heuristic keyword. Include component descriptions (not just names) in the LLM prompt. After first run, manually audit 20% sample and feed corrections back as few-shot examples.

**Warning signs:**
- One component has 3x more children than expected
- Entities clearly about LLM calls appear under DockerizedServices
- Component assignment changes between pipeline runs for the same entity name

**Phase to address:**
Phase 3 (Pipeline Hierarchy Support) — when the hierarchy assignment logic is built.

---

### Pitfall 5: TypeScript Strict Mode Does Not Catch Field Loss Through JSON Template Parameters

**What goes wrong:**
Workflow steps communicate via template parameters: `"entities": "{{accumulatedKG.entities}}"`. These are resolved at runtime by the coordinator, not at compile time. TypeScript cannot verify that a field added to `KGEntity` is actually present in the resolved `accumulatedKG.entities` value. Additionally, the `persistEntities()` method's typed parameter `entities: Array<{ name: string; entityType: string; observations: string[]; significance: number }>` does not include `parentId`. TypeScript does not reject callers that pass objects with extra fields (structural typing allows this). The field is present in the object passed at runtime but is silently ignored by `processEntity()` when it builds the `SharedMemoryEntity`, because `SharedMemoryEntity` construction in `processEntity` is an explicit object literal that picks only the fields it knows about.

**Why it happens:**
Look at the explicit `SharedMemoryEntity` construction in `persistEntities` → `processEntity`:
```typescript
const sharedMemoryEntity: SharedMemoryEntity = {
  id: ..., name: entity.name, entityType: entity.entityType,
  significance: entity.significance || 5, observations: [...], relationships: [], metadata: {...}
};
```
`parentId` is not in this object literal. Even if `entity.parentId` exists, it is never copied to `sharedMemoryEntity`. This is not a type error — it is a silent omission.

**How to avoid:**
The explicit construction in `processEntity` must be updated to spread or explicitly copy hierarchy fields: `parentId: (entity as any).parentId`. Better: update `SharedMemoryEntity` to include hierarchy fields and update the explicit object literal. Write a test that calls `persistEntities()` with an entity that has `parentId: 'coding:KnowledgeManagement'` and then calls `getEntity()` to verify `parentId` is stored.

**Warning signs:**
- `parentId` present in `accumulatedKG.entities[0]` (visible in coordinator logs) but absent in `storeEntityToGraph()` call logs
- After persistence, `graphDB.getEntity(name, team)` returns node without `parentId` attribute
- The explicit object literal in `processEntity` does not include `parentId` after interface update

**Phase to address:**
Phase 1 (Schema Definition) — update the explicit construction at the same time as the interface.

---

### Pitfall 6: Migration Reintroduces Bold Formatting Stripped in v1.0

**What goes wrong:**
The v1.0 bold-stripping fix (2026-03-01) applied `**` removal to 102 existing entities via PUT API calls, updating LevelDB. However, `.data/knowledge-export/coding.json` was last modified at `2026-03-01T09:32:04`. If the JSON export was not regenerated after the bold-strip fix, it contains the old bolded observations. A migration script that reads from `coding.json` as its source of truth will reintroduce `**` formatting into the migrated entities, undoing the v1.0 fix.

**Why it happens:**
The JSON export is driven by `GraphKnowledgeExporter` events. If the VKB PUT API calls that stripped bold formatting triggered `entity:stored` events, the export should be current. But if the server was down during the strip operation (direct LevelDB writes), the export may be stale. The migration timestamp and the bold-strip timestamp are the same day (2026-03-01), creating ambiguity about which happened first.

**How to avoid:**
Before migration, verify the export is current: check `coding.json` entities for `**` strings with `grep -c '\*\*' .data/knowledge-export/coding.json`. If count > 0, regenerate the export from LevelDB before using it as migration source. Alternatively, read migration source directly from LevelDB via `graphDB.queryEntities()`, not from the JSON file.

**Warning signs:**
- `grep '\*\*' .data/knowledge-export/coding.json` returns matches
- Post-migration VKB shows `**bold**` text in observation panels
- `coding.json` `last_modified` on entities is earlier than 2026-03-01T09:32:04

**Phase to address:**
Phase 2 (Migration) — in the pre-migration data validation step.

---

### Pitfall 7: VKB D3 Force Layout Collapses When Hierarchy Edges Are Added

**What goes wrong:**
`GraphVisualization.tsx` renders a D3 force-directed simulation. Currently there are 0 explicit relations in the graph. Adding `contains` edges from 10 component nodes to their respective ~12 children each creates 120+ edges in a graph with ~136 nodes. D3 force layout treats all edges as attractive springs — hierarchy edges pull parents toward all their children simultaneously, causing the layout to collapse into dense hub-and-spoke clusters. The simulation may not stabilize, causing continuous movement in the UI.

**Why it happens:**
D3 force-directed layout is designed for peer-relation graphs. It does not have built-in support for hierarchical containment semantics. The current VKB codebase has no edge-type filtering in the force simulation — all edges from `queryRelations()` are fed into `transformToD3Format()` and included in the simulation.

**How to avoid:**
Add a view toggle in VKB: "Tree View" uses `d3.hierarchy()` with collapsible nodes, "Graph View" uses the existing force layout with hierarchy edges filtered out. For the tree view, build the hierarchy from `parentId` attributes on entities (not from relation edges) to avoid a separate API call. Filter `contains` edge type from the force simulation's link force. This requires changes to `graphHelpers.ts`'s `getRelationsForEntities()` to accept an excluded-types parameter.

**Warning signs:**
- After adding hierarchy edges, VKB graph view shows tight clusters with no visible connections between clusters
- D3 simulation takes >3 seconds to stabilize or never stabilizes
- Component nodes are invisible (hidden behind leaf nodes due to force attraction)

**Phase to address:**
Phase 4 (VKB Tree Navigation) — when hierarchy edges are first rendered in VKB.

---

### Pitfall 8: Docker Build Forgotten After TypeScript Interface Changes

**What goes wrong:**
All TypeScript changes to `integrations/mcp-server-semantic-analysis/src/**` require two steps: `npm run build` inside the submodule, then `docker-compose build coding-services && docker-compose up -d coding-services`. Forgetting step 2 means the Docker container runs the old `dist/` while the source has the new hierarchy logic. The pipeline will run without errors — entities will be produced — but they will have no `parentId` because the old code does not set it. This is the most common recurring failure mode documented in CLAUDE.md and MEMORY.md.

**Why it happens:**
The container build copies `dist/` at image build time. Changes to TypeScript source only update the local `dist/` via `npm run build`, but the container keeps its own copy. There is no hot-reload for production containers. The container health endpoint at http://localhost:3033 shows "healthy" regardless of whether the code version matches.

**How to avoid:**
After ANY TypeScript change to the submodule:
```bash
cd integrations/mcp-server-semantic-analysis && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```
Add a build timestamp to the startup log or health endpoint so the container version is visible. Make "verify Docker is running new code" the first item in every phase's verification checklist.

**Warning signs:**
- `dist/agents/kg-operators.js` `mtime` is earlier than `src/agents/kg-operators.ts` `mtime`
- Pipeline runs cleanly but produces flat entities with no hierarchy fields
- Container shows "healthy" but pipeline behavior matches pre-change code

**Phase to address:**
Every phase. Make it step 1 of each phase's completion checklist.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hard-code L2 component list in config YAML | Avoids LLM discovery call | New components from future pipeline runs never appear; list becomes stale after a month | MVP only — plan discovery mechanism for v2.1 |
| Store `parentId` as a nested field inside `EntityMetadata` | No interface changes to KGEntity needed | `parentId` buried in `metadata.parentId`, not directly queryable; VKB must dig into metadata for every entity; dedup cannot easily preserve it | Never — makes hierarchy second-class |
| Use existing `related_to` edge type for parent-child relations | No graph schema changes | Parent-child and semantic relations are indistinguishable; cannot filter hierarchy edges for tree vs. graph view | Never — use a dedicated `contains` relation type |
| Run migration with VKB server running (API mode) | Simpler — no server stop/start | Each entity triggers ontology re-classification: ~5-10s × 126 entities = 10-21 minutes vs. ~30s direct | Never for production migration |
| Skip migrating low-significance flat entities | Faster migration, less noise | Mixed flat/hierarchical graph; VKB tree must handle parentless entities; dedup treats them as peers of component nodes | Acceptable if orphan entities are tagged as "legacy-flat" and VKB handles them gracefully |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `GraphDatabaseService.storeEntity()` | Assuming extra fields on the entity object are ignored | `storeEntity()` uses `...entityWithoutRelationships` spread — extra fields ARE stored as node attributes. Verify with `graph.getNodeAttributes(nodeId)`. |
| `queryEntities()` return shape | Expecting `entity.name` and `entity.entityType` (camelCase) | `queryEntities()` returns `entity_name` and `entity_type` (snake_case) for SQL compatibility. VKB `DatabaseClient.Entity` uses snake_case. Internal node attributes use camelCase. Do not mix them. |
| `PROTECTED_ENTITY_TYPES` in persistence-agent.ts | Assuming new component nodes are auto-protected | Only `'Coding'` and `'CollectiveKnowledge'` are currently protected. New component nodes will be re-classified by the ontology step unless explicitly added to `PROTECTED_ENTITY_TYPES` OR given valid pre-classification metadata that makes `hasValidPreClassification()` return true. |
| Hierarchy edge storage | Calling `storeRelationship(parent, child, 'related_to')` | Use `'contains'` or `'has-child'` as relation type. `queryRelations({ relationType: 'contains' })` is the only way to retrieve hierarchy edges specifically. |
| GraphDatabaseAdapter dual-mode | Writing via adapter when VKB server is up, assuming direct-mode behavior | In API mode, writes go to VKB server which handles JSON export. In direct mode, migration script must verify `GraphKnowledgeExporter` is attached. Check adapter's `useApi` flag in logs. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all entities without pagination in migration | OOM or hang on `getAllEntities()` | Use `queryEntities({ limit: 50, offset: N })` in batches | At ~500+ entities |
| Edge prediction runs over hierarchy edges | Adamic-Adar inflated for all entities under same parent; false high-confidence sibling edges | Filter `source: 'explicit'` hierarchy edges from the edge prediction loop — or mark hierarchy edges with a flag that excludes them from AA scoring | Immediately after adding hierarchy edges |
| Generating embeddings for new component nodes with no observations | Low-quality embeddings waste compute; component nodes pulled toward unrelated entities in embedding space | Do not call `nodeEmbedding()` on nodes with 0 observations; set `embedding: undefined` and skip them | Immediately on first pipeline run post-migration |

---

## "Looks Done But Isn't" Checklist

- [ ] **KGEntity interface extended:** `parentId` exists in KGEntity, SharedMemoryEntity, `persistEntities()` parameter, and GraphEntity (adapter) — all four.
- [ ] **`processEntity()` construction updated:** The explicit `SharedMemoryEntity` object literal in `persistEntities` copies `parentId` from the incoming entity.
- [ ] **Migration entity count verified:** `python3 -c "import json; d=json.load(open('.data/knowledge-export/coding.json')); print(len(d['entities']))"` shows 136+ (126 + component nodes).
- [ ] **Parent edges exist:** `queryRelations({ team: 'coding', relationType: 'contains' })` returns > 0 results. Current graph has 0 relations — if still 0 after migration, hierarchy edges were not created.
- [ ] **Docker rebuilt:** `stat dist/agents/kg-operators.js` mtime is AFTER `stat src/agents/kg-operators.ts` mtime.
- [ ] **Bold formatting absent:** `grep -c '\*\*' .data/knowledge-export/coding.json` returns 0.
- [ ] **Pipeline preserves hierarchy on second run:** After `ukb full`, component nodes still have `level` and `parentId`. Run twice to confirm dedup does not strip them.
- [ ] **PROTECTED_ENTITY_TYPES updated:** All L2 component names added so ontology step does not re-classify them.
- [ ] **VKB handles parentless entities:** Legacy-flat entities with no `parentId` render under "Uncategorized" in tree view, not as errors.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| LevelDB and JSON export out of sync | LOW | Stop VKB; call `graphDB.exportToJSON('coding', '.data/knowledge-export/coding.json')`; restart VKB |
| Migration run twice (duplicate component nodes) | MEDIUM | `node scripts/purge-knowledge-entities.js --dry-run` to identify duplicates; delete by name; re-run migration with idempotency check |
| `parentId` stripped after pipeline run | MEDIUM | Find which step drops the field via coordinator debug logs; fix `mergeEntities()` or type mapping; re-run pipeline |
| Docker running stale code | LOW | `cd docker && docker-compose build coding-services && docker-compose up -d coding-services` |
| D3 layout broken by hierarchy edges | LOW | Add edge type filter to force simulation — exclude `contains` edges from D3 link force |
| Wrong component assignment (>30% misclassified) | HIGH | Manual re-assignment via VKB PUT API; improve keyword heuristic; update LLM prompt with component descriptions and few-shot examples; re-run pipeline |
| Bold formatting reintroduced | LOW | Re-run bold-strip script via PUT API; regenerate JSON export |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| KGEntity/SharedMemoryEntity field disconnect | Phase 1 (Schema) | TypeScript compiles with `--strict`; integration test: parentId round-trips through full pipeline |
| `processEntity()` silently drops parentId | Phase 1 (Schema) | `getEntity()` after `persistEntities()` returns node with `parentId` attribute |
| LevelDB/JSON export out of sync | Phase 2 (Migration) | Entity counts match in JSON export and `getStatistics()` API |
| Bold formatting reintroduced | Phase 2 (Migration) | `grep -c '\*\*' .data/knowledge-export/coding.json` returns 0 |
| Dedup collapses parent nodes | Phase 3 (Pipeline) | After second pipeline run, component nodes retain `level` and `parentId` |
| LLM hierarchy misclassification | Phase 3 (Pipeline) | Manual 20-entity audit; no component has >3x the entities of another |
| PROTECTED_ENTITY_TYPES not updated | Phase 3 (Pipeline) | After `ukb full`, component nodes retain `entityType: 'Component'` |
| D3 layout breaks with hierarchy edges | Phase 4 (VKB) | Tree view renders; graph view hides hierarchy edges; no force simulation collapse |
| Docker build forgotten | Every phase | `dist/` mtime > `src/` mtime; first item in each phase completion checklist |

---

## Sources

- Direct inspection: `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` — KGEntity interface (line 31), mergeEntities(), deduplication()
- Direct inspection: `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` — SharedMemoryEntity, persistEntities(), processEntity() explicit construction, storeEntityToGraph(), PROTECTED_ENTITY_TYPES
- Direct inspection: `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` — entityType/type fix at lines 3102-3118, `as KGEntity` cast pattern, template parameter wiring
- Direct inspection: `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` — dual-mode routing, GraphKnowledgeExporter attachment (direct-mode only)
- Direct inspection: `integrations/mcp-server-semantic-analysis/src/knowledge-management/GraphDatabaseService.js` — storeEntity() attribute spread, queryEntities() snake_case return shape, hierarchy edge auto-creation for Project nodes
- Direct inspection: `integrations/memory-visualizer/src/api/databaseClient.ts` — Entity interface with snake_case fields
- Direct inspection: `integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx` — D3 force layout, no edge-type filtering
- Direct inspection: `.data/knowledge-export/coding.json` — 126 entities, 0 relations, export schema uses entity_name/entity_type
- MEMORY.md: Bold-stripping fix 2026-03-01, entityType/type disconnect fix 2026-03-01
- CLAUDE.md: Docker submodule rebuild requirement (recurring issue)

---
*Pitfalls research for: Hierarchical Knowledge Graph Restructuring (flat-to-tree on Graphology + LevelDB)*
*Researched: 2026-03-01*
*Confidence: HIGH — all pitfalls derived from direct code inspection; no WebSearch-only claims*

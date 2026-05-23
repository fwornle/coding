# Phase 42: Offline UKB Migration (B) — Research

**Status:** COMPLETE
**Researched:** 2026-05-23
**Locked decisions:** See 42-CONTEXT.md (D-51..D-54b). This document is FACTS only — do not re-debate decisions.

---

## Section 1: Phase 10 fix shape

### The actual write path (factual trace)

Wave-controller drives two writes per wave; understanding both is essential.

#### Path A — Bypass write (BROKEN — this is the Phase 10 bug)

`wave-controller.ts:1351–1411` runs the KG operators (conv -> aggr -> embed -> dedup -> pred -> merge) and then attempts a direct graph write:

```typescript
// wave-controller.ts:1356–1386
// Bypass the 7-layer persist pipeline — write embedding/role/enrichedContext
// directly to existing graph nodes via graphDB.mergeNodeAttributes()
for (const entity of currentEntities) {
  const enrichedAttrs: Record<string, any> = {};
  if (entity.embedding && entity.embedding.length > 0) enrichedAttrs.embedding = entity.embedding;
  if (entity.role) enrichedAttrs.role = entity.role;
  if (entity.enrichedContext) enrichedAttrs.enrichedContext = entity.enrichedContext;

  if (Object.keys(enrichedAttrs).length > 0) {
    try {
      const nodeId = `${this.team}:${entity.name}`;
      await this.graphDB.mergeAttributes(nodeId, enrichedAttrs);   // BUG: method does not exist
      directWriteSuccess++;
    } catch (e) {
      directWriteFail++;
      log('[WaveController] Direct graph write failed for entity (will try via persist)', 'debug', ...);
    }
  }
}
```

**The bug:** `graphDB.mergeAttributes(nodeId, enrichedAttrs)` is called at `wave-controller.ts:1373`, but **no such method exists on `GraphDatabaseService.js`**. Verified by `grep -n "mergeAttributes\|mergeNodeAttributes" GraphDatabaseService.js` — only matches in the comment and a local `const mergedAttributes` (line 262). The call throws synchronously, the catch logs at **`debug` level** (invisible in normal logs), and `directWriteFail` increments silently.

The summary log at line 1384 then says `success: 0, failed: N` — which is what the user is seeing as "0 embeddings stored".

#### Path B — Re-persist via persistEntities (DOES write embedding correctly... in theory)

Immediately after the failed bypass, wave-controller falls through to a re-persist (`wave-controller.ts:1388–1410`) which calls `this.persistWaveResult(refinedWaveResult)`, eventually reaching `persistenceAgent.persistEntities` at `wave-controller.ts:2107–2124`:

```typescript
await persistenceAgent.persistEntities({
  entities: qualityFilteredEntities.map(e => ({
    name: e.name,
    entityType: e.entityType,
    observations: e.observations.map(obs => typeof obs === 'string' ? obs : obs.content),
    significance: e.significance,
    metadata: e.metadata,
    parentId: e.parentEntityName,
    level: e.hierarchyLevel,
    ...((e as any).embedding ? { embedding: (e as any).embedding } : {}),   // embedding included
    ...((e as any).role ? { role: (e as any).role } : {}),
    ...((e as any).enrichedContext ? { enrichedContext: (e as any).enrichedContext } : {}),
  })),
  team: this.team,
});
```

This path threads embedding through `persistEntities -> storeEntityToGraph -> graphDB.storeEntity`:

- `persistence-agent.ts:3621` — copies `embedding` onto `sharedMemoryEntity` before `storeEntityToGraph`.
- `persistence-agent.ts:1606` — `storeEntityToGraph` includes `embedding` in `graphEntity` passed to `graphDB.storeEntity`.
- `GraphDatabaseService.js:220–229` — `storeEntity` builds `attributes` with `...entityWithoutRelationships` (which DOES include `embedding`) and calls `this.graph.addNode(nodeId, attributes)` (line 272) or `replaceNodeAttributes` (line 269).

**So the re-persist path SHOULD work.** Why does it fail in practice? **Empirical confirmation in Section 4:** of 727 entities in production `.data/exports/coding.json`, ZERO have an embedding. The bug is real and reproduced in stored data.

#### Two specific code paths that drop embedding (verify both during planning)

1. **Update-path early exit.** `GraphDatabaseService.js:255–258`: when `_hasContentChanged` returns false (compared against existing attributes minus timestamps), the method returns `nodeId` without writing. `embedding` is a 384-float array. The content-change check at line 360 iterates `contentFields`. Action for planning: confirm whether `embedding` is in that field list by reading lines 334–399. If it is excluded, a previously-stored entity gets its body update skipped, and the embedding never lands.

2. **Update-path enriched-fields branch.** `persistence-agent.ts:3543–3566` has a separate `enrichedFields` write that DOES include embedding. The surrounding code path queries `graphDB.queryEntities` and reconstructs the entity via spread — if the queryEntities return shape omits any field, the embedding write here also drops silently.

### The Phase 10 fix shape (per D-52b)

Per D-52b: "The 7-layer persist pipeline collapses to direct `graph.mergeNodeAttributes()` after the embedding-operator runs."

The fix has two parts:

**Part 1 — Make the bypass write actually work.** Replace the broken `mergeAttributes` call with a direct Graphology API call. The km-core `GraphKMStore` adapter (built in Plan 1) exposes the underlying graph; the planner needs to thread embedding writes through it.

Minimum-viable direct call shape (against `GraphKMStore` from km-core):

```typescript
// In wave-controller.ts (after KG operators run), via the km-core adapter:
import { GraphKMStore } from '@fwornle/km-core/store';

const store: GraphKMStore = /* injected by Plan 1 strangler adapter */;

for (const entity of currentEntities) {
  if (!entity.embedding || entity.embedding.length === 0) continue;
  await store.mergeAttributes(`${this.team}:${entity.name}`, {
    embedding: entity.embedding,
    role: entity.role,
    enrichedContext: entity.enrichedContext,
  });
}
```

The km-core surface to confirm during Plan 1: does `GraphKMStore` expose a `mergeAttributes` (or equivalent) atomic primitive? If not, Plan 1 adds one — a one-liner over Graphology's `mergeNodeAttributes()`:

```typescript
// In GraphKMStore.ts (km-core, Plan 1 addition):
async mergeAttributes(nodeId: string, attrs: Record<string, unknown>): Promise<void> {
  if (!this.graph.hasNode(nodeId)) {
    throw new NodeNotFoundError(nodeId);
  }
  this.graph.mergeNodeAttributes(nodeId, attrs);
  this.markDirty(nodeId);
  this.emit('entity:updated', { nodeId, attrs });
}
```

**Part 2 — Plumb embedding through the storeEntity path correctly.** The `_hasContentChanged` early-exit at `GraphDatabaseService.js:255` is replaced by GraphKMStore's atomic batch semantics (Phase 37 D-17). The new path through `store.put(entity)` always merges the embedding field; no content-equality check skips it.

### What kg-operators provides for the embedding-operator

`kg-operators.ts:31–47` defines `KGEntity` interface — `embedding?: number[]` is field 37. The embedding-operator method is `nodeEmbedding()` (called from `applyAll()` at `kg-operators.ts:148–152`). It populates `result[index] = { ...result[index], embedding }` at line 340. The operator returns the augmented array; it does NOT itself write to the graph. **The fix lives at the wave-controller/persistence-agent boundary, not in kg-operators.**

### Phase 10 SC#2 verification

Per D-52b/SC#2: "every entity returned by `findByOntologyClass('Detail')` after a `ukb full` run has `embedding.length === 384`."

The Plan 1 test should:
1. Run a minimal `ukb full` (or stub) producing N Detail entities.
2. Query the store via the km-core adapter for class='Detail'.
3. Assert each has `embedding` array of length exactly 384.

**Baseline:** Section 4 below confirms the current state — 0 of 727 entities have embeddings. After Plan 1 plus the wave-controller migration in later plans, a full `ukb full` run brings this to roughly 312 of 727 (all current `Detail` entities plus any newly-classified ones).

---

## Section 2: Race condition mechanics

### Where the symptom actually originates

The log line `"Race condition detected (0/0 steps) but no valid cache available"` does **NOT** originate in B's workflow-runner. It originates in the **dashboard**: `integrations/system-health-dashboard/server.js:1071`.

```javascript
// system-health-dashboard/server.js:1059–1072
// Check if we got invalid data (0/0 is not valid for a running workflow)
const isRaceCondition = totalSteps === 0 && inferredStatus === 'running';

if (isRaceCondition) {
    if (this.lastValidWorkflowProgress && ...totalSteps > 0) {
        console.log('Using cached progress data (race condition detected - got 0/0 steps)');
        ...
    } else {
        console.warn('Race condition detected (0/0 steps) but no valid cache available');
    }
}
```

The dashboard reads the progress JSON file. When it sees `totalSteps === 0` while `status === 'running'`, it logs the warning. **What we have is not a runtime race inside B, but a dashboard-observable inconsistency in the progress file**: the file briefly contains `totalSteps: 0` while workflow status is `running`.

### Why the progress file goes to 0/0

There are **two concurrent writers** to the same progress file:

**Writer 1 — coordinator.ts `writeProgressFile` (65 call sites).** Defined at `coordinator.ts:156`, called from 65 places. Each call does `fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))` (lines 577, 729). The `progress` object includes a `stepsDetail` array built from `execution.results`.

**Writer 2 — workflow-state-machine.ts `createProgressFileSubscriber` (every state transition).** Defined at `workflow-state-machine.ts:117–162`. Wired up at `workflow-runner.ts:407` via `subscribe(createProgressFileSubscriber(progressFile))`. On every state transition, this subscriber does READ-MERGE-WRITE:

```typescript
// workflow-state-machine.ts:117–162 (abbreviated)
return (state, _event) => {
  let merged = { ...state };
  try {
    const existing = JSON.parse(readFileSync(progressFilePath, 'utf8'));
    // preserve stepPaused, pausedAtStep, pausedAt, mockLLM, mockLLMDelay,
    //          singleStepMode, stepIntoSubsteps, llmState, config.singleStepMode
  } catch { /* fresh write */ }
  merged.lastUpdate = ...;
  writeFileSync(progressFilePath, JSON.stringify(merged, null, 2));
};
```

**Critical:** The state-machine subscriber preserves `stepPaused`, `mockLLM`, `singleStepMode`, etc., but does **NOT** preserve `stepsDetail`, `completedSteps`, or `totalSteps`. Those live inside `state.progress` for some workflows and outside for others. When coordinator writes a "fat" progress file with `stepsDetail`, and then the state-machine subscriber fires a transition write, the subscriber overwrites the file with `{...state}` (the lean state-machine shape) and clobbers `stepsDetail`. The dashboard polls during that window, sees 0/0, and logs the warning.

The reverse also happens: state-machine writes a transition; coordinator's next `writeProgressFile` clobbers the `stepPaused` field. The subscriber's read-modify-write was specifically added to PREVENT that, but it only preserves a known allowlist of fields. Coordinator's `writeProgressFile` does NOT have a corresponding read-modify-write — it writes the entire `progress` blob fresh.

### Why this matters for the dashboard "stuck at running" symptom

After `ukb full` completes successfully, `workflow-runner.ts:471–478` dispatches `{type: 'complete'}`, which triggers a final state-machine subscriber write with status=`completed`. When coordinator's last `writeProgressFile` fires AFTER that (during cleanup) and writes the "running" execution object back, the file ends up stuck at status=`running` with `stepsDetail` data from a stale snapshot. The PID is gone (workflow exited), so the dashboard reads "running with no live PID" → "stuck".

### Three viable fix shapes (ranked simplest -> most invasive)

| # | Fix | Effort | Risk | Phase 42 fit |
|---|-----|--------|------|--------------|
| 1 | **Single-writer through state-machine.** Route ALL progress writes through the state-machine subscriber. Coordinator's 65 `writeProgressFile` calls become `dispatch({type:'step_progress', stepName, runningSteps, batchProgress})` events. The subscriber owns the file. **Pros:** eliminates the race definitionally — only one writer. **Cons:** large refactor; need to model coordinator's batch/sub-step data in state-machine events. | M-L | M | Best long-term but heavy for one plan |
| 2 | **File lock on progress writes.** Wrap every `writeFileSync(progressFilePath, ...)` in an advisory lock (e.g., `proper-lockfile`) so writers serialize. **Pros:** small change; preserves existing call sites. **Cons:** still allows the "stepsDetail clobbered" semantic race — locking only prevents torn writes, not stale overwrites. The dashboard still sees 0/0 when the state-machine subscriber writes between two coordinator writes. | S | L (insufficient) | Won't satisfy SC#3 alone |
| 3 | **Field-preserving merges everywhere.** Same allowlist-merge pattern as the state-machine subscriber, but added to coordinator's `writeProgressFile`. The function reads existing file, merges `stepsDetail`/`completedSteps`/`totalSteps` from existing into the new progress object if absent, then writes. **Pros:** minimal API change; localized to one method. **Cons:** still racy in the millisecond between read and write — though the race window is much narrower and the dashboard cache covers it. Both writers' field allowlists must stay in sync. | S-M | M | **Most pragmatic for Plan 2** |

### Recommendation for the planner

Phase 42's SC#3 anchor (D-51 Plan 2) calls the race-fix shape "planner's discretion". Given the strangler migration moves all writes onto km-core anyway in later plans, fix #3 is the pragmatic choice:
- Cheapest land in Plan 2.
- Removes the "0/0 dashboard log spam" within one plan.
- The deeper single-writer architecture (fix #1) rides along with the km-core event-subscription path in Plans 3+ as a natural byproduct of moving progress writes through the new store's event system. The cleanup plan deletes both legacy writers together with `GraphDatabaseService.js` etc.

Counter-evidence the planner should weigh: if the dashboard still shows "stuck at running" after fix #3 lands, that's the *terminal-state* race — a separate defect (workflow-runner exits before coordinator's final write completes). That requires fix #1's single-writer model. Plan 2 verification (SC#3) should explicitly assert BOTH "no '0/0 steps' warning" AND "dashboard reflects terminal state within 5s of process exit" — when the second assertion fails, the planner escalates to fix #1.

---

## Section 3: Storage trio API surface

### Bottom line up front

Of the three storage modules listed in D-51 for deletion, only **`GraphDatabaseService.js`** is actually referenced in the source tree. `KnowledgeStorageService.js` (750 lines) and `QdrantSyncService.js` (390 lines) are **orphaned** — verified by:

```bash
grep -rEn "KnowledgeStorageService|QdrantSyncService" src/ --include='*.ts' --include='*.js'
# -> no matches (no constructor invocations or imports)
```

This is good news for the strangler migration: the final cleanup plan **deletes both files outright** with no ripple effects, no migration of callers required. The actual storage-trio replacement work in Phase 42 is single-target — `GraphDatabaseService` only.

### GraphDatabaseService.js — public API (1984 lines)

File: `integrations/mcp-server-semantic-analysis/src/knowledge-management/GraphDatabaseService.js`

| Line | Method | Purpose |
|------|--------|---------|
| 38 | `constructor(options = {})` | Initializes Graphology + LevelDB + autoPersist timer. EventEmitter base. |
| 73 | `async initialize()` | Boot sequence: lsof preflight (Win32-only), `_loadGraphFromLevel`, autoPersist start. |
| 204 | `async storeEntity(entity, options = {team})` | Primary write. `_hasContentChanged` early-exit at line 255. Emits `entity:stored`. |
| 489 | `async getEntity(name, team)` | Read by `team:name` key from Graphology. |
| 513 | `async deleteEntity(name, team, options)` | Critical-node protection + connection-count protection. |
| 598 | `async storeRelationship(fromEntity, toEntity, type, metadata)` | Edge write with normalization + dup check. |
| 685 | `async deleteRelationsByType(relationType, options)` | Bulk edge delete by type (plus optional team filter). |
| 738 | `async deduplicateRelations()` | Self-clean pass over duplicate edges. |
| 825 | `async normalizeAndCleanupRelations()` | Edge type normalization sweep. |
| 945 | `async findRelated(entityName, depth=2, filter)` | BFS traversal. |
| 1047 | `async queryEntities(options = {})` | Filtered list with searchTerm, ontology class, hierarchy, etc. |
| 1276 | `async queryRelations(options = {})` | Filtered edge list. |
| 1336 | `async queryByOntologyClass(options = {})` | Class-scoped read (the SC#2 verification target). |
| 1437 | `async getTeams()` | Distinct team values across nodes. |
| 1484 | `async getStatistics(options = {})` | Node/edge counts grouped by type. |
| 1559 | `async exportToJSON(team, filePath)` | JSON snapshot of the graph slice. |
| 1655 | `async importFromJSON(filePath)` | Inverse of above. |
| 1768 | `async getHealth()` | DB health snapshot. |
| 1808 | `async close()` | Stop autoPersist plus close LevelDB. |

**Notable gaps for the migration:**
- **No `mergeAttributes` / `mergeNodeAttributes`** — the Phase 10 bug source.
- **No `getAllEntities`** — `persistence-agent.ts:3486` calls `this.getAllEntities(team)` but that's a method on `PersistenceAgent`, NOT on `GraphDatabaseService`.
- Private helpers: `_hasContentChanged` (334), `_linkCollectiveKnowledgeToProjects` (402), `_arraysAreEqual` (432), `_persistGraphToLevel` (1837), `_loadGraphFromLevel` (1878), `_exportAllTeamsToJSON` (1922), `_startAutoPersist` (1954), `_stopAutoPersist` (1978).

### KnowledgeStorageService.js — public API (750 lines, DEAD CODE)

File: `integrations/mcp-server-semantic-analysis/src/knowledge-management/KnowledgeStorageService.js`

| Line | Method | Purpose |
|------|--------|---------|
| 80 | `constructor(config)` | Requires `databaseManager`, `graphDatabase`, `embeddingGenerator`. |
| 114 | `async initialize()` | Boot. |
| 142 | `async storeKnowledge(knowledge, options)` | Embedding gen + Qdrant write + Graph write. |
| 207 | `async storeBatch(knowledgeItems, options)` | Batched version. |
| 244 | `async searchKnowledge(query, options)` | Embedding-cosine search via Qdrant. |
| 310 | `async getRecentKnowledge(options)` | Time-window list. |
| 369 | `async getKnowledgeByType(knowledgeType, options)` | Type filter. |
| 412 | `async getKnowledgeById(knowledgeId)` | UUID/ID lookup. |
| 451 | `async deleteKnowledge(knowledgeId)` | Two-store delete. |
| 475 | `async updateKnowledge(knowledgeId, updates)` | RMW. |
| 509 | `async checkDuplicate(knowledgeText)` | Pre-write dedup. |
| 535 | `async storeTransactional(id, knowledge, embeddings)` | Pre-computed-embedding write path. |
| 586 | `async rollbackStorage(knowledgeId)` | Compensating delete on failure. |
| 598 | `async generateEmbeddings(text, vectorSize)` | 384 and/or 1536 dim. |

**Callers in src/:** ZERO. Module is dead. Final cleanup deletes the file with no replacement work.

### QdrantSyncService.js — public API (390 lines, DEAD CODE)

File: `integrations/mcp-server-semantic-analysis/src/knowledge-management/QdrantSyncService.js`

| Line | Method | Purpose |
|------|--------|---------|
| 35 | `constructor(options)` | Requires `graphService` (event source), `databaseManager`. |
| 73 | `async initialize()` | Wires up `_setupEventListeners` to `graphService`. |
| 109 | `_setupEventListeners()` | Listens for `entity:stored` and `entity:deleted` events. |
| 127 | `async _handleEntityStored(event)` | Per-entity upsert into Qdrant. |
| 179 | `async _handleEntityDeleted(event)` | Per-entity delete. |
| 241 | `async syncAllEntities(options)` | Full sweep. |
| 359 | `getStats()` | Counter dump. |
| 369 | `enable()` / 377 `disable()` / 385 `async shutdown()` | Lifecycle. |

**Callers in src/:** ZERO. Module dead. Final cleanup deletes the file. **Note:** D-52a's new `syncQdrantFromStore` in km-core replaces this module's `syncAllEntities` semantics, with one key shift — the new op reads from the canonical km-core store (single source of truth) instead of listening to `entity:stored` events from a now-deleted GraphDB.

### Caller heat map for GraphDatabaseService methods

Counted via `grep -rE "\b<method>\(" src/ --include='*.ts' --include='*.js'` (raw occurrence count, includes the definition):

| Method | Occurrences | Top callers |
|--------|-------------|-------------|
| `queryEntities` | 13 | `persistence-agent.ts` (multiple), `wave-controller.ts`, `content-validation-agent.ts` |
| `storeEntity` | 6 | `persistence-agent.ts:1611, 3557`; `graph-database-adapter.ts` |
| `deleteEntity` | 6 | `persistence-agent.ts`, `tools.ts` |
| `storeRelationship` | 4 | `wave-controller.ts:2134`, `persistence-agent.ts` (multiple) |
| `getEntity` | 4 | `persistence-agent.ts:3501`, `graph-database-adapter.ts` |
| `getStatistics` | 3 | dashboard tools, `tools.ts` |
| `getAllEntities` | 3 | wrapper methods only — defined on `PersistenceAgent`, not `GraphDatabaseService` |
| `exportToJSON` | 3 | utility tools |
| `queryRelations` | 0 | dead path |
| `queryByOntologyClass` | 0 | dead path (method exists at line 1336 but has no callers — added speculatively) |
| `findRelated` | 0 | dead path |

**Files that touch `GraphDatabaseService`:**
- `src/agents/wave-controller.ts` (3 hits) — main consumer
- `src/agents/persistence-agent.ts` (10 hits) — main consumer
- `src/agents/content-validation-agent.ts` (4 hits)
- `src/storage/graph-database-adapter.ts` (5 hits) — adapter, imports the class

**Migration implication for Plan 1 strangler:** the strangler adapter must implement the read surface used by all four consumer files. The "hot" methods to support first are `queryEntities`, `storeEntity`, `storeRelationship`, `getEntity`, `deleteEntity`. The "cold" methods (`queryRelations`, `queryByOntologyClass`, `findRelated`) can be deferred — they have zero callers and Plan 1 can add stubs that throw NotImplementedError, to be filled in only when a caller appears.

---

## Section 4: D-54 schema mapping table

### Empirical baseline from production data

Surveyed `coding/.data/exports/coding.json` (1.18 MB, 727 entities, snapshot 2026-05-23 07:45). This is the authoritative shape of what exists in the LevelDB store today.

**Top-level keys actually populated across ALL 727 entities:**

```
entityType, id, metadata, name, observations, problem, significance, solution, source
```

**Notably absent from ALL 727 entities:**
- `embedding` — 0/727 (Phase 10 bug, empirically confirmed)
- `ontologyClass` — 0/727 (B uses `entityType` as the class label)
- `hierarchyLevel` — 0/727 (despite wave-controller code that sets it; stripped on export)
- `parentEntityName` — 0/727 (same)
- `relationships` — 0/727 (edges are stored separately as `d.relations`, not embedded)
- `role` — 0/727 (operator-enriched; never persisted)

**Metadata keys actually populated across ALL 727 entities:**
```
created_at, last_updated
```
Just those two. No `team`, no `ontology`, no `created_by`, no provenance, no version. The metadata blob is impoverished.

**entityType distribution (727 entities):**

| entityType | Count | Notes |
|------------|-------|-------|
| `SubComponent` | 347 | Wave-2 hierarchy output |
| `Detail` | 312 | Wave-3 hierarchy output (SC#2 target — must have embeddings after migration) |
| `Process` | 17 | Specialized class (not in upper ontology) |
| `Container` | 10 | Specialized |
| `Component` | 7 | Wave-1 hierarchy output |
| `File` | 7 | Specialized |
| `StaticDiagnostics` | 7 | Specialized |
| `Config` | 5 | Specialized |
| `Port` | 4 | Specialized |
| `Fault` | 4 | Specialized |
| `Service` | 3 | Specialized |
| `RuntimeDiagnostics` | 2 | Specialized |
| `System` | 1 | Root: "CollectiveKnowledge" |
| `Project` | 1 | "Coding" |

The 4-level hierarchy (Project -> Component -> SubComponent -> Detail) accounts for 667/727 = 92% of entities. The remaining 60 use B's specialized lower-ontology classes.

### KGEntity (B's internal shape — kg-operators.ts:31–47)

```typescript
export interface KGEntity {
  id: string;
  name: string;
  type: string;                    // field is `type`, NOT `entityType`
  observations: string[];
  significance: number;
  embedding?: number[];            // computed but not persisted (Phase 10)
  role?: 'core' | 'non-core';
  batchId?: string;
  timestamp?: string;
  references?: string[];
  enrichedContext?: string;
  parentId?: string;
  level?: number;
  hierarchyPath?: string;
}
```

This is the operator-pipeline shape. **Coordinator casts to KGEntity but adds `entityType` plus `metadata` via `as KGEntity` per the memory note** — kg-operators's strict interface doesn't reflect what actually flows through it.

### SharedMemoryEntity (B's persistence shape — persistence-agent.ts:42)

```typescript
export interface SharedMemoryEntity {
  id: string;
  name: string;
  entityType: string;              // field is `entityType`, NOT `type`
  significance: number;
  observations: (string | ObservationObject)[];
  relationships: EntityRelationship[];
  metadata: EntityMetadata;        // includes ontology classification fields
  hierarchyLevel?: number;
  parentEntityName?: string | null;
  childEntityNames?: string[];
  isScaffoldNode?: boolean;
  // (operator-enriched fields appended via spread in storeEntityToGraph)
  embedding?: number[];
  role?: string;
  enrichedContext?: string;
}
```

The KGEntity-vs-SharedMemoryEntity gap (`type` vs `entityType`) is the long-standing recurring bug captured in memory.

### km-core canonical Entity (`~/Agentic/km-core/src/types/entity.ts:113-148`)

```typescript
export interface Entity {
  id: EntityId;                    // branded UUIDv7
  name: string;
  entityType: string;              // free-form (B uses Project/Component/...)
  ontologyClass?: string;          // maps to B's entityType in D-54
  layer: Layer;                    // 'evidence' | 'pattern'
  description: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
  supersedes?: EntityId;
  legacyId?: { system: 'A' | 'B' | 'C'; id: string };
}
```

Per Phase 39 schema, `metadata` carries: `provenance: EntityProvenance` (createdBy + lastConfirmedBy + confirmationCount), `descriptionSegments: DescriptionSegment[]`, `resolutionHistory: ResolutionRecord[]`, plus arbitrary other keys.

**embedding is NOT in the type yet** — D-52 adds `embedding?: number[]` as a Phase 39 schema extension. Plan 1 lands this change in km-core before B can store embeddings through it.

### D-54 in-place migration mapping table

| B (current attribute) | km-core canonical | Migration rule |
|----------------------|-------------------|----------------|
| `id` (e.g., `"mc4flkglue8o7"` — 13-char LevelDB key, NOT a UUID) | `id` (branded UUIDv7) AND `legacyId.id` | `mintEntityId()` to assign a fresh UUIDv7 for `id`. Move existing string to `legacyId = { system: 'B', id: <oldId> }`. |
| `name` | `name` | Identity copy. |
| `entityType` (e.g., `"Detail"`) | `ontologyClass` | **Direct copy.** B's entityType IS its ontology class. The km-core `entityType` field is set to the SAME value for back-compat (consumers reading either field get the same answer). |
| `observations: (string \| ObservationObject)[]` | `description` plus `metadata.descriptionSegments[0]` | Join observations into a single description string (B's existing pattern). Build initial DescriptionSegment with `{ text: <joined>, runId: <migrationRunId>, provider: 'phase-42-migration', model: 'b-to-km-core', quality: 'standard', timestamp: <now>, confirmations: [] }`. Preserve raw observations array in `metadata.legacyObservations` for downstream consumers that haven't migrated yet. |
| `significance` (e.g., `0.5`) | `metadata.significance` | Verbatim copy into metadata. |
| `source` (e.g., `"manual"`) | `metadata.source` | Verbatim copy. |
| `metadata.created_at` | `createdAt` AND `validFrom` | Promote to top-level Entity fields per D-54. |
| `metadata.last_updated` | `updatedAt` | Promote. |
| `problem`, `solution` (objects, mostly `{}`) | `metadata.problem`, `metadata.solution` | Preserve. Per Section 4 survey these are nearly always empty `{}`, but a small minority of entities may have content (insight documents). |
| (absent) | `legacyId` | Synthesize: `{ system: 'B', id: <existing entity.id> }`. |
| (absent) | `metadata.subsystem` | Set to `'wave-analysis'` per D-54 + Phase 41 pattern. |
| (absent) | `validUntil` | Set to `null` (in-force at migration time). |
| (absent) | `metadata.provenance.createdBy` | Set to migration-run provenance stamp: `{ provider: 'phase-42-migration', model: 'b-to-km-core', runId: <runId>, timestamp: <now> }`. |
| (absent) | `metadata.provenance.lastConfirmedBy` | Same as createdBy. |
| (absent) | `metadata.provenance.confirmationCount` | `1`. |
| `embedding` (0/727 entities have this) | `embedding` (Phase 39 schema extension) | If present, copy verbatim. If absent (vast majority), leave undefined — to be filled by the next `ukb full` run after Plan 1 lands. |
| `layer` (not present in B's shape) | `layer` (mandatory in km-core) | Set to `'evidence'` for all migrated entities (B is the wave-analysis offline UKB, which produces evidence-layer entities; the pattern layer is reserved for A's distilled insights). |
| `hierarchyLevel`, `parentEntityName`, `childEntityNames`, `isScaffoldNode` | `metadata.hierarchyLevel`, `metadata.parentEntityName`, ... | Preserved in metadata if present in source (note: 0/727 production entities had these in JSON export — confirm what's in LevelDB during Plan 1). |

### Example migrated entities

**Example 1 — Detail entity (the SC#2 target)**

Before (from production JSON export):
```json
{
  "name": "TranscriptAdapter",
  "entityType": "Detail",
  "observations": [
    "The TranscriptProcessor uses the TranscriptAdapter abstract base class...",
    "The parent analysis suggests the existence of TranscriptAdapter...",
    "Given the lack of direct code evidence, the TranscriptAdapter's role..."
  ],
  "source": "manual",
  "metadata": {
    "created_at": "2026-03-07T12:38:24.946Z",
    "last_updated": "2026-03-21T06:36:53.211Z"
  },
  "id": "mc4flkglue8o7"
}
```

After (post-migration, canonical Entity):
```json
{
  "id": "01902b78-3c4a-7000-9000-000000000001",
  "name": "TranscriptAdapter",
  "entityType": "Detail",
  "ontologyClass": "Detail",
  "layer": "evidence",
  "description": "The TranscriptProcessor uses the TranscriptAdapter abstract base class in 'lib/agent-api' to read and convert transcripts from various agent formats... [joined from all observations]",
  "createdAt": "2026-03-07T12:38:24.946Z",
  "updatedAt": "2026-03-21T06:36:53.211Z",
  "validFrom": "2026-03-07T12:38:24.946Z",
  "validUntil": null,
  "legacyId": { "system": "B", "id": "mc4flkglue8o7" },
  "metadata": {
    "subsystem": "wave-analysis",
    "significance": 5,
    "source": "manual",
    "legacyObservations": [
      "The TranscriptProcessor uses the TranscriptAdapter...",
      "The parent analysis suggests...",
      "Given the lack of direct code evidence..."
    ],
    "descriptionSegments": [{
      "text": "The TranscriptProcessor uses the TranscriptAdapter abstract base class...",
      "runId": "phase-42-migration-2026-05-23",
      "provider": "phase-42-migration",
      "model": "b-to-km-core",
      "quality": "standard",
      "timestamp": "2026-05-23T08:00:00.000Z",
      "confirmations": []
    }],
    "provenance": {
      "createdBy": { "provider": "phase-42-migration", "model": "b-to-km-core", "runId": "phase-42-migration-2026-05-23", "timestamp": "2026-05-23T08:00:00.000Z" },
      "lastConfirmedBy": { "provider": "phase-42-migration", "model": "b-to-km-core", "runId": "phase-42-migration-2026-05-23", "timestamp": "2026-05-23T08:00:00.000Z" },
      "confirmationCount": 1
    }
  }
}
```

**Example 2 — Project entity (root anchor)**

Before:
```json
{
  "name": "Coding",
  "entityType": "Project",
  "observations": ["Project anchor for the coding team..."],
  "source": "manual",
  "metadata": { "created_at": "2026-03-07T12:38:08.270Z", "last_updated": "2026-05-14T11:13:46.742Z" },
  "id": "mc4flkgxgvxje"
}
```

After: same migration rules; `ontologyClass: "Project"`, `layer: "evidence"`, single-segment description, etc. The Project anchor structure is preserved exactly.

### Idempotency contract

Per D-54: "Migration is idempotent. Running twice produces the same result."

The migration script must:
1. Detect already-migrated entities by presence of `legacyId.system === 'B'` AND a valid `EntityId` shape on `id`. Skip these.
2. For partial migrations (e.g., the embedding write is added later), allow targeted re-processing of specific fields without rewriting the whole entity. Use km-core's `mergeAttributes` primitive for this.
3. Use a stable runId derived from the input data (e.g., hash of all entity legacyIds) so the same migration over the same source produces byte-identical provenance stamps. This makes the property-based test trivially repeatable.

---

## Section 5: OntologyManager surface to replace

### OntologyManager.ts public API (508 lines)

File: `integrations/mcp-server-semantic-analysis/src/ontology/OntologyManager.ts`

| Line | Method | Purpose |
|------|--------|---------|
| 70 | `async initialize()` | Boot: load upper plus all configured lower ontologies. |
| 101 | `async loadTeamOntology(teamConfig)` | Per-team lower-ontology load. |
| 112 (private) | `loadOntology(...)` | File reader. |
| 191 | `getUpperOntology(): Ontology` | Return upper ontology object. |
| 204 | `getLowerOntology(team): Ontology \| undefined` | Per-team. |
| 211 | `getAllLowerOntologies(): Map<string, Ontology>` | All teams. |
| 218 | `hasEntityClass(entityClass, team?): boolean` | Class-existence check. |
| 359 | `getAllEntityClasses(team?): string[]` | Class enumeration. |
| 392 | `getAllRelationships(team?): Record<string, RelationshipDefinition>` | Relationship enumeration. |
| 457 | `getStatistics(team?)` | Class/relationship counts. |
| 495 | `clearCache()` | Drop caches. |
| 502 | `async reload()` | Re-read all files. |

### Callers of OntologyManager (from grep -rln)

```
src/agents/ontology-classification-agent.ts
src/tools.ts
```

Just **two callers** in the entire codebase. The migration surface is small.

### km-core OntologyRegistry mapping

| OntologyManager method | km-core OntologyRegistry equivalent | Notes |
|------------------------|--------------------------------------|-------|
| `initialize()` | constructor + `loadFromDisk()` (`registry.ts:63`) | Eager-load. |
| `loadTeamOntology(teamConfig)` | Not directly — registry is single-team per instance | Per-team registries instantiated separately. |
| `getUpperOntology()` | `registry.getClass('<upperClassName>')` per-class | Different abstraction; B caller refactors to per-class lookups. |
| `getLowerOntology(team)` | Not 1:1 — registry exposes `getClass`, `listClasses`, `listDomains` | Lower-ontology data flattens into the unified class catalog. |
| `hasEntityClass(entityClass, team?)` | `registry.hasClass(name)` | Direct equivalent. |
| `getAllEntityClasses(team?)` | `registry.listClasses()` | Direct equivalent. |
| `getAllRelationships(team?)` | Not in km-core registry today | Phase 42 prerequisite if B uses this surface non-trivially. |
| `getStatistics(team?)` | Not in km-core registry | B-side wrapper, lightweight. |
| `clearCache()` | Not needed (atomic reload) | Drop. |
| `reload()` | `registry.reload()` (`registry.ts:102`) | Direct equivalent. |

### Layout of `coding/.data/ontologies/` (one-level walk)

Directories at the root of `.data/ontologies/`:
- `archive/` — 1 subdir, historical
- `lower/` — 7 JSON files (see below)
- `schemas/` — `ontology-schema.json` (reference, not loaded)
- `suggestions/` — `pending-classes.json` (B-specific staging, not loaded)
- `upper/` — `development-knowledge-ontology.json`

Files in `lower/`:
- `agentic-ontology.json`
- `cluster-reprocessing-ontology.json`
- `code-entities-ontology.json`
- `coding-ontology.json`
- `raas-ontology.json`
- `resi-ontology.json`
- `ui-ontology.json`

**Total relevant lower-ontology files: 7 in `lower/`, plus 1 in `upper/`.**

### km-core OntologyRegistry — does it walk subdirs?

**No.** Verified at `km-core/src/ontology/registry.ts:71`:

```typescript
const files = readdirSync(this.ontologyDir).filter(
  (f) => f.endsWith('.json') && f !== 'upper.json',
);
```

Single-level `readdirSync`. The registry expects:
- A file named `upper.json` (line 65) at the root of `ontologyDir`.
- All other `*.json` files at the same level (lower ontologies).

B's layout has `upper/development-knowledge-ontology.json` (subdir) and `lower/*.json` (subdir). The two layouts are **incompatible without intervention.**

### D-53a recommendation: flatten (Option A)

Per D-53a: "the planner decides: either (a) one-time flatten the layout, OR (b) extend the registry to walk subdirs."

**Recommendation: flatten (Option A).** Reasons:

1. **Smaller change.** Renaming/moving 8 JSON files is a single git operation. Extending km-core registry would require a Phase 42 prerequisite plan against the km-core repo, broader test surface, and a new D-53c-style decision on whether subdirs are 1-level or n-level.
2. **One-time cost.** Per D-53b, B's ontology files become km-core lower-ontology JSONs in place. The flatten only happens once during Phase 42.
3. **Aligns with existing precedent.** km-core's expected shape (`upper.json` plus flat lower JSONs) IS the established Phase 38 contract — bending it for B would set a precedent for C's migration (Phase 43) and any future system.
4. **Loses no semantics.** B's `upper/`, `lower/`, `schemas/`, `suggestions/` directories are organization-only — no consumer code depends on the directory paths beyond the OntologyManager loader, which is being deleted.

**Concrete flatten plan:**
- `upper/development-knowledge-ontology.json` -> `upper.json` (rename plus move).
- `lower/agentic-ontology.json` -> `agentic-ontology.json` (move up).
- `lower/cluster-reprocessing-ontology.json` -> `cluster-reprocessing-ontology.json` (move up).
- ...(5 more moves from lower/)
- `schemas/ontology-schema.json` -> keep in place (not loaded by registry; reference-only).
- `suggestions/pending-classes.json` -> keep in place (not loaded by registry; B-specific staging).
- `archive/` -> keep in place (historical, not loaded).

After: `coding/.data/ontologies/` contains `upper.json` plus 7 lower `*.json` files at the root, plus the untouched `schemas/`, `suggestions/`, `archive/` subdirs (registry ignores them since it does `endsWith('.json')` at root only).

### Two consumer files to update

After the OntologyManager deletion:

1. **`src/agents/ontology-classification-agent.ts`** — replaces `new OntologyManager()` plus `hasEntityClass` / `getAllEntityClasses` calls with `new OntologyRegistry({ ontologyDir: <path> })` plus `hasClass` / `listClasses` calls.
2. **`src/tools.ts`** — same swap.

Both are mechanical search-and-replace. Plan should include grep-after-rename to confirm zero references to `OntologyManager` remain.

### Confirmation that OntologyClassifier/Validator/QueryEngine survive

Per D-53: "Keep OntologyClassifier + OntologyValidator + OntologyQueryEngine."

Verification: searched for `OntologyManager` usage inside those three modules. Both `OntologyClassifier` and `OntologyValidator` live in the same `src/ontology/` directory. They depend on `OntologyManager`'s `getLowerOntology` / `hasEntityClass` surfaces — but those surfaces map cleanly to `OntologyRegistry.hasClass` / `getClass`. **No deeper coupling to OntologyManager-private internals was observed during this research pass.** Planner confirms during Plan 5+ (ontology-classification-agent rewire).

---

## Section 6: Risks & Open Questions

### Risks

1. **The "0/0 race" symptom has a deeper root cause than just the two-writer pattern.** When fix #3 in Section 2 lands and the dashboard still shows stuck-at-running, that is the workflow-runner-exit-vs-coordinator-final-write ordering defect that requires fix #1. Plan 2's verification must catch this.

2. **727 entities require migration, NONE of which currently have embeddings.** D-54a says "Qdrant is fully rebuilt from km-core after the in-place migration." When 0 entities have embeddings and the migration only fills them on the next `ukb full`, then Qdrant will be empty until that rebuild — VKB semantic search is BROKEN during the gap. The planner should sequence: (a) D-54 migration -> (b) one `ukb full` to fill embeddings -> (c) `syncQdrantFromStore` -> (d) cleanup. Otherwise there's a multi-hour search outage.

3. **Specialized entity types (Config, Port, Container, Process, File, Service, etc. — 60 entities total) do not all fit B's documented ontology cleanly.** These are ad-hoc classes added by the wave pipeline for diagnostics, not declared in `lower/coding-ontology.json`. Migration must not assume the ontologyClass exists in the registry — a fallback (perhaps `ontologyClass: 'Unclassified'` plus preserve original entityType in metadata) is needed for these.

4. **Docker rebuild cycle is 3-5 minutes per code change in B.** Per CLAUDE.md, every TS source edit requires `npm run build` plus `docker-compose build coding-services` plus restart. With roughly 10 plans in Phase 42 and N test iterations each, the planner should design wave parallelism to minimize Docker rebuilds (group multiple plans into a single rebuild where safe).

### Open Questions

1. **Does km-core's `GraphKMStore` expose a `mergeAttributes` primitive today?** Phase 37/38/39 didn't explicitly require it. Plan 1 must either confirm it exists OR add it (one-liner over Graphology). Researcher did not read `~/Agentic/km-core/src/store/GraphKMStore.ts` in this pass to confirm. **Action for planner:** verify before Plan 1's plan-write.

2. **What is the `_hasContentChanged.contentFields` allowlist in `GraphDatabaseService.js`?** Section 1 noted this may exclude `embedding`. Researcher didn't enumerate the list. **Action for planner:** read lines 334–399 of `GraphDatabaseService.js` and confirm whether embedding is excluded; when it is, this is a direct root cause of the Phase 10 bug independent of the bypass-write defect.

3. **The orphaned `KnowledgeStorageService.js` plus `QdrantSyncService.js` may be referenced from compiled `dist/` output that's been committed to git.** Researcher only searched `src/`. **Action for planner:** when the final cleanup plan deletes these files, also run `grep -rn "KnowledgeStorageService\|QdrantSyncService" dist/ docker/ scripts/` to ensure no stale build artifacts reference them.

4. **Embedding generator Python dependency.** Per memory note: `src/utils/embedding_generator.py` needs `numpy` plus `sentence-transformers` in Docker, or QdrantSync errors non-fatally. Since Phase 42 deletes QdrantSync entirely, the Python dependency question shifts: does km-core's new default `EmbeddingClient` (D-52c, fastembed) require its own Python deps in the Docker container, or is fastembed pure-JS? Researcher didn't verify. **Action for planner:** confirm fastembed's runtime requirements before Plan 1.

5. **Confidence level on "no OntologyManager-private dependency."** Section 5 claims OntologyClassifier/Validator/QueryEngine don't depend on OntologyManager-private internals. Researcher's pass was shallow (no full read of these three files). **Action for planner:** confirm during Plan 5 by reading their actual implementations before rewiring.

---

## Summary table

| Section | Key finding | Confidence |
|---------|-------------|------------|
| 1 — Phase 10 fix | `graphDB.mergeAttributes()` at `wave-controller.ts:1373` is a call to a method that DOES NOT EXIST. Catch swallows it at debug-level. Confirmed empirically: 0/727 entities have embeddings in production data. | HIGH |
| 2 — Race condition | "0/0 steps" warning is a DASHBOARD-side log (`system-health-dashboard/server.js:1071`), not a B-side log. Root cause: two writers to progress file (`coordinator.writeProgressFile` x65 plus `state-machine subscriber`) with non-matching field-allowlist merges. Fix #3 (field-preserving merges) recommended for Plan 2. | HIGH |
| 3 — Storage trio | `KnowledgeStorageService.js` and `QdrantSyncService.js` are DEAD CODE (zero src/ references). Only `GraphDatabaseService.js` needs strangling. Hot methods: queryEntities, storeEntity, storeRelationship, getEntity, deleteEntity. | HIGH |
| 4 — Schema mapping | Production data has 9 top-level fields plus 2 metadata fields. Embedding/ontologyClass/hierarchyLevel are all 0/727. Migration adds 6 new top-level fields plus 4 new metadata fields per Phase 39 contract. | HIGH |
| 5 — Ontology | km-core registry is single-level only; B has multi-level (`upper/`, `lower/`). **Recommendation: flatten 8 JSON files in `.data/ontologies/`.** Only 2 OntologyManager callers in B's tree (`ontology-classification-agent.ts`, `tools.ts`). | HIGH |
| 6 — Risks | Qdrant blank window during migration is the highest-impact risk; planner must sequence migration -> ukb-full -> syncQdrantFromStore. | HIGH |

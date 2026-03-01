# Architecture Research

**Domain:** Hierarchical Knowledge Graph Integration -- adding entity hierarchy (Project to Component to SubComponent to Detail) to existing Graphology + LevelDB + VKB stack
**Researched:** 2026-03-01
**Confidence:** HIGH -- based on direct code inspection of GraphDatabaseService, GraphDatabaseAdapter, coordinator, persistence-agent, KGOperators, VKB frontend (Redux store, D3 graph), API routes, and live knowledge export

---

## System Overview (Current State)

The existing system is a flat-entity knowledge graph with rudimentary hierarchy in storage but none in UI or pipeline logic.

**Layer: MCP SERVER (Docker: coding-services)**
- CoordinatorAgent -> 14-agent batch pipeline
- PersistenceAgent -> GraphDatabaseAdapter

**Layer: STORAGE**
- Graphology (in-memory graph) <-> LevelDB (.data/knowledge-graph/)
- JSON export at .data/knowledge-export/coding.json: 126 flat entities, 0 relations

**Layer: VKB VIEWER (localhost:8080)**
- React + Redux + D3 force-directed graph
- Flat node list -> force-layout -> click for details

### What Already Exists

GraphDatabaseService already has partial hierarchy logic:

- Node IDs use `{team}:{entityName}` pattern (e.g., `coding:LiveLoggingSystem`)
- When `entityType === 'Project'`, auto-creates `CollectiveKnowledge -> includes -> Project` edge
- `_linkCollectiveKnowledgeToProjects()` method exists for retroactive linking
- Edge schema: `{ id, relation_type, team, created_at, auto_generated }`

This means hierarchy edges are already natively supported by Graphology's multi-edge graph. What is missing is: (1) parent/level attributes on nodes, (2) pipeline assigning those attributes, (3) VKB rendering a tree view.

---

## Hierarchy Schema Design

### Extended KGEntity Interface

The current `KGEntity` in `kg-operators.ts:31` has `type` but not `entityType`, `metadata`, or any hierarchy fields. Adding hierarchy fields requires extending this interface without breaking the cast pattern in coordinator.ts (`as KGEntity` after adding extra fields):

```typescript
// kg-operators.ts -- extend existing KGEntity
export interface KGEntity {
  id: string;
  name: string;
  type: string;
  observations: string[];
  significance: number;
  embedding?: number[];
  role?: 'core' | 'non-core';
  batchId?: string;
  timestamp?: string;
  references?: string[];
  enrichedContext?: string;

  // NEW: hierarchy fields
  hierarchyLevel?: 0 | 1 | 2 | 3;  // 0=Project, 1=Component, 2=SubComponent, 3=Detail
  parentName?: string;              // name of parent entity (not ID, to stay team-agnostic)
  isHierarchyNode?: boolean;        // true for Project/Component/SubComponent scaffold nodes
}
```

### Extended SharedMemoryEntity Interface

`SharedMemoryEntity` in `persistence-agent.ts` has `entityType` and `metadata`. Hierarchy goes into `metadata` to avoid breaking the shared-memory JSON schema contract:

```typescript
// persistence-agent.ts -- extend EntityMetadata
export interface EntityMetadata {
  created_at: string;
  last_updated: string;
  // ... existing fields ...

  // NEW: hierarchy fields (stored in metadata to preserve backward compat)
  hierarchyLevel?: 0 | 1 | 2 | 3;
  parentEntityName?: string;
  childEntityNames?: string[];      // populated by migration and pipeline
  isScaffoldNode?: boolean;         // true for curated component/project nodes
}
```

### GraphDatabaseService Node Attributes

The Graphology node already stores arbitrary attributes. Hierarchy attributes flow through transparently because `storeEntity()` does `{ ...entityWithoutRelationships }` spread. No change to GraphDatabaseService itself is needed -- new attributes land automatically.

What DOES need changing: the `storeRelationship()` call must be triggered for `child_of` / `contains` hierarchy edges. Currently relationships are only stored from `entity.relationships[]` array on the entity, or manually. The migration script and pipeline must explicitly call `storeRelationship(child, parent, 'child_of')`.

### Hierarchy Edge Types

Two edge type conventions to follow (matching existing `relation_type` field):

| Edge Type | Direction | Meaning |
|-----------|-----------|---------|
| `child_of` | child -> parent | Entity belongs to parent component |
| `contains` | parent -> child | Parent contains child (inverse of child_of) |

Use `child_of` as the canonical type (child->parent direction) to match graph traversal semantics. `contains` can be added as a convenience inverse. The existing `includes` edge (CollectiveKnowledge -> Project) should remain unchanged.

---

## Component Boundaries (New vs Modified)

**New Components:**
- `scripts/migrate-to-hierarchy.js` -- one-time migration script
- `integrations/mcp-server-semantic-analysis/src/agents/hierarchy-classifier.ts` -- assigns hierarchy during pipeline
- `integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` -- curated L1/L2 definitions (bind-mounted, no rebuild)
- `integrations/memory-visualizer/src/components/KnowledgeGraph/TreeNavigation.tsx` -- tree sidebar for VKB
- `integrations/memory-visualizer/src/components/KnowledgeGraph/HierarchyBreadcrumb.tsx` -- path display in NodeDetails
- `integrations/memory-visualizer/src/utils/hierarchyHelpers.ts` -- pure tree-building functions

**Modified Components:**
- `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` -- KGEntity interface extension
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` -- EntityMetadata extension + child_of edge creation
- `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` -- call HierarchyClassifier after ontology step
- `integrations/memory-visualizer/src/store/slices/graphSlice.ts` -- Entity interface: add hierarchyLevel, parentEntityName
- `integrations/memory-visualizer/src/store/slices/navigationSlice.ts` -- Node interface: add hierarchyLevel, parentEntityName
- `integrations/memory-visualizer/src/store/slices/filtersSlice.ts` -- add setHierarchyFilter action
- `integrations/memory-visualizer/src/components/KnowledgeGraph/index.tsx` -- add TreeNavigation panel
- `integrations/memory-visualizer/src/components/KnowledgeGraph/NodeDetails.tsx` -- show parent/children
- `integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx` -- apply hierarchy filter

**Unchanged:**
- `src/knowledge-management/GraphDatabaseService.js` -- no changes needed (hierarchy flows through spread)
- `lib/vkb-server/api-routes.js` -- no changes needed (passes through node attributes)
- `lib/vkb-server/express-server.js` -- no changes needed
- `config/workflows/batch-analysis.yaml` -- no YAML step changes needed (hierarchy is inline in coordinator)

---

## Data Flow: Hierarchy Assignment During Batch Analysis

### Current Flow (No Hierarchy)

```
ObservationAgent -> KGEntity[]
                      |
OntologyClassificationAgent -> KGEntity[] (with entityType set)
                      |
KGOperators (conv/aggr/embed/dedup/pred/merge)
                      |
accumulatedKG.entities (flat list)
                      |
PersistenceAgent -> GraphDB
```

### New Flow (With Hierarchy)

```
ObservationAgent -> KGEntity[]
                      |
OntologyClassificationAgent -> KGEntity[] (with entityType set)
                      |
HierarchyClassifier.assignHierarchy()       [NEW - inline in coordinator]
  Loads config/component-manifest.yaml
  For each entity: match name/type against component aliases
  Assigns hierarchyLevel (0/1/2/3) and parentName
  Creates scaffold nodes for L0/L1/L2 if missing from accumulatedKG
                      |
KGOperators (conv/aggr/embed/dedup/pred/merge)
                      |
accumulatedKG.entities (entities with hierarchyLevel + parentName)
                      |
PersistenceAgent -> GraphDB
  For each entity: if parentName set -> storeRelationship(entity.name, parentName, 'child_of')
```

### HierarchyClassifier Design

The classifier uses fast manifest lookup with LLM fallback for ambiguous entities:

```typescript
// src/agents/hierarchy-classifier.ts (NEW FILE)

export interface ComponentManifest {
  project: string;            // "Coding" -- L0 node name
  components: Array<{
    name: string;             // e.g. "LiveLoggingSystem"
    aliases: string[];        // e.g. ["LSL", "LiveLogging", "log-streaming"]
    subComponents?: Array<{
      name: string;           // e.g. "ManualLearning"
      aliases: string[];
    }>;
  }>;
}

export class HierarchyClassifier {
  private manifest: ComponentManifest;

  // Fast path: name/alias matching against manifest (~0ms, no LLM)
  assignFromManifest(entity: KGEntity): { level: 0|1|2|3; parentName?: string } | null

  // Slow path: LLM-based classification for entities that don't match aliases (~1s)
  async assignByLLM(entity: KGEntity, components: string[]): Promise<{ level: 0|1|2|3; parentName: string }>

  // Main entry point -- skips entities that already have hierarchyLevel set
  async assignHierarchy(entities: KGEntity[]): Promise<KGEntity[]>
}
```

The manifest is stored in `config/component-manifest.yaml` (bind-mounted read-only, no Docker rebuild needed):

```yaml
# config/component-manifest.yaml
project: Coding
components:
  - name: LiveLoggingSystem
    aliases: [LSL, LiveLogging, log-streaming, realtime-logging]
    subComponents:
      - name: SessionCapture
        aliases: [specstory, vibe-session, session-log]
  - name: LLMAbstraction
    aliases: [llm-provider, dmr, model-routing, SemanticAnalyzer]
  - name: DockerizedServices
    aliases: [docker, container, compose, coding-services]
  - name: Trajectory
    aliases: [trajectory-analyzer, live-state, trajectory-generation]
  - name: KnowledgeManagement
    aliases: [knowledge-graph, ukb, vkb, knowledge-base]
    subComponents:
      - name: ManualLearning
        aliases: [ukb-script, update-knowledge]
      - name: OnlineLearning
        aliases: [batch-analysis, semantic-analysis]
  - name: ConstraintSystem
    aliases: [constraint-monitor, mcp-constraint, ConstraintRule]
  - name: CodingPatterns
    aliases: [coding-practice, pattern, workflow, generic-wisdom]
```

### Coordinator Integration Point

In `coordinator.ts`, after the `classify_with_ontology` step completes and before `kg_operators`. This is an inline call within the existing batch loop -- no YAML step change needed:

```typescript
// coordinator.ts -- inside executeBatchWorkflow(), per-batch loop
// After: classify_with_ontology step completes, batchEntities has entityType set
// Before: kg_operators.applyAll(...)

// NEW: Assign hierarchy (pure classification, ~50ms per batch for fast path)
const entitiesWithHierarchy = await this.hierarchyClassifier.assignHierarchy(batchEntities);
// entitiesWithHierarchy replaces batchEntities going into kg_operators
```

---

## Data Flow: Migration Script

The one-time migration operates directly on the GraphDB and JSON export, bypassing the pipeline entirely.

**Input:** `.data/knowledge-export/coding.json` (126 entities, 0 relations)

**Process in `scripts/migrate-to-hierarchy.js`:**
1. Load all 126 entities from coding.json
2. Create scaffold nodes: Coding (L0), L1 components, L2 subComponents
3. For each existing entity:
   - Run fast manifest matching (alias check against entity name + entityType)
   - If no match: run LLM classification (entity name + observations -> which component?)
   - Assign hierarchyLevel, parentName
   - Merge-or-keep check: if < 3 observations AND generic name -> merge observations into parent and mark for deletion; otherwise keep as Detail (L3) leaf
4. Call `GraphDatabaseAdapter.storeEntity()` for all scaffold nodes
5. Call `GraphDatabaseAdapter.storeRelationship()` for all child_of edges
6. Re-export to coding.json

**Output:** `.data/knowledge-export/coding.json` (updated: scaffold nodes + 126 entities, with hierarchy edges)

The migration uses `GraphDatabaseAdapter` (not direct `GraphDatabaseService`) to ensure it works through the VKB HTTP API if the server is running, respecting the lock-free architecture.

---

## Data Flow: VKB Tree Navigation

### Current VKB Data Flow

```
GET /api/entities?team=coding
  -> flat Entity[] (no hierarchy attributes)
  -> Redux graphSlice.entities (flat array)
  -> GraphVisualization: D3 force-layout, all 126 nodes, no hierarchy
  -> NodeDetails: name + observations (no parent/children)
```

### New VKB Data Flow

```
GET /api/entities?team=coding
  -> Entity[] (metadata.hierarchyLevel and metadata.parentEntityName now populated)
  -> Redux graphSlice.entities (same structure, metadata richer)
  -> buildHierarchyTree(entities) selector [NEW pure function]
  -> TreeNavigation.tsx [NEW left panel]
     Coding (L0)
       LiveLoggingSystem (L1)
         SessionCapture (L2)
         LiveLoggingArchitectureDecision (L3 leaf)
       KnowledgeManagement (L1)
         ManualLearning (L2)
         OnlineLearning (L2)
  -> Click L1/L2 node: dispatch setHierarchyFilter -> D3 shows subtree only
  -> Click L3 leaf: selectNode -> NodeDetails (existing behavior)
  -> NodeDetails: HierarchyBreadcrumb + children list + existing observations
```

### VKB Tree Implementation

Build a derived selector that transforms the flat `entities[]` array into a tree structure. No API change needed -- `hierarchyLevel` and `parentEntityName` come through `metadata` in the existing entity payload.

```typescript
// src/utils/hierarchyHelpers.ts -- NEW FILE
export interface TreeNode {
  entity: Entity;
  children: TreeNode[];
  level: 0 | 1 | 2 | 3;
}

export function buildHierarchyTree(entities: Entity[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create tree nodes for all entities
  for (const entity of entities) {
    nodeMap.set(entity.name, {
      entity,
      children: [],
      level: (entity.metadata?.hierarchyLevel ?? 3) as 0|1|2|3,
    });
  }

  // Link parent-child relationships
  for (const entity of entities) {
    const node = nodeMap.get(entity.name)!;
    const parentName = entity.metadata?.parentEntityName;
    if (parentName && nodeMap.has(parentName)) {
      nodeMap.get(parentName)!.children.push(node);
    } else if ((entity.metadata?.hierarchyLevel ?? 3) === 0) {
      roots.push(node);
    }
  }

  return roots;
}
```

`TreeNavigation.tsx` renders the tree as a collapsible `ul/li` list (no D3 needed -- pure React). On click, dispatches `setHierarchyFilter` to `filtersSlice`. `GraphVisualization.tsx` applies the filter to restrict D3 to entities at or below the clicked node.

The D3 force-directed graph is preserved -- it still shows force-layout within the filtered subtree. This is additive, not a rewrite.

---

## Component Responsibilities

| Component | Responsibility | New/Modified |
|-----------|---------------|-------------|
| `HierarchyClassifier` | Assign hierarchyLevel + parentName per entity; scaffold node creation | NEW |
| `component-manifest.yaml` | Curated L1/L2 component definitions and aliases | NEW |
| `migrate-to-hierarchy.js` | One-time: classify 126 entities, create scaffold nodes, store edges | NEW |
| `TreeNavigation.tsx` | VKB tree panel: collapsible hierarchy, dispatches filter on click | NEW |
| `HierarchyBreadcrumb.tsx` | Shows root-to-node path in NodeDetails | NEW |
| `hierarchyHelpers.ts` | Pure functions: buildHierarchyTree, getAncestors, getDescendants | NEW |
| `KGEntity` interface | Add hierarchyLevel, parentName, isHierarchyNode (all optional) | MODIFIED |
| `EntityMetadata` interface | Add hierarchyLevel, parentEntityName, childEntityNames, isScaffoldNode | MODIFIED |
| `coordinator.ts` | Call HierarchyClassifier after ontology step, before kg_operators | MODIFIED |
| `persistence-agent.ts` | After storeEntity: if parentName set -> storeRelationship(child_of) | MODIFIED |
| `graphSlice.ts` | Entity interface: add metadata.hierarchyLevel, parentEntityName | MODIFIED |
| `navigationSlice.ts` | Node interface: add metadata.hierarchyLevel, parentEntityName | MODIFIED |
| `filtersSlice.ts` | Add setHierarchyFilter action | MODIFIED |
| `KnowledgeGraph/index.tsx` | Add TreeNavigation panel alongside filters | MODIFIED |
| `NodeDetails.tsx` | Show HierarchyBreadcrumb and children list | MODIFIED |
| `GraphVisualization.tsx` | Apply hierarchy filter to restrict D3 node set | MODIFIED |

---

## Build Order (Dependency-Aware)

The four deliverables have strict dependencies:

```
Phase 1: Schema + Config
  -> Phase 2: Migration (needs schema, accesses live GraphDB)
  -> Phase 3: Pipeline HierarchyClassifier (needs schema, benefits from migration data for testing)
  -> Phase 4: VKB Tree Navigation (needs hierarchical data from Phase 2+3 to be testable)
```

### Phase 1: Schema + Config (no runtime impact, no Docker needed)

1. Extend `KGEntity` in `kg-operators.ts` -- add optional hierarchy fields
2. Extend `EntityMetadata` in `persistence-agent.ts` -- add hierarchy to metadata
3. Add `Component` and `SubComponent` to `coding-ontology.json` lower ontology
4. Create `config/component-manifest.yaml` -- curated L1/L2/L3 list (bind-mounted, no rebuild)
5. Extend `Entity` in `graphSlice.ts` -- add `metadata.hierarchyLevel`, `metadata.parentEntityName`
6. Extend `Node` in `navigationSlice.ts` -- same additions
7. Create `src/utils/hierarchyHelpers.ts` in memory-visualizer -- pure functions, no runtime deps

After steps 1-3: `npm run build` in `integrations/mcp-server-semantic-analysis` + Docker rebuild for coding-services. Steps 4-7 have no build requirements.

### Phase 2: Migration Script (standalone, runs against live GraphDB)

1. Write `scripts/migrate-to-hierarchy.js`
2. Test: `node scripts/migrate-to-hierarchy.js --dry-run`
3. Run: `node scripts/migrate-to-hierarchy.js`

No Docker rebuild needed -- script runs on the host, routes to VKB API if running.

### Phase 3: Pipeline HierarchyClassifier

1. Create `src/agents/hierarchy-classifier.ts`
2. Modify `coordinator.ts` -- call classifier after ontology, before kg_operators
3. Modify `persistence-agent.ts` -- storeRelationship(child_of) after storeEntity when parentName set
4. `npm run build` in `integrations/mcp-server-semantic-analysis`
5. Docker rebuild for coding-services

Test: run `ukb full` with `maxBatches: 1` and verify new entities have hierarchyLevel set.

### Phase 4: VKB Tree Navigation

1. Create `TreeNavigation.tsx` -- collapsible tree using `buildHierarchyTree()`
2. Add `setHierarchyFilter` to `filtersSlice.ts`
3. Apply hierarchy filter in `GraphVisualization.tsx`
4. Create `HierarchyBreadcrumb.tsx`
5. Update `KnowledgeGraph/index.tsx` -- add TreeNavigation panel
6. Update `NodeDetails.tsx` -- add breadcrumb and children list
7. `npm run build` in `integrations/system-health-dashboard` (bind-mounted, no Docker rebuild)

---

## Architectural Patterns

### Pattern 1: Additive Schema Extension

**What:** Add hierarchy fields as optional fields to existing interfaces. Never replace or remove existing fields.
**When to use:** Adding features to a working system where backward compatibility matters.
**Trade-offs:** Safe -- existing code paths continue to work. Existing entities without hierarchy fields are valid. The GraphDatabaseService spread pattern (`{ ...entityWithoutRelationships }`) passes new attributes through automatically with zero changes to storage code.

```typescript
// Correct -- new fields are optional
export interface KGEntity {
  // existing required fields unchanged
  hierarchyLevel?: 0 | 1 | 2 | 3;  // optional, existing entities unaffected
  parentName?: string;
}

// Wrong -- breaks all existing KGEntity construction sites
export interface KGEntity {
  hierarchyLevel: 0 | 1 | 2 | 3;   // required, would break all existing usage
}
```

### Pattern 2: Scaffold-First Hierarchy

**What:** Create hierarchy structure (Coding -> L1 components -> L2 subComponents) as explicit graph nodes before assigning existing entities into it.
**When to use:** The hierarchy skeleton is curated by the user, not inferred from data.
**Trade-offs:** Migration and pipeline can do a simple name lookup rather than on-demand creation. Scaffold nodes are always present before leaf entities try to reference them as parents.

```typescript
// Migration: create scaffolds before processing existing entities
await adapter.storeEntity({ name: 'Coding', entityType: 'Project',
  metadata: { hierarchyLevel: 0, isScaffoldNode: true } });
await adapter.storeEntity({ name: 'LiveLoggingSystem', entityType: 'Component',
  metadata: { hierarchyLevel: 1, isScaffoldNode: true, parentEntityName: 'Coding' } });
// ... then process existing 126 entities and assign them under scaffold nodes
```

### Pattern 3: Lock-Free GraphDB Access via VKB API

**What:** Migration script and pipeline both use `GraphDatabaseAdapter`, which routes to the VKB HTTP API (localhost:8080) when running, direct LevelDB access otherwise.
**When to use:** Any script that runs while the VKB server may be up.
**Trade-offs:** LevelDB has an exclusive lock. Bypassing the adapter and opening LevelDB directly from a script while the VKB server holds the lock causes `EBUSY`. The adapter already handles this routing automatically.

```javascript
// Correct -- adapter auto-routes based on server availability
const adapter = new GraphDatabaseAdapter(DEFAULT_DB_PATH, 'coding');
await adapter.initialize();  // routes to API if server up, direct if not
await adapter.storeRelationship({ from: childName, to: parentName, relationType: 'child_of' });

// Wrong -- bypasses lock-free routing, causes EBUSY if VKB server is running
const graphDB = new GraphDatabaseService({ dbPath: DEFAULT_DB_PATH });
await graphDB.initialize();
```

### Pattern 4: Manifest-First, LLM-Fallback Classification

**What:** Match entities against the curated component manifest first (O(n x aliases) string matching). Only call LLM for entities that don't match any alias.
**When to use:** Classification where the target classes are known and well-defined.
**Trade-offs:** The majority of entities match a component alias. LLM calls are ~1s each. With a well-crafted alias list, LLM may only need to handle 10-20% of entities, keeping migration fast (< 30s total) and pipeline overhead minimal (< 100ms per batch for fast path).

### Pattern 5: Frontend Tree from Flat API (No New Backend Endpoint)

**What:** The existing `/api/entities` endpoint returns entities with hierarchy attributes in metadata. Frontend builds the tree using `buildHierarchyTree()` pure function.
**When to use:** Backend data model is already adequate and only presentation changes.
**Trade-offs:** No backend changes needed. Tree-building logic lives in the frontend where it's easier to test and iterate. The flat entity list remains the canonical API -- hierarchy is a view over the same data.

---

## Anti-Patterns

### Anti-Pattern 1: Hierarchy Only in Edges, Not Node Attributes

**What happens:** Hierarchy encoded purely as graph edges. Level and parent derived by traversing edges at query time.
**Why it's wrong:** VKB API returns flat entity lists -- no graph traversal. Frontend cannot display `hierarchyLevel` or `parentName` without additional API calls per entity.
**Do this instead:** Store `hierarchyLevel` and `parentEntityName` as node attributes AND create the edges. Attributes make data self-describing for flat API responses; edges enable graph traversal queries. Both are needed.

### Anti-Pattern 2: Adding Hierarchy Logic to GraphDatabaseService.storeEntity()

**What happens:** Hierarchy inference (auto-create parent nodes, auto-create edges) added directly inside `storeEntity()`.
**Why it's wrong:** `GraphDatabaseService` is used by multiple consumers. Adding hierarchy logic there creates tight coupling -- every entity write triggers hierarchy inference, which may not be correct for all consumers.
**Do this instead:** Hierarchy assignment happens BEFORE calling `storeEntity()`. The entity is fully attributed when it reaches storage. Relationship storage is an explicit call after entity storage, not an implicit side effect.

### Anti-Pattern 3: New /api/entities/tree Endpoint

**What happens:** A new backend endpoint returns entities structured as a tree JSON.
**Why it's wrong:** Duplicates tree-building logic in the backend. Adds complexity to api-routes.js and KnowledgeQueryService. The existing /api/entities already returns all needed data if entities have hierarchy attributes.
**Do this instead:** Build the tree in the frontend from the flat entity list using `buildHierarchyTree()` in `hierarchyHelpers.ts`.

### Anti-Pattern 4: Rewriting VKB's D3 Graph for Tree Layout

**What happens:** Replacing force-directed D3 graph with `d3.tree()` hierarchy layout for the entire VKB view.
**Why it's wrong:** Force-directed layout is valuable for seeing relationship clusters within a component. The existing D3 code is working and complex -- rewriting it is high risk for low gain.
**Do this instead:** Add a tree navigation panel ALONGSIDE the existing D3 graph. Tree panel acts as a filter/drill-down UI. D3 shows the selected subtree using its existing force-directed layout. Additive, not a rewrite.

### Anti-Pattern 5: LLM Classification for Every Entity on Every Pipeline Run

**What happens:** HierarchyClassifier calls LLM for every entity in every batch, including entities already in `accumulatedKG` with hierarchy assigned from previous batches.
**Why it's wrong:** Entities in `accumulatedKG` from previous batches already have `hierarchyLevel` and `parentName` set via dedup+merge. Re-classifying wastes tokens and time.
**Do this instead:** Skip entities where `hierarchyLevel !== undefined`. Only classify newly encountered entities.

---

## Integration Points with Existing Ontology

The ontology currently defines entity classes but not hierarchy classes. Two new classes need adding to `coding-ontology.json`:

```json
{
  "classes": {
    "Component": {
      "description": "A major subsystem of the Coding project (L1 hierarchy node)",
      "parent": "Project",
      "properties": { "hierarchyLevel": 1, "isScaffoldNode": true }
    },
    "SubComponent": {
      "description": "A sub-area within a Component (L2 hierarchy node)",
      "parent": "Component",
      "properties": { "hierarchyLevel": 2, "isScaffoldNode": true }
    }
  }
}
```

Without this, `OntologyClassificationAgent` will classify scaffold nodes as 'Unclassified', causing `GraphDatabaseAdapter.storeEntity()` to throw (`Cannot store entity: entityType is Unclassified`).

**Recommended approach:** Scaffold nodes bypass the pipeline entirely -- they are created by the migration script and HierarchyClassifier with their type already set to 'Component' or 'SubComponent'. They never flow through `OntologyClassificationAgent`. The ontology addition just satisfies PersistenceAgent's validation check.

---

## Scalability Considerations

This is a single-user, single-team system. Scalability concerns are about data volume, not concurrent users.

| Scale | Entity Count | Concern | Approach |
|-------|-------------|---------|----------|
| Current | 126 entities | None | Any approach works |
| After 10 pipeline runs | ~500 entities | VKB D3 performance | Hierarchy filter limits visible nodes to ~10-30 |
| After 100 pipeline runs | ~2000 entities | LevelDB query time | Graphology in-memory stays fast; hierarchy pruning helps |

The D3 force simulation is the bottleneck. With subtree filtering (show only the selected component's entities), the visible node count drops from ~500 to ~10-30, well within D3's performance envelope.

---

## Sources

- Direct inspection of `src/knowledge-management/GraphDatabaseService.js` -- storeEntity(), storeRelationship(), CollectiveKnowledge auto-linking logic (lines 200-420)
- `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` -- lock-free routing pattern (lines 1-200)
- `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` -- KGEntity interface (lines 31-43)
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` -- SharedMemoryEntity, EntityMetadata interfaces (lines 1-150)
- `integrations/mcp-server-semantic-analysis/config/workflows/batch-analysis.yaml` -- 16-step pipeline, phase assignments, coordinator integration points
- `lib/vkb-server/api-routes.js` -- REST endpoints, entity pass-through pattern
- `lib/ukb-unified/core/VkbApiClient.js` -- API client interface
- `integrations/memory-visualizer/src/store/slices/graphSlice.ts` -- Entity, Relation, GraphState interfaces
- `integrations/memory-visualizer/src/store/slices/navigationSlice.ts` -- Node interface (D3 simulation fields)
- `integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx` -- D3 force layout, filter chain
- `integrations/memory-visualizer/src/components/KnowledgeGraph/NodeDetails.tsx` -- detail panel structure
- `integrations/memory-visualizer/src/components/KnowledgeGraph/index.tsx` -- component composition, Redux integration
- `.data/knowledge-export/coding.json` -- live entity snapshot (126 entities, 0 relations, type distribution: 46 KnowledgeEntity, 19 MCPAgent, 12 WorkflowDefinition, 11 ConstraintRule, 10 SemanticAnalyzer, 6 ConfigurationFile, 5 CodingArtifact, 4 GraphDatabase, 1 Project, 1 System)
- `scripts/knowledge-management/migrate-entities.js` -- existing migration script as implementation reference

---

*Architecture research for: hierarchical knowledge graph restructuring (v2.0 milestone)*
*Researched: 2026-03-01*

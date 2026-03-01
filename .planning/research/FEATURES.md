# Feature Research

**Domain:** Hierarchical Knowledge Graph Restructuring (agentic coding environment)
**Researched:** 2026-03-01
**Confidence:** HIGH (direct codebase inspection + verified external patterns)

---

## Context: What Already Exists

Before mapping features, it is critical to understand what the existing system provides so new features are scoped correctly.

**Already working (do not rebuild):**
- 126 flat entities in Graphology + LevelDB (`.data/knowledge-graph/`)
- Entities stored with directed edges via `storeRelationship()` -- edge type is a string attribute
- `CollectiveKnowledge` -> `Project` hierarchy partially exists via auto-created "includes" edges
- VKB server at port 8080 with Express + static SPA; API routes for `/api/entities`, `/api/relations`, `/api/stats`
- `GraphMigrationService` with backup, extract, transform, load, verify phases (SQLite->Graph pattern -- reusable structure)
- `graphology-dag` and `graphology-traversal` in standard library: topological sort, BFS/DFS from node, cycle detection
- `@radix-ui/react-collapsible` and `@radix-ui/react-accordion` already in dashboard deps -- tree UI primitives available without new npm installs

**Critical gap:** No `parentId` / `level` / `path` attributes on nodes. Hierarchy is implicit via edge type "includes", not explicit on the node. The VKB frontend has no tree/drill-down UI -- it shows a flat list. Existing 126 entities have no relationship edges at all (confirmed from export inspection).

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the system must have for the hierarchy restructuring to be functional. Missing these = the milestone goal is not met.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Hierarchical entity schema | Nodes must carry `parentId`, `level` (0-3), `path` for tree traversal without expensive graph queries | MEDIUM | Extend `GraphEntity` interface; backward-compatible (optional fields). Graphology node attributes accept arbitrary keys. |
| Curated L2 component nodes | User specified: LSL, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement. Must exist as real nodes before migration assigns children. | LOW | Seed script or migration step 0. Each node needs a description, not just a name. |
| Parent-child edge type "contains" | A dedicated edge type distinct from existing "relates-to" / "includes". Graphology edges support typed attributes today. | LOW | Use `relationType: 'contains'` in existing `storeRelationship()`. Do NOT reuse "includes" (already overloaded by CollectiveKnowledge auto-logic). |
| One-time migration script | Reassign 126 flat entities to hierarchy positions. Must be idempotent and reversible. | HIGH | Reuse GraphMigrationService backup/verify pattern. LLM-assisted classification for ambiguous entities; rule-based for clear-cut ones. |
| Entity merge for generic nodes | ~40-50 entities are generic KnowledgeEntity type with overlapping content. Must be merged into parent component nodes, not left as orphan leaves. | HIGH | Requires semantic similarity check + merge strategy (aggregate observations into parent, update all edges that pointed to merged nodes). Hardest single piece. |
| Pipeline hierarchy assignment | Future `ukb full` runs must produce entities with correct `parentId` and `level`. Coordinator must determine hierarchy position during batch. | HIGH | Requires hierarchy classification prompt + lookup of existing component nodes before entity creation. Changes coordinator create-then-classify order. |
| VKB tree navigation | Sidebar with collapsible tree: Coding -> Component -> SubComponent -> Detail. Click navigates to entity detail panel. | MEDIUM | `@radix-ui/react-collapsible` or `@radix-ui/react-accordion` already available. New VKB frontend component only. |
| Breadcrumb trail | When viewing a detail entity, show: Coding > KnowledgeManagement > OnlineLearning > EntityName | LOW | Computed from `path` attribute or by walking `parentId` chain up to root. |
| Backward-compatible flat list | VKB must still show all entities in existing flat list view if tree fails to load | LOW | Fallback is current behavior -- no regression if tree panel is additive. |

### Differentiators (Competitive Advantage)

Features that make this knowledge graph notably more useful than a flat list.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Component summary observations | Each L2 node carries LLM-synthesized observations describing the component. Future pipeline runs aggregate child observations upward. | MEDIUM | LLM synthesis pass during migration to generate component descriptions. Enables "what is DockerizedServices about?" queries. |
| Auto-discovery of L3 sub-components | During migration, system discovers L3 groupings from entity names and types beyond user-specified ones. E.g., KnowledgeManagement -> [ManualLearning, OnlineLearning, GraphStorage, ExportPipeline]. | MEDIUM | Clustering by entity name prefix + LLM grouping suggestion. Show proposed groupings for user validation before commit. |
| Architecture diagrams on component nodes | PlantUML diagrams attached as metadata to L2 nodes; VKB renders them inline as collapsible panels. | MEDIUM | Storage: metadata field on node. VKB: render PlantUML PNG. Already use `plantuml` CLI. |
| CodingPatterns aggregation node | Generic "programming wisdom" entities (TypedReduxHooks, ErrorHandlingPattern, AsyncActionPattern, etc.) merged into a CodingPatterns component. | LOW | Define as known L2 node in migration seed. High-value cleanup with low implementation cost. |
| Hierarchy-aware search | VKB search returns results annotated with their hierarchy path (e.g., "found in KnowledgeManagement / GraphStorage"). | MEDIUM | Requires `path` attribute on nodes and search result rendering change. |
| Level-scoped API queries | `/api/entities?level=2` or `/api/entities?parentId=coding:KnowledgeManagement` for programmatic access. | LOW | Additive query params to existing `/api/entities` route. No breaking changes. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fully automated LLM assignment for all 126 entities | Seems like it saves effort | LLM hallucination rate on ambiguous entity names is high; running LLM on all 126 adds API cost and latency for a one-time migration | Use LLM only for ambiguous entities; rule-based assignment for clear-cut ones (e.g., entity_type=LSLSession -> LiveLoggingSystem) |
| Deep hierarchy beyond 4 levels | Feels comprehensive | Beyond L4 the UI becomes unusable; users lose their place; 4 levels is the maximum practical depth per established HKG research and UX guidelines | Hard cap at 4 levels: L0=Coding project, L2=Component, L3=SubComponent, L4=Detail leaf |
| Real-time hierarchy update during pipeline run | Keeps VKB current | Creating parent nodes mid-batch causes race conditions with concurrent agents writing children to the same parent; LevelDB is single-writer | Write all hierarchy updates at end of pipeline run (post-persist aggregation step) |
| Automatic cycle detection as hard blocker during migration | Safety guarantee | Current "includes" edges may form informal cycles; blocking on cycle detection will halt migration unexpectedly | Run `hasCycle()` as a diagnostic report after migration, not a hard stop; fix cycles manually |
| Force-directed graph visualization | Looks impressive | Already tried in this codebase; used only for pipeline debugging; for knowledge navigation a tree sidebar is strictly more useful | Tree sidebar is faster to read and faster to build |
| Full-text search across observations in this milestone | Useful capability | Qdrant integration is already stubbed (`QdrantSyncService.js`) -- activating it is a separate milestone with its own complexity | Defer to v3.0 / Qdrant activation milestone |

---

## Feature Dependencies

The following dependency relationships must inform phase ordering in the roadmap.

**Hierarchical entity schema (parentId, level, path on GraphEntity + SharedMemoryEntity)** is required by: one-time migration script, pipeline hierarchy assignment, VKB tree navigation, breadcrumb trail, level-scoped API queries.

**Curated L2 component nodes seeded into graph** is required by: one-time migration script, pipeline hierarchy assignment.

**One-time migration script** enables: entity merge for generic nodes, component summary observations, auto-discovery of L3 sub-components.

**VKB tree navigation component** requires: level-scoped API query filter (or parentId filter on /api/entities). Enhanced by: breadcrumb trail, hierarchy-aware search.

**Pipeline hierarchy assignment** is enhanced by: component summary observations (aggregation step post-persist).

### Dependency Notes

- Schema is the foundation. `parentId`, `level`, and `path` must be defined on both `GraphEntity` (storage adapter) and `SharedMemoryEntity` (coordinator/persistence) before any migration or pipeline work. This is a type-only change with backward compatibility -- existing nodes simply lack these fields until migrated.
- Seed nodes before migration. L2 component nodes must exist in the graph before migration can assign `parentId` references. Migration step 0 = seed components; step 1 = classify and assign children.
- Migration before pipeline changes. Do not deploy pipeline hierarchy assignment until after migration completes, or the graph will have mixed flat/hierarchical state that complicates the tree view.
- VKB tree depends on API filtering, not schema directly. Adding `?parentId=` and `?level=` query params to the existing `/api/entities` route is sufficient -- no new API routes required.

---

## MVP Definition

### Launch With (this milestone -- all P1)

Minimum to call the v2.0 milestone complete.

- [ ] Schema extension: `parentId`, `level`, `path` on `GraphEntity` and `SharedMemoryEntity` -- foundational; all other features require this
- [ ] Seed script: create L2 component nodes (LSL, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns) with descriptions
- [ ] Migration script: classify all 126 entities by hierarchy position, merge low-value generics into CodingPatterns, assign `parentId` + `level` + `path`
- [ ] Pipeline hierarchy assignment: coordinator classifies new entities by hierarchy position during batch before persisting
- [ ] VKB tree navigation panel: collapsible tree sidebar, entity detail panel on click, breadcrumb trail

### Add After Validation (post-milestone)

- [ ] Component summary observations -- when users find L2 nodes feel empty without synthesized context
- [ ] Architecture diagrams on L2 nodes -- when PlantUML integration becomes convenient
- [ ] Level-scoped and parentId-filtered API queries -- when other tools need programmatic hierarchy access
- [ ] Hierarchy-aware search results -- when users struggle to locate entities by name alone

### Future Consideration (v3+)

- [ ] Auto-discovery of additional L3 sub-components via embedding clustering -- requires Qdrant activation
- [ ] Full-text semantic search across observations -- separate milestone
- [ ] Hierarchy decay / pruning for stale nodes -- `KnowledgeDecayTracker.js` is already stubbed, activate later

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Schema extension (parentId, level, path) | HIGH | LOW | P1 |
| Seed L2 component nodes | HIGH | LOW | P1 |
| One-time migration script | HIGH | HIGH | P1 |
| Entity merge (generic -> CodingPatterns) | HIGH | HIGH | P1 |
| Pipeline hierarchy assignment | HIGH | HIGH | P1 |
| VKB tree navigation | HIGH | MEDIUM | P1 |
| Breadcrumb trail in VKB | MEDIUM | LOW | P2 |
| Level-scoped API queries | MEDIUM | LOW | P2 |
| Component summary observations | HIGH | MEDIUM | P2 |
| Architecture diagrams on L2 nodes | MEDIUM | MEDIUM | P2 |
| Hierarchy-aware search | MEDIUM | MEDIUM | P3 |
| Auto-discovery of L3 sub-components | LOW | HIGH | P3 |

**Priority key:**
- P1: Required for milestone to be complete
- P2: High value, add within milestone sprint when P1 is stable
- P3: Valuable, defer to follow-on sprint

---

## Complexity Callouts (What to Watch For)

### Entity merge is the most complex single feature

Merging entities requires: (1) identifying candidates via semantic similarity, shared name prefix, overlapping ontology type; (2) deciding merge direction -- surviving node vs. absorbed nodes; (3) combining observations without duplication; (4) updating all existing edges that pointed to absorbed nodes to point to the survivor; (5) deleting absorbed nodes cleanly from both Graphology in-memory graph and LevelDB persistence.

Graphology supports all of this via node/edge APIs, but the edge-update step (4) is easy to miss. Missing it leaves dangling edges in the graph pointing to deleted nodes.

### Pipeline hierarchy assignment requires a "lookup before create" pattern

The coordinator currently creates entities then classifies them. For hierarchy, it must: (1) load existing L2/L3 component nodes at batch start; (2) classify which component a new entity belongs to (LLM call with component list as context); (3) set `parentId`, `level`, `path` before persisting.

This changes the coordinator create-then-classify order to classify-hierarchy-then-create. It is an architectural change to the coordinator loop, not just adding a new field.

### VKB frontend must handle missing hierarchy gracefully

Entities created before migration, or during a run before migration completes, will lack `parentId`. The tree component must: fall back to flat list for entities without `parentId`; show an "Unassigned" bucket at the root level for orphans; never crash if `level` is undefined.

### Graphology DAG constraint on "contains" edges

Parent-child "contains" edges are directed parent -> child. If existing cross-reference edges point back up the tree, adding "contains" edges can create cycles. Use `graphology-dag`'s `willCreateCycle()` as a guard before adding any "contains" edge during migration. Run `hasCycle()` as a full validation step after migration completes.

---

## Existing Infrastructure Relevant to This Milestone

| Capability | Location | Relevance |
|------------|----------|-----------|
| Graphology DAG functions | `graphology-dag` npm pkg | topologicalSort, willCreateCycle, hasCycle -- use for migration ordering and validation |
| BFS/DFS traversal | `graphology-traversal` npm pkg | Walk component subtrees to collect descendants, compute paths |
| GraphMigrationService | `src/knowledge-management/GraphMigrationService.js` | Backup/extract/transform/load/verify pattern -- reuse structure for hierarchy migration |
| VKB API server | `lib/vkb-server/api-routes.js` | Add `?level=` and `?parentId=` query params to existing `/api/entities` handler |
| Collapsible UI primitives | `@radix-ui/react-collapsible`, `@radix-ui/react-accordion` in dashboard deps | Build tree sidebar without new npm packages |
| Entity type classification | 16 distinct entity_type values in current 126 entities | Rule-based hierarchy assignment: LSLSession -> LSL, MCPAgent -> KnowledgeManagement, WorkflowDefinition -> Trajectory |

---

## Sources

- Graphology DAG standard library: https://graphology.github.io/standard-library/dag.html (HIGH confidence)
- Graphology traversal standard library: https://graphology.github.io/standard-library/traversal.html (HIGH confidence)
- Interaction Design for Trees (UX patterns): https://medium.com/@hagan.rivers/interaction-design-for-trees-5e915b408ed2 (MEDIUM confidence)
- Hierarchical Knowledge Graphs overview: https://www.emergentmind.com/topics/hierarchical-knowledge-graphs (MEDIUM confidence)
- Breadcrumbs UX (Nielsen Norman Group): https://www.nngroup.com/articles/breadcrumbs/ (HIGH confidence)
- Drill-down navigation UX: https://www.toptal.com/designers/ux/multilevel-menu-design (MEDIUM confidence)
- LeanRAG hierarchical KG aggregation: https://arxiv.org/html/2508.10391v1 (MEDIUM confidence)
- Direct codebase inspection: `integrations/mcp-server-semantic-analysis/src/`, `lib/vkb-server/`, `src/knowledge-management/`, `.data/knowledge-export/coding.json` (HIGH confidence)

---

*Feature research for: Hierarchical Knowledge Graph Restructuring (v2.0 milestone)*
*Researched: 2026-03-01*

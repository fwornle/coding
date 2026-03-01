# Project Research Summary

**Project:** Hierarchical Knowledge Graph Restructuring (v2.0 Milestone)
**Domain:** Multi-agent knowledge graph pipeline — flat-to-hierarchical entity migration
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

This milestone restructures the existing flat-entity knowledge graph (126 entities, 0 relations, single-level) into a 4-level hierarchy: Coding (L0 root) -> major components like LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns (L1) -> sub-components like ManualLearning, OnlineLearning (L2) -> detail leaf entities (L3). The existing Graphology + LevelDB storage already supports this natively — node attributes are arbitrary JSON and edges are typed — but no code currently sets hierarchy fields or creates parent-child edges. The work is an additive extension to working infrastructure, not a rewrite.

The recommended approach follows a strict 4-phase sequence dictated by hard dependencies: (1) schema first so all interfaces are consistent before any data moves, (2) one-time migration to retrofit the 126 existing entities into the hierarchy, (3) pipeline changes so future `ukb full` runs produce hierarchical entities, (4) VKB tree navigation UI as the final consumer. Attempting any phase out of order creates an inconsistent mixed state that is costly to debug. The two largest complexity items are the entity merge operation (merging ~40-50 generic nodes into CodingPatterns) and pipeline hierarchy assignment (which changes the create-then-classify order to classify-hierarchy-then-create).

The dominant risk category is silent field loss through the pipeline. The v1.0 milestone already suffered the `entityType`/`type` disconnect bug where classification results were silently discarded at persistence. The hierarchy fields (`parentId`, `level`, `hierarchyPath`) will face the same trap: TypeScript structural typing allows extra fields through casts without verifying they survive explicit object literal reconstruction in `processEntity()`. Every phase must include an end-to-end round-trip test that verifies hierarchy fields survive from coordinator through deduplication through `persistEntities()` through `storeEntity()` through `getEntity()` before declaring the phase complete.

## Key Findings

### Recommended Stack

The existing stack requires only two new npm packages. `graphology-traversal` ^0.3.1 is needed in the MCP server submodule to perform BFS from the Coding root node — it is the official Graphology standard library package and is peer-compatible with the installed graphology ^0.25.4. `react-arborist` ^3.4.3 is needed in the VKB viewer for the tree panel — it is virtualized, has built-in TypeScript types, requires no design system, and is compatible with React 18.2.0. All other dependencies (`graphology-dag`, `@radix-ui/react-collapsible`, Node.js built-in `fetch`) are already installed.

The migration script requires no new packages — it follows the established pattern from `scripts/purge-knowledge-entities.js`, using the VKB HTTP API at localhost:8080 to avoid LevelDB lock conflicts. No new backend API routes are required: the existing `/api/entities` endpoint already passes through node attributes, so `parentId` and `level` appear automatically once stored.

**Core technologies:**
- `graphology` ^0.25.4 (installed): in-memory graph — hierarchy edges stored via `storeRelationship()` with `relationType: 'contains'`
- `graphology-traversal` ^0.3.1 (new, MCP server): BFS/DFS from root node for tree building and migration ordering
- `graphology-dag` (installed): `hasCycle()` and `willCreateCycle()` guards during migration edge creation
- `react-arborist` ^3.4.3 (new, VKB viewer): virtualized collapsible tree panel with TypeScript support
- `level` ^10.0.0 (installed): LevelDB persistence — no changes; hierarchy fields flow through automatically via attribute spread
- Node.js 18+ `fetch` (built-in): migration script HTTP calls to VKB API

**Critical version requirement:** Docker rebuild is mandatory after every TypeScript change to `integrations/mcp-server-semantic-analysis/` — the container copies `dist/` at build time. No hot-reload exists. This is the single most common failure mode in this project.

### Expected Features

The milestone delivers a functional hierarchy from migration through pipeline through UI. Five features are P1 (required for milestone completion); four are P2 (add within milestone sprint when P1 is stable); three are deferred to v3+.

**Must have (P1 — table stakes):**
- Schema extension: `parentId`, `level`, `hierarchyPath` on `KGEntity`, `SharedMemoryEntity`, `persistEntities()` parameter, and `GraphEntity` adapter — all four simultaneously in one commit
- Seed script: create L2 component nodes (LSL, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns) with descriptions before migration
- One-time migration script: classify all 126 entities, merge generic nodes into CodingPatterns, assign hierarchy fields, create `contains` edges
- Pipeline hierarchy assignment: `HierarchyClassifier` agent inserted after ontology step, before kg_operators; uses `component-manifest.yaml` for fast alias matching with LLM fallback
- VKB tree navigation panel: collapsible tree sidebar, entity detail on click, breadcrumb trail

**Should have (P2 — add when P1 stable):**
- Component summary observations: LLM-synthesized descriptions on L1/L2 nodes
- Level-scoped API queries: `?level=2` and `?parentId=coding:KnowledgeManagement` filters on `/api/entities`
- Architecture diagrams on L2 nodes: PlantUML metadata field rendered in VKB as collapsible panel

**Defer (v3+):**
- Full-text semantic search across observations (requires Qdrant activation, separate milestone)
- Auto-discovery of additional L3 sub-components via embedding clustering
- Hierarchy decay/pruning for stale nodes (`KnowledgeDecayTracker.js` already stubbed)

**Key anti-features to avoid:**
- Fully automated LLM assignment for all 126 entities — too expensive and inaccurate for a one-time migration; use keyword heuristics first, LLM only for ~10-20% ambiguous entities
- Hierarchy beyond 4 levels — UX becomes unusable
- Real-time hierarchy update during pipeline runs — race conditions with concurrent agents writing to the same parent node in LevelDB
- New `/api/entities/tree` backend endpoint — unnecessary; build the tree in the frontend from `parentId` attributes on the flat entity list

### Architecture Approach

The architecture is additive throughout. No existing components are replaced. `GraphDatabaseService.storeEntity()` requires zero changes because the existing `{ ...entityWithoutRelationships }` spread automatically stores any extra attributes. Four new files are created (HierarchyClassifier, component-manifest.yaml, migration script, TreeNavigation/HierarchyBreadcrumb in VKB). Eight existing files are modified with targeted additions. The storage layer, VKB API server, and workflow YAML are unchanged.

The data flow for hierarchy assignment follows: `OntologyClassificationAgent` sets `entityType` (existing) -> `HierarchyClassifier.assignHierarchy()` (new, inline in coordinator) sets `hierarchyLevel` and `parentName` from manifest lookup -> `KGOperators` dedup/merge (modified to preserve hierarchy fields) -> `PersistenceAgent.processEntity()` (modified to copy hierarchy fields into `SharedMemoryEntity`) -> `GraphDatabaseService.storeEntity()` (unchanged) + explicit `storeRelationship(child, parent, 'contains')` call.

**Major components:**
1. `HierarchyClassifier` (new) — fast manifest alias matching with LLM fallback; creates scaffold nodes for missing L1/L2 parents; skips entities already classified (where `hierarchyLevel !== undefined`)
2. `component-manifest.yaml` (new) — curated L1/L2 definitions and aliases; bind-mounted, no Docker rebuild needed on config changes
3. `migrate-to-hierarchy.js` (new) — one-time script; reads from live graph via `GraphDatabaseAdapter`; dry-run flag required; creates scaffold nodes, classifies 126 entities, merges generics, stores `contains` edges
4. `TreeNavigation.tsx` (new) — VKB collapsible tree panel built from `buildHierarchyTree()` pure function; dispatches `setHierarchyFilter` on click; pure React `ul/li`, no D3
5. `HierarchyBreadcrumb.tsx` (new) — shows root-to-node path in NodeDetails panel computed from `parentId` chain

**Key pattern — Manifest-First, LLM-Fallback Classification:** Match entities against curated aliases (O(n x aliases), ~0ms) before calling LLM. With a well-crafted alias list, LLM handles only ~10-20% of entities, keeping migration under 30s and per-batch overhead under 100ms.

**Key pattern — Frontend Tree from Flat API:** Build `TreeNode[]` hierarchy in the frontend from `parentId` attributes already present on the flat `/api/entities` response. No new backend endpoint needed.

### Critical Pitfalls

1. **KGEntity/SharedMemoryEntity field disconnect** — Hierarchy fields added to `KGEntity` but not to `SharedMemoryEntity`'s explicit object literal construction in `processEntity()` will be silently discarded at persistence. TypeScript structural typing does not catch this. This is the same mechanism as the v1.0 `entityType`/`type` disconnect bug. Prevention: update all four interfaces simultaneously in Phase 1 and write a round-trip integration test.

2. **Dedup operator collapses parent nodes on second pipeline run** — `mergeEntities()` uses `...existing` spread then overwrites select fields. If an incoming entity has `parentId: undefined` (unset), it overwrites the component node's `parentId`. Prevention: add null-coalescing in `mergeEntities()`: `parentId: incoming.parentId ?? existing.parentId`. Add component node names to `PROTECTED_ENTITY_TYPES`.

3. **LevelDB and JSON export out of sync after migration** — A migration script that bypasses `GraphDatabaseAdapter` and opens LevelDB directly will not attach `GraphKnowledgeExporter`, leaving the JSON export stale. Prevention: always use `GraphDatabaseAdapter` (not `GraphDatabaseService` directly); stop VKB server before running migration so the adapter enters direct-mode and attaches the exporter.

4. **LLM hierarchy misclassification by surface name patterns** — Without component descriptions in the prompt, LLMs match on surface keywords ("Docker" -> DockerizedServices even for trajectory debug entities). Prevention: build keyword heuristics first; include component descriptions (not just names) in LLM prompt; manually audit a 20-entity sample.

5. **Docker rebuild forgotten after TypeScript changes** — Documented in CLAUDE.md and MEMORY.md as a recurring issue. Container health endpoint shows "healthy" regardless of code version. The container silently runs stale `dist/`. Prevention: make `stat dist/agents/kg-operators.js` mtime vs `src/agents/kg-operators.ts` mtime check the first item in every phase's completion checklist.

**Additional pitfalls:**
- D3 force layout collapses when hierarchy edges are added (120+ edges on 136 nodes creates hub-and-spoke collapse) — filter `contains` edges from D3 link force; tree navigation uses React, not D3
- Bold formatting reintroduced from stale `coding.json` if migration reads from the JSON export rather than live LevelDB — verify with `grep -c '\*\*' .data/knowledge-export/coding.json` = 0 before migration

## Implications for Roadmap

The phase structure is dictated by hard dependencies. Schema must precede everything. Migration must precede pipeline changes (deploying hierarchical pipeline to a flat graph creates a mixed state that complicates the tree view). Pipeline must run before VKB tree is useful to validate against real data. Four phases, no reordering.

### Phase 1: Schema and Configuration Foundation

**Rationale:** All other phases write or read hierarchy fields. If the interfaces are inconsistent, field loss is silent and debugging is expensive. This is the lesson from the v1.0 entityType/type bug. Phase 1 has zero runtime impact and no Docker rebuild requirement — type changes only in MCP server submodule; VKB type changes are build-only.
**Delivers:** Consistent TypeScript interfaces across all four systems (MCP server `KGEntity`, persistence `SharedMemoryEntity`/`processEntity()`, GraphDB adapter `GraphEntity`, VKB `Entity`/`Node` Redux interfaces); `component-manifest.yaml` with curated L1/L2 definitions; `hierarchyHelpers.ts` pure functions in VKB.
**Addresses:** P1 schema feature; resolves pitfall 1 (field disconnect) and pitfall 5 (processEntity omission).
**Avoids:** Silent field loss; interface divergence; TypeScript type errors in Phase 2+.

Files: `kg-operators.ts` (KGEntity interface), `persistence-agent.ts` (EntityMetadata interface + processEntity explicit construction), `graph-database-adapter.ts` (GraphEntity interface), `graphSlice.ts` and `navigationSlice.ts` (VKB Entity/Node interfaces), `coding-ontology.json` (add Component and SubComponent classes), `config/component-manifest.yaml` (new), `src/utils/hierarchyHelpers.ts` (new).

Post-phase validation: TypeScript compiles with `--strict` in both submodule and VKB; integration test passes entity with `parentId` through `persistEntities()` and returns it from `getEntity()` with `parentId` intact.

### Phase 2: One-Time Migration

**Rationale:** Migration operates on the live graph and produces the hierarchical structure that Phase 3 (pipeline) and Phase 4 (VKB) depend on for realistic testing. Running migration before pipeline changes means pipeline changes can be validated against real hierarchical data. Migration is standalone — does not require Docker rebuild.
**Delivers:** 126 existing entities classified into hierarchy; ~10 new scaffold L1/L2 component nodes created; ~40-50 generic entities merged into CodingPatterns; `contains` edges connecting all children to parents; JSON export updated and bold-free.
**Addresses:** P1 migration feature; P1 entity merge feature; CodingPatterns aggregation.
**Avoids:** Stale JSON export (pitfall 3); bold formatting reintroduction; LevelDB lock conflict (use `GraphDatabaseAdapter`).

Files: `scripts/knowledge-management/migrate-to-hierarchy.js` (new, follows `purge-knowledge-entities.js` pattern).

Post-phase validation: `python3 -c "import json; d=json.load(open('.data/knowledge-export/coding.json')); print(len(d['entities']))"` shows 136+; `queryRelations({ relationType: 'contains' })` returns > 0; `grep -c '\*\*' .data/knowledge-export/coding.json` returns 0.

### Phase 3: Pipeline Hierarchy Assignment

**Rationale:** Once migration establishes the hierarchy, new entities from `ukb full` must slot into it. This requires changes to the coordinator and persistence agent, which both require Docker rebuild. Phase 3 is the most pipeline-invasive change — keep it after migration so issues can be isolated from migration issues.
**Delivers:** `HierarchyClassifier` agent with manifest alias matching and LLM fallback; coordinator calls it after ontology step, before kg_operators; `persistEntities()` creates `contains` edges after `storeEntity()`; `mergeEntities()` null-coalesces hierarchy fields; component nodes added to `PROTECTED_ENTITY_TYPES`.
**Addresses:** P1 pipeline hierarchy assignment; resolves pitfall 2 (dedup collapse); resolves pitfall 4 (LLM misclassification via heuristics-first).
**Avoids:** Component node orphaning on second pipeline run; LLM cost on already-classified entities (skip where `hierarchyLevel !== undefined`).

Files: `src/agents/hierarchy-classifier.ts` (new), `coordinator.ts` (call HierarchyClassifier after ontology), `persistence-agent.ts` (storeRelationship for child_of after storeEntity; PROTECTED_ENTITY_TYPES update), `kg-operators.ts` (mergeEntities null-coalescing).

Post-phase validation: Run `ukb full` with `maxBatches: 1`; verify new entities have `hierarchyLevel` set; run a second time and verify component nodes still have `level` and `parentId` (dedup preservation test).

### Phase 4: VKB Tree Navigation UI

**Rationale:** The UI is the final consumer. Phase 4 requires hierarchical data from Phase 2 (migration) and Phase 3 (pipeline) to be meaningful and testable. VKB changes are bind-mounted — no Docker rebuild, only `npm run build` in `integrations/system-health-dashboard`.
**Delivers:** Collapsible tree sidebar showing Coding -> L1 -> L2 -> L3 with click-to-filter; breadcrumb trail in NodeDetails; `setHierarchyFilter` in Redux; D3 graph filters to selected subtree; legacy-flat entities without `parentId` shown in "Uncategorized" bucket without errors.
**Addresses:** P1 VKB tree navigation; P1 breadcrumb trail; P2 level-scoped API filters (additive `?level=` and `?parentId=` query params on existing route).
**Avoids:** D3 force layout collapse (pitfall 7) — filter `contains` edges from D3 link force; tree panel uses React `ul/li`, not D3.

Files: `TreeNavigation.tsx` (new), `HierarchyBreadcrumb.tsx` (new), `filtersSlice.ts` (setHierarchyFilter action), `KnowledgeGraph/index.tsx` (add TreeNavigation panel), `NodeDetails.tsx` (breadcrumb + children list), `GraphVisualization.tsx` (hierarchy edge filter on D3 link force), `lib/vkb-server/api-routes.js` (add `?level=` and `?parentId=` query params).

Post-phase validation: VKB shows 6 L1 component nodes in tree; clicking a component filters D3 graph to its subtree; entities without `parentId` render in "Uncategorized" bucket without errors.

### Phase Ordering Rationale

The dependency chain is: schema (defines types) -> migration (populates hierarchy data) -> pipeline (maintains it going forward) -> UI (displays it). Each phase requires the previous phases' outputs to work correctly. Phase 4 (VKB) could theoretically run in parallel with Phase 3 (Pipeline) once Phase 2 (Migration) provides test data, but sequential ordering reduces debugging complexity if issues arise.

The 4-phase structure also isolates Docker rebuild requirements: Phases 1 and 2 require no Docker rebuild (type-only changes and standalone script). Phase 3 requires Docker rebuild (coordinator and persistence agent changes). Phase 4 requires only `npm run build` in the bind-mounted VKB. This limits risky rebuild operations to Phase 3 only.

### Research Flags

Phases with standard patterns — can proceed without `gsd:research-phase`:
- **Phase 1 (Schema):** Pure TypeScript interface extension; well-documented additive pattern; all code paths traced
- **Phase 2 (Migration):** Follows established `purge-knowledge-entities.js` pattern; `GraphMigrationService` provides backup/verify structure; code paths clear
- **Phase 4 (VKB):** React component addition with Redux; standard patterns; `buildHierarchyTree()` pure function is straightforward

Phase likely needing a spike before full implementation:
- **Phase 3 (Pipeline) — HierarchyClassifier LLM fallback:** The prompt engineering for LLM hierarchy classification with component descriptions as context has not been designed or validated. The alias keyword list needs construction. Recommend a 20-entity classification spike before building the full classifier: test classification accuracy on a representative sample before committing to the approach.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against npm registry live on 2026-03-01; peer dependencies confirmed; installed versions verified from package.json |
| Features | HIGH | Based on direct codebase inspection of all affected files; entity type distribution confirmed from live coding.json (126 entities, 0 relations) |
| Architecture | HIGH | Based on direct code inspection of GraphDatabaseService, GraphDatabaseAdapter, coordinator, persistence-agent, VKB Redux store, and D3 graph component; data flow traced through actual code |
| Pitfalls | HIGH | All 8 pitfalls derived from direct code inspection; KGEntity/SharedMemoryEntity disconnect is a known production bug pattern (v1.0); Docker rebuild is a documented recurring issue |

**Overall confidence:** HIGH

### Gaps to Address

- **HierarchyClassifier LLM prompt design:** The specific prompt format for LLM fallback classification has not been researched. The keyword heuristic alias list covers known entity types (LSLSession -> LiveLoggingSystem, MCPAgent -> KnowledgeManagement) but edge cases for ~20-25 ambiguous entities need validation. Recommend a 20-entity classification spike in Phase 3 before committing.

- **Entity merge criteria for CodingPatterns:** The criteria for "merge vs. keep as leaf" (< 3 observations AND generic name) are estimates. The actual count of mergeable entities has not been verified by running the criteria against the live entity list. Recommend a dry-run report as the first migration step before any data modification.

- **D3 force simulation fix prototyping:** The pitfall (D3 collapse with hierarchy edges) is identified but the specific fix (filter `contains` edges from D3 link force) has not been prototyped. Fallback is simply not rendering hierarchy edges in D3 at all — low risk.

- **`queryEntities()` snake_case handling for `parentId`:** The existing `queryEntities()` returns `entity_name` and `entity_type` in snake_case. It is unclear whether `parentId` will be returned as `parent_id` or `parentId` from the API. Needs a quick runtime test in Phase 2 before finalizing the migration script's update calls.

## Sources

### Primary (HIGH confidence — direct code inspection, 2026-03-01)
- `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` — KGEntity interface (line 31), mergeEntities(), deduplication()
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` — SharedMemoryEntity, EntityMetadata, processEntity() explicit construction, PROTECTED_ENTITY_TYPES
- `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` — entityType/type fix pattern (line ~3098), template wiring, pipeline step order
- `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` — dual-mode routing, GraphKnowledgeExporter attachment pattern
- `src/knowledge-management/GraphDatabaseService.js` — storeEntity() spread, queryEntities() snake_case return shape, CollectiveKnowledge auto-linking
- `lib/vkb-server/api-routes.js` — REST endpoint surface, entity pass-through
- `integrations/memory-visualizer/src/store/slices/graphSlice.ts` — Entity interface, Redux state shape
- `integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx` — D3 force layout, no edge-type filtering currently
- `integrations/memory-visualizer/package.json` — React 18.2.0, D3 7.8.5, Tailwind 3.4.1, TypeScript 5.3.3
- `integrations/mcp-server-semantic-analysis/package.json` — graphology ^0.25.4, level ^10.0.0
- `.data/knowledge-export/coding.json` — live snapshot: 126 entities, 0 relations, type distribution (46 KnowledgeEntity, 19 MCPAgent, 12 WorkflowDefinition, 11 ConstraintRule, 10 SemanticAnalyzer, etc.)
- `scripts/purge-knowledge-entities.js` — VKB HTTP API pattern reference for migration scripts

### Primary (HIGH confidence — npm registry, 2026-03-01)
- `npm view graphology-traversal` — version 0.3.1, peer deps `graphology-types >=0.20.0` satisfied by installed graphology ^0.25.4
- `npm view react-arborist` — version 3.4.3, peer deps `react >= 16.14` satisfied by installed React 18.2.0

### Secondary (MEDIUM confidence — web research)
- Graphology standard library docs (traversal, DAG) — BFS/DFS API, cycle detection API
- Hierarchical Knowledge Graph UX patterns — max 4 levels, drill-down navigation best practices
- LeanRAG hierarchical KG aggregation — parent node observation synthesis patterns
- Nielsen Norman Group breadcrumbs UX — breadcrumb placement and behavior
- react-arborist GitHub — React 18 compatibility, virtualized rendering, built-in TypeScript types

---
*Research completed: 2026-03-01*
*Ready for roadmap: yes*

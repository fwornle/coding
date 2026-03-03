# Roadmap: Coding Project Knowledge Management

## Milestones

- ✅ **v1.0** — UKB Pipeline Fix & Improvement (shipped 2026-03-03) → [archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v2.0** — Hierarchical Knowledge Restructuring (Phases 5-7, in progress)

---

<details>
<summary>✅ v1.0 UKB Pipeline Fix & Improvement — SHIPPED 2026-03-03</summary>

- [x] Phase 1: Core Pipeline Data Quality (7/7 plans) — completed 2026-03-02
- [x] Phase 4: Schema & Configuration Foundation (2/2 plans) — completed 2026-03-01
- [ ] Phase 2: Insight Generation & Data Routing — Deferred
- [ ] Phase 3: Significance & Quality Ranking — Deferred

</details>

---

## v2.0 — Hierarchical Knowledge Restructuring

### Overview

Three remaining phases that transform the flat knowledge graph (126 entities, 0 relations) into a navigable Project → Component → SubComponent → Detail hierarchy. Schema foundation (Phase 4) shipped in v1.0.

### Phases

- [ ] **Phase 5: One-Time Migration** - Classify all 126 existing entities into the hierarchy, create scaffold nodes, merge generic entities into CodingPatterns, and store `contains` edges
- [ ] **Phase 6: Pipeline Hierarchy Assignment** - Insert HierarchyClassifier into the coordinator pipeline so future `ukb full` runs slot new entities into the hierarchy automatically
- [ ] **Phase 7: VKB Tree Navigation** - Add collapsible tree sidebar, breadcrumb navigation, and subtree filtering to the VKB viewer

### Phase Details

#### Phase 5: One-Time Migration
**Goal**: All existing entities are placed in the hierarchy with parent assignments, new scaffold nodes exist for the Coding root and all L1/L2 components, and generic entities are merged into CodingPatterns
**Depends on**: Phase 4 (v1.0, shipped)
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05
**Success Criteria** (what must be TRUE):
  1. `--dry-run` mode prints a classification report without modifying any data
  2. After migration, `queryRelations({ relationType: 'contains' })` returns more than 100 edges
  3. The Coding root node and at least 6 L1 component scaffold nodes exist with descriptions
  4. Generic/low-value entities removed; observations rolled up on parent CodingPatterns node
  5. `grep -c '\*\*' .data/knowledge-export/coding.json` returns 0
**Plans**: TBD

#### Phase 6: Pipeline Hierarchy Assignment
**Goal**: New entities produced by `ukb full` are automatically assigned to the correct component, and scaffold nodes survive repeated pipeline runs
**Depends on**: Phase 5
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06
**Success Criteria** (what must be TRUE):
  1. `ukb full` with `maxBatches: 1` produces entities with `hierarchyLevel` and `parentId` set
  2. Second `ukb full` leaves scaffold nodes intact (dedup does not overwrite)
  3. HierarchyClassifier uses keyword heuristics first, LLM for ambiguous (visible in logs)
  4. Component/scaffold nodes protected from dedup/purge deletion
  5. Hierarchy fields appear in `coding.json` for new entities
**Plans**: TBD

#### Phase 7: VKB Tree Navigation
**Goal**: Users can navigate the knowledge hierarchy in the VKB viewer with tree drill-down and breadcrumbs
**Depends on**: Phase 5
**Requirements**: VKB-01, VKB-02, VKB-03, VKB-04, VKB-05
**Success Criteria** (what must be TRUE):
  1. Collapsible tree sidebar with Coding root, L1 components, and children
  2. Clicking component node filters D3 graph to that subtree
  3. Breadcrumb trail computed from `parentId` chain
  4. D3 force layout renders correctly with `contains` edges
  5. Entities without `parentId` appear in "Uncategorized" bucket
**Plans**: TBD

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. One-Time Migration | 0/? | Not started | - |
| 6. Pipeline Hierarchy Assignment | 0/? | Not started | - |
| 7. VKB Tree Navigation | 0/? | Not started | - |

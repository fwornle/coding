# Requirements: Hierarchical Knowledge Restructuring

**Defined:** 2026-03-01
**Core Value:** Knowledge graph organized as navigable hierarchy — not a flat soup of disconnected entities

## v1 Requirements

### Schema & Configuration

- [x] **SCHM-01**: KGEntity interface extended with optional `parentId`, `level`, `hierarchyPath` fields (backward-compatible)
- [x] **SCHM-02**: SharedMemoryEntity/EntityMetadata extended with `hierarchyLevel`, `parentEntityName`, `childEntityNames`, `isScaffoldNode` fields
- [x] **SCHM-03**: `Component` and `SubComponent` entity types added to `coding-ontology.json` so ontology validation accepts scaffold nodes
- [x] **SCHM-04**: `component-manifest.yaml` defines L1/L2 component hierarchy (names, aliases, descriptions) as the source of truth for classification

### One-Time Migration

- [ ] **MIGR-01**: Migration script creates scaffold nodes (Coding project root, L1 components, L2 sub-components) from component manifest
- [ ] **MIGR-02**: Migration script classifies existing 126 entities into the hierarchy by assigning `parentId` and `level`
- [ ] **MIGR-03**: Generic/low-value entities merged into parent component nodes (observations rolled up, original nodes removed)
- [ ] **MIGR-04**: Migration has `--dry-run` mode showing classification and merge decisions before executing
- [ ] **MIGR-05**: Migration reads from VKB HTTP API (not direct LevelDB) to avoid lock conflicts and keep JSON export in sync

### Pipeline Hierarchy Assignment

- [ ] **PIPE-01**: New HierarchyClassifier assigns `parentId` and `level` to entities during pipeline batch processing
- [ ] **PIPE-02**: HierarchyClassifier uses keyword heuristics first, LLM fallback for ambiguous entities
- [ ] **PIPE-03**: Coordinator integrates HierarchyClassifier after ontology classification, before KG operators
- [ ] **PIPE-04**: Dedup operator's `mergeEntities()` preserves `parentId` from component nodes (no silent field loss)
- [ ] **PIPE-05**: PersistenceAgent passes hierarchy fields through to storage without dropping them
- [ ] **PIPE-06**: Component/scaffold nodes added to protected entity types (not deleted by dedup or purge)

### VKB Tree Navigation

- [ ] **VKB-01**: Collapsible tree sidebar showing Coding → Components → SubComponents → Detail hierarchy
- [ ] **VKB-02**: Clicking a tree node navigates to that entity's detail view
- [ ] **VKB-03**: Breadcrumb navigation showing current position in hierarchy (e.g., Coding > KnowledgeManagement > OnlineLearning)
- [ ] **VKB-04**: D3 graph view filters hierarchy `contains` edges to avoid visual collapse of force layout
- [ ] **VKB-05**: Component detail view shows description, child count, and aggregated observation summary

## v2 Requirements

### Advanced Hierarchy

- **HIER-01**: Drag-and-drop reclassification of entities in VKB tree
- **HIER-02**: Auto-suggest hierarchy placement for new entities based on semantic similarity
- **HIER-03**: Hierarchy depth analytics (which components have the most knowledge)

### Deferred from v1.0

- **INSD-01**: Insight document generation for significant entities
- **INSD-02**: Rich markdown insight documents with diagrams
- **QUAL-01**: Significance score normalization

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full-text search (Qdrant) | Over-engineering; tree navigation solves discovery |
| Real-time hierarchy updates during pipeline | Batch completion is sufficient; real-time adds complexity |
| Force-directed graph with hierarchy rendering | Tree sidebar is the navigation tool; D3 graph stays flat |
| Agent framework rewrite | Architecture is sound |
| MCP server interface changes | `ukb full` invocation unchanged |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHM-01 | Phase 4 | Complete |
| SCHM-02 | Phase 4 | Complete |
| SCHM-03 | Phase 4 | Complete |
| SCHM-04 | Phase 4 | Complete |
| MIGR-01 | Phase 5 | Pending |
| MIGR-02 | Phase 5 | Pending |
| MIGR-03 | Phase 5 | Pending |
| MIGR-04 | Phase 5 | Pending |
| MIGR-05 | Phase 5 | Pending |
| PIPE-01 | Phase 6 | Pending |
| PIPE-02 | Phase 6 | Pending |
| PIPE-03 | Phase 6 | Pending |
| PIPE-04 | Phase 6 | Pending |
| PIPE-05 | Phase 6 | Pending |
| PIPE-06 | Phase 6 | Pending |
| VKB-01 | Phase 7 | Pending |
| VKB-02 | Phase 7 | Pending |
| VKB-03 | Phase 7 | Pending |
| VKB-04 | Phase 7 | Pending |
| VKB-05 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after initial definition*

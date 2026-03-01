# Phase 4: Schema & Configuration Foundation - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend TypeScript interfaces across all four systems (KGEntity, SharedMemoryEntity, EntityMetadata, VKB viewer) with hierarchy fields, and author the component manifest as the authoritative source of truth for L1/L2 component names. No data migration, no pipeline changes, no VKB UI changes — those are Phases 5-7.

</domain>

<decisions>
## Implementation Decisions

### Component taxonomy
- 8 L1 components: LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns, ConstraintSystem, SemanticAnalysis
- L2 sub-components defined only where natural subsystems exist (e.g., KnowledgeManagement -> ManualLearning, OnlineLearning; SemanticAnalysis -> Pipeline, Ontology, Insights). Don't force L2s on flat components
- PascalCase naming for all component names (matches existing entity naming convention)
- CodingPatterns serves as the catch-all for entities that don't clearly fit any other component

### Manifest content depth
- Rich entries per component: name, description (1-2 sentences), aliases (alternate names), keywords (for heuristic matching in Phase 6), children (L2 sub-components)
- Descriptions should be enough for an LLM or human to understand the component's scope without reading code
- Manifest defines the component tree only — level semantics (what L0/L1/L2/L3 mean) are defined in TypeScript interfaces
- File location: `integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` (bind-mounted into Docker, no rebuild needed to iterate)

### Hierarchy depth & levels
- 4 levels: L0 (Project root "Coding"), L1 (Component), L2 (SubComponent), L3 (Detail/individual entities)
- Level stored as numeric integer 0-3 (not string enum)
- `hierarchyPath` uses slash-separated PascalCase names: "Coding/KnowledgeManagement/OnlineLearning/BatchAnalysisPattern"
- Scaffold nodes (Coding root, L1 components, L2 sub-components) are full knowledge graph entities with type 'Component'/'SubComponent', descriptions, and aggregated observations — not lightweight structural stubs

### Interface consolidation
- Hierarchy fields added to all three interface layers: KGEntity (parentId, level, hierarchyPath), SharedMemoryEntity (hierarchyLevel, parentEntityName, childEntityNames, isScaffoldNode), EntityMetadata (keeps audit fields only)
- All new hierarchy fields are optional (?) for backward compatibility — existing entities without hierarchy data pass through cleanly
- Do NOT fix the existing type/entityType disconnect in this phase — add hierarchy fields alongside, don't bundle unrelated refactoring
- Ontology file (`coding-ontology.json`) extended with `Component` and `SubComponent` entity types

### Claude's Discretion
- Which file becomes the canonical location for KGEntity (kg-operators.ts vs agent-dataflow.ts vs new shared file)
- Exact field names on EntityMetadata if any hierarchy audit fields are needed
- How to structure the `Component` and `SubComponent` entity definitions in the ontology JSON
- Whether to add a TypeScript enum/const for hierarchy level names alongside the numeric type

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KGEntity` interface (kg-operators.ts:31, agent-dataflow.ts:389): Two duplicate copies, both need hierarchy fields added
- `SharedMemoryEntity` (persistence-agent.ts:40): Uses `entityType` (not `type`), has `metadata` sub-object and `relationships` array
- `EntityMetadata` (persistence-agent.ts:69): Already has extensible patterns (ontology metadata, staleness tracking, rename tracking)
- `KGRelation` interface: Already supports `type: string` and `source` — can carry 'contains' edges for hierarchy

### Established Patterns
- Entity types in the ontology use the `entities` key (not `classes`), with `description`, `extendsEntity`, `properties`, `requiredProperties`, `examples`
- Config files in `integrations/mcp-server-semantic-analysis/config/` are bind-mounted read-only into Docker — no rebuild needed for changes
- The coordinator casts entities via `as KGEntity` after adding extra fields like `entityType` and `metadata` — this pattern will need to accommodate hierarchy fields too

### Integration Points
- `persistEntities()` in persistence-agent.ts — must pass hierarchy fields through to LevelDB storage
- `getEntity()` in persistence-agent.ts — must return hierarchy fields from storage
- Ontology classification agent (ontology-classification-agent.ts) — will need to accept Component/SubComponent as valid types
- Deduplication agent (deduplication.ts) — Phase 6 concern but schema must not conflict with merge logic

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-schema-configuration-foundation*
*Context gathered: 2026-03-01*

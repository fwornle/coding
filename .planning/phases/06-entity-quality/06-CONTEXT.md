# Phase 6: Entity Quality - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Every entity produced by wave agents carries rich, specific observations (3+ per entity) and a detailed insight document (markdown with architecture context, purpose, patterns). Architectural entities (L1 Components, L2 SubComponents) also get rendered PlantUML diagrams. Insight documents cross-reference related entities with navigable links. This phase enhances the wave pipeline output quality — it does not change wave orchestration, hierarchy structure, or VKB visualization.

</domain>

<decisions>
## Implementation Decisions

### Observation enrichment
- Enhance LLM prompts in Wave1/2/3 agents to produce richer, more specific observations directly
- Add post-LLM validation that enforces minimum 3 observations per entity
- If fewer than 3 returned: retry once with an enriched prompt including code snippets and hierarchy context
- If still under 3 after retry: supplement from entity description, hierarchy path, and code-graph-rag file analysis
- Observations stay as plain strings (string[]) — content quality matters more than wrapper format
- Observation quality bar: must reference specific code artifacts (files, classes, functions, patterns). "Uses GraphDatabaseAdapter for LevelDB persistence" not "Handles data storage"

### Insight generation timing
- Insight generation runs as a **finalization step after all waves complete** — not inline during waves
- All entities and relationships exist at this point, so cross-references are complete
- Only generate insights for entities created/updated in the current wave run (not all entities in graph)
- Use bounded concurrency via existing `runWithConcurrency` work-stealing pattern (2-3 entities in parallel)
- Insight files stored in existing location: `knowledge-management/insights/<EntityName>.md` with `puml/` and `images/` subdirectories
- After generating each insight, update entity metadata: `validated_file_path` and `has_insight_document = true`

### Diagram scope by entity level
- PlantUML diagrams generated for **L1 Component and L2 SubComponent entities only** (matches QUAL-03 "architectural entities")
- All 4 diagram types generated: architecture, sequence, use-cases, class (InsightGenerationAgent already does this in parallel)
- L0 Project and L3 Detail entities get **text-only insight documents** (no diagrams) — satisfies QUAL-02 for all entities
- If a diagram fails to render after LLM repair attempts: skip that diagram type, continue with remaining diagrams and insight doc (entity still gets its insight)

### Cross-reference depth
- Each insight document references **parent, children, and sibling entities** at the same level
- Describes relationships in context (e.g., "Pipeline is a sub-component of SemanticAnalysis alongside Ontology and Insights")
- Cross-references appear in **two forms**: natural references woven into the narrative text AND a structured "Related Entities" section at the end
- Entity names rendered as **relative markdown links**: `[Pipeline](./Pipeline.md)` — navigable in any markdown viewer
- One-line description for each related entity uses its **first observation** (no extra LLM call)

### Claude's Discretion
- Exact LLM prompt wording for enriched observation generation
- WaveController integration architecture for the insight finalization step
- Concurrency level for insight generation (2-3 entities, tuned to LLM rate limits)
- InsightGenerationAgent method selection (generateInsightDocument vs generateTechnicalDocumentation)
- Observation retry prompt design and supplementation strategy
- Error handling and logging for the finalization step

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `InsightGenerationAgent` (insight-generation-agent.ts): Fully operational engine — generates markdown content via LLM + all 4 PlantUML diagram types in parallel. Has `generateInsightDocument()` (line 1610) and `generateTechnicalDocumentation()` (line 220)
- `generateAllDiagrams()` (line 1808): Parallel 4-diagram generation with LLM-enhanced PlantUML, validation, and auto-repair
- `validateAndFixPlantUML()` (line 2138): Syntax fixer for common PlantUML errors
- `_standard-style.puml` (knowledge-management/insights/puml/): Standard skin/theme included in all diagrams
- `toKebabCase()` (line 100): Naming convention utility for diagram files
- `runWithConcurrency()` (wave-controller.ts line 489): Work-stealing concurrency pattern for bounded parallel execution
- `SharedMemoryEntity.metadata.validated_file_path` and `has_insight_document` (persistence-agent.ts): Entity-to-insight linking fields already exist

### Established Patterns
- Wave agents produce `KGEntity` with `observations: string[]` — Phase 6 enhances the prompt quality and adds enforcement
- InsightGenerationAgent writes to `knowledge-management/insights/` with PascalCase `.md`, kebab-case `.puml` and `.png`
- PlantUML CLI: `plantuml -checkonly` for validation, `plantuml -tpng` for rendering — never `java -jar`
- Persistence agent's `mapEntityToSharedMemory()` pre-populates ontology metadata to skip redundant LLM re-classification

### Integration Points
- `WaveController.persistWaveResult()` (wave-controller.ts line 379): Primary hook — add insight generation after entity persistence
- `PersistenceAgent.persistEntities()`: Already handles entity metadata updates including `validated_file_path`
- Wave agent LLM prompts in `wave1-project-agent.ts`, `wave2-component-agent.ts`, `wave3-detail-agent.ts`: Enhancement targets for observation quality
- `WaveResult.entities` and `WaveResult.relationships`: Available after all waves for cross-reference data

</code_context>

<specifics>
## Specific Ideas

- InsightGenerationAgent is the existing engine — wire it into the wave pipeline, don't rebuild
- The observation quality bar (must reference code artifacts) should be enforced via validation logic, not just prompt instructions
- Phase 5 decision: "Insight documents are NOT produced in Phase 5 — that's Phase 6" — this is that phase
- Existing ~30 insight docs in knowledge-management/insights/ were produced by the old batch pipeline and can coexist with new wave-produced ones

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-entity-quality*
*Context gathered: 2026-03-04*

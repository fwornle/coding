# Phase 9: Agent Pipeline Integration - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Wave agents produce entities through the full agent pipeline -- deep semantic analysis, proper persistence, insight documents, and ontology classification -- instead of lightweight standalone LLM calls. This phase integrates SemanticAnalysisAgent, PersistenceAgent, InsightGenerationAgent, and OntologyClassificationAgent into the wave pipeline. It does not restore KG operators (Phase 10), content validation/QA (Phase 11), or trace display UI (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### Semantic analysis routing
- Hybrid approach: Wave 1 uses enhanced multi-step prompts (2 LLM calls: structure analysis then observation synthesis). Wave 2+3 route through SemanticAnalysisAgent for deep code-grounded analysis
- SemanticAnalysisAgent (semantic-analysis-agent.ts), NOT SemanticAnalyzer -- the focused agent, not the orchestrator. Wave agent stays in control of entity construction
- Sub-step integration: wave agents call SemanticAnalysisAgent for code analysis + observation generation only, then construct entities themselves (hierarchy fields, relationships, suggested children)
- Trace data instrumented now: SemanticAnalysisAgent calls capture LLM call counts, timing, and model info so the data is available for Phase 12 to display

### Agent orchestration order
- Per-wave pipeline: SemanticAnalysisAgent + OntologyClassificationAgent run per-wave before persistence. Insights finalize at end (Wave 4) for cross-reference completeness
- Sequential within entity: analyze first, then classify. Ontology gets enriched observations as input
- Per-entity processing: each entity gets its own SemanticAnalysisAgent call with focused code context, then its own ontology classification
- Atomic per-entity pipeline: each parallel slot runs the full analyze->classify pipeline for one entity before taking the next
- Bounded concurrency: 2-3 entities processed in parallel within a wave using existing runWithConcurrency() pattern
- In-memory pipeline: results flow through in-memory (wave agent -> semantic analysis enriches -> ontology classifies -> persistence writes). No graph I/O between agent steps
- Fresh agent instances per wave (current pattern): no cross-wave state contamination
- Fallback on failure: if SemanticAnalysisAgent fails for an entity, fall back to wave agent's own lightweight LLM observations. Mark entity with 'shallow_analysis' flag. No data loss

### Persistence and hierarchy
- Fix mapEntityToSharedMemory() to correctly pass parentId, level, hierarchyPath through the persistence path
- Enable basic structural validation: hierarchy fields present, observations non-empty. Content quality validation stays disabled (Phase 11)
- Discovery stays batch: wave agents discover all entities in one LLM call (current pattern), then SemanticAnalysisAgent enriches each discovered entity individually

### Insight generation
- Keep Wave 4 finalization: all insights generated after waves 1-3 complete, for cross-reference completeness
- Pass analysis artifacts: beyond observations, pass SemanticAnalysisAgent's raw analysis artifacts (code patterns, architecture notes) to the insight agent for deeper insight documents
- Add diagrams for L3: all entity levels (L1, L2, AND L3) get full PlantUML diagram treatment. Overrides Phase 6 decision of L3 text-only
- InsightGenerationAgent logic stays the same, just receives richer input from the pipeline

### Claude's Discretion
- Whether wave agents pass existing CGR file context to SemanticAnalysisAgent or let it read its own code (pick based on actual interface)
- Whether to merge SemanticAnalysisAgent observations with wave agent's own observations or replace entirely (pick based on quality and dedup)
- Insight scope: current-run entities only vs all entities (pick based on full-replace re-run model from Phase 7)
- Concurrency level tuning (2 vs 3 parallel entities) based on LLM rate limits
- Error handling and logging patterns for the enriched pipeline
- How to store and pass analysis artifacts from SemanticAnalysisAgent to InsightGenerationAgent

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SemanticAnalysisAgent` (semantic-analysis-agent.ts:66): Focused code analysis agent with analyzeCode(). Takes code + context, returns patterns/observations. Target for Wave 2+3 integration
- `PersistenceAgent` (persistence-agent.ts): Entity persistence to LevelDB via persistEntities(). Already instantiated in wave-controller.ts:458 with validationMode: 'disabled'
- `InsightGenerationAgent` (insight-generation-agent.ts): Full insight engine with generateInsightDocument() and generateAllDiagrams(). Already wired as Wave 4 in wave-controller.ts:677
- `OntologyClassificationAgent` (ontology-classification-agent.ts): Classification via classifyObservations(). Already wired pre-persist in wave-controller.ts:517
- `LLMService` (lib/llm): Direct LLM calls used by all 3 wave agents currently. Wave 1+2+3 each instantiate their own LLMService
- `runWithConcurrency()` (wave-controller.ts:489): Work-stealing concurrency pattern for bounded parallel execution
- `mapEntityToSharedMemory()` (wave-controller.ts): Converts KGEntity to SharedMemoryEntity format -- needs hierarchy field fixes

### Established Patterns
- Wave agents use `LLMService.complete()` directly for entity discovery -- this is what Phase 9 changes for Wave 2+3
- Ontology classification runs as `classifyWaveEntities()` batch before `persistWaveResult()` -- Phase 9 changes to per-entity sequential
- Insight generation runs as Wave 4 finalization with bounded concurrency -- stays the same
- Fresh agent instances per wave (Phase 5 decision) -- preserved
- Full replace per run (Phase 7 decision) -- entities replaced each run, manifest accumulates

### Integration Points
- `wave-controller.ts`: Main orchestration target. persistWaveResult(), classifyWaveEntities(), and the wave execution loop all need modification
- `wave1-project-agent.ts`: Enhance with multi-step LLM prompts (2 calls instead of 1)
- `wave2-component-agent.ts`: Add SemanticAnalysisAgent integration as sub-step after entity discovery
- `wave3-detail-agent.ts`: Add SemanticAnalysisAgent integration as sub-step after entity discovery
- `persistence-agent.ts`: Fix hierarchy field mapping in the wave persistence path

</code_context>

<specifics>
## Specific Ideas

- Wave 1 multi-step: first LLM call analyzes code structure, second synthesizes observations from the analysis. Richer L0/L1 entities without full SemanticAnalysisAgent overhead
- Per-entity atomic pipeline: analyze->classify is one unit of work per parallel slot. runWithConcurrency() processes 2-3 entities in parallel, each running through the full sub-pipeline
- Trace instrumentation now: wire SemanticAnalysisAgent trace data (LLM counts, timing, model) through wave agents so Phase 12 just needs to display it
- Shallow analysis flag: when SemanticAnalysisAgent fails, entity gets created with lightweight observations AND a 'shallow_analysis' marker so you know which entities didn't get deep treatment

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 09-agent-pipeline-integration*
*Context gathered: 2026-03-07*

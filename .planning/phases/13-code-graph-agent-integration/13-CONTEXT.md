# Phase 13: Code Graph Agent Integration - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Wave agents use code-graph-rag (CGR) as a primary evidence source — querying call graphs, dependencies, and code snippets — so entities are grounded in actual code structure rather than purely LLM-generated text. CGR index is automatically refreshed at wave1_init before analysis begins. This phase does not add new agents or modify KG operators — it wires CGR into the existing wave agent pipeline.

</domain>

<decisions>
## Implementation Decisions

### Evidence source tagging
- All observations get provenance tags: `[CGR]` for direct code-graph observations, `[LLM]` for pure LLM-generated, `[LLM+CGR]` for LLM analysis grounded in code graph data
- Tags are prefix strings in observation text (no schema change needed)
- Tags visible everywhere — VKB, insight docs, exports. Not stripped for display
- Existing observations from prior runs stay untagged (full-replace-per-run means tags appear naturally on next run)
- Level-dependent CGR minimum: L0/L1 optional (architectural concepts), L2/L3 require 1+ `[CGR]` or `[LLM+CGR]` observation
- When CGR has no data for an L2/L3 entity, flag with `_noCgrEvidence` (like Phase 9's `_shallowAnalysis` pattern) but proceed

### CGR query strategy per wave
- **Wave 1 (L0/L1):** Component-scoped entity queries — for each L1 component, query CGR for top-level classes/modules in that component's file paths
- **Wave 2 (L2):** Code snippets + function signatures for each L2 entity scoped to parent component files
- **Wave 3 (L3):** Deep call graphs (depth 2-3) + code snippets for detailed code-level grounding
- CGR queries cached per component scope — query once per L1 component, reuse across Wave 2/3 entities under the same component
- CGR results formatted as hybrid summaries + top 3 key code snippets per entity before injection into LLM prompts
- Both direct `[CGR]` observations AND LLM-synthesized `[LLM+CGR]` observations generated
- Direct `[CGR]` observations include structural facts (file paths, exports, signatures, complexity metrics) AND relationship facts (call graph summaries, import/dependency chains)
- No cap on `[CGR]` observations per entity — generate all relevant structural and relationship facts

### Index refresh behavior
- Async index refresh at wave1_init with 30-second timeout — start refresh, continue wave setup, block only when first CGR query is needed
- Falls back to stale index data on timeout with logged warning
- Incremental indexing with fallback: try incremental first, full reindex if no existing index found (`hasExistingIndex()` returns false)
- If CGR entirely unavailable (Memgraph down, CGR not installed), pipeline continues without CGR — LLM-only observations, no `_noCgrEvidence` flags (CGR was never available for the run)

### Evidence integration depth
- CGR data injected BEFORE SemanticAnalysisAgent in the per-entity pipeline: wave agent queries CGR first, passes results as context to SAA
- New dedicated `cgrContext` parameter on `analyzeEntityCode()` — cleaner separation than mixing into existing context string
- New `CgrObservationBuilder` utility generates `[CGR]` observations from CodeGraphAgent query results — reusable across all 3 wave agents
- All observations count equally toward 3+ minimum (Phase 9 requirement). CGR, LLM, and LLM+CGR all contribute

### Wave agent prompt changes
- Dedicated `<code_graph>` XML section in LLM prompts for CGR data, separate from existing file content
- Explicit prompt instructions to reference `<code_graph>` data in observations and cite specific functions/files from code graph
- LLM self-tags observations: prompted to prefix with `[LLM+CGR]` when grounded in code graph data, `[LLM]` otherwise
- CGR-specific anti-hallucination rules: "Only reference functions/classes that appear in `<code_graph>`. Do NOT invent file paths or function names not present in the code graph data."

### CGR cache service
- Standalone `CgrQueryCache` class (not inline on WaveController) — modular, testable, injected by WaveController
- In-memory cache, single-run lifecycle — created at wave1_init, discarded after run completes
- Cache build strategy: Claude's Discretion (eager vs lazy based on manifest size and CGR query latency)

### Trace integration
- New `TraceCGRQuery` trace entry type alongside existing `TraceLLMCall` — captures query type (call graph, code snippet, entity search), entity count returned, duration
- Entity-level summary fields added to `EntityTraceData`: `cgrQueryCount`, `cgrDurationMs`, `cgrEntitiesReturned`
- Full `cgrContext` payload captured in traces — shows exactly what code evidence the LLM received for diagnostic purposes
- Separate "Code Graph Queries" section in trace modal alongside "LLM Calls" section

### Dashboard indicators
- CGR index freshness indicator: last index timestamp, entity count in Memgraph, whether incremental refresh happened at wave1_init
- Indicator in both locations: CGR panel (full index management) AND wave progress panel (compact freshness badge during runs)
- Per-wave CGR stats in progress steps: queries made, entities returned, cache hits per wave
- Trace history comparison tracks `[CGR]` vs `[LLM]` vs `[LLM+CGR]` observation breakdown per run to detect CGR integration regression

### Claude's Discretion
- CGR observation verbosity (compact one-liner vs detailed multi-sentence) — pick based on existing observation style
- Cache build strategy (eager at wave1_init vs lazy on first query) — pick based on manifest component count and CGR query latency
- How to structure the `CgrQueryCache` API (method signatures, cache key format)
- Error handling details for individual CGR query failures within a run

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CodeGraphAgent` (code-graph-agent.ts): Full CGR client with `indexRepository()`, `queryCodeGraph()`, `getCallGraph()`, `findSimilarCode()`, and `runCypherQuery()`. Already integrated in coordinator workflows
- `AnalysisArtifacts` (wave-types.ts:20): Has `patterns[]`, `architectureNotes[]`, `codeReferences[]` — extends naturally for CGR data
- `EntityTraceData` (wave-types.ts:30): Existing trace structure to extend with CGR fields
- `EnrichedEntity` (wave-types.ts): Already has `_analysisArtifacts`, `_traceData`, `_shallowAnalysis` — add `_noCgrEvidence` here
- `runWithConcurrency()` (wave-controller.ts): Work-stealing concurrency pattern for bounded parallel CGR queries
- `cgr-reindex-modal.tsx`: Dashboard UI for CGR management — extend with freshness indicator
- `documentation-linker-agent.ts`: Existing code reference pattern with `codeReferences[]` — pattern for CGR observations

### Established Patterns
- Per-entity atomic pipeline: analyze→classify per entity (Phase 9) — CGR query becomes first step: cgr→analyze→classify
- Fallback-on-failure: `_shallowAnalysis` flag pattern (Phase 9) — reuse for `_noCgrEvidence`
- Full replace per run (Phase 7) — tags appear naturally, no migration needed
- Wave agents use `LLMService.complete()` for LLM calls — CGR queries are separate (Memgraph/Cypher, not LLM)
- Fire-and-forget trace capture (Phase 12) — extend for CGR query traces

### Integration Points
- `wave-controller.ts` line 288: Wave1 init — hook point for async CGR index refresh
- `wave1-project-agent.ts`: Add CGR component-scoped entity queries per L1 component
- `wave2-component-agent.ts`: Add CGR code snippet + signature queries per L2 entity
- `wave3-detail-agent.ts`: Add CGR deep call graph + snippet queries per L3 entity
- `semantic-analysis-agent.ts analyzeEntityCode()`: Add new `cgrContext` parameter
- `coordinator.ts` wave-analysis workflow: `index_codebase` step already exists — ensure it feeds into wave pipeline
- `server.js` + `cgr-reindex-modal.tsx`: Extend with freshness indicator data

</code_context>

<specifics>
## Specific Ideas

- CGR observation builder should generate both structural facts (exports, metrics) and relationship facts (call graphs, imports) as separate observations — not one mega-observation
- The `<code_graph>` section in LLM prompts should include actual code snippets (top 3) so the LLM can reference specific implementation details
- Anti-hallucination rules for CGR are critical — LLM must only cite functions/files that actually appear in the code graph data
- Trace comparison across runs should flag when CGR observation ratio drops (regression detection)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-code-graph-agent-integration*
*Context gathered: 2026-03-09*

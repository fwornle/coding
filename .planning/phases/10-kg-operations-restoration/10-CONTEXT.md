# Phase 10: KG Operations Restoration - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Persisted entities are refined through the full KG operator pipeline -- converted, aggregated, embedded, deduplicated, scored, and merged -- producing a clean, enriched knowledge graph. This phase restores the 6 KG operators (conv, aggr, embed, dedup, pred, merge) into the wave pipeline. It does not add content validation/QA (Phase 11) or trace display UI (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### Operator placement
- All 6 operators run post-pipeline: AFTER all 3 waves complete but BEFORE insight finalization (Wave 4)
- Operators get the full entity set from all waves, enabling cross-hierarchy dedup/merge/pred
- All 6 operators enabled: conv adapts to wave mode using run metadata instead of batch dates
- Each operator gets its own dashboard progress step (operator_conv, operator_aggr, etc.) matching old pipeline behavior
- Operator failures are graceful: each operator wrapped in try/catch, failure logs warning and skips that operator, pipeline continues
- Use KGOperators.applyAll() to sequence operators internally -- less code in wave-controller

### Embedding strategy
- Local sentence-transformers via Python subprocess (NOT mock, NOT LLM API)
- Model: all-MiniLM-L6-v2 (384-dim, ~80MB) -- matches existing mock dimension
- Downloaded at Docker build time (baked into image, no lazy download)
- Batch all entities in one subprocess call -- sentence-transformers handles internal batching
- Embeddings persisted on entities in the knowledge graph (stored on KGEntity.embedding)
- Embedding subprocess fallback: Claude's discretion (graceful skip of embed + pred operators, or TF-IDF fallback)

### Dedup scope and behavior
- Hierarchy-aware dedup: dedup key includes parentId, same-name entities under different parents are NOT merged
- Two-pass dedup: first pass is exact normalized name match, second pass uses embedding cosine similarity
- Semantic dedup auto-merges above threshold (cosine > 0.9 AND same hierarchy level AND same parent)
- mergeEntities() parentId fix (KGOP-06): incoming hierarchy fields win -- `parentId: incoming.parentId ?? existing.parentId`, same for level and hierarchyPath

### Accumulated KG and operator context
- Cross-wave accumulation: all 3 waves' entities form the complete set for post-pipeline operators
- Since operators run post-pipeline on the full set, accumulated KG = the entities produced by all waves in this run
- Edge prediction (pred): cross-branch only -- compare entities in different L1 branches, skip same-branch pairs (they already have explicit parent-child relations)
- Conv context: build BatchContext from run metadata (run timestamp, recent git commits from repo, session count) -- adapts to wave mode without changing conv interface

### Claude's Discretion
- Embedding subprocess fallback strategy (skip embed+pred or TF-IDF)
- Exact cosine similarity threshold for semantic dedup (starting point: 0.9)
- How to collect recent git commits and sessions for conv's BatchContext
- Dashboard progress integration details for individual operator steps
- Whether applyAll() needs modification to emit per-operator progress events or if wave-controller wraps it

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KGOperators` class (kg-operators.ts:96): Full 6-operator pipeline with applyAll(). Already has conv, aggr, embed, dedup, pred, merge methods
- `createKGOperators()` (kg-operators.ts:679): Factory function taking SemanticAnalyzer
- `mergeEntities()` (kg-operators.ts:400): Merge logic -- needs parentId null-coalesce fix
- `generateEmbedding()` (semantic-analyzer.ts:721): Currently mock (random 384-dim) -- replace with real sentence-transformers call
- `embedding_generator.py` (src/utils/): Partial Python embedding script -- needs numpy + sentence-transformers installed
- Old coordinator pipeline (coordinator.ts:3327-3422): Individual operator step progression with progress tracking -- reference for dashboard integration

### Established Patterns
- Wave persistence via PersistenceAgent (wave-controller.ts:463) -- operators run after this
- Individual progress steps per operator in old pipeline (coordinator.ts:285) -- same pattern for wave pipeline
- Graceful fallback with flags (Phase 9: shallow_analysis flag on SemanticAnalysisAgent failure)
- Full replace per run (Phase 7 decision) -- entities replaced each run, manifest accumulates
- Per-entity atomic pipeline in waves (Phase 9) -- operators run on the accumulated result post-waves

### Integration Points
- `wave-controller.ts`: Add operator phase between wave 3 persistence and insight finalization (Wave 4)
- `kg-operators.ts`: Fix mergeEntities() hierarchy fields, update dedup to be hierarchy-aware, adapt conv for run metadata
- `semantic-analyzer.ts`: Replace mock generateEmbedding() with real sentence-transformers subprocess call
- `Dockerfile`: Add numpy + sentence-transformers + all-MiniLM-L6-v2 model download to build stage
- Dashboard progress: operator steps need to be registered in the progress tracking system

</code_context>

<specifics>
## Specific Ideas

- Operators run as a distinct phase between wave completion and insight finalization -- "Wave 4" becomes "Wave 5" or insight finalization stays Wave 4 but operators are a named step between waves and insights
- Cross-branch edge prediction discovers relationships like "ErrorHandler relates_to Logger" across different component branches -- the kind of insight that wave-per-branch analysis misses
- Semantic dedup with real embeddings can catch near-duplicates the wave agents create independently (e.g., two wave 3 agents both creating a "ConfigurationManagement" detail under different parents)

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 10-kg-operations-restoration*
*Context gathered: 2026-03-07*

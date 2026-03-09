# Phase 13: Code Graph Agent Integration - Research

**Researched:** 2026-03-09
**Domain:** Wave pipeline integration with code-graph-rag (CGR) for code-grounded entity observations
**Confidence:** HIGH

## Summary

Phase 13 wires the existing `CodeGraphAgent` (which wraps code-graph-rag's Memgraph-backed AST knowledge graph) into the wave analysis pipeline so that entity observations are grounded in actual code structure. The `CodeGraphAgent` already exists with full API surface: `indexRepository()`, `runCypherQuery()`, `getCallGraph()`, `queryCodeGraph()`, `findSimilarCode()`, and `synthesizeInsights()`. The wave-controller already uses CGR in one place -- `getComponentFiles()` -- which queries Memgraph File nodes to scope component files for Wave 2/3 agents. This phase extends that pattern dramatically: each wave agent queries CGR for entity-relevant code data, builds `[CGR]` observations from the results, passes CGR context to `SemanticAnalysisAgent` for `[LLM+CGR]` observations, and captures CGR query traces alongside existing LLM traces.

The implementation spans 4 layers: (1) a new `CgrQueryCache` service and `CgrObservationBuilder` utility, (2) wave agent modifications to query CGR and inject results into LLM prompts, (3) trace type extensions for CGR query visibility, and (4) dashboard indicators for CGR freshness and per-wave stats. The existing codebase patterns (per-entity atomic pipeline, `_shallowAnalysis` fallback flags, `runWithConcurrency()`, fire-and-forget trace capture) all apply directly.

**Primary recommendation:** Build CgrQueryCache + CgrObservationBuilder as standalone modules first, then wire into wave agents wave-by-wave, then extend tracing, then add dashboard indicators.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Evidence source tagging: `[CGR]`, `[LLM]`, `[LLM+CGR]` prefix strings in observation text (no schema change)
- Tags visible everywhere, not stripped. Existing observations stay untagged
- Level-dependent CGR minimum: L0/L1 optional, L2/L3 require 1+ `[CGR]` or `[LLM+CGR]` observation
- When CGR has no data for L2/L3 entity, flag with `_noCgrEvidence` but proceed
- Wave 1: component-scoped entity queries per L1 component
- Wave 2: code snippets + function signatures per L2 entity scoped to parent component files
- Wave 3: deep call graphs (depth 2-3) + code snippets for detailed grounding
- CGR queries cached per component scope -- query once per L1 component, reuse across Wave 2/3 entities under same component
- CGR results formatted as hybrid summaries + top 3 key code snippets before injection into LLM prompts
- Both direct `[CGR]` observations AND LLM-synthesized `[LLM+CGR]` observations generated
- Direct `[CGR]` observations include structural facts AND relationship facts -- no cap
- Async index refresh at wave1_init with 30-second timeout; falls back to stale index on timeout
- Incremental indexing with fallback to full reindex if no existing index
- If CGR entirely unavailable, pipeline continues LLM-only (no `_noCgrEvidence` flags in that case)
- CGR data injected BEFORE SemanticAnalysisAgent via new `cgrContext` parameter on `analyzeEntityCode()`
- New `CgrObservationBuilder` utility generates `[CGR]` observations from CodeGraphAgent results
- All observations count equally toward 3+ minimum (Phase 9 requirement)
- Dedicated `<code_graph>` XML section in LLM prompts, separate from existing file content
- Explicit prompt instructions to reference code graph data; LLM self-tags with `[LLM+CGR]` or `[LLM]`
- CGR anti-hallucination rules: only reference functions/classes in `<code_graph>`, no invented paths
- Standalone `CgrQueryCache` class -- modular, testable, injected by WaveController
- In-memory cache, single-run lifecycle
- New `TraceCGRQuery` trace entry type alongside `TraceLLMCall`
- Entity-level summary fields: `cgrQueryCount`, `cgrDurationMs`, `cgrEntitiesReturned`
- Full `cgrContext` payload captured in traces
- Separate "Code Graph Queries" section in trace modal
- CGR index freshness indicator in both CGR panel and wave progress panel
- Per-wave CGR stats in progress steps
- Trace history comparison tracks observation source breakdown per run

### Claude's Discretion
- CGR observation verbosity (compact one-liner vs detailed multi-sentence) -- pick based on existing observation style
- Cache build strategy (eager at wave1_init vs lazy on first query) -- pick based on manifest component count and CGR query latency
- How to structure the `CgrQueryCache` API (method signatures, cache key format)
- Error handling details for individual CGR query failures within a run

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CGR-01 | Code-graph-rag wired into wave pipeline as code-evidence source for entity observations | CgrQueryCache service + CgrObservationBuilder utility; wave agents query CGR before SAA; observations tagged `[CGR]` |
| CGR-02 | Wave agents query CGR for call graphs, dependencies, and code snippets relevant to each entity | Per-wave Cypher queries: Wave1 component-scoped entities, Wave2 signatures+snippets, Wave3 deep call graphs; cached per L1 component |
| CGR-03 | CGR evidence attached to entities as code-grounded observations | CgrObservationBuilder generates structural + relationship `[CGR]` observations; LLM produces `[LLM+CGR]` via `<code_graph>` prompt section |
| CGR-04 | CGR index refreshed automatically at wave1_init before analysis begins | Async refresh at wave1_init with 30s timeout; incremental first, full reindex fallback; graceful degradation on failure |
</phase_requirements>

## Architecture Patterns

### Recommended Module Structure
```
src/
  agents/
    code-graph-agent.ts          # EXISTING -- CGR client (Memgraph + CLI)
    wave-controller.ts           # MODIFY -- inject CgrQueryCache, async refresh, trace capture
    wave1-project-agent.ts       # MODIFY -- CGR component queries, observation tagging
    wave2-component-agent.ts     # MODIFY -- CGR snippet/signature queries, observation tagging
    wave3-detail-agent.ts        # MODIFY -- CGR call graph queries, observation tagging
    semantic-analysis-agent.ts   # MODIFY -- add cgrContext param to analyzeEntityCode()
  services/
    cgr-query-cache.ts           # NEW -- CgrQueryCache class
  utils/
    cgr-observation-builder.ts   # NEW -- CgrObservationBuilder utility
  trace-types.ts                 # MODIFY -- add TraceCGRQuery interface
  types/
    wave-types.ts                # MODIFY -- add _noCgrEvidence, CGR trace fields to EnrichedEntity/EntityTraceData
```

### Pattern 1: CgrQueryCache (In-Memory, Single-Run Lifecycle)
**What:** A standalone class that queries Memgraph via CodeGraphAgent, caches results keyed by L1 component name, and provides scoped retrieval for Wave 2/3 entities.
**When to use:** Created at wave1_init, injected into wave agents, discarded after run completes.
**Key design:**
```typescript
// Source: Derived from existing getComponentFiles() pattern in wave-controller.ts:2323
export class CgrQueryCache {
  private cache = new Map<string, CgrComponentData>();
  private cgrAgent: CodeGraphAgent;
  private available: boolean = true;

  constructor(repositoryPath: string) {
    this.cgrAgent = new CodeGraphAgent(repositoryPath);
  }

  /** Check CGR availability and warm cache for all manifest components */
  async initialize(componentNames: string[]): Promise<{ available: boolean; cached: number }> { ... }

  /** Get cached CGR data for a component (returns null if not cached) */
  getComponentData(componentName: string): CgrComponentData | null { ... }

  /** Query entities scoped to a component's files */
  async queryComponentEntities(componentName: string, keywords: string[]): Promise<CodeEntity[]> { ... }

  /** Query code snippets + signatures for a specific entity within component scope */
  async queryEntityDetails(entityName: string, componentFiles: string[]): Promise<CgrEntityDetails> { ... }

  /** Query deep call graph for a specific entity */
  async queryCallGraph(entityName: string, depth: number): Promise<CgrCallGraphResult> { ... }

  /** Whether CGR is available for this run */
  isAvailable(): boolean { return this.available; }
}
```

### Pattern 2: CgrObservationBuilder (Reusable Utility)
**What:** Transforms raw CGR query results (CodeEntity[], CodeRelationship[]) into `[CGR]`-tagged observation strings for KGEntity.observations[].
**When to use:** Called by each wave agent after CGR query, before entity construction.
**Key design:**
```typescript
// Source: Follows documentation-linker-agent.ts codeReferences[] pattern
export class CgrObservationBuilder {
  /** Build structural observations from CGR entities */
  buildStructuralObservations(entities: CodeEntity[], entityName: string): string[] {
    // e.g. "[CGR] WaveController exports 15 methods including execute(), runWithConcurrency(), persistWaveResult()"
    // e.g. "[CGR] Module complexity: avg 12.3 across 8 functions in wave-controller.ts"
  }

  /** Build relationship observations from call graph data */
  buildRelationshipObservations(calls: CodeRelationship[], calledBy: CodeRelationship[]): string[] {
    // e.g. "[CGR] Calls: persistWaveResult -> PersistenceAgent.persistBatch, GraphDatabaseAdapter.storeEntity"
    // e.g. "[CGR] Called by: coordinator.runWaveAnalysis -> WaveController.execute"
  }

  /** Format CGR data for LLM prompt injection (XML section) */
  formatForLLMPrompt(data: CgrEntityDetails): string {
    // Returns <code_graph>...</code_graph> XML block
  }
}
```

### Pattern 3: Per-Entity CGR Pipeline (cgr -> analyze -> classify)
**What:** Extends the existing per-entity atomic pipeline from Phase 9. CGR query is the first step before SemanticAnalysisAgent.
**When to use:** Every entity in Wave 2 and Wave 3 (mandatory). Wave 1 (optional, L0/L1).
```typescript
// Source: Follows existing pattern in wave2-component-agent.ts:170-189
// BEFORE (Phase 9):
//   entity = buildEntity() -> try SAA.analyzeEntityCode() catch _shallowAnalysis

// AFTER (Phase 13):
//   cgrData = cache.queryEntityDetails(entity.name, componentFiles)
//   cgrObservations = builder.buildStructuralObservations(cgrData) + builder.buildRelationshipObservations(cgrData)
//   entity.observations.push(...cgrObservations)  // [CGR] tagged
//   try {
//     result = SAA.analyzeEntityCode(input, { cgrContext: builder.formatForLLMPrompt(cgrData) })
//     // LLM tags its observations as [LLM+CGR] or [LLM]
//   } catch {
//     entity._shallowAnalysis = true
//   }
//   if (cgrObservations.length === 0 && entity.level >= 2) entity._noCgrEvidence = true
```

### Pattern 4: Async Index Refresh at wave1_init
**What:** Fire-and-forget CGR index refresh with 30s timeout, non-blocking until first query needs results.
**When to use:** At the start of WaveController.execute(), during wave1_init.
```typescript
// Source: Based on CodeGraphAgent.indexRepository() at code-graph-agent.ts:453
// In WaveController.execute():
const cgrCache = new CgrQueryCache(this.repositoryPath);
const refreshPromise = cgrCache.refreshIndex(30_000); // 30s timeout
// ... continue manifest loading, entity loading ...
// Before first CGR query (wave1 analyze):
await refreshPromise; // blocks here only if not yet done
```

### Anti-Patterns to Avoid
- **Creating new CodeGraphAgent per query:** Instantiate once in CgrQueryCache, reuse. Each constructor validates paths and checks Memgraph.
- **Mixing CGR data into existing context string:** Use dedicated `cgrContext` parameter, not string concatenation into `parentContext`.
- **Querying CGR for every L3 entity individually without caching:** Cache at L1 component level, reuse for all descendant entities.
- **Throwing on CGR failure:** CGR is an enrichment layer. Catch errors, set `_noCgrEvidence`, continue with LLM-only observations.
- **SQL injection via Cypher:** The existing `getComponentFiles()` method has a raw string interpolation vulnerability (`'${componentName}'`). New Cypher queries should sanitize inputs or use parameterized queries via mgconsole.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memgraph queries | Custom HTTP/TCP client | `CodeGraphAgent.runCypherQuery()` | Already handles Docker exec, CSV parsing, timeouts |
| Repository indexing | Custom AST parser | `CodeGraphAgent.indexRepository()` | Wraps uv/Python code-graph-rag CLI with error handling |
| Call graph traversal | Custom graph traversal | `CodeGraphAgent.getCallGraph()` | Uses Memgraph's built-in graph algorithms |
| Concurrency control | Custom Promise.all | `WaveController.runWithConcurrency()` | Existing work-stealing pattern with failFast support |
| Trace capture | Custom logging | Extend existing `TraceLLMCall` pattern from `trace-types.ts` | Dashboard already consumes this format |

**Key insight:** The CodeGraphAgent is already a full CGR client. The work here is NOT building a new CGR interface but wiring the existing one into the wave pipeline with caching, observation formatting, and trace integration.

## Common Pitfalls

### Pitfall 1: CGR CLI Commands Are Limited
**What goes wrong:** `queryCodeGraph()`, `getCallGraph()`, `findSimilarCode()` all call `runCodeGraphCommand()` which logs a warning and returns `{ skipped: true }` for non-index/export commands. The CLI only supports `index` and `export`.
**Why it happens:** code-graph-rag's CLI (`codebase_rag.main`) has limited subcommands. The query methods were designed for a different interface.
**How to avoid:** Use `runCypherQuery()` directly for ALL queries. The `queryCodeGraph()`, `getCallGraph()`, and `findSimilarCode()` methods will silently fail. Build Cypher queries directly.
**Warning signs:** Logs showing `"Command 'query' not supported via CLI"`.

### Pitfall 2: Cypher Injection in Component Name Queries
**What goes wrong:** The existing `getComponentFiles()` at wave-controller.ts:2329 uses raw string interpolation in Cypher: `toLower('${componentName}')`. Malicious or special-character entity names could break queries.
**Why it happens:** No input sanitization for Cypher queries.
**How to avoid:** Escape single quotes in entity names before embedding in Cypher strings, or use a sanitization helper.

### Pitfall 3: Docker Rebuild Required After Changes
**What goes wrong:** Source changes to `mcp-server-semantic-analysis` don't take effect.
**Why it happens:** Submodule requires `npm run build` + Docker rebuild (see CLAUDE.md).
**How to avoid:** After every code change: `cd integrations/mcp-server-semantic-analysis && npm run build && cd ../../docker && docker-compose build coding-services && docker-compose up -d coding-services`.

### Pitfall 4: EnrichedEntity Fields Lost in Persistence
**What goes wrong:** New fields like `_noCgrEvidence` or CGR trace data get silently stripped during persistence.
**Why it happens:** The persistence pipeline's `processEntity()` hierarchy mapping doesn't propagate unknown fields (Phase 10 decision: fields must be explicitly mapped).
**How to avoid:** Add `_noCgrEvidence` to `EnrichedEntity` interface in wave-types.ts. Ensure persistence-agent and wave-controller map the field through the pipeline. Follow the `_shallowAnalysis` pattern exactly.

### Pitfall 5: Memgraph Node Labels vs Property Queries
**What goes wrong:** Queries assume entity properties (like `name`, `qualified_name`, `file_path`) exist on all nodes. Some nodes may lack expected properties.
**Why it happens:** code-graph-rag's Tree-sitter indexer creates nodes with varying property sets depending on language and entity type.
**How to avoid:** Always use `OPTIONAL MATCH` or null checks (`WHERE n.name IS NOT NULL`) in Cypher queries. Handle empty/null results gracefully.

### Pitfall 6: Observation Tag Consistency
**What goes wrong:** LLM doesn't consistently prefix observations with `[LLM+CGR]` or `[LLM]` tags despite prompt instructions.
**Why it happens:** LLMs sometimes ignore formatting instructions, especially under long contexts.
**How to avoid:** Post-process LLM observations: if `<code_graph>` data was provided and observation references code entities, auto-tag as `[LLM+CGR]`. If no code graph data was provided, auto-tag as `[LLM]`. Don't rely solely on LLM self-tagging.

## Code Examples

### Cypher Query: Component-Scoped Entities (Wave 1)
```typescript
// Source: Derived from existing getComponentFiles() pattern in wave-controller.ts:2329
// Query all code entities within a component's file scope
const cypher = `
  MATCH (f:File)-[:DEFINES]->(e)
  WHERE toLower(f.file_path) CONTAINS toLower('${sanitize(componentName)}')
     OR ANY(k IN [${keywords.map(k => `'${sanitize(k)}'`).join(',')}]
        WHERE toLower(f.file_path) CONTAINS toLower(k))
  RETURN e.name AS name, labels(e)[0] AS type, e.qualified_name AS qualifiedName,
         e.signature AS signature, f.file_path AS filePath, e.complexity AS complexity
  ORDER BY e.complexity DESC
  LIMIT 30
`;
```

### Cypher Query: Entity Signatures + Snippets (Wave 2)
```typescript
// Query function signatures and relationships for a specific entity
const cypher = `
  MATCH (e)
  WHERE e.name = '${sanitize(entityName)}'
     OR e.qualified_name CONTAINS '${sanitize(entityName)}'
  OPTIONAL MATCH (e)-[:CALLS]->(called)
  OPTIONAL MATCH (e)-[:IMPORTS]->(imported)
  RETURN e.name AS name, e.signature AS signature, e.docstring AS docstring,
         e.qualified_name AS qualifiedName, labels(e)[0] AS type,
         collect(DISTINCT called.name) AS callees,
         collect(DISTINCT imported.name) AS imports
  LIMIT 5
`;
```

### Cypher Query: Deep Call Graph (Wave 3)
```typescript
// Query call graph to depth 2-3 for detailed grounding
const cypher = `
  MATCH path = (root)-[:CALLS*1..${depth}]->(target)
  WHERE root.name = '${sanitize(entityName)}'
  UNWIND nodes(path) AS n
  UNWIND relationships(path) AS r
  RETURN DISTINCT
    startNode(r).name AS caller,
    endNode(r).name AS callee,
    startNode(r).qualified_name AS callerQN,
    endNode(r).qualified_name AS calleeQN
  LIMIT 50
`;
```

### CgrObservationBuilder Output Examples
```typescript
// Structural observations (one per relevant fact):
"[CGR] WaveController (Class) in wave-controller.ts defines 23 methods including execute(), runWithConcurrency(), persistWaveResult()"
"[CGR] wave-controller.ts has cyclomatic complexity 45, highest in the agents/ directory"
"[CGR] Module exports: WaveController, WaveControllerConfig (2 exports from agents/wave-controller.ts)"

// Relationship observations:
"[CGR] Call chain: WaveController.execute -> executeWave1WithMetrics -> Wave1ProjectAgent.execute -> LLMService.complete"
"[CGR] Imports from 8 modules: persistence-agent, insight-generation-agent, ontology-classification-agent, kg-operators, semantic-analyzer, wave1-project-agent, quality-assurance-agent, workflow-report-agent"

// LLM+CGR observations (from LLM analyzing code_graph section):
"[LLM+CGR] The WaveController implements a work-stealing concurrency pattern via runWithConcurrency() that bounds parallel agent execution to maxAgentsPerWave (default 4), preventing resource exhaustion during Wave 2/3 parallel agent spawning"
```

### LLM Prompt Code Graph Section
```typescript
// Source: New pattern for Phase 13
const codeGraphSection = `
<code_graph>
## Code Graph Evidence for "${entityName}"

### Functions and Methods
${entities.map(e => `- ${e.name} (${e.type}): ${e.signature || 'no signature'} [${e.filePath}]`).join('\n')}

### Key Code Snippets
${topSnippets.map((s, i) => `#### Snippet ${i+1}: ${s.name}\n\`\`\`${s.language}\n${s.content}\n\`\`\``).join('\n\n')}

### Call Graph
${callChains.map(c => `- ${c.caller} -> ${c.callee}`).join('\n')}

### Dependencies
${imports.map(i => `- imports ${i}`).join('\n')}
</code_graph>

ANTI-HALLUCINATION RULES:
- Only reference functions, classes, and files that appear in <code_graph> above
- Do NOT invent file paths or function names not present in the code graph data
- Prefix observations grounded in code graph data with [LLM+CGR]
- Prefix observations from your own analysis with [LLM]
`;
```

### TraceCGRQuery Type Extension
```typescript
// Source: Extends trace-types.ts pattern from Phase 12
export interface TraceCGRQuery {
  id: string;
  queryType: 'component_entities' | 'entity_details' | 'call_graph' | 'index_refresh';
  entityName: string;
  cypherQuery?: string;
  resultCount: number;
  durationMs: number;
  cacheHit: boolean;
  status: 'success' | 'failed' | 'timeout';
  error?: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CGR used only for file scoping | CGR used for entity evidence | Phase 13 | Entities grounded in code structure |
| LLM-only observations | Mixed LLM + CGR observations | Phase 13 | Verifiable code-grounded knowledge |
| No observation provenance | `[CGR]`/`[LLM]`/`[LLM+CGR]` tags | Phase 13 | Source attribution for every observation |
| CGR queried ad-hoc per wave | Cached per L1 component | Phase 13 | Reduced query latency, consistent data |

## Open Questions

1. **Code snippet extraction from Memgraph**
   - What we know: Memgraph stores AST entities (functions, classes, methods) with properties like `name`, `qualified_name`, `signature`, `docstring`. File contents are NOT stored in Memgraph.
   - What's unclear: Whether "code snippets" means reading source files at `file_path` (like SAA already does) or extracting from Memgraph properties only.
   - Recommendation: Use Memgraph for structural data (signatures, relationships, complexity) and read source files directly for actual code snippets (reusing SAA's file reading pattern). The `<code_graph>` section should include both Memgraph-sourced metadata and file-sourced snippets scoped by Memgraph's file_path data.

2. **CGR observation verbosity (Claude's Discretion)**
   - Recommendation: Use compact one-liner format matching existing observation style. Current observations are single sentences (e.g., "Uses dependency injection via constructor"). CGR observations should match: `"[CGR] Defines 15 methods including execute(), runWithConcurrency() in wave-controller.ts"` not multi-paragraph.

3. **Cache build strategy (Claude's Discretion)**
   - Recommendation: Lazy on first query. The manifest typically has 8-12 components, and CGR queries via mgconsole take 200-500ms each. Eager caching would add 2-6 seconds to wave1_init. Lazy caching amortizes this across wave execution and avoids caching for components that might not need CGR data.

## Sources

### Primary (HIGH confidence)
- `code-graph-agent.ts` - Full CodeGraphAgent API: indexRepository(), runCypherQuery(), getCallGraph(), queryCodeGraph(), findSimilarCode(), synthesizeInsights(), hasExistingIndex(), getExistingStats()
- `wave-controller.ts` - WaveController with wave1_init hook point (line 288-291), getComponentFiles() CGR usage (line 2323-2344), runWithConcurrency() pattern (line 1966), WAVE_STEP_SEQUENCE (line 2071)
- `wave-types.ts` - EnrichedEntity with _shallowAnalysis pattern, AnalyzeEntityCodeInput/Result contracts, Wave1/2/3Input shapes
- `trace-types.ts` - TraceLLMCall, TraceAgentInstance, TraceEntityFlow, TraceStepExtension interfaces
- `semantic-analysis-agent.ts` - analyzeEntityCode() at line 1920 with current prompt structure
- `wave1-project-agent.ts`, `wave2-component-agent.ts`, `wave3-detail-agent.ts` - Per-entity pipeline pattern with SAA integration and _shallowAnalysis fallback

### Secondary (MEDIUM confidence)
- `cgr-reindex-modal.tsx` - Existing dashboard CGR panel with progress polling
- `server.js` - Express endpoints /api/cgr/status, /api/cgr/progress, /api/cgr/reindex
- `agent-tuning.yaml` - code_graph config: memgraph_check_timeout_ms (5000), uv_process_timeout_ms (300000)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all integration points are existing code, fully inspected
- Architecture: HIGH - follows established patterns (_shallowAnalysis, trace capture, runWithConcurrency)
- Pitfalls: HIGH - identified from direct code inspection (CLI limitations, Cypher injection, field mapping)

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable internal codebase, no external dependencies)

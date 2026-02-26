# Architecture Research

**Domain:** UKB Multi-Agent Analysis Pipeline (`integrations/mcp-server-semantic-analysis`)
**Researched:** 2026-02-26
**Confidence:** HIGH — based on direct code inspection of all major agents, coordinator, workflow YAML, and current knowledge export

---

## System Overview

The pipeline is a 14-agent DAG workflow executed by `CoordinatorAgent` within a separate child process (`workflow-runner.ts`). The MCP server spawns the workflow runner as a subprocess; the runner writes progress to `.data/workflow-progress.json` and the dashboard polls that file.

Entry point: `mcp__semantic-analysis__execute_workflow` tool call triggers `sse-server.ts` which spawns `workflow-runner.ts` as a child process. The runner instantiates `CoordinatorAgent` and calls `executeBatchWorkflow()`.

### Pipeline Structure

The workflow runs in three sequential phases:

**Phase 0 — Initialization (once):** `plan_batches` via `BatchScheduler`. Determines how many 50-commit windows exist in git history.

**Phase 1 — Batch Loop (N iterations):** Each iteration processes one 50-commit window through 7 steps:
1. `extract_batch_commits` (GitHistoryAgent)
2. `extract_batch_sessions` (VibeHistoryAgent)
3. `batch_semantic_analysis` (SemanticAnalysisAgent) — 4 substeps
4. `generate_batch_observations` (ObservationGenerationAgent) — 2 substeps
5. `classify_with_ontology` (OntologyClassificationAgent) — 3 substeps
6. `kg_operators` (KGOperators) — 6 substeps (conv, aggr, embed, dedup, pred, merge)
7. `batch_qa` + `save_batch_checkpoint`

**Phase 2 — Finalization (once, after all batches):** 8 steps run sequentially:
1. `index_codebase` (CodeGraphAgent) — parallel with link_documentation
2. `link_documentation` (DocumentationLinkerAgent)
3. `synthesize_code_insights` (CodeGraphAgent, LLM, 30 entities)
4. `transform_code_entities` (CodeGraphAgent)
5. `final_persist` (PersistenceAgent) — writes to GraphDB + shared-memory JSON
6. **[EXPLICIT CODE BLOCK — not YAML]** `generate_insights` (InsightGenerationAgent)
7. `web_search` (WebSearchAgent)
8. `final_dedup` (DeduplicationAgent)
9. `final_validation` (ContentValidationAgent)

---

## Component Responsibilities

| Agent | File | Responsibility |
|-------|------|----------------|
| `BatchScheduler` | `agents/batch-scheduler.ts` | Plans 50-commit windows from git log; tracks progress |
| `GitHistoryAgent` | `agents/git-history-agent.ts` | Extracts commits per batch with stats |
| `VibeHistoryAgent` | `agents/vibe-history-agent.ts` | Extracts `.specstory` session logs correlated to commits |
| `SemanticAnalysisAgent` | `agents/semantic-analysis-agent.ts` | LLM-based semantic analysis of commits + sessions; produces architecturalPatterns, keyPatterns |
| `ObservationGenerationAgent` | `agents/observation-generation-agent.ts` | Transforms semantic entities into `StructuredObservation[]` via LLM synthesis |
| `OntologyClassificationAgent` | `agents/ontology-classification-agent.ts` | Classifies entity types against upper + lower ontology JSONs |
| `KGOperators` | `agents/kg-operators.ts` | 6 Tree-KG operators (conv, aggr, embed, dedup, pred, merge) |
| `QualityAssuranceAgent` | `agents/quality-assurance-agent.ts` | Validates batch output quality |
| `BatchCheckpointManager` | `utils/batch-checkpoint-manager.ts` | Persists per-batch progress for crash recovery |
| `CodeGraphAgent` | `agents/code-graph-agent.ts` | AST-based code indexing via Memgraph; LLM synthesis of 30 entities |
| `DocumentationLinkerAgent` | `agents/documentation-linker-agent.ts` | Links .md and .puml files to code entities |
| `PersistenceAgent` | `agents/persistence-agent.ts` | Writes entities to GraphDB (LevelDB) and shared-memory JSON |
| `InsightGenerationAgent` | `agents/insight-generation-agent.ts` | Generates insight .md documents with PlantUML diagrams |
| `WebSearchAgent` | `agents/web-search.ts` | Searches external sources for similar patterns |
| `DeduplicationAgent` | `agents/deduplication.ts` | Merges duplicate entities |
| `ContentValidationAgent` | `agents/content-validation-agent.ts` | Final validation of entity accuracy |
| `CoordinatorAgent` | `agents/coordinator.ts` | Orchestrates all agents; owns all state; 5428 lines |
| `SmartOrchestrator` | `orchestrator/smart-orchestrator.ts` | Confidence-based routing, retry decisions |

---

## Data Transformations at Each Stage

### Stage 1: Batch Data Extraction

**Input:** git commit range (startCommit, endCommit hash strings)

**Output — GitHistoryAgent:**
```typescript
{
  commits: GitCommit[],  // { hash, message, date, files: GitFileChange[], stats: CommitStats }
  filteredCount: number
}
```

**Output — VibeHistoryAgent:**
```typescript
{
  sessions: Session[],  // { exchanges: [{userMessage, assistantMessage}], filename, timestamp }
  correlations: {}
}
```

### Stage 2: Semantic Analysis

**Input:**
```typescript
analyzeGitAndVibeData(gitAnalysis, vibeAnalysis, { analysisDepth: 'surface' })
```

The coordinator always calls with `analysisDepth: 'surface'` (coordinator.ts line ~2637). This triggers a cheaper LLM call path.

**Output:**
```typescript
SemanticAnalysisResult = {
  codeAnalysis: {
    architecturalPatterns: Array<{ name, files, description, confidence }>
  },
  semanticInsights: {
    keyPatterns: string[],       // e.g. ["TypeScript", "Docker"]
    architecturalDecisions: string[]  // e.g. ["ModularRepo: Use modular structure..."]
  },
  confidence: number
}
```

**Critical failure path:** When LLM fails (timeout, no credit), `generateSemanticInsights()` falls back to `generateRuleBasedInsights()` which produces:
- `keyPatterns` = file extension names from the analyzed files (e.g. "TypeScript", "YAML")
- `architecturalDecisions` = first 5 git commit messages reformatted as "Decision: [commit message]"

This is the root cause of "commit-message parroting" observations.

### Stage 3: Observation Generation (First Call — Inside Semantic Block)

The coordinator calls `observationAgent.generateStructuredObservations()` TWICE per batch.

**First call** (coordinator.ts ~line 2650, inside the semantic analysis try-block):
- **Input:** `enrichedGitAnalysis` (with `architecturalDecisions` array derived from semantic patterns), `vibeAnalysis`, `insightsForObservation` (array of insight objects from semantic patterns)
- **Output:** `{ observations: StructuredObservation[] }` immediately used to build `batchEntities: KGEntity[]`
- **Purpose:** Produces the entities that flow through `classify_with_ontology` and `kg_operators`

**Entity name construction** (coordinator.ts ~line 2742):
```typescript
batchEntities = obsResult.observations.map((obs: any) => ({
  id: `${currentBatchId}-${(obs.name || 'unnamed').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
  name: obs.name || 'Unnamed Entity',   // e.g. "RealtimetrajectoryanalyzerpatternProblemHowKeep"
  entityType: obs.entityType || 'Unclassified',
  observations: Array.isArray(obs.observations)
    ? obs.observations.map((o: any) => typeof o === 'string' ? o : (o?.content || String(o)))
    : [],
  significance: obs.significance || 5,
}))
```

The `obs.name` for entities generated from git analysis comes from `generateFromGitAnalysis()` in `observation-generation-agent.ts`. That method concatenates the architectural decision `type` (e.g. "RealtimeTrajectoryAnalyzerPattern") with first words of description (e.g. "ProblemHowKeep") without inserting spaces — producing mangled names.

### Stage 4: Observation Generation (Second Call — Separate Step)

**Second call** (`generate_batch_observations` step, coordinator.ts ~line 2850):
- **Input:** `enrichedGitAnalysisForObs` (same enriched git), wrapped vibe sessions, `{ entities: batchEntities, relations: batchRelations }` (from first call's output)
- **The `generateFromSemanticAnalysis()` path** processes `semanticAnalysis.entities` (the batchEntities array)
- Per entity, calls `createEntityObservation(entity)` which does an LLM synthesis call:

```typescript
// insight-generation-agent.ts ~line 813
const prompt = `Synthesize a concise, actionable observation from this entity data:
Entity: ${entity.name}
Type: ${entity.type}
Raw Observations: ${rawContent}  // <-- whatever came from first call

Provide a JSON response with:
{ "synthesizedContent": string, "keyPattern": string | null, ... }`;
```

**Output:** `batchObservations: StructuredObservation[]` pushed to `allBatchObservations` accumulator array.

If the first call produced thin observations (because LLM fell back to rule-based), the second call's LLM synthesis input is also thin — it can only work with what was given.

### Stage 5: Ontology Classification

**Input:** `batchEntities` mapped to `{ name, entityType: 'Unclassified', observations[], significance }[]`

**Output:**
```typescript
{
  classified: Array<{ original: { name, entityType }, ontologyMetadata: { ontologyClass, confidence } }>,
  summary: { classifiedCount, unclassifiedCount }
}
```

Entities are updated in-place: `batchEntities` gets `ontologyMetadata` merged in. The entity type changes from 'Unclassified' to e.g. 'MCPAgent', 'ConstraintRule', 'KnowledgeEntity'.

### Stage 6: KG Operators

**Input:** `{ entities: batchEntities, batchContext, accumulatedKG, weights }`

**Output:** Updated `accumulatedKG` — entities and relations accumulated across all batches.

```typescript
KGEntity = { id, name, entityType, type, observations: string[], significance, batchId, timestamp }
```

The `accumulatedKG` object grows across all batches. After all batches complete it contains all entities and relations from the entire git history window.

### Stage 7: Finalization — Persistence

**final_persist inputs (from YAML template resolution):**
```
entities: accumulatedKG.entities         // KGEntity[] from batch phase
code_entities: transform_code_entities.result   // from CGR finalization
team: params.team
```

**What PersistenceAgent.persistEntities() does:**
- Writes each entity to `GraphDatabaseAdapter` (LevelDB at `.data/knowledge-graph/`)
- Writes to `shared-memory-coding.json`
- Does NOT write insight documents (that's InsightGenerationAgent's job)

**After finalization YAML loop completes**, the coordinator exports the graph:
```typescript
await (persistenceAgent as any).graphDB.exportToJSON('.data/knowledge-export/coding.json')
```

### Stage 8: Finalization — Insight Generation (Critical Broken Flow)

After all finalization YAML steps complete, the coordinator runs an EXPLICIT insight generation block NOT via `executeStepWithTimeout`. This block (coordinator.ts ~line 3797) is guarded by:

```typescript
if (insightAgent && !execution.results['generate_insights']?.insightDocuments?.length) {
```

**Data the explicit block passes to `generateComprehensiveInsights()`:**

| Parameter | Source | Status |
|-----------|--------|--------|
| `git_analysis_results.commits` | Scraped from `execution.results['extract_batch_commits']` | EMPTY — compacted |
| Fallback: `allBatchCommits` | Dedicated accumulator array | Available |
| `vibe_analysis_results.sessions` | Scraped from `execution.results['extract_batch_sessions']` | EMPTY — compacted |
| Fallback: `allBatchSessions` | Dedicated accumulator array | Available |
| `semantic_analysis_results.entities` | Scraped from `execution.results['batch_semantic_analysis']` | EMPTY — compacted |
| Fallback: `accumulatedKG.entities` | In-memory accumulatedKG | Available but summary only |
| `observations` | `allBatchObservations` | Available — primary source |
| `code_graph_results` | `execution.results['index_codebase']` | Available (not compacted) |
| `code_synthesis_results` | `execution.results['synthesize_code_insights']` | Available (not compacted) |

**The `generateComprehensiveInsights` flow:**

1. Filter commits (remove trivial: typo/format with < 5 changes, merge commits with < 10 changes)
2. Call `generatePatternCatalog()` — extracts patterns from all data sources
3. Filter patterns: `significance >= 3` AND not in thin-pattern exclusion list AND not purely statistical evidence
4. If `significantPatterns.length === 0`: return `{ skipped: true, insights_generated: 0 }` — zero insight documents written
5. If patterns found: call `generateInsightDocument(pattern)` for top 20 patterns in batches of 10 (parallel)
6. `generateInsightDocument()` calls LLM to write full markdown + PlantUML diagrams
7. Documents written to `knowledge-management/insights/` via `fs.writeFile()`

**`generatePatternCatalog()` sources (in order):**
1. Code graph patterns from `index_codebase` result (AST-based: language distribution, circular deps, high complexity)
2. Architectural patterns from git commits via `extractArchitecturalPatternsFromCommits()` — **EMPTY if commits are lost to compaction**
3. Implementation patterns from `gitAnalysis.codeEvolution`
4. Design patterns from `semanticAnalysis.codeAnalysis`
5. Solution patterns from `vibeAnalysis.problemSolutionPairs`
6. Documentation patterns from `docSemanticsResults` (not populated in batch mode currently)
7. Code synthesis patterns from `codeSynthesisResults` (from `synthesize_code_insights` — available)
8. Observation patterns from `allBatchObservations` via `extractPatternsFromObservations()`

---

## Where Insight Generation Breaks

### Break Point 1: Surface-depth semantic analysis produces thin entity observations

**Location:** `coordinator.ts` line ~2637

```typescript
const semanticResult = await semanticAgent.analyzeGitAndVibeData(
  gitAnalysis, vibeAnalysis,
  { analysisDepth: 'surface' }   // always 'surface' for batch efficiency
);
```

Surface depth = fewer files analyzed + less detailed LLM prompt. When LLM fails → `generateRuleBasedInsights()` fallback produces:
- `keyPatterns`: file extension names ("TypeScript", "YAML")
- `architecturalDecisions`: first 5 commit messages reformatted

These flow into `insightsForObservation.insights` which the first ObservationAgent call uses as its primary source — producing entities with commit-message observations.

### Break Point 2: Entity names are constructed by concatenating without spaces

**Location:** `observation-generation-agent.ts` `generateFromGitAnalysis()` method

The method transforms git architectural decision objects into entity names by concatenating `type` + first words of `description`. The transformation uses `replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).map(...).join('')` which produces PascalCase tokens joined with no separator:

- Input: `{ type: "RealtimeTrajectoryAnalyzerPattern", description: "Problem: How to keep live-state.json fresh" }`
- Output entity name: `"RealtimetrajectoryanalyzerpatternProblemHowKeep"`

### Break Point 3: Commit data is compacted before insight generation can use it

**Location:** `coordinator.ts` batch memory compaction block (~line 3566)

```typescript
const batchStepsToCompact = [
  'extract_batch_commits',     // <-- compacted
  'extract_batch_sessions',    // <-- compacted
  'batch_semantic_analysis',   // <-- compacted
  'generate_batch_observations'
];
```

The explicit insight generation block tries to scrape commits from `execution.results` first:
```typescript
for (const [key, value] of Object.entries(execution.results)) {
  if (key.startsWith('extract_batch_commits') && (value as any)?.commits) {
    allCommits.push(...((value as any).commits || []));
  }
}
```

This yields zero commits (results are `{ _compacted: true }`). The fallback `allBatchCommits` array IS populated correctly — but it's a fallback path, not the primary. Similarly `allSemanticEntities` has no fallback and ends up empty.

### Break Point 4: Thin observations produce low-significance patterns that all get filtered

**Location:** `insight-generation-agent.ts` `generateComprehensiveInsights()` significance filter

```typescript
const significantPatterns = patternCatalog.patterns
  .filter(p => p.significance < 3 ? (filterStats.lowSignificance++, false) : true)
  .filter(p => THIN_PATTERN_NAMES.includes(p.name) ? (filterStats.thinPatternNames++, false) : true)
  .filter(p => {
    const hasOnlyStats = evidence.every(e => /^(Total|Functions|Classes...)/.test(e));
    return !hasOnlyStats;
  });

if (significantPatterns.length === 0) {
  return { skipped: true, insights_generated: 0 };
}
```

When observations are thin, `extractPatternsFromObservations()` assigns `significance = obs.significance || 5` (default 5). This passes the >= 3 filter. But if the only patterns come from code-graph statistics (language distribution etc.), those get filtered as "thin". If commits are empty, `extractArchitecturalPatternsFromCommits([])` returns 0 patterns. Result: either 0 patterns (skipped) or patterns that pass filters but produce low-quality insight documents.

---

## Specific Code Paths

### Path A: Successful insight document generation (target state)

```
[Batch N]
SemanticAnalysisAgent.generateLLMInsights()  // LLM succeeds
  → architecturalPatterns: [{ name: "DockerCompose", description: "Multi-container orchestration..." }]
  → keyPatterns: ["MCP Agent Pattern", "Repository Pattern"]

ObservationAgent CALL 1 (inside semantic block)
  → createEntityObservation() — LLM synthesizes from rich entity observations
  → batchEntities: [{ name: "DockerComposePattern", observations: ["Orchestrates 8 services..."] }]

ObservationAgent CALL 2 (generate_batch_observations step)
  → createEntityObservation({ observations: ["Orchestrates 8 services..."] })
  → LLM synthesizes: "Docker Compose orchestrates 8 services including VKB, Memgraph..."
  → allBatchObservations.push({ significance: 7, observations: ["Docker Compose orchestrates..."] })

[Finalization]
InsightGenerationAgent.generateComprehensiveInsights({
  observations: allBatchObservations  // rich StructuredObservation[]
})
  → extractPatternsFromObservations():
    → pattern.significance = 7 (from obs.significance)
    → pattern.evidence = ["Docker Compose orchestrates 8 services including VKB, Memgraph..."]
    → pattern.name = "DockerCompose"
  → significantPatterns.length = 12  (passes >= 3 filter)
  → generateInsightDocument(pattern):
    → LLM: write detailed analysis of DockerCompose pattern
    → PlantUML diagram generated
    → File written: knowledge-management/insights/docker-compose.md
```

### Path B: Current broken state

```
[Batch N]
SemanticAnalysisAgent.generateLLMInsights()  // LLM timeout or credit exhaustion
  → FALLBACK: generateRuleBasedInsights()
  → keyPatterns: ["TypeScript", "YAML", "JavaScript"]
  → architecturalDecisions: ["fix: add heartbeat to keep live-state.json fresh"]

ObservationAgent CALL 1 (inside semantic block)
  → insightsForObservation.insights = [
      { description: "TypeScript: TypeScript", type: "pattern", confidence: 0.6 },
      { description: "YAML: YAML", type: "pattern", confidence: 0.6 }
    ]
  → generateFromSemanticAnalysis({ insights: [...] })  // thin
  → OR generateFromGitAnalysis(enrichedGitAnalysis)
    → architecturalDecisions[0].type = "RealtimeTrajectoryAnalyzerPattern"
    → entityName = "RealtimetrajectoryanalyzerpatternProblemHowKeep"  // mangled
    → observations: ["**RealTimeTrajectoryAnalyzerPattern**\n- Problem: How to keep..."]
  → batchEntities: [{ name: "RealtimetrajectoryanalyzerpatternProblemHowKeep", observations: ["**..."] }]

[After batch — memory compaction]
execution.results['extract_batch_commits'] = { _compacted: true }  // LOST

[Finalization]
InsightGenerationAgent.generateComprehensiveInsights({
  git_analysis_results: { commits: [] },   // scraping yields [] (compacted)
  observations: allBatchObservations       // thin: significance=5, evidence=["This entity tracks..."]
})
  → extractArchitecturalPatternsFromCommits([]) → 0 patterns
  → extractPatternsFromObservations(allBatchObservations):
    → significance = 5 (default)
    → evidence = ["This entity tracks development activity"]
    → passes significance >= 3 filter
    → passes hasOnlyStats check (not purely stats)
  → significantPatterns.length = 8 (passes)
  → generateInsightDocument(pattern):
    → LLM: write insight for "RealtimetrajectoryanalyzerpatternProblemHowKeep"
    → No real code context in evidence
    → Generic insight document OR LLM error → no document written
```

### Path C: Zero insight documents (skipped)

```
[When all commits are trivial or pattern extraction yields only statistical patterns]
generatePatternCatalog():
  → extractCodeGraphPatterns() → ["Large-Scale Codebase Pattern"]  // in thin-pattern exclusion list
  → extractArchitecturalPatternsFromCommits([]) → 0 patterns
  → extractPatternsFromObservations([]) → 0 patterns (empty allBatchObservations)

significantPatterns = []  // all filtered out
return { skipped: true, insights_generated: 0 }
```

---

## Architectural Patterns

### Pattern 1: Two-Phase Batch + Finalization Workflow

**What:** All batch work (commit analysis) runs in a loop; expensive single-pass operations (CGR, insights) run once after all batches complete.
**When to use:** When historical data must be analyzed chronologically but final synthesis needs the complete picture.
**Trade-offs:** Good for memory efficiency via per-batch compaction. Bad for data availability in finalization — compacted step results cannot be scraped.

### Pattern 2: Dedicated Accumulator Arrays (partial implementation)

**What:** Critical data is accumulated into dedicated arrays (`allBatchCommits`, `allBatchSessions`, `allBatchObservations`) that are immune to per-batch compaction.
**Current state:** Commits, sessions, and observations have accumulators. Semantic entities (`allSemanticEntities`) was attempted but only works if `execution.results['batch_semantic_analysis']` is not compacted — which it is.
**Fix direction:** Add `allBatchSemanticEntities` accumulator populated immediately after semantic analysis, before compaction.

### Pattern 3: YAML Step + Explicit Code Fallback

**What:** The `generate_insights` YAML step runs via `executeStepWithTimeout` but receives null parameters (YAML template bindings to `accumulatedKG` fail because it is not a real step result). The explicit code block after the YAML loop provides the actual insight generation using the correct accumulator data.
**Current state:** The guard `!execution.results['generate_insights']?.insightDocuments?.length` works — if YAML step fails, explicit block runs. If YAML step produces empty result (common), explicit block also runs.
**Implication:** The YAML `generate_insights` step definition is effectively dead code; all insight generation happens via the explicit block.

### Pattern 4: Dual Observation Generation per Batch

**What:** `ObservationGenerationAgent.generateStructuredObservations()` is called twice per batch with different inputs and for different purposes.
**Call 1 (inside semantic block):** Produces `batchEntities: KGEntity[]` that flow through ontology classification and KG operators.
**Call 2 (separate step):** Produces `batchObservations: StructuredObservation[]` that flow into `allBatchObservations` for finalization insight generation.
**Problem:** The two calls process the same underlying data twice. Call 2 receives Call 1's output as input — it synthesizes from already-synthesized content, compounding quality issues.

---

## Data Flow Summary Table

| Step | Input Format | Output Format | Accumulated? |
|------|-------------|---------------|-------------|
| `extract_batch_commits` | hash range | `GitCommit[]` | `allBatchCommits[]` (dedicated) |
| `extract_batch_sessions` | `GitCommit[]` | `Session[]` | `allBatchSessions[]` (dedicated) |
| `batch_semantic_analysis` | commits + sessions | `SemanticAnalysisResult` | Compacted after batch — no accumulator |
| `generate_batch_observations` (call 1) | semantic insights | `KGEntity[]` | `accumulatedKG.entities` via kg_operators |
| `generate_batch_observations` (call 2) | entities + enriched git | `StructuredObservation[]` | `allBatchObservations[]` (dedicated) |
| `classify_with_ontology` | `KGEntity[]` | classified entities in-place | via `accumulatedKG` |
| `kg_operators` | classified entities | merged `accumulatedKG` | `accumulatedKG` grows |
| `index_codebase` | repo HEAD | AST index | `execution.results` (not compacted) |
| `synthesize_code_insights` | AST index | `SynthesisResult[]` | `execution.results` (not compacted) |
| `transform_code_entities` | AST + synthesis | `KGEntity[]` (code) | passed to `final_persist` |
| `final_persist` | `accumulatedKG.entities` + code entities | LevelDB + JSON | exported to `coding.json` |
| `generate_insights` | `allBatchObservations` + code synthesis | `InsightDocument[]` | files written to `insights/` |

---

## Integration Points

### LLM Provider Chain

- **`SemanticAnalyzer`** (used by ObservationAgent, OntologyAgent, InsightAgent): routes via `providers/dmr-provider.ts` through configured provider chain
- **`SemanticAnalysisAgent`**: uses direct `LLMService` from `../../../../lib/llm/dist/index.js`
- Provider selection: `config/model-tiers.yaml` (fast/standard/premium tiers) + `config/orchestrator.yaml`
- Tier assignments in `batch-analysis.yaml`: semantic analysis = `premium`, observation generation = `premium`, ontology = `standard`, insight generation = `premium`

### Storage

| Store | Location | Written By | Read By |
|-------|----------|-----------|---------|
| GraphDB (LevelDB) | `.data/knowledge-graph/` | `PersistenceAgent` via `GraphDatabaseAdapter` | Dashboard via health API |
| JSON export | `.data/knowledge-export/coding.json` | `coordinator.ts` explicit export block | VKB viewer |
| Shared memory | `shared-memory-coding.json` | `PersistenceAgent` | Legacy consumers |
| Insight docs | `knowledge-management/insights/*.md` | `InsightGenerationAgent` directly | VKB viewer, humans |
| Progress | `.data/workflow-progress.json` | `workflow-runner.ts` + `coordinator.ts` | Dashboard (polling) |
| Checkpoints | `.data/batch-checkpoints/` | `BatchCheckpointManager` | `BatchScheduler` on resume |

### Key Config Files

| File | Controls |
|------|----------|
| `config/workflows/batch-analysis.yaml` | Step definitions, phase assignments, timeouts |
| `config/model-tiers.yaml` | LLM tier routing (fast/standard/premium) |
| `config/orchestrator.yaml` | Retry counts, concurrency, mock mode settings |
| `config/agents.yaml` | Agent-level configuration |
| `.data/ontologies/upper/development-knowledge-ontology.json` | Entity class hierarchy |
| `.data/ontologies/lower/coding-ontology.json` | Project-specific entity classes |

---

## Anti-Patterns

### Anti-Pattern 1: Compacting Then Scraping

**What happens:** After compacting `execution.results['batch_semantic_analysis']`, the explicit insight block tries to scrape `allSemanticEntities` from those compacted results.
**Why it's wrong:** Results are replaced with `{ _compacted: true }` — scraping produces empty arrays.
**Do this instead:** Use dedicated accumulator arrays populated immediately when data is available, before any compaction can happen. Add `allBatchSemanticEntities` array alongside `allBatchCommits`.

### Anti-Pattern 2: Surface-Depth Analysis for All Batches

**What happens:** `analysisDepth: 'surface'` is hardcoded for all batches in the coordinator.
**Why it's wrong:** Surface depth produces a smaller LLM prompt, fewer files analyzed, and more frequent fallback to rule-based insights. Rule-based insights produce commit-message paraphrases.
**Do this instead:** Use 'deep' depth (or at minimum give the LLM more commit context). The cost difference per batch is low relative to the quality gain.

### Anti-Pattern 3: Double Observation Generation

**What happens:** Two LLM synthesis passes per batch, with Call 2 synthesizing from Call 1's already-synthesized output.
**Why it's wrong:** Compounds quality issues. If Call 1 produces thin content, Call 2 cannot recover.
**Do this instead:** Merge into one call. Use the rich `StructuredObservation[]` format from the start, and have that same output serve both the KG operator pipeline and the insight generation accumulator.

### Anti-Pattern 4: YAML Template Bindings to Non-Step Results

**What happens:** `generate_insights` YAML step uses `{{accumulatedKG.entities}}` — but `accumulatedKG` is stored as `execution.results['accumulatedKG']`, not a real step result from a named agent.
**Why it's wrong:** `resolveParameterTemplates()` cannot resolve this — returns null. The YAML step effectively always runs with empty entity lists.
**Do this instead:** Remove the `generate_insights` YAML step entirely (since the explicit code block handles it), or store `accumulatedKG` as a proper step result.

---

## Sources

- Direct inspection of `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` (5428 lines)
- `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` (5802 lines)
- `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts`
- `integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts`
- `integrations/mcp-server-semantic-analysis/config/workflows/batch-analysis.yaml`
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts`
- `.data/knowledge-export/coding.json` (live output: 57 entities, 22 with low quality indicators)
- `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md` (historical context)

---

*Architecture research for: UKB multi-agent analysis pipeline*
*Researched: 2026-02-26*

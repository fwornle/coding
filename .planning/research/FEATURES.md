# Feature Research

**Domain:** UKB Multi-Agent Analysis Pipeline (integrations/mcp-server-semantic-analysis)
**Researched:** 2026-02-26
**Confidence:** HIGH (direct codebase inspection, workflow reports, knowledge export)

---

## Agent Inventory

The pipeline is defined as a 14-agent system (plus batch-checkpoint-manager as a 15th). The workflow YAML labels it "Unified 14-agent workflow." Here is every agent, its file, and its actual role.

| # | Agent Key | File | Role |
|---|-----------|------|------|
| 1 | batch_scheduler | batch-scheduler.ts | Plans chronological batches of 50 commits each; produces BatchWindow[] with start/end commits and dates; handles checkpoint resume |
| 2 | git_history | git-history-agent.ts | Extracts git commits for a batch window via git log; produces GitCommit[] with files, additions/deletions, author, date, message |
| 3 | vibe_history | vibe-history-agent.ts | Reads .specstory/history/ session logs; correlates sessions to commits by timestamp; extracts KeyTopic[] using LLM analysis of conversation content |
| 4 | semantic_analysis | semantic-analysis-agent.ts | Cross-analyzes git commits and vibe sessions using LLM; produces SemanticAnalysisResult with architectural patterns, code quality, crossAnalysisInsights |
| 5 | observation_generation | observation-generation-agent.ts | Transforms semantic analysis output into StructuredObservation[] — typed, dated observations with entity names, significance scores, and relationships |
| 6 | ontology_classification | ontology-classification-agent.ts | Maps each observation/entity against the project ontology using heuristics + LLM; assigns OntologyMetadata with class, confidence, properties |
| 7 | kg_operators | kg-operators.ts | Applies 6 Tree-KG operators per batch: conv (context enrichment), aggr (core/non-core ranking), embed (vector embeddings), dedup (merge duplicates), pred (edge prediction), merge (integrate into accumulated KG) |
| 8 | quality_assurance | quality-assurance-agent.ts | Validates batch output: entity naming, observation counts, significance range, file conventions; has retry loop up to 3x |
| 9 | batch_checkpoint_manager | (coordinator internal) | Saves per-batch checkpoint to .data/ so workflow can resume from last completed batch |
| 10 | code_graph | code-graph-agent.ts | AST indexes repository via Memgraph/Tree-sitter; runs indexRepository, synthesizeInsights (LLM synthesis of top code entities), transformToKnowledgeEntities; runs in finalization phase only |
| 11 | documentation_linker | documentation-linker-agent.ts | Scans all .md and .puml files; extracts code references; creates DocumentationLink[] mapping docs to code entities |
| 12 | web_search | web-search.ts | Searches external resources for similar patterns; enriches generated insights with community context; max 10 searches |
| 13 | insight_generation | insight-generation-agent.ts | Generates rich markdown insight documents with PlantUML diagrams, code examples, pattern catalogs; writes to knowledge-management/insights/ |
| 14 | persistence | persistence-agent.ts | Persists entities via GraphDatabaseAdapter to Graphology + LevelDB at .data/knowledge-graph/; falls back to JSON if GraphDB unavailable |
| + | deduplication | deduplication.ts | Cross-entity deduplication using embedding similarity (OpenAI) and merging strategies; runs in finalization phase |
| + | content_validation | content-validation-agent.ts | Validates observation accuracy against current codebase; checks file refs, command names, API endpoints; detects stale observations |
| + | workflow_report | workflow-report-agent.ts | Generates per-execution markdown reports to .data/workflow-reports/; coordinator utility, not a pipeline step |

**Note:** semantic-analyzer.ts is a shared LLM access layer used by multiple agents, not an agent itself.

---

## Pipeline Phases and Data Flow

### Batch Phase (repeats 26 times for this repo, 50 commits per batch)

```
batch_scheduler
  -> git_history (extract commits)
  -> vibe_history (extract sessions, correlate with commits)
  -> semantic_analysis (LLM cross-analysis of commits and sessions)
  -> observation_generation (transform to StructuredObservation[])
  -> ontology_classification (assign ontology classes)
  -> kg_operators (conv, aggr, embed, dedup, pred, merge into accumulatedKG)
  -> quality_assurance (validate, retry up to 3x)
  -> batch_checkpoint_manager (save checkpoint)
```

### Finalization Phase (runs once, after all 26 batches)

```
index_codebase (code_graph, AST index of HEAD)
link_documentation (scan all .md and .puml)
synthesize_code_insights (code_graph, LLM synthesis of top 30 entities)
transform_code_entities (code_graph, convert to knowledge entities)
final_persist (persistence: accumulatedKG.entities + code entities -> GraphDB)
generate_insights (insight_generation: insight docs, PlantUML diagrams)
web_search (external pattern enrichment)
final_dedup (deduplication: cross-entity merge)
final_validation (content_validation: stale observation detection)
```

### Intended Outputs

| Output | Location | Format |
|--------|----------|--------|
| Knowledge graph entities | .data/knowledge-graph/ | Graphology + LevelDB |
| JSON export | .data/knowledge-export/coding.json | JSON (auto-exported) |
| Insight documents | knowledge-management/insights/ | Markdown with embedded PlantUML images |
| PlantUML diagrams | knowledge-management/insights/puml/ | .puml source + .png |
| Workflow reports | .data/workflow-reports/ | Markdown per execution |
| Batch checkpoints | .data/ | JSON per batch |

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Status |
|---------|--------------|------------|--------|
| Batch processing of git history | 1260 commits must be processed without memory overflow | HIGH | WORKING |
| Checkpoint resume | Large pipeline must survive interruption | MEDIUM | WORKING |
| Entity creation with observations | Core knowledge graph output | HIGH | PARTIAL: entities created; observations are trivial |
| Knowledge graph persistence | Must survive session end | MEDIUM | WORKING |
| JSON export for VKB viewer | Viewer reads coding.json | LOW | WORKING |
| Insight document generation | Named in core value statement of PROJECT.md | HIGH | BROKEN: 0 docs with valid content |
| Meaningful entity names | Entities must be identifiable | MEDIUM | BROKEN: mangled lowercase names |
| Rich observations | Must capture architectural patterns | HIGH | BROKEN: commit-message paraphrases |
| Ontology classification | Assigns entity types, enables categorization | MEDIUM | PARTIAL: assigns types to a poor entity set |
| Deduplication | Prevents duplicates across batches | MEDIUM | WORKING |
| Content validation | Detects stale observations | MEDIUM | WORKING |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Status |
|---------|-------------------|------------|--------|
| Vibe history correlation | Session logs give intent context behind commits | HIGH | IMPLEMENTED (correctness unverified) |
| Code Graph RAG (Tree-sitter AST) | AST-level intelligence beyond text search | HIGH | WORKING: 46K entities indexed in Memgraph |
| Tree-KG operators | Six-stage KG construction (conv/aggr/embed/dedup/pred/merge) | HIGH | WORKING: all 6 operators run; impact uncertain given poor input quality |
| PlantUML diagram generation | Auto-generated architecture diagrams in insight docs | HIGH | BROKEN: insight generation fails before reaching diagram phase |
| Smart orchestrator | Confidence-propagating retry/skip routing | HIGH | IMPLEMENTED: code exists; mostly falls through to "proceed" given pass-through results |
| Cross-batch knowledge accumulation | Later batches informed by earlier patterns | HIGH | IMPLEMENTED: accumulatedKG grows per batch; quality low |
| Web search enrichment | External pattern context in insight docs | LOW | WORKING: runs but downstream insight docs are broken |
| Documentation linking | Connects .md/.puml to code entities | MEDIUM | WORKING: 2977 links found; not yet influencing insight content |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Per-batch insight generation | Seems like insights should happen as data arrives | Creates temporal mismatch — code graph only indexes HEAD, not historical state | Keep insights in finalization phase (correct design) |
| Increasing agent count further | More agents seems like more intelligence | More agents means more data-passing failure points and skip-cascade risks | Fix existing agents to produce quality output |
| Reducing batch size below 50 | Smaller batches, more frequent checkpoints | No meaningful gain; bottleneck is LLM prompt quality, not batch size | Keep 50-commit batches |
| Synchronization agent | Was in previous architecture | Was a placeholder calling a non-existent "knowledge_graph" agent; GraphDB handles sync | Removed permanently (Oct 2025) |
| MCP Memory integration | Seems like natural integration | MCP Memory server never existed as a dependency; was dead code | Removed permanently (Oct 2025) |

---

## Working vs Broken Features

### Confirmed Working

1. **Batch scheduling and checkpointing** — plan_batches correctly slices 1260 commits into 26 batches of 50; checkpoint resume works across runs.

2. **Git history extraction** — extract_batch_commits produces GitCommit[] with file paths, additions/deletions, author, date per batch.

3. **Code graph indexing** — index_codebase uses existing Memgraph data (46,222 functions/classes/methods/modules indexed); incremental mode works correctly.

4. **Documentation linking** — link_documentation finds 531 documents and creates 2,977 links across markdown and PlantUML files.

5. **Knowledge graph persistence** — final_persist stores entities via GraphDatabaseAdapter to Graphology + LevelDB; 57 entities currently stored.

6. **JSON export** — coding.json is exported and readable; VKB viewer works correctly from this data.

7. **Deduplication** — runs and merges duplicate entities across batches.

8. **Content validation** — runs, checks file references, detects stale observations.

9. **Workflow reports** — per-run markdown reports generated to .data/workflow-reports/.

10. **Ontology classification** — assigns ontology classes (MCPAgent, GraphDatabase, etc.) using heuristic + LLM classification.

### Confirmed Broken

**Insight document generation — produces 0 valid insight documents**

Root cause chain:
- The YAML generate_insights step uses template refs like {{accumulatedKG.gitAnalysis}} which resolve to undefined in the batch workflow because accumulatedKG is a coordinator JavaScript variable, not a named step result
- The coordinator has an explicit fallback call to generateComprehensiveInsights at coordinator.ts line ~3797 that DOES run (33s duration in the production run report), but produces mock LLM content ("Mock: Code structure analyzed") because the production run used debug/mock mode
- On checkpoint-resume runs, the explicit call receives "No commits found" because allBatchCommits is empty — batches are already checkpointed and commit accumulation is skipped

**Insight document content is mock JSON, not markdown**

When insight generation does produce files, the content is raw JSON from mock LLM:
```
# ApiHandlesExternalCommunication
{"summary": "Mock: Code structure analyzed", "codePatterns": [...]}
```
This is 37 lines vs. the 263-line quality target (MVIReduxArchitecturePattern.md).

**Observation quality — commit-message paraphrasing with template repetition**

Nearly all 57 entities have identical observations:
- "[Name] is implemented across: src/knowledge-management, lib/ukb-unified, ..."
- "shared-memory.json has been REMOVED from the codebase"

These are either hardcoded template observations or the LLM prompt produces near-identical output for every entity. No entity has has_insight_document: true. All 57 entities have significance 0.5 (uniform default).

**Entity naming — mangled lowercase from LLM output**

Many entities have names like:
- PathanalyzerpatternProblemHowConsider (should be: PathAnalyzerPattern)
- ConstraintmonitorimplementationProblemImplementingConstraint
- ModularconstraintmonitoringDecisionUtilizingMcp

These names come from the observation-generation LLM prompt output which produces raw lowercase text that gets naively joined without PascalCase formatting.

**Significance scores uniformly 0.5**

All historical entities have significance 0.5 (equivalent to 5/10). The kg_operators aggregation step should promote high-significance entities to "core" role, but either initial significance scores are uniformly low or the KG operator output is discarded before persistence.

**YAML generate_insights step receives unresolved templates**

The finalization-phase YAML step for generate_insights passes {{accumulatedKG.gitAnalysis}} etc., but these template refs never resolve in the batch coordinator because accumulatedKG is stored in a JavaScript variable, not a named step result. The YAML step always skips with "No commits found."

---

## Feature Gaps (Should Exist, Does Not)

| Gap | Expected Behavior | Current State |
|-----|-------------------|---------------|
| Insight docs linked to entities | has_insight_document: true + file path in entity metadata | All 57 entities have has_insight_document: false; field is set only if file exists at persistence time, but file is written after persistence |
| Observation diversity | Each entity has 3-5 distinct typed observations (architecture, implementation, validation) | 1-11 observations all using same template text |
| Pattern discovery across categories | Discovers architecture patterns, design decisions, components, conventions, integration approaches | Output dominated by MCPAgent and GraphDatabase entities from recent storage-layer commits |
| Real PlantUML diagrams in insight docs | Architecture, sequence, class, use-case diagrams per insight | No diagrams generated; insight generation fails before reaching PlantUML phase |
| Entity significance differentiation | Range spans 1-10; high-value patterns rated 8-9 | All entities score 5 (0.5 normalized); differentiation logic in kg_operators.aggr not affecting final output |
| Web search enrichment in insights | External resources cited in insight docs | Web search runs but downstream insight generation is broken |
| correlate_with_codebase step | Historical entities correlated with current codebase to mark superseded vs. active | Explicitly commented out in YAML with TODO; method not implemented in CodeGraphAgent |

---

## Feature Dependencies

```
[batch_scheduler] feeds [git_history] and [vibe_history]
[git_history] and [vibe_history] feed [semantic_analysis]
[semantic_analysis] feeds [observation_generation]
[observation_generation] feeds [ontology_classification]
[ontology_classification] feeds [kg_operators]
[kg_operators] feeds [quality_assurance]
[quality_assurance] feeds [batch_checkpoint_manager]

After all batches complete:
[batch_checkpoint_manager] triggers [code_graph.index] and [documentation_linker] in parallel
[code_graph.index] feeds [code_graph.synthesize]
[code_graph.synthesize] feeds [code_graph.transform]
[code_graph.transform] and [documentation_linker] feed [final_persist]
[final_persist] and [accumulated batch data] feed [insight_generation]
[insight_generation] feeds [web_search]
[web_search] feeds [final_dedup]
[final_dedup] feeds [content_validation]
```

**Critical dependency violations:**

1. insight_generation depends on meaningful patterns from observation_generation, but observation_generation produces template content — so even if insight generation runs, it filters all patterns as "thin/statistical" and skips.

2. insight_generation depends on allBatchCommits being populated, but on checkpoint-resume runs, batches are marked complete and commits are never accumulated — leaving allBatchCommits empty.

3. The YAML generate_insights step's template references ({{accumulatedKG.gitAnalysis}}) are never resolved in the batch workflow because accumulatedKG is a JavaScript variable, not accessible to the template engine.

---

## MVP Definition

The MVP for the fix project is a pipeline run that produces, for the coding repo:
- At least 10 entities with significance >= 6 (currently all are 5)
- At least 5 entities with has_insight_document: true
- Insight documents of at least 100 lines with real, specific content (not mock JSON)
- Entity names in proper PascalCase (no mangled lowercase names)
- At least 3 different entity categories beyond "MCPAgent" and "GraphDatabase"

### Fix Priority

**P1 (blocks all insight generation):**
- Fix insight generation data routing — coordinator must pass real allBatchCommits to generateComprehensiveInsights on resume runs, or load from checkpoints. The YAML template ref mismatch must be resolved.
- Disable mock LLM in production runs — production runs must use real LLM providers.
- Fix observation quality — the observation_generation LLM prompt must produce entity-specific, semantically meaningful observations rather than template text.

**P2 (quality improvement):**
- Fix entity naming — formatPatternName() in insight generation and observation generation must enforce PascalCase with word boundary detection.
- Fix significance differentiation — entities must receive differentiated significance scores (1-10 range) based on actual pattern importance.

**P3 (completeness):**
- Implement correlate_with_codebase — currently commented out; needed for distinguishing active vs. historical patterns.
- Link insight documents to entities at persist time — set has_insight_document: true and validated_file_path when insight file exists.

---

## Quality Benchmark: What a Good Insight Document Looks Like

Reference: knowledge-management/insights/MVIReduxArchitecturePattern.md (263 lines)

| Characteristic | Target | Current Output |
|---------------|--------|----------------|
| Length | 200-500+ lines | 37 lines (mock JSON) |
| Structure | Table of Contents, Overview, Problem/Solution, Diagrams, Code Examples, Applicability, Checklist | Single header and JSON blob |
| Diagrams | Mermaid or PlantUML architecture/sequence diagrams | None |
| Code examples | Real TypeScript/JavaScript from the codebase | None |
| Problem statement | Specific problem this pattern solves | None |
| Significance rating | Explicit 1-10 rating with justification | None |
| Related patterns | Cross-links to related entities | None |
| Implementation guidance | DO/DON'T rules, when to use/not use | None |
| References | Links to official docs, related patterns | None |

**Quality grade of current pipeline output: 1/10** — mock JSON wrapped in a header is not an insight document.

The best current insight document (VSCodeExtensionBridgePattern.md, ~73 lines) does contain LLM-generated prose in the correct sections but is generic — it describes the knowledge graph storage system rather than the actual VSCode extension bridge pattern, because it was generated from uniform "storage-layer" observations that don't distinguish between entities.

---

## Sources

- integrations/mcp-server-semantic-analysis/src/agents/ — all 16 agent files read directly
- integrations/mcp-server-semantic-analysis/config/workflows/batch-analysis.yaml — canonical workflow definition
- integrations/mcp-server-semantic-analysis/src/orchestrator/smart-orchestrator.ts — routing logic
- integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md — resolved architecture issues
- .data/knowledge-export/coding.json — current entity quality inspection (57 entities)
- .data/workflow-reports/batch-analysis-2026-01-20T07-07-57-874Z.md — full production run report
- .data/workflow-reports/batch-analysis-2026-01-21T11-51-12-233Z.md — debug/resume run report
- knowledge-management/insights/MVIReduxArchitecturePattern.md — quality target (263 lines, real content)
- knowledge-management/insights/ApiHandlesExternalCommunication.md — current output quality (37 lines, mock JSON)
- knowledge-management/insights/VSCodeExtensionBridgePattern.md — best current output (~73 lines, generic LLM prose)

---
*Feature research for: UKB multi-agent analysis pipeline*
*Researched: 2026-02-26*

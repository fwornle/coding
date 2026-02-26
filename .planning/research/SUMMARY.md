# Project Research Summary

**Project:** UKB Multi-Agent Analysis Pipeline (mcp-server-semantic-analysis)
**Domain:** Multi-agent knowledge graph construction from git history + session logs
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

The UKB pipeline is a 14-agent DAG workflow that analyzes a git repository's commit history and AI session logs (`.specstory/`) to construct a knowledge graph of architectural patterns, design decisions, and code entities. The pipeline is well-architected in terms of its overall structure — batch processing with checkpoint resume, a two-phase execution model (batch loop then finalization), and a custom multi-agent framework — but has several concrete, traceable bugs that prevent its primary output (insight documents) from ever being generated. The pipeline currently runs to completion and produces 57 entities in LevelDB, but those entities have mangled names, uniform significance scores, template-filled observations, and zero linked insight documents.

The recommended approach is surgical bug-fixing rather than architectural redesign. The core architecture (14-agent DAG, YAML workflow, Graphology + LevelDB storage, CoordinatorAgent orchestration) is sound and working. Three specific failure chains account for the entire quality gap: (1) LLM output format mismatch in pattern extraction causes zero patterns to be extracted from valid LLM responses; (2) the `toPascalCase()` bug introduced on Feb 15, 2026 destroys entity name capitalization; and (3) template-based observation generation in `createArchitecturalDecisionObservation()` produces slot-filled strings instead of semantic content. All three have clear, low-risk fixes.

The primary risk during the fix project is regression — fixing one agent's output format may cascade into downstream parsing failures in other agents that now expect the broken format. Every fix should be validated against a full workflow run report, not just unit-level output. The secondary risk is that LLM provider fallbacks (Groq -> Anthropic -> OpenAI) may produce different output formats than the primary provider, causing format-mismatch pitfalls to recur after deployment. All LLM parsing should use JSON schemas rather than line-by-line text parsing to eliminate this class of bug permanently.

## Key Findings

### Current Stack (Established, Working)

The stack is entirely custom-built — no third-party agent framework (no LangChain, no AutoGen). All findings are from direct code inspection with HIGH confidence.

**Core technologies:**
- **Custom `BaseAgent<TInput, TOutput>`** — abstract base class for all 14 agents; typed input/output with confidence/issues/routing metadata
- **`CoordinatorAgent` (5428 lines)** — central orchestrator; owns all in-memory state (`accumulatedKG`, `allBatchCommits`, `allBatchObservations`); executes YAML DAG steps
- **`SmartOrchestrator`** — confidence-propagating routing layer wrapping CoordinatorAgent
- **Custom `@coding/llm` library** — singleton `LLMService` with circuit breakers, caching, mode routing (mock/local/public), budget tracking
- **Graphology ^0.25.4 + LevelDB ^10.0.0** — in-memory KG + persistent storage; working correctly; do not modify
- **YAML workflow definitions** — DAG step definitions in `config/workflows/batch-analysis.yaml`; template references (`{{accumulatedKG.entities}}`) are partially broken for non-step data
- **Anthropic/OpenAI/Groq/Gemini SDKs** — direct SDK bindings, no abstraction layer; subscription providers (Copilot) prioritized to reduce API cost
- **code-graph-rag (Python + Tree-sitter + Memgraph)** — AST-based code indexing; 46,222 entities already indexed; gracefully degrades when unavailable

**What the stack does not need:** No new libraries, no framework changes, no storage migration. The infrastructure is correct.

### Feature Landscape

**Working correctly (do not touch):**
- Batch scheduling (26 batches of 50 commits from 1260 total commits) and checkpoint resume
- Git history extraction per batch (`GitCommit[]` with file diffs)
- Code graph indexing (46,222 AST entities in Memgraph)
- Documentation linking (2,977 links across 531 documents)
- Knowledge graph persistence (Graphology + LevelDB, VKB export)
- Deduplication and content validation
- Ontology classification (heuristic + LLM; assigns MCPAgent, GraphDatabase, etc.)
- Workflow report generation

**Confirmed broken (requires fixes):**
- **Insight document generation** — produces 0 valid documents due to pattern extraction returning 0 results (Pitfall 1)
- **Entity naming** — mangled lowercase due to `toPascalCase()` bug (Pitfall 2)
- **Observation content** — template-filled commit-message paraphrases, not semantic analysis (Pitfall 3)
- **Significance scores** — all entities at 0.5 (fraction storage bug) with no differentiation
- **YAML `generate_insights` step** — dead code; template bindings to `accumulatedKG` never resolve; explicit code block handles insight generation instead

**MVP target:** 10+ entities with significance >= 6, 5+ entities with `has_insight_document: true`, insight documents >= 100 lines with real content, PascalCase entity names, 3+ entity categories beyond MCPAgent/GraphDatabase.

**What to defer (do not implement now):**
- `correlate_with_codebase` step (currently commented out in YAML)
- Per-batch insight generation (wrong phase — code graph indexes HEAD only)
- Increasing agent count (architecture stays fixed)

### Architecture: Key Patterns and Boundaries

The pipeline uses a **two-phase batch + finalization** architecture. Batch phase (26 iterations) processes commits chronologically; finalization phase runs once to produce final outputs. This is the correct design — do not collapse phases.

**Critical data flow boundary:** CoordinatorAgent maintains dedicated accumulator arrays (`allBatchCommits`, `allBatchSessions`, `allBatchObservations`) that survive per-batch memory compaction. `allBatchSemanticEntities` is NOT implemented — semantic entities are only in `execution.results['batch_semantic_analysis']` which gets compacted. This is the data-loss path.

**Broken YAML template resolution:** `generate_insights` YAML step uses `{{accumulatedKG.entities}}` — `accumulatedKG` is a JavaScript variable in CoordinatorAgent scope, not a named step result, so template resolution always returns null. The explicit code block at coordinator.ts ~line 3797 is the actual insight generation path. The YAML step is dead code.

**Double observation generation anti-pattern:** `ObservationGenerationAgent.generateStructuredObservations()` is called twice per batch. Call 1 produces `KGEntity[]` for the KG operator pipeline. Call 2 synthesizes from Call 1's already-thin output — compounding quality issues. These should be merged into one call.

**Major components (all working correctly at infrastructure level):**

| Component | Status | Notes |
|-----------|--------|-------|
| `CoordinatorAgent` | Infrastructure working | Logic bugs in data routing |
| `SmartOrchestrator` | Working | Mostly falls through to "proceed" given low confidence scores |
| `LLMService` + provider chain | Working | Circuit breakers, caching functional |
| `GraphDatabaseAdapter` | Working | Lock-free via VKB HTTP API when server running |
| `InsightGenerationAgent` | Infrastructure working | Pattern extraction parser is broken |
| `BatchCheckpointManager` | Working | Resume from any batch works |

### Critical Pitfalls

1. **LLM output format mismatch in pattern extraction** — The parser in `parseArchitecturalPatternsFromLLM()` uses regex `^(Pattern|Architecture|Design):\s*(.+)` but Groq returns markdown-numbered format (`1. **Pattern: KnowledgeBaseUpdatePattern**`). Zero patterns extracted. **Fix:** Change LLM prompt to request JSON schema output; parse JSON instead of line-by-line.

2. **`toPascalCase()` bug destroys interior capitals** — Introduced commit `ee72322` (Feb 15, 2026). The function lowercases all non-first characters: `word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()` — turning `PathAnalyzer` into `Pathanalyzer`. **Fix:** Remove `.toLowerCase()` — use `word.slice(1)` unchanged.

3. **Template-filled observation generation** — `createArchitecturalDecisionObservation()` fills hardcoded strings from commit file extensions ("This X pattern is applicable when building JSON, JavaScript, Markdown systems"). **Fix:** Replace with LLM synthesis call, same as `createEntityObservation()` already does correctly.

4. **`code_synthesis_results` passed as empty timing wrapper** — When Memgraph is unavailable, `synthesizeInsights` returns `[]`; spread with `wrapWithTiming` produces `{_timing: {...}}` object; `Array.isArray()` check in insight agent fails silently. **Fix:** Return structured skip object `{synthesisResults: [], skipped: true}`; unwrap before passing.

5. **Significance stored as fraction, read back as fraction** — `UKBDatabaseWriter` stores `confidence: significance / 10`; `GraphDatabaseService.getEntities()` reads `confidence` field back as `significance`. All entities show 0.5. **Fix:** Normalize in `GraphDatabaseService.getEntities()` read path.

## Implications for Roadmap

The fix project has a clear dependency order based on the pipeline's data flow. Each bug blocks downstream quality, so fixes must follow the pipeline's execution order.

### Phase 1: Core Pipeline Data Quality (P1 Fixes)

**Rationale:** All downstream quality depends on what `ObservationGenerationAgent` and `SemanticAnalysisAgent` produce in each batch. Fixing the pattern extraction parser (Pitfall 1), entity naming (Pitfall 2), and observation template replacement (Pitfall 3) unblocks insight generation entirely.

**Delivers:**
- LLM-synthesized, entity-specific observations instead of template strings
- Correctly capitalized PascalCase entity names
- `extractArchitecturalPatternsFromCommits()` returning actual patterns (currently 0)
- Pattern catalog with significance >= 3 passing filter thresholds

**Addresses features:** Observation quality, entity naming, pattern extraction
**Avoids pitfalls:** Pitfall 1 (parser), Pitfall 2 (toPascalCase), Pitfall 3 (templates)

**Specific changes:**
- `insight-generation-agent.ts`: Change `extractArchitecturalPatternsFromCommits` prompt to JSON schema; update parser to `JSON.parse()` instead of regex
- `observation-generation-agent.ts`: Fix `toPascalCase` (remove `.toLowerCase()`); replace `createArchitecturalDecisionObservation` templates with LLM synthesis
- `coordinator.ts` line ~2637: Change `analysisDepth: 'surface'` to `'deep'` to reduce rule-based fallback frequency

**Research flag:** No additional research needed — all code paths are fully traced.

### Phase 2: Insight Generation Data Routing

**Rationale:** Even with Phase 1 fixes producing quality observations, the insight generation step will still fail if it receives empty commit arrays (compaction problem) or a timing wrapper instead of synthesis results (Pitfall 4). Data routing must be fixed so insight generation receives the rich context it was designed to consume.

**Delivers:**
- Insight documents written to `knowledge-management/insights/` with real content (target: >= 100 lines)
- `has_insight_document: true` set in entity metadata
- PlantUML diagrams generated for top patterns

**Addresses features:** Insight document generation (currently 0 docs), `has_insight_document` linkage
**Avoids pitfalls:** Pitfall 4 (timing wrapper), Pitfall 5 (silent skip with no visibility)

**Specific changes:**
- `coordinator.ts`: Add `allBatchSemanticEntities` accumulator array populated immediately after semantic analysis (before compaction)
- `code-graph-agent.ts`: Return `{synthesisResults: [], skipped: true, reason: '...'}` when Memgraph unavailable; unwrap in coordinator before passing to insight agent
- `coordinator.ts`: Remove dead YAML `generate_insights` step or add explicit comment; pass `allBatchSemanticEntities` to `generateComprehensiveInsights`
- `persistence-agent.ts`: Set `has_insight_document: true` and `validated_file_path` when insight file exists at persist time (or add post-insight linking pass)

**Research flag:** No additional research needed — code paths are fully traced.

### Phase 3: Significance and Quality Ranking

**Rationale:** After Phases 1 and 2 produce real content, the quality differentiation layer needs fixing so high-value entities float to the top and the significance scale (1-10) is meaningful throughout the pipeline.

**Delivers:**
- Entities with differentiated significance scores (1-10 range, not all 0.5)
- KG operator `aggr` step correctly promoting high-significance entities to "core" role
- Observation quality ranking (LLM-synthesized > template-based) before 50-observation cap

**Addresses features:** Significance differentiation, entity role assignment
**Avoids pitfalls:** Pitfall 5 (uniform scores), Pitfall 7 (fraction storage), Pitfall 8 (50-observation cap drops good observations)

**Specific changes:**
- `GraphDatabaseService.getEntities()`: Normalize: `significance = attributes.significance ?? Math.round((attributes.confidence || 0.5) * 10)`
- `kg-operators.ts` `mergeEntities()`: Quality-rank observations before applying 50-obs cap (prefer observations with code references and file paths)
- `observation-generation-agent.ts` + coordinator: Ensure LLM-assigned significance (not always `|| 5` default) propagates through KG operator pipeline

**Research flag:** No additional research needed.

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** Pattern extraction fix (Phase 1) is required before insight generation routing (Phase 2) matters — routing quality data into a broken parser produces the same zero-document result.
- **Phase 2 before Phase 3:** Significance differentiation only matters when there is real content to differentiate. Running Phase 3 on template-based observations would produce misleadingly high significance scores for garbage content.
- **All three phases are contained within one service:** `integrations/mcp-server-semantic-analysis`. No cross-service changes required.
- **Infrastructure changes are not needed:** Storage, transport, agent count, Docker configuration, and MCP server interface remain unchanged.

### Research Flags

Phases with fully traced code paths (skip deeper research):
- **Phase 1:** All bugs traced to specific lines with code evidence in logs. No unknowns.
- **Phase 2:** All data routing paths traced through CoordinatorAgent. Accumulator pattern is well-established (`allBatchCommits` as reference implementation).
- **Phase 3:** Normalization paths traced through `GraphDatabaseService` and `kg-operators.ts`.

Phases that warrant validation against a production run before marking done:
- **Phase 2** (insight generation): End-to-end validation requires a full pipeline run (26 batches + finalization, approximately 2-4 hours). Use `--singleStepMode` with `mockLLM: false` for the finalization phase only to validate without re-running all batches.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All from direct code inspection. No inference. |
| Features | HIGH | Working/broken status verified against production run report (batch-analysis-2026-01-20) and `coding.json` entity export. |
| Architecture | HIGH | CoordinatorAgent fully traced (5428 lines), all data paths documented with line numbers. |
| Pitfalls | HIGH | All 5 critical pitfalls traced to specific log files (`/logs/pattern-extraction-result-*.json`) and code lines. Git commit `ee72322` identified as the toPascalCase regression. |

**Overall confidence:** HIGH

### Gaps to Address

- **Vibe history correlation accuracy** — `VibeHistoryAgent` correlates session logs to commits by timestamp. Whether this correlation is accurate (correct sessions matched to correct commits) is unverified. Low priority since vibe data is supplementary to git analysis, but should be validated during Phase 1 testing.

- **LLM provider behavior differences** — Pattern extraction fix uses JSON schema prompting, but different providers (Groq vs Anthropic vs Copilot) may still return subtly different JSON structures. Implement a validation step that logs malformed responses rather than silently returning empty results.

- **`correlate_with_codebase` TODO** — Currently commented out in YAML with a TODO comment and no implementation in `CodeGraphAgent`. This feature would distinguish active vs. historical patterns. Not blocking for MVP but will affect long-term accuracy of the entity set. Flag for post-MVP work.

- **Duplicate observation accumulation on resume runs** — When the workflow resumes from checkpoint, `allBatchObservations` is re-populated from scratch. Whether already-completed batches' observations are re-added needs verification. The checkpoint system prevents re-running batches, but the accumulator arrays are populated from `execution.results` which may contain compacted results depending on when the resume happens.

## Sources

### Primary (HIGH confidence — direct code inspection)

All sources are local codebase files. No external documentation was required.

- `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` — 5428 lines, fully read
- `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` — 5802 lines, key methods traced
- `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts` — template strings identified
- `integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts` — fallback path traced
- `integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts` — timing wrapper bug identified
- `integrations/mcp-server-semantic-analysis/src/knowledge-management/GraphDatabaseService.js` — significance normalization gap
- `integrations/mcp-server-semantic-analysis/config/workflows/batch-analysis.yaml` — YAML step definitions
- `lib/llm/` — full LLM service and provider chain
- `.data/knowledge-export/coding.json` — 57 entities inspected (0 with `has_insight_document: true`)
- `.data/workflow-reports/batch-analysis-2026-01-20T07-07-57-874Z.md` — production run report
- `/logs/pattern-extraction-result-1769877223136.json` — confirms `totalPatterns: 0` from valid LLM response
- `/logs/insight-generation-input-1769877218503.json` — confirms timing wrapper bug in `code_synthesis_results`
- `git show ee72322` — confirms `toPascalCase` regression date (Feb 15, 2026)

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*

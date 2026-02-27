---
status: diagnosed
phase: 01-core-pipeline-data-quality
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md]
started: 2026-02-27T06:00:00Z
updated: 2026-02-27T12:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Pattern Extraction Produces Results
expected: Run `ukb full`. In the logs, look for "Extracted N patterns from LLM response" where N > 0. The pipeline should successfully parse patterns from the LLM's response. No "Zero patterns extracted" warning should appear after retry.
result: issue
reported: "The 1778 patterns logged are observation entities being read back, not newly extracted patterns from parseArchitecturalPatternsFromLLM. 93% data loss across the pipeline — 293 concepts in, only 20 entities out. Cannot confirm pattern extraction actually worked at the parseArchitecturalPatternsFromLLM level."
severity: blocker

### 2. Pattern Names Use Correct PascalCase
expected: After a pipeline run, check extracted pattern names in logs or knowledge graph output. Names like "PathAnalyzer" should appear as "PathAnalyzerPattern" (not "PathanalyzerPattern"). Multi-word names should preserve internal capitalization boundaries.
result: issue
reported: "Entity names in knowledge graph show mixed results. Top entities are clean PascalCase (KnowledgePersistencePattern, VSCodeExtensionBridgePattern) but many entities have mangled lowercase-concatenated names: PathanalyzerimplementationProblemImplementingPath, ComprehensiveknowledgegraphDecisionImplementComprehensive, SemanticanalysisrefactoringProblemTightCoupling. A different naming code path is still producing broken names."
severity: major

### 3. Entity Names Preserve PascalCase
expected: After a pipeline run, check entity names in the knowledge graph. Entity names should preserve existing PascalCase. Run purge script or inspect entities to verify naming.
result: issue
reported: "Same as Test 2. Entity naming fixes applied to toPascalCase/generateCleanEntityName/generateEntityName but another code path (likely in observation-generation-agent entity creation or a different agent) still concatenates lowercase words. 66 total entities, roughly half have broken names."
severity: major

### 4. Observations Are LLM-Synthesized (Not Templates)
expected: After a pipeline run, inspect observation content in the knowledge graph. Observations should contain specific, contextual analysis — NOT generic template text.
result: issue
reported: "293 LLM synthesis failures for entity observations fell back to raw content. 63 'LLM insight enhancement failed, using template-based approach' warnings. Insight documents contain mock data from a previous debug run ('Mock: Code structure analyzed'). All 21 insight documents have qualityScore: 0, empty sections, and empty materials. The LLM synthesis is being attempted but failing at scale."
severity: blocker

### 5. Analysis Depth Is Deep
expected: In pipeline logs, the semantic analysis should process full file contents (deep mode). Look for longer analysis times or analysisDepth: deep in coordinator log.
result: issue
reported: "Cannot confirm deep analysis had any effect. The coordinator change was made but with 93% data loss at semantic_analysis step and all LLM synthesis failing, the depth setting is moot. The pipeline produced no meaningful output regardless of depth."
severity: major

## Summary

total: 5
passed: 0
issues: 5
pending: 0
skipped: 0

## Gaps

- truth: "parseArchitecturalPatternsFromLLM extracts patterns from LLM responses and pipeline retains data through stages"
  status: failed
  reason: "User reported: 93% data loss across pipeline. 293 concepts in, 20 entities out. Log line '1778 patterns' refers to reading existing observations, not new pattern extraction."
  severity: blocker
  test: 1
  root_cause: "Entity vocabulary hardcoded to 10 patterns in semantic-analysis-agent.ts:532-547 (getPatternDescription). parseArchitecturalPatternsFromLLM only runs at finalization (not per-batch), returned 0 patterns because all 3 parse strategies failed on actual LLM response format. '93% loss' is a category error in ukb-trace-report.ts:416 comparing commits to entities."
  artifacts:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts"
      issue: "getPatternDescription() hardcodes 10-pattern vocabulary, pure regex matching"
    - path: "integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts"
      issue: "parseArchitecturalPatternsFromLLM returned 0 patterns at finalization, parse strategies failed on actual response format"
    - path: "integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts"
      issue: "Data loss metric compares commits to entities (category error), lossReasons never populated"
  missing:
    - "parseArchitecturalPatternsFromLLM needs to handle actual LLM prose response format"
    - "Entity creation needs LLM-driven pattern extraction per batch, not hardcoded vocabulary"
    - "Trace report loss metric needs to compare semantically equivalent units"
  debug_session: ".planning/debug/pattern-extraction-data-loss.md"

- truth: "Entity names use correct PascalCase throughout all naming code paths"
  status: failed
  reason: "User reported: Many entities have mangled lowercase names. Fixes applied to 3 of 7 naming paths."
  severity: major
  test: 2
  root_cause: "Phase 01 fixed toPascalCase, generateCleanEntityName, generateEntityName. Four bypass paths untouched in observation-generation-agent.ts: createEntityObservation (uses raw entity.name), createSessionObservation (inline naming with same bug), createPatternObservation (raw pattern.name), createInsightDocumentObservation (raw insightDoc.name). Three independent naming functions in insight-generation-agent.ts also untouched: generateMeaningfulPatternName, formatPatternName (different from the one fixed), generateMeaningfulNameAndTitle."
  artifacts:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts"
      issue: "4 of 7 naming paths unfixed: createEntityObservation, createSessionObservation, createPatternObservation, createInsightDocumentObservation"
    - path: "integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts"
      issue: "3 independent naming functions unfixed: generateMeaningfulPatternName, formatPatternName (different instance), generateMeaningfulNameAndTitle"
  missing:
    - "Apply PascalCase fix to all 7 naming paths in observation-generation-agent.ts"
    - "Apply PascalCase fix to all 3 naming functions in insight-generation-agent.ts"
  debug_session: ".planning/debug/entity-naming-paths.md"

- truth: "Observations are LLM-synthesized with meaningful content, not templates or mock data"
  status: failed
  reason: "User reported: 293 LLM synthesis failures fell back to raw content. 63 template fallbacks. Insight docs contain mock data."
  severity: blocker
  test: 4
  root_cause: "LLM calls SUCCEED but JSON.parse fails. createEntityObservation (line 948) and createSemanticInsightObservation (line 1337) call JSON.parse(result.insights) WITHOUT stripping markdown fences. The fixed methods (createArchitecturalDecisionObservation, createCodeEvolutionObservation) DO strip fences. Insight docs on disk contain mock data from previous debug run because Docker bind-mount excludes knowledge-management/insights/ directory. Trace reporter hardcodes empty arrays for materialsUsed in ukb-trace-report.ts:554."
  artifacts:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts"
      issue: "createEntityObservation (line 948) and createSemanticInsightObservation (line 1337) missing markdown fence stripping before JSON.parse"
    - path: "integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts"
      issue: "traceInsightGeneration hardcodes materialsUsed to empty arrays, qualityScore falls back to 0"
    - path: "docker/docker-compose.yml"
      issue: "knowledge-management/insights/ not bind-mounted to host, insight docs lost on container stop"
  missing:
    - "Add markdown fence stripping to createEntityObservation and createSemanticInsightObservation before JSON.parse"
    - "Add knowledge-management bind-mount to docker-compose.yml"
    - "Wire materialsUsed and qualityScore in trace reporter"
  debug_session: ".planning/debug/llm-synthesis-failures.md"

- truth: "Analysis depth 'deep' produces richer output than 'surface'"
  status: failed
  reason: "User reported: Cannot confirm deep analysis had effect. Pipeline produced no meaningful output regardless of depth setting."
  severity: major
  test: 5
  root_cause: "The analysisDepth: deep setting is correctly applied in coordinator.ts but its effect is masked by upstream structural issues: hardcoded 10-pattern vocabulary, JSON.parse failures on LLM responses, and insight docs not persisted to host. Deep analysis may be working but its output is lost before it can be observed."
  artifacts:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts"
      issue: "Setting is correct but effect masked by upstream failures"
  missing:
    - "Fix upstream issues first, then re-verify depth impact"
  debug_session: ""

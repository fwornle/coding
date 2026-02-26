# Roadmap: UKB Pipeline Fix & Improvement

## Overview

Three phases of surgical bug-fixing to restore the UKB multi-agent analysis pipeline to full quality. The dependency order follows the pipeline's own execution order: first fix what enters the pipeline (pattern extraction, naming, observation content), then fix how that data flows into insight generation, then fix how quality is ranked and surfaced. Each phase is independently verifiable by running the pipeline and inspecting output.

## Phases

- [ ] **Phase 1: Core Pipeline Data Quality** - Fix pattern extraction parser, entity naming, and observation template substitution so the pipeline produces real content
- [ ] **Phase 2: Insight Generation & Data Routing** - Fix data accumulators and timing wrapper so insight documents are generated and linked to entities
- [ ] **Phase 3: Significance & Quality Ranking** - Fix significance score normalization and observation ranking so high-value entities surface correctly

## Phase Details

### Phase 1: Core Pipeline Data Quality
**Goal**: The pipeline extracts real architectural patterns, produces correctly-named entities, and generates LLM-synthesized observations instead of template strings
**Depends on**: Nothing (first phase)
**Requirements**: PTRN-01, PTRN-02, PTRN-03, NAME-01, NAME-02, OBSV-01, OBSV-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. `extractArchitecturalPatternsFromCommits()` returns non-zero patterns from a codebase run (log file shows `totalPatterns > 0`)
  2. Entity names in the knowledge export use correct PascalCase (e.g., `PathAnalyzerPattern` not `Pathanalyzerpattern`)
  3. Observations in `coding.json` contain code-specific analysis language, not slot-filled commit file extension strings
  4. Semantic analysis runs with `analysisDepth: 'deep'` (visible in workflow execution logs)
  5. Pattern parser handles both JSON and markdown-numbered LLM response formats without returning empty results
**Plans**: 2 plans
  - [ ] 01-01-PLAN.md -- Fix pattern extraction parser + pattern name formatter (PTRN-01, PTRN-02, PTRN-03, NAME-01)
  - [ ] 01-02-PLAN.md -- Fix entity naming, replace template observations with LLM synthesis, switch to deep analysis (NAME-01, NAME-02, OBSV-01, OBSV-02, DATA-03)

### Phase 2: Insight Generation & Data Routing
**Goal**: Insight documents are written to `knowledge-management/insights/` and linked to their corresponding knowledge graph entities
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, INSD-01, INSD-02, INSD-03, INSD-04, QUAL-02
**Success Criteria** (what must be TRUE):
  1. At least 5 insight documents exist in `knowledge-management/insights/` after a full pipeline run
  2. Insight documents are >= 100 lines with problem statement, solution analysis, code examples, and applicability sections
  3. At least one insight document contains a PlantUML or Mermaid diagram
  4. Corresponding entities in `coding.json` have `has_insight_document: true` set
  5. Insight generation skip events are logged visibly (not silently swallowed) when Memgraph is unavailable
**Plans**: TBD

### Phase 3: Significance & Quality Ranking
**Goal**: Entities carry differentiated significance scores (1-10 range) and the observation cap retains the most meaningful observations
**Depends on**: Phase 2
**Requirements**: OBSV-03, QUAL-01
**Success Criteria** (what must be TRUE):
  1. Entities in `coding.json` show a spread of significance scores (not all 0.5) across the 1-10 range
  2. After a full run, at least 10 entities have significance >= 6
  3. Observations retained after the 50-cap truncation include LLM-synthesized content with code references, not template strings
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Pipeline Data Quality | 1/2 | In Progress|  |
| 2. Insight Generation & Data Routing | 0/? | Not started | - |
| 3. Significance & Quality Ranking | 0/? | Not started | - |

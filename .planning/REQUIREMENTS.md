# Requirements: UKB Pipeline Fix & Improvement

**Defined:** 2026-02-26
**Core Value:** Running `ukb full` must produce meaningful knowledge graph entities with rich insight documents

## v1 Requirements

### Pattern Extraction

- [x] **PTRN-01**: Pattern extraction parser handles markdown-formatted LLM responses (numbered lists, bold markers) from Groq and other providers
- [x] **PTRN-02**: Pattern extraction parser handles JSON-formatted LLM responses as fallback
- [x] **PTRN-03**: Pattern extraction produces non-zero patterns from a codebase with real architectural decisions

### Entity Naming

- [x] **NAME-01**: Entity names use correct PascalCase (e.g., "PathAnalyzerPattern" not "Pathanalyzerpattern")
- [ ] **NAME-02**: Entity names are semantically meaningful (not concatenated type + description fragments)

### Observation Quality

- [ ] **OBSV-01**: Observations are LLM-synthesized from actual code analysis, not hardcoded template strings
- [ ] **OBSV-02**: Observations capture architectural patterns, design decisions, and component significance — not commit message paraphrases
- [ ] **OBSV-03**: Observations are quality-ranked before the 50-cap truncation so most meaningful observations survive

### Data Routing

- [ ] **DATA-01**: Semantic entity data accumulates across batches via `allBatchSemanticEntities` accumulator (prevents data loss during batch compaction)
- [ ] **DATA-02**: `synthesizeInsights` returns properly structured data (not wrapped in `{_timing}` object that breaks `Array.isArray()` check)
- [ ] **DATA-03**: Semantic analysis uses `analysisDepth: 'deep'` instead of `'surface'` for meaningful code understanding

### Insight Documents

- [ ] **INSD-01**: Insight documents are generated for significant entities (non-zero count on a real codebase)
- [ ] **INSD-02**: Insight documents contain rich markdown content: problem statement, solution analysis, code examples, applicability guidance (matching MVIReduxArchitecturePattern.md quality bar)
- [ ] **INSD-03**: Insight documents include PlantUML or Mermaid diagrams where architecturally relevant
- [ ] **INSD-04**: Generated insight documents are linked to their corresponding knowledge graph entities at persist time

### Significance & Logging

- [ ] **QUAL-01**: Significance scores are stored and retrieved correctly (no fraction/integer normalization bugs)
- [ ] **QUAL-02**: Insight generation skip reasons are logged visibly (not silently swallowed)

## v2 Requirements

### Pipeline Observability

- **OBSB-01**: Dashboard shows per-agent execution status during pipeline run
- **OBSB-02**: Dashboard shows insight generation progress in real-time

### Advanced Analysis

- **ADVN-01**: `correlate_with_codebase` step implemented for cross-referencing patterns with live code
- **ADVN-02**: Duplicate observation detection during batch accumulation on resume runs

## Out of Scope

| Feature | Reason |
|---------|--------|
| VKB viewer changes | Viewer is functioning correctly |
| Knowledge graph storage changes | Storage/export layer is fine |
| Reducing agent count | 13-14 agent architecture stays |
| MCP server interface changes | `ukb full` invocation must remain unchanged |
| Agent framework rewrite | Custom framework is architecturally sound |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PTRN-01 | Phase 1 | Complete |
| PTRN-02 | Phase 1 | Complete |
| PTRN-03 | Phase 1 | Complete |
| NAME-01 | Phase 1 | Complete |
| NAME-02 | Phase 1 | Pending |
| OBSV-01 | Phase 1 | Pending |
| OBSV-02 | Phase 1 | Pending |
| OBSV-03 | Phase 3 | Pending |
| DATA-01 | Phase 2 | Pending |
| DATA-02 | Phase 2 | Pending |
| DATA-03 | Phase 1 | Pending |
| INSD-01 | Phase 2 | Pending |
| INSD-02 | Phase 2 | Pending |
| INSD-03 | Phase 2 | Pending |
| INSD-04 | Phase 2 | Pending |
| QUAL-01 | Phase 3 | Pending |
| QUAL-02 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after roadmap creation*
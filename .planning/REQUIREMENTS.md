# Requirements: Coding Project Knowledge Management

**Defined:** 2026-03-04
**Core Value:** Wave-based multi-agent pipeline producing self-sufficient hierarchical knowledge at every level

## v2.0 Requirements (Shipped)

### Wave Orchestration

- [x] **WAVE-01**: Pipeline executes analysis in hierarchical waves (L0->L1->L2->L3) instead of a flat batch pass
- [x] **WAVE-02**: Wave 1 agent surveys the entire project and produces L0 Project node + L1 Component nodes with comprehensive summaries
- [x] **WAVE-03**: Wave 2 agents receive L1 results and produce L2 SubComponent nodes with detailed observations per component
- [x] **WAVE-04**: Wave 3 agents receive L2 results and produce L3 Detail nodes with specific, deep knowledge
- [x] **WAVE-05**: Wave controller ensures wave N completes fully before wave N+1 spawns
- [x] **WAVE-06**: Within each wave, agents run in parallel (one agent per parent node being expanded)

### Entity Quality

- [x] **QUAL-01**: Each entity produced by the pipeline has 3+ meaningful, specific observations (not one-liner stubs)
- [x] **QUAL-02**: Each entity gets a detailed insight document (markdown with architecture context, purpose, patterns)
- [x] **QUAL-03**: Insight documents include PlantUML diagrams for architectural entities
- [x] **QUAL-05**: Insight documents cross-reference related entities and parent/child relationships

### Hierarchy Completeness

- [x] **HIER-01**: L1 components have comprehensive sub-node coverage reflecting actual architecture (not just 2-3 children)
- [x] **HIER-02**: Sub-nodes represent real architectural aspects discovered from code analysis, not generic labels
- [x] **HIER-03**: Component manifest is auto-extended based on wave analysis discoveries
- [x] **HIER-04**: Each hierarchy level provides self-sufficient knowledge useful at that granularity

## v2.1 Requirements

Requirements for Wave Pipeline Quality Restoration. Each maps to roadmap phases.

### Agent Integration

- [x] **AGNT-01**: Wave agent LLM calls route through SemanticAnalyzer for deep, multi-observation analysis
- [x] **AGNT-02**: Semantic analysis agent integrated into wave pipeline (all 3 waves)
- [x] **AGNT-03**: Persistence agent restored in wave persistence path
- [x] **AGNT-04**: Insight generation agent produces detailed insight documents per entity
- [x] **AGNT-05**: Ontology classification agent fully integrated into wave pipeline

### KG Operations

- [x] **KGOP-01**: Conversion operator (conv) enabled in wave persistence
- [x] **KGOP-02**: Aggregation operator (aggr) enabled in wave persistence
- [x] **KGOP-03**: Embedding operator (embed) enabled in wave persistence
- [x] **KGOP-04**: Dedup operator enabled with fuzzy name matching
- [x] **KGOP-05**: Prediction operator (pred) enabled in wave persistence
- [x] **KGOP-06**: Merge operator enabled with null-coalesce fix for parentId

### Content Quality

- [ ] **QUAL-06**: Content validation enforced in wave persistence path
- [ ] **QUAL-07**: QA agent validates every agent output (continuous gate, not single pipeline stage)
- [ ] **QUAL-08**: Coordinator receives QA feedback and can reject/retry agent outputs
- [ ] **QUAL-09**: Hallucination guards completed (L3 caps, code evidence filter, prompt hardening)

### Observability

- [ ] **OBSV-01**: Trace modal displays LLM call counts per wave and agent
- [ ] **OBSV-02**: Trace modal displays timing breakdown per agent and wave
- [ ] **OBSV-03**: Trace modal displays model info (which LLM, provider)
- [ ] **OBSV-04**: Trace modal shows data flow — what went in/out of each agent to diagnose information loss

### Code Graph Integration

- [ ] **CGR-01**: Code-graph-rag (CGR) wired into wave pipeline as code-evidence source for entity observations
- [ ] **CGR-02**: Wave agents query CGR for call graphs, dependencies, and code snippets relevant to each entity
- [ ] **CGR-03**: CGR evidence attached to entities as code-grounded observations (not just LLM-generated text)
- [ ] **CGR-04**: CGR index refreshed automatically at wave1_init before analysis begins

### Documentation Generation

- [ ] **DOC-01**: Docs agent generates PlantUML diagrams (.puml) for architectural entities (Component, SubComponent)
- [ ] **DOC-02**: PlantUML diagrams compiled to PNG and embedded in entity insight markdown documents
- [ ] **DOC-03**: Constraint agent validates pipeline outputs before persistence (content quality, naming, observation count)
- [ ] **DOC-04**: Generated documentation includes entity relationships, hierarchy context, and cross-references

## Future Requirements

### VKB Navigation (v2.2)

- **VKBN-01**: Tree navigation with hierarchy drill-down
- **VKBN-02**: Breadcrumb navigation showing hierarchy path
- **VKBN-03**: Entity detail view with observations and insight documents
- **QUAL-04**: VKB entity detail panel shows "Detailed Insight" link to the insight document
- **VKB-01**: Collapsible tree sidebar showing full hierarchy
- **VKB-02**: Clicking a tree node filters the D3 graph to that subtree
- **VKB-03**: Breadcrumb navigation computed from parent chain
- **VKB-04**: Blue gradient visualization persists

### Scoring (future)

- **SIG-01**: Significance scoring for entities
- **SIG-02**: Quality ranking for observations

## Out of Scope

| Feature | Reason |
|---------|--------|
| VKB tree navigation | v2.2 scope — v2.1 focuses on pipeline quality |
| MCP server interface changes | `ukb full` invocation must stay the same |
| Agent framework rewrite | Extend existing coordinator, don't rewrite |
| Real-time pipeline monitoring | Trace modal is sufficient for current needs |
| Significance scoring | Revisit after pipeline quality restored |

## Traceability

Which phases cover which requirements.

### v2.0 (Shipped)

| Requirement | Phase | Status |
|-------------|-------|--------|
| WAVE-01 | Phase 5 | Complete |
| WAVE-02 | Phase 5 | Complete |
| WAVE-03 | Phase 5 | Complete |
| WAVE-04 | Phase 5 | Complete |
| WAVE-05 | Phase 5 | Complete |
| WAVE-06 | Phase 5 | Complete |
| QUAL-01 | Phase 6 | Complete |
| QUAL-02 | Phase 6 | Complete |
| QUAL-03 | Phase 6 | Complete |
| QUAL-05 | Phase 6 | Complete |
| HIER-01 | Phase 7 | Complete |
| HIER-02 | Phase 7 | Complete |
| HIER-03 | Phase 7 | Complete |
| HIER-04 | Phase 7 | Complete |

### v2.1

| Requirement | Phase | Status |
|-------------|-------|--------|
| AGNT-01 | Phase 9 | Complete |
| AGNT-02 | Phase 9 | Complete |
| AGNT-03 | Phase 9 | Complete |
| AGNT-04 | Phase 9 | Complete |
| AGNT-05 | Phase 9 | Complete |
| KGOP-01 | Phase 10 | Complete |
| KGOP-02 | Phase 10 | Complete |
| KGOP-03 | Phase 10 | Complete |
| KGOP-04 | Phase 10 | Complete |
| KGOP-05 | Phase 10 | Complete |
| KGOP-06 | Phase 10 | Complete |
| QUAL-06 | Phase 11 | Pending |
| QUAL-07 | Phase 11 | Pending |
| QUAL-08 | Phase 11 | Pending |
| QUAL-09 | Phase 11 | Pending |
| OBSV-01 | Phase 12 | Pending |
| OBSV-02 | Phase 12 | Pending |
| OBSV-03 | Phase 12 | Pending |
| OBSV-04 | Phase 12 | Pending |

| CGR-01 | Phase 13 | Pending |
| CGR-02 | Phase 13 | Pending |
| CGR-03 | Phase 13 | Pending |
| CGR-04 | Phase 13 | Pending |
| DOC-01 | Phase 14 | Pending |
| DOC-02 | Phase 14 | Pending |
| DOC-03 | Phase 14 | Pending |
| DOC-04 | Phase 14 | Pending |

**Coverage:**
- v2.1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Last updated: 2026-03-08 after adding phases 13-14*

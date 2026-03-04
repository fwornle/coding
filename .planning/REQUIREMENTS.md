# Requirements: Coding Project Knowledge Management

**Defined:** 2026-03-04
**Core Value:** Wave-based multi-agent pipeline producing self-sufficient hierarchical knowledge at every level

## v2.0 Requirements

Requirements for wave-based hierarchical semantic analysis. Each maps to roadmap phases.

### Wave Orchestration

- [x] **WAVE-01**: Pipeline executes analysis in hierarchical waves (L0→L1→L2→L3) instead of a flat batch pass
- [x] **WAVE-02**: Wave 1 agent surveys the entire project and produces L0 Project node + L1 Component nodes with comprehensive summaries
- [x] **WAVE-03**: Wave 2 agents receive L1 results and produce L2 SubComponent nodes with detailed observations per component
- [x] **WAVE-04**: Wave 3 agents receive L2 results and produce L3 Detail nodes with specific, deep knowledge
- [x] **WAVE-05**: Wave controller ensures wave N completes fully before wave N+1 spawns
- [x] **WAVE-06**: Within each wave, agents run in parallel (one agent per parent node being expanded)

### Entity Quality

- [ ] **QUAL-01**: Each entity produced by the pipeline has 3+ meaningful, specific observations (not one-liner stubs)
- [ ] **QUAL-02**: Each entity gets a detailed insight document (markdown with architecture context, purpose, patterns)
- [ ] **QUAL-03**: Insight documents include PlantUML diagrams for architectural entities
- [ ] **QUAL-04**: VKB entity detail panel shows "Detailed Insight" link to the insight document
- [ ] **QUAL-05**: Insight documents cross-reference related entities and parent/child relationships

### Hierarchy Completeness

- [ ] **HIER-01**: L1 components have comprehensive sub-node coverage reflecting actual architecture (not just 2-3 children)
- [ ] **HIER-02**: Sub-nodes represent real architectural aspects discovered from code analysis, not generic labels
- [ ] **HIER-03**: Component manifest is auto-extended based on wave analysis discoveries
- [ ] **HIER-04**: Each hierarchy level provides self-sufficient knowledge useful at that granularity

### VKB Visualization

- [ ] **VKB-01**: Collapsible tree sidebar showing full hierarchy (Project → Components → SubComponents → Details)
- [ ] **VKB-02**: Clicking a tree node filters the D3 graph to that subtree
- [ ] **VKB-03**: Breadcrumb navigation computed from parent chain
- [ ] **VKB-04**: Blue gradient visualization persists (darker at stem, lighter at leaves)

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Observation Quality

- **OBSQ-01**: Observation quality scoring to filter trivial observations
- **OBSQ-02**: Significance ranking across entities

### Pipeline Monitoring

- **MON-01**: Real-time wave progress visualization
- **MON-02**: Agent status dashboard during wave execution

## Out of Scope

| Feature | Reason |
|---------|--------|
| Agent framework rewrite | Extend existing coordinator; don't rewrite |
| MCP interface changes | `ukb full` invocation stays the same |
| Real-time chat/streaming | Pipeline is batch-oriented |
| Mobile VKB | Web-first |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WAVE-01 | Phase 5 | Complete |
| WAVE-02 | Phase 5 | Complete |
| WAVE-03 | Phase 5 | Complete |
| WAVE-04 | Phase 5 | Complete |
| WAVE-05 | Phase 5 | Complete |
| WAVE-06 | Phase 5 | Complete |
| QUAL-01 | Phase 6 | Pending |
| QUAL-02 | Phase 6 | Pending |
| QUAL-03 | Phase 6 | Pending |
| QUAL-04 | Phase 8 | Pending |
| QUAL-05 | Phase 6 | Pending |
| HIER-01 | Phase 7 | Pending |
| HIER-02 | Phase 7 | Pending |
| HIER-03 | Phase 7 | Pending |
| HIER-04 | Phase 7 | Pending |
| VKB-01 | Phase 8 | Pending |
| VKB-02 | Phase 8 | Pending |
| VKB-03 | Phase 8 | Pending |
| VKB-04 | Phase 8 | Pending |

**Coverage:**
- v2.0 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 — traceability updated with phase mappings*

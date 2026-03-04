# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, in progress)

---

<details>
<summary>v1.0 UKB Pipeline Fix & Improvement -- SHIPPED 2026-03-03</summary>

- [x] Phase 1: Core Pipeline Data Quality (7/7 plans) -- completed 2026-03-02
- [x] Phase 4: Schema & Configuration Foundation (2/2 plans) -- completed 2026-03-01
- [ ] Phase 2: Insight Generation & Data Routing -- Deferred
- [ ] Phase 3: Significance & Quality Ranking -- Deferred

</details>

---

## v2.0 -- Wave-Based Hierarchical Semantic Analysis

### Overview

Four phases that replace the flat batch DAG with a wave-based multi-agent system. Wave orchestration provides the execution model (Phase 5). Entity quality ensures each wave agent produces rich, documented knowledge (Phase 6). Hierarchy completeness drives comprehensive sub-node discovery from actual code analysis (Phase 7). VKB tree navigation exposes the hierarchy to users with drill-down and breadcrumbs (Phase 8). Foundation from v1.0: hierarchy schema fields, 30 entities organized L0-L3, component manifest, VKB blue gradient.

### Phases

- [x] **Phase 5: Wave Orchestration** - Replace flat batch DAG with hierarchical wave controller executing L0->L1->L2->L3 agents (completed 2026-03-04)
- [x] **Phase 6: Entity Quality** - Rich multi-observation entities with detailed insight documents and PlantUML diagrams (completed 2026-03-04)
- [ ] **Phase 7: Hierarchy Completeness** - Comprehensive sub-node coverage reflecting actual architecture from code analysis
- [ ] **Phase 8: VKB Tree Navigation** - Collapsible tree sidebar with subtree filtering, breadcrumbs, and insight links

### Phase Details

#### Phase 5: Wave Orchestration
**Goal**: The pipeline executes analysis in sequential waves where each wave operates at one hierarchy level, producing parent nodes before spawning child-level agents
**Depends on**: Phase 4 (v1.0, shipped)
**Requirements**: WAVE-01, WAVE-02, WAVE-03, WAVE-04, WAVE-05, WAVE-06
**Success Criteria** (what must be TRUE):
  1. Running `ukb full` executes analysis in distinct waves visible in logs (Wave 1: L0/L1, Wave 2: L2, Wave 3: L3) rather than a single flat batch pass
  2. Wave 1 produces a Project root node (L0) and Component nodes (L1) with summary observations before Wave 2 begins
  3. Wave 2 agents each receive their parent L1 node context and produce SubComponent nodes (L2) with parent-child relationships set
  4. Wave 3 agents produce Detail nodes (L3) linked to their L2 parents, with knowledge specific to that detail scope
  5. Within each wave, multiple agents run in parallel (one per parent node being expanded), observable via concurrent log entries
**Plans:** 4/4 plans complete
Plans:
- [x] 05-01-PLAN.md -- Wave types, YAML config, and routing plumbing
- [x] 05-02-PLAN.md -- WaveController orchestrator and Wave1ProjectAgent (L0+L1)
- [x] 05-03-PLAN.md -- Wave2ComponentAgent (L2) and Wave3DetailAgent (L3)
- [x] 05-04-PLAN.md -- Build, deploy, integration smoke test, and human verification

#### Phase 6: Entity Quality
**Goal**: Every entity produced by wave agents carries rich, specific observations and a detailed insight document that makes the entity self-explanatory
**Depends on**: Phase 5
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-05
**Success Criteria** (what must be TRUE):
  1. Each entity in the knowledge graph has 3 or more observations that are specific to that entity (not generic boilerplate)
  2. Each entity has an associated insight document (markdown) containing architecture context, purpose description, and key patterns
  3. Insight documents for architectural entities (Components, SubComponents) include rendered PlantUML diagrams
  4. Insight documents reference related entities by name and describe parent-child relationships in context
**Plans:** 3/3 plans complete
Plans:
- [x] 06-01-PLAN.md -- Enhance wave agent LLM prompts and add observation validation with retry/supplementation
- [x] 06-02-PLAN.md -- Wire InsightGenerationAgent into WaveController as finalization step with cross-references
- [x] 06-03-PLAN.md -- Build, deploy, smoke test, and human verification

#### Phase 7: Hierarchy Completeness
**Goal**: Wave analysis produces comprehensive sub-node trees that reflect real architectural structure discovered from code, with each level providing standalone useful knowledge
**Depends on**: Phase 5, Phase 6
**Requirements**: HIER-01, HIER-02, HIER-03, HIER-04
**Success Criteria** (what must be TRUE):
  1. L1 component nodes have sub-node counts reflecting their actual complexity (e.g., a complex component like SemanticAnalysis has 8+ children, not 2-3)
  2. Sub-node names and descriptions reflect real architectural aspects found in code (e.g., "BatchScheduler", "LLMRetryPolicy") rather than generic labels (e.g., "Pipeline", "Insights")
  3. Running `ukb full` on an evolved codebase auto-extends the component manifest with newly discovered components or sub-components
  4. Reading any single hierarchy level (L1 components alone, or L2 sub-components alone) provides useful, self-contained knowledge without needing to drill into children
**Plans:** 3 plans
Plans:
- [x] 07-01-PLAN.md -- Type contracts, manifest write-back function, Docker mount change
- [ ] 07-02-PLAN.md -- Wire L3 suggestions and L1 keywords into wave agents, self-sufficiency prompts
- [ ] 07-03-PLAN.md -- Build, deploy, smoke test, and human verification

#### Phase 8: VKB Tree Navigation
**Goal**: Users can navigate the full knowledge hierarchy in the VKB viewer through a tree sidebar with drill-down, breadcrumbs, and direct access to insight documents
**Depends on**: Phase 5 (wave data), Phase 7 (complete hierarchy)
**Requirements**: VKB-01, VKB-02, VKB-03, VKB-04, QUAL-04
**Success Criteria** (what must be TRUE):
  1. VKB viewer shows a collapsible tree sidebar listing the full hierarchy (Project -> Components -> SubComponents -> Details)
  2. Clicking any tree node filters the D3 graph view to show only that node and its subtree
  3. Breadcrumb trail above the graph view shows the path from root to current context (e.g., Coding > SemanticAnalysis > BatchScheduler)
  4. Blue gradient visualization is preserved -- darker shade at stem/root level (#1565c0), lighter at leaf level (#bbdefb)
  5. Entity detail panel includes a "Detailed Insight" link that opens the entity's insight document
**Plans**: TBD

### Progress

**Execution Order:** Phases execute sequentially: 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Wave Orchestration | 4/4 | Complete   | 2026-03-04 | - |
| 6. Entity Quality | 3/3 | Complete   | 2026-03-04 | - |
| 7. Hierarchy Completeness | v2.0 | 1/3 | In Progress | - |
| 8. VKB Tree Navigation | v2.0 | 0/? | Not started | - |

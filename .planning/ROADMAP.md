# Roadmap: Coding Project Knowledge Management

## Milestones

- **v1.0** — UKB Pipeline Fix & Improvement (Phases 1-3, Phase 1 complete)
- **v2.0** — Hierarchical Knowledge Restructuring (Phases 4-7, current milestone)

---

## v1.0 — UKB Pipeline Fix & Improvement

### Phases

- [x] **Phase 1: Core Pipeline Data Quality** - Fix pattern extraction parser, entity naming, and observation template substitution so the pipeline produces real content
- [ ] **Phase 2: Insight Generation & Data Routing** - Fix data accumulators and timing wrapper so insight documents are generated and linked to entities
- [ ] **Phase 3: Significance & Quality Ranking** - Fix significance score normalization and observation ranking so high-value entities surface correctly

### Phase Details

#### Phase 1: Core Pipeline Data Quality
**Goal**: The pipeline extracts real architectural patterns, produces correctly-named entities, and generates LLM-synthesized observations instead of template strings
**Depends on**: Nothing (first phase)
**Requirements**: PTRN-01, PTRN-02, PTRN-03, NAME-01, NAME-02, OBSV-01, OBSV-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. `extractArchitecturalPatternsFromCommits()` returns non-zero patterns from a codebase run (log file shows `totalPatterns > 0`)
  2. Entity names in the knowledge export use correct PascalCase (e.g., `PathAnalyzerPattern` not `Pathanalyzerpattern`)
  3. Observations in `coding.json` contain code-specific analysis language, not slot-filled commit file extension strings
  4. Semantic analysis runs with `analysisDepth: 'deep'` (visible in workflow execution logs)
  5. Pattern parser handles both JSON and markdown-numbered LLM response formats without returning empty results
  6. Per-batch entity diversity exceeds the 10-pattern hardcoded vocabulary
**Plans**: 5 plans
Plans:
  - [x] 01-01-PLAN.md -- Fix pattern extraction parser + pattern name formatter (PTRN-01, PTRN-02, PTRN-03, NAME-01)
  - [x] 01-02-PLAN.md -- Fix entity naming, replace template observations with LLM synthesis, switch to deep analysis (NAME-01, NAME-02, OBSV-01, OBSV-02, DATA-03)
  - [ ] 01-03-PLAN.md -- [GAP] Fix JSON.parse fence stripping in 2 observation methods + Docker bind-mount (OBSV-01, OBSV-02)
  - [ ] 01-04-PLAN.md -- [GAP] Fix all 7 entity naming bypass paths across both agent files (NAME-01, NAME-02)
  - [ ] 01-05-PLAN.md -- [GAP] Enrich per-batch patterns with LLM output + fix trace report metrics (PTRN-01, PTRN-02, DATA-03)

#### Phase 2: Insight Generation & Data Routing
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

#### Phase 3: Significance & Quality Ranking
**Goal**: Entities carry differentiated significance scores (1-10 range) and the observation cap retains the most meaningful observations
**Depends on**: Phase 2
**Requirements**: OBSV-03, QUAL-01
**Success Criteria** (what must be TRUE):
  1. Entities in `coding.json` show a spread of significance scores (not all 0.5) across the 1-10 range
  2. After a full run, at least 10 entities have significance >= 6
  3. Observations retained after the 50-cap truncation include LLM-synthesized content with code references, not template strings
**Plans**: TBD

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Pipeline Data Quality | 4/5 | In Progress | - |
| 2. Insight Generation & Data Routing | 0/? | Deferred | - |
| 3. Significance & Quality Ranking | 0/? | Deferred | - |

---

## v2.0 — Hierarchical Knowledge Restructuring

### Overview

Four phases that transform the flat knowledge graph (126 entities, 0 relations) into a navigable Project → Component → SubComponent → Detail hierarchy. Dependency order is non-negotiable: schema defines the types all other phases write and read; migration populates the hierarchy into the live graph; pipeline changes ensure future `ukb full` runs maintain the hierarchy; VKB tree navigation is the final consumer and requires real hierarchical data to be meaningful.

### Phases

- [ ] **Phase 4: Schema & Configuration Foundation** - Extend TypeScript interfaces across all four systems and author the component manifest so hierarchy fields are consistently typed before any data moves
- [ ] **Phase 5: One-Time Migration** - Classify all 126 existing entities into the hierarchy, create scaffold nodes, merge generic entities into CodingPatterns, and store `contains` edges
- [ ] **Phase 6: Pipeline Hierarchy Assignment** - Insert HierarchyClassifier into the coordinator pipeline so future `ukb full` runs slot new entities into the hierarchy automatically
- [ ] **Phase 7: VKB Tree Navigation** - Add collapsible tree sidebar, breadcrumb navigation, and subtree filtering to the VKB viewer

### Phase Details

#### Phase 4: Schema & Configuration Foundation
**Goal**: Hierarchy fields are consistently defined across all TypeScript interfaces and the component manifest is the authoritative source of truth for L1/L2 component names
**Depends on**: Nothing (v2.0 starting phase)
**Requirements**: SCHM-01, SCHM-02, SCHM-03, SCHM-04
**Success Criteria** (what must be TRUE):
  1. TypeScript compiles with `--strict` in both `mcp-server-semantic-analysis` and the VKB viewer with no new errors after interface changes
  2. An entity created with `parentId`, `level`, and `hierarchyPath` fields passes through `persistEntities()` and returns from `getEntity()` with all three fields intact (round-trip integration test)
  3. `coding-ontology.json` accepts `Component` and `SubComponent` entity types without validation errors
  4. `component-manifest.yaml` lists all named L1 components (LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns) with aliases and descriptions
  5. Existing pipeline runs against unmodified data produce no errors from the schema changes (backward compatibility holds)
**Plans**: TBD

#### Phase 5: One-Time Migration
**Goal**: All 126 existing entities are placed in the hierarchy with parent assignments, new scaffold nodes exist for the Coding root and all L1/L2 components, and generic entities are merged into CodingPatterns
**Depends on**: Phase 4
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05
**Success Criteria** (what must be TRUE):
  1. `--dry-run` mode prints a classification report (entity count by component, merge candidates) without modifying any data
  2. After migration, `queryRelations({ relationType: 'contains' })` returns more than 100 edges connecting children to parent component nodes
  3. The Coding root node and at least 6 L1 component scaffold nodes exist in the knowledge graph with descriptions
  4. Generic/low-value entities previously in the flat graph are removed; their observations appear rolled up on the parent CodingPatterns node
  5. `grep -c '\*\*' .data/knowledge-export/coding.json` returns 0 (no bold formatting introduced by migration)
**Plans**: TBD

#### Phase 6: Pipeline Hierarchy Assignment
**Goal**: New entities produced by `ukb full` are automatically assigned to the correct component in the hierarchy, and component scaffold nodes survive repeated pipeline runs without being overwritten or orphaned
**Depends on**: Phase 5
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06
**Success Criteria** (what must be TRUE):
  1. Running `ukb full` with `maxBatches: 1` produces new entities that each have `hierarchyLevel` and `parentId` set in `coding.json`
  2. Running `ukb full` a second time leaves component scaffold nodes with their `level` and `parentId` intact (dedup does not overwrite with undefined)
  3. The HierarchyClassifier uses keyword/alias heuristics for clearly-named entities and only calls LLM for genuinely ambiguous ones (visible in logs: heuristic vs. LLM assignment counts)
  4. Component and scaffold nodes are not deleted by dedup or purge operations (protected entity type check)
  5. Hierarchy fields (`parentId`, `hierarchyLevel`, `hierarchyPath`) appear in `coding.json` for new entities after a pipeline run
**Plans**: TBD

#### Phase 7: VKB Tree Navigation
**Goal**: Users can navigate the knowledge hierarchy in the VKB viewer by drilling from Coding root down to individual entities, with breadcrumb context at every level, while entities lacking hierarchy data degrade gracefully
**Depends on**: Phase 5
**Requirements**: VKB-01, VKB-02, VKB-03, VKB-04, VKB-05
**Success Criteria** (what must be TRUE):
  1. The VKB sidebar shows a collapsible tree with the Coding root, all L1 component nodes, and their children — clicking any node navigates to that entity's detail view
  2. Clicking a component node in the tree filters the D3 graph to show only that component's subtree (not the entire graph)
  3. The entity detail view shows a breadcrumb trail (e.g., `Coding > KnowledgeManagement > OnlineLearning`) computed from the `parentId` chain
  4. The D3 force layout renders correctly with hierarchy data loaded — `contains` edges do not collapse the force simulation into a hub-and-spoke
  5. Entities without `parentId` (pre-migration or unclassified) appear in an "Uncategorized" bucket in the tree without errors or blank screens
**Plans**: TBD

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Schema & Configuration Foundation | 0/? | Not started | - |
| 5. One-Time Migration | 0/? | Not started | - |
| 6. Pipeline Hierarchy Assignment | 0/? | Not started | - |
| 7. VKB Tree Navigation | 0/? | Not started | - |

# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with a multi-agent UKB analysis pipeline, knowledge graph storage (Graphology + LevelDB), and VKB viewer. The pipeline analyzes codebases to produce knowledge entities with observations and insight documents. Currently the knowledge graph contains 126 flat, granular entities — this milestone restructures them into a navigable hierarchy.

## Core Value

The knowledge graph must be organized as a navigable hierarchy (Project → Component → SubComponent → Detail) so users can drill into specific areas and the pipeline produces well-placed, contextual knowledge — not a flat soup of disconnected entities.

## Current Milestone: v2.0 Hierarchical Knowledge Restructuring

**Goal:** Transform the flat knowledge graph into a tree structure with curated component nodes, merge generic entities, update the pipeline to maintain hierarchy on future runs, and add tree navigation to the VKB viewer.

**Target features:**
- Hierarchical entity model (Project → Component → SubComponent → Detail)
- One-time migration of existing 126 entities into the hierarchy
- Pipeline produces hierarchical entities natively on future runs
- VKB viewer with tree/drill-down navigation
- Architecture diagrams attached to component nodes

## Requirements

### Validated

<!-- Shipped and confirmed valuable from v1.0. -->

- ✓ Pattern extraction handles JSON + markdown LLM responses — v1.0 Phase 1
- ✓ Entity names use correct PascalCase — v1.0 Phase 1
- ✓ Observations are LLM-synthesized, not template strings — v1.0 Phase 1
- ✓ Deep analysis mode enabled — v1.0 Phase 1
- ✓ Garbage insight names filtered via blocklist — v1.0 ad-hoc
- ✓ Bold formatting stripped from observations — v1.0 ad-hoc

### Active

- [ ] Hierarchical entity model in storage schema (parent-child relationships in Graphology/LevelDB)
- [ ] Top-level "Coding" project node with L2 components underneath
- [ ] L2 components: LSL, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, plus discovered ones
- [ ] L3 sub-components (e.g., KnowledgeManagement → ManualLearning, OnlineLearning)
- [ ] One-time migration: merge generic/low-value entities into parent nodes, keep high-value as leaves
- [ ] Pipeline produces hierarchical entities on future runs (hierarchy assignment during batch analysis)
- [ ] VKB viewer tree navigation (drill Coding → Component → SubComponent → Detail)
- [ ] Component nodes carry descriptions, architecture diagrams, and coding-relevant observations
- [ ] Generic "programming wisdom" nodes merged into a CodingPatterns component

### Out of Scope

- v1.0 deferred work (insight documents, significance scoring) — revisit after v2.0
- Changing the MCP server interface — `ukb full` invocation stays the same
- Agent framework rewrite — custom framework is architecturally sound
- Real-time pipeline monitoring — v2+ concern

## Context

- **Pipeline location:** `integrations/mcp-server-semantic-analysis`
- **Knowledge graph storage:** `.data/knowledge-graph/` (Graphology + LevelDB + JSON exports)
- **Export file:** `.data/knowledge-export/coding.json` (126 entities, flat structure)
- **VKB viewer:** `vkb` command, runs on http://localhost:8080
- **Key interface:** `KGEntity` in `kg-operators.ts:31` has `type` but NOT `entityType` or `metadata`. Coordinator casts via `as KGEntity` after adding extra fields. Persistence uses `SharedMemoryEntity.entityType`.
- **Named L2 components from user:** LiveLoggingSystem (LSL), LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement
- **L3 example:** KnowledgeManagement → ManualLearning, OnlineLearning

## Constraints

- **Storage:** Must work with existing Graphology + LevelDB infrastructure
- **Interface:** `ukb full` / `mcp__semantic-analysis__execute_workflow` must remain unchanged
- **Architecture:** Build on existing multi-agent pipeline; add hierarchy support, don't redesign
- **Backward compat:** VKB viewer must still display entities even if hierarchy features aren't fully loaded

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix existing pipeline, not redesign | Pipeline worked before — architecture is sound | ✓ Good |
| Keep batched execution mode | Working and wanted | ✓ Good |
| Defer v1.0 Phases 2-3 | Pipeline quality is good enough; hierarchy is higher priority | — Pending |
| Selective merge of existing entities | Merge generic, keep high-value leaves | — Pending |
| User's component list + auto-discovery | Start with named components, discover additional from data | — Pending |

---
*Last updated: 2026-03-01 after milestone v2.0 initialization*

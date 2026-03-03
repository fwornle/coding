# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with a multi-agent UKB analysis pipeline, knowledge graph storage (Graphology + LevelDB), and VKB viewer. The pipeline analyzes codebases to produce knowledge entities with observations and insight documents. v1.0 shipped a working pipeline with correct pattern extraction, entity naming, and LLM-synthesized observations. v2.0 restructures the flat knowledge graph (126 entities) into a navigable hierarchy.

## Core Value

The knowledge graph must be organized as a navigable hierarchy (Project → Component → SubComponent → Detail) so users can drill into specific areas and the pipeline produces well-placed, contextual knowledge — not a flat soup of disconnected entities.

## Current Milestone: v2.0 Hierarchical Knowledge Restructuring

**Goal:** Transform the flat knowledge graph into a tree structure with curated component nodes, merge generic entities, update the pipeline to maintain hierarchy on future runs, and add tree navigation to the VKB viewer.

**Foundation shipped (v1.0 Phase 4):** TypeScript interfaces extended with hierarchy fields, component manifest authored, ontology types added.

**Remaining:** Phase 5 (migration), Phase 6 (pipeline), Phase 7 (VKB tree nav)

## Requirements

### Validated

- ✓ Pattern extraction handles JSON + markdown LLM responses — v1.0
- ✓ Entity names use correct PascalCase — v1.0
- ✓ Observations are LLM-synthesized, not template strings — v1.0
- ✓ analysisDepth is configurable (surface/deep/comprehensive) — v1.0
- ✓ Garbage insight names filtered via blocklist — v1.0
- ✓ Bold formatting stripped from observations — v1.0
- ✓ KGEntity/SharedMemoryEntity/VKB interfaces extended with hierarchy fields — v1.0
- ✓ Component manifest defines L1/L2 hierarchy as source of truth — v1.0
- ✓ Ontology accepts Component/SubComponent entity types — v1.0

### Active

- [ ] One-time migration of existing entities into hierarchy (MIGR-01..05)
- [ ] Pipeline hierarchy assignment for future runs (PIPE-01..06)
- [ ] VKB tree navigation with drill-down and breadcrumbs (VKB-01..05)

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
- **Key interface:** `KGEntity` in `kg-operators.ts` — hierarchy fields added (parentId, level, hierarchyPath)
- **Component manifest:** `config/component-manifest.yaml` — 8 L1 + 5 L2 components
- **v1.0 shipped:** 2026-03-03, 2 phases, 9 plans, 12/12 requirements satisfied

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
| Defer v1.0 Phases 2-3 | Pipeline quality is good enough; hierarchy is higher priority | ✓ Good (shipped v1.0) |
| All hierarchy fields optional (?) | Full backward compatibility | ✓ Good |
| Selective merge of existing entities | Merge generic, keep high-value leaves | — Pending |
| Manifest-first, LLM-fallback classification | Keyword aliases cover ~80%, LLM handles ~20% | — Pending |
| Phase 7 depends on Phase 5 not Phase 6 | Can run after migration data exists | — Pending |

---
*Last updated: 2026-03-03 after v1.0 milestone completion*

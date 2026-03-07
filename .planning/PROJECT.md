# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with a multi-agent UKB analysis pipeline, knowledge graph storage (Graphology + LevelDB), and VKB viewer. The pipeline analyzes codebases to produce knowledge entities with observations and insight documents. v1.0 shipped a working pipeline with correct pattern extraction, entity naming, and LLM-synthesized observations. v2.0 replaces the flat batch DAG with a wave-based multi-agent system that builds hierarchical knowledge top-down: project survey → component deep-dive → detail expansion.

## Core Value

The semantic analysis pipeline must operate as a hierarchical wave-based multi-agent system — not a flat DAG — producing self-sufficient knowledge at every level, with rich observations, detailed insight documents, and proper parent-child structure from stem to leaves.

## Current Milestone: v2.1 Wave Pipeline Quality Restoration

**Goal:** Re-integrate the full multi-agent pipeline (semantic analysis, KG operators, content validation, QA, ontology classification, trace reporting) into the wave-based architecture. v2.0 built the hierarchical wave structure but dropped the rich agent pipeline — this milestone restores it.

**Foundation available:** Working wave-controller (3 waves + insight finalization), 691 entities in KG, component manifest, ontology classification agent (partially restored), persistence agent, insight generation agent.

**Key problems to fix:**
- Wave agents do lightweight LLM calls — need deep semantic analysis integration
- KG operators (conv, aggr, embed, dedup, pred, merge) completely skipped
- Content validation disabled in wave persistence
- No QA step in wave pipeline
- Trace modal broken (no LLM counts, no timing, no model info)
- Ontology classification was auto-assigning hierarchy level as class (partially fixed)
- Hallucination risk from unbounded L3 suggestions (basic guards added)

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

- [ ] Wave-based pipeline orchestration (replaces flat batch DAG)
- [ ] Rich multi-observation entities with detailed insight documents
- [ ] Hierarchical agent spawning (wave 1→2→3)
- [ ] VKB tree navigation with drill-down and breadcrumbs
- [ ] Self-sufficient knowledge at each hierarchy level

### Out of Scope

- v1.0 deferred work (significance scoring) — revisit after v2.0
- Changing the MCP server interface — `ukb full` invocation stays the same
- Agent framework rewrite — extend existing coordinator, don't rewrite
- Real-time pipeline monitoring — v2+ concern

## Context

- **Pipeline location:** `integrations/mcp-server-semantic-analysis`
- **Knowledge graph storage:** `.data/knowledge-graph/` (Graphology + LevelDB + JSON exports)
- **Export file:** `.data/knowledge-export/coding.json` (30 entities, hierarchical L0→L3)
- **VKB viewer:** `vkb` command, runs on http://localhost:8080
- **Key interface:** `KGEntity` in `kg-operators.ts` — hierarchy fields (parentId, level, hierarchyPath)
- **Component manifest:** `config/component-manifest.yaml` — 8 L1 + 5 L2 components
- **Current pipeline:** DAG steps in `coordinator.ts` — batch extraction → observation synthesis → persistence
- **Current problem:** Entities have 1 banal observation each, 2-3 sub-nodes per component (should be many more)

## Constraints

- **Storage:** Must work with existing Graphology + LevelDB infrastructure
- **Interface:** `ukb full` / `mcp__semantic-analysis__execute_workflow` must remain unchanged
- **Architecture:** Extend existing coordinator; add wave orchestration on top of DAG
- **Backward compat:** VKB viewer must still display entities even if hierarchy features aren't fully loaded
- **Build pipeline:** Submodule build + Docker rebuild required for pipeline changes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix existing pipeline, not redesign | Pipeline worked before — architecture is sound | ✓ Good |
| Keep batched execution mode | Working and wanted | ✓ Good |
| Defer v1.0 Phases 2-3 | Pipeline quality is good enough; hierarchy is higher priority | ✓ Good (shipped v1.0) |
| All hierarchy fields optional (?) | Full backward compatibility | ✓ Good |
| Replace flat DAG with wave-based agents | Flat pass produces shallow knowledge; waves produce depth | — Pending |
| Wave-per-level architecture | Each wave operates at one hierarchy level, spawns next | — Pending |
| Rich observations + insight docs per entity | One-liner observations are insufficient for useful knowledge | — Pending |

---
*Last updated: 2026-03-07 after v2.1 milestone start*

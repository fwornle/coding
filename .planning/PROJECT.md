# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with a multi-agent UKB analysis pipeline, knowledge graph storage (Graphology + LevelDB), and VKB viewer. The pipeline analyzes codebases to produce knowledge entities with observations and insight documents. v1.0 shipped a working pipeline with correct pattern extraction, entity naming, and LLM-synthesized observations. v2.0 replaces the flat batch DAG with a wave-based multi-agent system that builds hierarchical knowledge top-down: project survey → component deep-dive → detail expansion.

## Core Value

The semantic analysis pipeline must operate as a hierarchical wave-based multi-agent system — not a flat DAG — producing self-sufficient knowledge at every level, with rich observations, detailed insight documents, and proper parent-child structure from stem to leaves.

## Current Milestone: v4.0 Mastra Integration & LSL Observational Memory

**Goal:** Integrate mastra.ai's observational memory system into the coding infrastructure — replacing verbatim LSL logging with intelligent observations, adding mastra plugin to OpenCode, and integrating mastracode as a new coding agent.

**Target features:**
- Add mastra plugin to OpenCode variant (`coding --opencode`) for live observational memory alongside existing LSL
- Evaluate and implement LSL refactoring from verbatim transcript logging to mastra-style observations (online/live mode + batch mode for historical LSL conversion)
- Build transcript-to-observation converters for all 3 agents (Claude JSONL, Copilot events.jsonl, OpenCode SQLite)
- Install and integrate mastracode (pi-tui based) as `coding --mastra` with tmux statusline, coding services, and LSL support

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

- [ ] Mastra plugin integration for OpenCode (live observational memory)
- [x] LSL refactoring: verbatim logging → mastra-style observations (live + batch) — Phase 23
- [x] Transcript-to-observation converters (Claude, Copilot, OpenCode) — Phase 22
- [x] Historical LSL batch converter (git-tracked .specstory files → observations) — Phase 22
- [x] Mastracode agent integration (`coding --mastra` with full infrastructure support) — Phase 21

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
## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-05 after Phase 23 completion — v4.0 milestone complete*

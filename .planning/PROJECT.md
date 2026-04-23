# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with multi-agent support (Claude, Copilot, OpenCode, Mastracode), live session logging, real-time observational memory, semantic knowledge management, and a health dashboard. v1.0-v2.1 shipped the UKB analysis pipeline. v3.0 added workflow state machine. v4.0 integrated mastra.ai's observational memory alongside LSL, added mastracode as a fourth coding agent, and built transcript converters + a live observation dashboard.

## Core Value

A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable — across all AI coding agents.

## Current Milestone: v5.0 Service Reliability & Health System Overhaul

**Goal:** Make the health system detect all failures — if any service dies, the dashboard shows unhealthy within 60 seconds and attempts auto-healing.

**Target features:**
- Port liveness checks for all services (3030, 3032, 3033, 3848, 8080, 12435)
- Supervisord status integration — detect FATAL/STOPPED processes inside Docker
- Database integrity monitoring (SQLite WAL corruption, malformed JSON)
- Stale status file detection (PID gone but status file says "running")
- Auto-restart for crashed services (supervisord + host-side processes)
- Statusline and dashboard accuracy — no green when services are down
- Observation consolidation daemon reliability

## Current State

**v4.0 shipped.** Four coding agents supported (`coding --claude/--copilot/--opencode/--mastra`). Live observations generated per-exchange via ETM, stored in LibSQL, browsable at http://localhost:3032/observations. Historical transcript conversion via CLI for Claude JSONL, Copilot events, and .specstory files. v4.0+ added observation digests, insights, and auto-consolidation daemon.

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

(Defined in REQUIREMENTS.md for v5.0)

### Shipped in v4.0

- ✓ Mastracode agent integration (`coding --mastra`) — Phase 21
- ✓ Transcript-to-observation converters (Claude, Copilot, Specstory) — Phase 22
- ✓ Historical LSL batch converter (git-tracked .specstory files → observations) — Phase 22
- ✓ Live observation tap (ETM fire-and-forget per exchange) — Phase 23
- ✓ Observations dashboard (REST API + React page with FTS search) — Phase 23
- ✓ LLM proxy bridge for observer/reflector agents — Phase 20

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
*Last updated: 2026-04-23 after v5.0 milestone start*

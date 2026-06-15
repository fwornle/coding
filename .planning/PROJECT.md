# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with multi-agent support (Claude, Copilot, OpenCode, Mastracode), live session logging, real-time observational memory, semantic knowledge management, and a health dashboard. v1.0-v2.1 shipped the UKB analysis pipeline. v3.0 added workflow state machine. v4.0 integrated mastra.ai's observational memory alongside LSL, added mastracode as a fourth coding agent, and built transcript converters + a live observation dashboard. v5.0 overhauled service reliability and health monitoring.

## Core Value

A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable — across all AI coding agents.

## Current State

**v6.0 shipped.** Knowledge context injection is live across all four coding agents. Every `coding` session automatically receives relevant knowledge from the accumulated observation/digest/insight/KG database via Qdrant semantic search, with per-agent scoring profiles and cross-agent session continuity. Working memory provides a 300-token project state prefix on every retrieval response.

Stack: Four coding agents (`coding --claude/--copilot/--opencode/--mastra`), live ETM observations, Qdrant vector search, hybrid retrieval (semantic + keyword + recency), Redis pub/sub for write-time embedding, per-agent adapters, session state handoff.

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

### Shipped in v6.0

- ✓ Embedding pipeline — all knowledge tiers (obs, digests, insights, KG) in Qdrant — Phase 28
- ✓ Write-time auto-embedding via Redis pub/sub — Phase 28
- ✓ One-shot backfill CLI with content-hash idempotency — Phase 28
- ✓ Hybrid retrieval service (semantic + keyword + recency via RRF) — Phase 29
- ✓ Token-budgeted markdown assembly with tier-weighted scoring — Phase 29
- ✓ POST /api/retrieve on health API (port 3033), <500ms latency — Phase 29

### Shipped in v6.0 (continued)

- ✓ Claude UserPromptSubmit hook with fail-open design — Phase 30
- ✓ Cross-project hook (global settings), all 4 agent adapters — Phase 30.1
- ✓ Context-aware relevance boosting (project, cwd, recent files) — Phase 30.1
- ✓ Working memory (KG structure + STATE.md, 300-token budget) — Phase 31
- ✓ Per-agent scoring profiles (tier weight multipliers) — Phase 32
- ✓ Cross-agent session continuity (session state file, 2-hour window) — Phase 32

### Active

## Current Milestone: v7.2 VKB & Online-Learning Quality

**Goal:** Bring the online learning pipeline → km-core → unified viewer surface to production data quality, so operators rely on the graph view for navigation and triage instead of working around known-broken rendering.

**Target features:**
- ✓ **Online pipeline emits semantic-content edges on Insights** — Phase 58 shipped 2026-06-15: `mentions` edge type emitted atomically in `ObservationWriter.writeInsight` (EDGE-01 + EDGE-02 complete); one-shot live backfill covered 96 historical Insights; verified by SC#1 `--sample 20 --min 18 = PASS`, SC#2 atomicity integration tests, SC#3 unified-viewer screenshot
- Ontology rework — clarify upper/lower split, build lower ontology for coding-specific concepts (LSL, ConstraintMonitor, Online-Observation/Digest/Insight tiers), per-project grouping in viewer
- VKB rendering UX integrity — Evidence/Pattern filter symmetry, Legend derived from rendered graph, eliminate Observations/Digests architecture bleed, restore CollectiveKnowledge visibility under Online filter
- LSL timeline scale honesty — remove 200-record silent cap, honest "all" window name, bi-source coloring (manual vs online) on ticks
- OKB data routing fix — resolve `/api/entities` vs `/api/v1/entities` contract mismatch so `/viewer/okb` reaches OKM Express on :8090
- Long-tail orphan fixes — close Phase 48 (System-type vanish), Phase 49 (orphan project-anchor relations); reduce 157-orphan baseline materially

**Key context:**
- Foundation is healthy: km-core export at 1262 nodes / 1592 edges / 88% connectivity / 10 relation types after the 2026-06-10 backfill + repair commits trail (`bc5fe8012`, `a283c9be1`, `7ab1f9cd8`, `939f8d506`). Qdrant collections live: observations=5509, digests=1601, insights=225, kg_entities=675. This milestone is about the LONG TAIL of data quality, not foundational repair.
- Scope seeds: the 9-todo cluster surfaced during Phase 56.1 visual smoke (2026-06-13/14), listed in `.planning/MILESTONES.md` under the v7.2 entry. Two carry operator-set `scope_hint: This is a multi-phase milestone, not a single TODO`.
- Phase 48 + Phase 49 (legacy ROADMAP TBD placeholders) fold into v7.2 phase numbering — close the old slots as superseded.
- Phase numbering continues from Phase 56.1 → new phases start at **Phase 57**.
- v7.1 (KM Unification — Phases 37-46) was functionally shipped before this milestone opened; one Phase 46 HUMAN-UAT (ONBOARDING.md operator dry-run) remains pending. v7.1 will be archived once that UAT lands; it runs in parallel.
- Out of scope: LLM proxy worker pool (v7.3), cross-agent perf measurement (v7.4), Phase 51 follow-ups, Phase 54 ETM hardening, Phase 35-04/05 retention wiring — all run in parallel as backlog phases.

### v7.1 Shipped (Knowledge Management Unification — Phases 37-46)

- ✓ Shared KM-Core types + GraphKMStore (Graphology + LevelDB + JSON exports) — Phase 37
- ✓ OntologyRegistry with dynamic upper + lower ontology discovery — Phase 38
- ✓ Uniform entity shape (kills KGEntity/SharedMemoryEntity split) + temporal validity fields — Phase 39
- ✓ 4-stage consolidation framework + layered dedup pipeline — Phase 40
- ✓ Online-learning adapter + post-hoc resolution (System A) — Phase 41
- ✓ Offline UKB migration (System B) — Phase 42 + 42.1/42.1.1/42.1.2/42.2
- ✓ OKM cross-repo migration (System C) — Phase 43
- ✓ Common REST query API + git-snapshot/restore — Phase 44
- ✓ Unified viewer routing layer + UI feature parity with VOKB — Phase 45 + 55
- ⏳ Per-system documentation + onboarding — Phase 46 (one operator HUMAN-UAT pending: ONBOARDING.md dry-run)

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
*Last updated: 2026-06-15 — Phase 58 complete (Online Pipeline Semantic Edges on Insights: `MentionsClassifier` host-side module, atomic emission via extended `ObservationWriter.writeInsight`, one-shot backfill + bridge extension, SC#1/SC#2/SC#3 all PASS, EDGE-01 + EDGE-02 marked complete in REQUIREMENTS.md). v7.2 milestone in progress.*

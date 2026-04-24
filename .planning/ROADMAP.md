# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, shipped 2026-04-05)
- v5.0 -- Service Reliability & Health System Overhaul (Phases 24-27, in progress)
- v6.0 -- Knowledge Context Injection (Phases 28-32, planned)

---

<details>
<summary>v1.0 UKB Pipeline Fix & Improvement -- SHIPPED 2026-03-03</summary>

- [x] Phase 1: Core Pipeline Data Quality (7/7 plans) -- completed 2026-03-02
- [x] Phase 4: Schema & Configuration Foundation (2/2 plans) -- completed 2026-03-01
- [ ] Phase 2: Insight Generation & Data Routing -- Deferred
- [ ] Phase 3: Significance & Quality Ranking -- Deferred

</details>

<details>
<summary>v2.0 Wave-Based Hierarchical Semantic Analysis -- Phases 5-8</summary>

- [x] **Phase 5: Wave Orchestration** - Replace flat batch DAG with hierarchical wave controller (completed 2026-03-04)
- [x] **Phase 6: Entity Quality** - Rich multi-observation entities with insight documents (completed 2026-03-04)
- [x] **Phase 7: Hierarchy Completeness** - Comprehensive sub-node coverage from code analysis (completed 2026-03-07)
- [x] **Phase 8: VKB Tree Navigation** - Deferred to v2.2

</details>

<details>
<summary>v2.1 Wave Pipeline Quality Restoration -- Phases 9-14, SHIPPED 2026-03-10</summary>

- [x] **Phase 9: Agent Pipeline Integration** (3/3 plans) -- completed 2026-03-07
- [x] **Phase 10: KG Operations Restoration** (5/5 plans) -- completed 2026-03-08
- [x] **Phase 11: Content Quality Gate** (3/3 plans) -- completed 2026-03-09
- [x] **Phase 12: Pipeline Observability** (4/4 plans) -- completed 2026-03-09
- [x] **Phase 13: Code Graph Agent Integration** (3/3 plans) -- completed 2026-03-09
- [~] **Phase 14: Documentation Generation** (2/3 plans) -- 14-03 deferred to v3.0

</details>

<details>
<summary>v3.0 Workflow State Machine -- Phases 15-19</summary>

- [x] **Phase 15: Type Definitions** (2/2 plans) -- completed 2026-03-10
- [x] **Phase 16: Backend State Machine** (2/2 plans) -- completed 2026-03-11
- [x] **Phase 17: SSE Event Typing** (2/2 plans) -- completed 2026-03-11
- [x] **Phase 18: Dashboard Consumer** (2/2 plans) -- completed 2026-03-11
- [ ] **Phase 19.1: Dashboard SM Integration** (2/4 plans) -- in progress
- [ ] **Phase 19: Migration & Cleanup** (0/2 plans) -- blocked on 19.1

</details>

<details>
<summary>v4.0 Mastra Integration & LSL Observational Memory -- Phases 20-23, SHIPPED 2026-04-05</summary>

- [ ] **Phase 20: Foundation & OpenCode OM** (1/2 plans) -- in progress
- [x] **Phase 21: Mastracode Agent Integration** (4/4 plans) -- completed 2026-04-02
- [x] **Phase 22: Transcript Converters** (3/3 plans) -- completed 2026-04-03
- [x] **Phase 23: Live Observation Tap & Dashboard** (2/2 plans) -- completed 2026-04-05

</details>

<details>
<summary>v5.0 Service Reliability & Health System Overhaul -- Phases 24-27</summary>

- [ ] **Phase 24: Port Liveness & Supervisord Checks** - Core failure detection for all services and container processes
- [ ] **Phase 25: Database Health & Process Lifecycle** - SQLite integrity, WAL management, stale PID detection, host process monitoring
- [ ] **Phase 26: Dashboard Accuracy & Auto-Healing** - Truthful dashboard, auto-restart for crashed services, failure history timeline
- [ ] **Phase 27: Insight Validation** - Verify insight claims against the codebase, flag stale references

</details>

---

## v6.0 -- Knowledge Context Injection

### Overview

Five phases that make accumulated knowledge actionable by injecting it into coding agent conversations. Phase 28 embeds all knowledge tiers (observations, digests, insights, KG entities) into Qdrant with write-time hooks for new items. Phase 29 builds the retrieval service -- a hybrid search endpoint combining semantic, keyword, and recency scoring with token budget enforcement. Phase 30 wires the Claude Code UserPromptSubmit hook as the primary injection adapter, proving end-to-end value. Phase 31 adds a persistent working memory template injected alongside retrieval results. Phase 32 extends to remaining agents (OpenCode, Copilot) and adds per-agent scoring profiles with cross-agent continuity.

### Phases

- [x] **Phase 28: Embedding Pipeline** - Embed all knowledge tiers into Qdrant with write-time hooks
- [x] **Phase 29: Retrieval Service** - Hybrid search endpoint with token-budgeted context assembly (completed 2026-04-24)
- [ ] **Phase 30: Claude Hook Adapter** - UserPromptSubmit hook injecting retrieved knowledge into Claude conversations
- [ ] **Phase 31: Working Memory** - Persistent project state template injected as fixed prefix
- [ ] **Phase 32: Agent Profiles & Additional Adapters** - Per-agent scoring, OpenCode/Copilot adapters, cross-agent continuity

### Phase Details

#### Phase 28: Embedding Pipeline
**Goal**: All accumulated knowledge exists as searchable vectors in Qdrant, and new knowledge is embedded automatically on creation
**Depends on**: Nothing (first phase of v6.0)
**Requirements**: EMBED-01, EMBED-02, EMBED-03, EMBED-04, EMBED-05, EMBED-06
**Success Criteria** (what must be TRUE):
  1. Running a Qdrant collection listing shows 4 knowledge collections (observations, digests, insights, kg_entities) with point counts matching source data (558+ obs, 132+ digests, 12+ insights, 160+ entities)
  2. Creating a new observation via ETM causes it to appear in Qdrant within 60 seconds without manual intervention
  3. Querying Qdrant with a semantic search for a known observation topic returns relevant results with correct metadata (agent, project, date, quality)
  4. The embedding model is pinned to all-MiniLM-L6-v2 (384-dim) in a single config location, and changing it requires updating only that one value
**Plans:** 3/3 plans complete

Plans:
- [x] 28-01-PLAN.md -- Foundation: fastembed install, embedding config, service wrapper, Qdrant collections
- [x] 28-02-PLAN.md -- Backfill: one-shot CLI to embed all existing knowledge into Qdrant
- [x] 28-03-PLAN.md -- Write-time hooks: Redis pub/sub listener + ObservationWriter integration

#### Phase 29: Retrieval Service
**Goal**: Any client can POST a query and receive a token-budgeted, relevance-scored markdown block of knowledge from all tiers
**Depends on**: Phase 28 (vectors must exist in Qdrant)
**Requirements**: RETR-01, RETR-02, RETR-03, RETR-04, RETR-05, RETR-06, RETR-07
**Success Criteria** (what must be TRUE):
  1. POSTing a query to /api/retrieve returns a structured markdown block with tier headers (Insights, Digests, Entities, Observations) and source attribution per result
  2. The returned context stays within the configured token budget (default ~1000 tokens) even when many results match
  3. Insights and digests consistently rank above raw observations for the same topic (tier-weighted scoring works)
  4. Queries with no relevant matches return an empty result rather than low-confidence noise (relevance threshold 0.75 enforced)
  5. The endpoint responds in under 500ms at p95 measured over 20 consecutive queries
**Plans:** 2/2 plans complete

Plans:
- [x] 29-01-PLAN.md -- Core retrieval module: RRF fusion, token budgeting, keyword search, RetrievalService orchestrator
- [x] 29-02-PLAN.md -- Wire POST /api/retrieve into server.js + end-to-end verification

#### Phase 30: Claude Hook Adapter
**Goal**: Claude Code conversations automatically receive relevant knowledge context on every prompt submission
**Depends on**: Phase 29 (retrieval endpoint must exist)
**Requirements**: HOOK-01, HOOK-02, HOOK-03
**Success Criteria** (what must be TRUE):
  1. Typing a substantive prompt in Claude Code causes injected knowledge to appear as system-reminder context visible in the conversation
  2. If the retrieval service is stopped, Claude Code continues working normally with no errors or delays (fail-open behavior)
  3. Short prompts like "yes", "continue", or single-word commands do not trigger knowledge injection
**Plans**: TBD

Plans:
- [ ] 30-01-PLAN.md -- TBD

#### Phase 31: Working Memory
**Goal**: Every agent conversation starts with a concise, auto-generated project state summary alongside semantic results
**Depends on**: Phase 29 (injected via retrieval service response)
**Requirements**: WMEM-01, WMEM-02, WMEM-03
**Success Criteria** (what must be TRUE):
  1. The retrieval response includes a "Working Memory" section containing current project state, active conventions, and known issues
  2. The working memory section stays under 500 tokens regardless of project complexity
  3. Working memory content reflects actual KG state -- adding or removing a KG entity causes the working memory to update on next retrieval
**Plans**: TBD

Plans:
- [ ] 31-01-PLAN.md -- TBD

#### Phase 32: Agent Profiles & Additional Adapters
**Goal**: All supported coding agents receive knowledge injection tailored to their work patterns, with continuity across agent switches
**Depends on**: Phase 30 (Claude hook proves the pattern), Phase 29 (retrieval service)
**Requirements**: HOOK-04, HOOK-05, PROF-01, PROF-02
**Success Criteria** (what must be TRUE):
  1. OpenCode receives injected knowledge context via its plugin system or agent configuration file
  2. Copilot receives injected knowledge context via workspace context file or instructions mechanism
  3. Switching from Claude to OpenCode mid-task causes the OpenCode session to include recent observations from the preceding Claude session
  4. Different agents receive differently weighted results for the same query (e.g., Claude biased toward architecture pitfalls, Copilot toward code conventions)
**Plans**: TBD

Plans:
- [ ] 32-01-PLAN.md -- TBD
- [ ] 32-02-PLAN.md -- TBD

### Progress

**Execution Order:** 28 -> 29 -> 30 -> 31 -> 32

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 28. Embedding Pipeline | v6.0 | 3/3 | Complete    | 2026-04-24 |
| 29. Retrieval Service | v6.0 | 2/2 | Complete    | 2026-04-24 |
| 30. Claude Hook Adapter | v6.0 | 0/TBD | Not started | - |
| 31. Working Memory | v6.0 | 0/TBD | Not started | - |
| 32. Agent Profiles & Additional Adapters | v6.0 | 0/TBD | Not started | - |

---

## Backlog

### Phase 999.1: Extract Shared LLM Adapter Library (BACKLOG)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain -> Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) -- same pattern for claude-code.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

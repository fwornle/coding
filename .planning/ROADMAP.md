# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, shipped 2026-04-05)
- v5.0 -- Service Reliability & Health System Overhaul (Phases 24-27, in progress)
- v6.0 -- Knowledge Context Injection (Phases 28-32, shipped 2026-04-25) -> [archive](milestones/v6.0-ROADMAP.md)

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

<details>
<summary>v6.0 Knowledge Context Injection -- Phases 28-32, SHIPPED 2026-04-25</summary>

- [x] **Phase 28: Embedding Pipeline** (3/3 plans) -- completed 2026-04-24
- [x] **Phase 29: Retrieval Service** (2/2 plans) -- completed 2026-04-24
- [x] **Phase 30: Claude Hook Adapter** (1/1 plan) -- completed 2026-04-25
- [x] **Phase 30.1: Cross-Project Agent-Agnostic Injection** (2/2 plans) -- completed 2026-04-25
- [x] **Phase 31: Working Memory** (1/1 plan) -- completed 2026-04-25
- [x] **Phase 32: Agent Profiles & Additional Adapters** (2/2 plans) -- completed 2026-04-25

</details>

---

## Backlog

### Phase 999.1: Extract Shared LLM Adapter Library (BACKLOG)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain -> Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) -- same pattern for claude-code.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

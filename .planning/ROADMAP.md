# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, planned)

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

---

## v4.0 -- Mastra Integration & LSL Observational Memory

### Overview

Four phases that integrate mastra.ai's observational memory into the coding infrastructure. Phase 20 lays the foundation: LibSQL observation storage, the OpenCode mastra plugin, LLM proxy routing, and token budget controls. Phase 21 adds mastracode as a third coding agent with full tmux/LSL infrastructure. Phase 22 builds transcript-to-observation converters for Claude JSONL, Copilot events, and historical .specstory files. Phase 23 (highest risk) taps the live enhanced-transcript-monitor to produce real-time observations alongside verbatim LSL, and surfaces observations via dashboard REST endpoint. The ordering respects dependencies: storage before consumers, additive integrations before modifying the existing LSL pipeline.

### Phases

- [ ] **Phase 20: Foundation & OpenCode OM** - LibSQL storage, mastra OpenCode plugin, LLM proxy routing, token budget controls
- [ ] **Phase 21: Mastracode Agent Integration** - `coding --mastra` launch, tmux statusline, LSL capture via observation hooks
- [ ] **Phase 22: Transcript Converters** - Claude JSONL, Copilot events, .specstory batch conversion, shared MastraDBMessage normalization
- [ ] **Phase 23: Live Observation Tap & Dashboard** - Real-time observation generation in enhanced-transcript-monitor, REST browsing endpoint

### Phase Details

#### Phase 20: Foundation & OpenCode OM
**Goal**: Users running `coding --opencode` get live observational memory with cost-controlled LLM calls and persistent LibSQL storage
**Depends on**: Nothing (foundation phase for v4.0)
**Requirements**: OCOM-01, OCOM-02, OCOM-03, OCOM-04
**Success Criteria** (what must be TRUE):
  1. Running `install.sh` installs the mastra/opencode plugin; `uninstall.sh` removes it; `scripts/test-coding.sh` validates the installation
  2. Observations persist to a LibSQL database at a configurable path under `.observations/` and survive process restarts
  3. Observer and reflector LLM calls route through the existing coding LLM proxy (Docker to host agent SDK) -- no direct API keys in mastra config
  4. Token budget limits are configurable per observer/reflector agent and prevent runaway LLM costs during tool-heavy sessions
**Plans:** 1/2 plans executed

Plans:
- [ ] 20-01-PLAN.md -- Port LLM proxy bridge server and provider config from OKM
- [x] 20-02-PLAN.md -- Plugin installation lifecycle, storage config, token budgets, smoke test

#### Phase 21: Mastracode Agent Integration
**Goal**: Users can launch mastracode as a fully integrated coding agent with tmux session management and LSL logging
**Depends on**: Phase 20 (LibSQL storage pattern established)
**Requirements**: MSTR-01, MSTR-02, MSTR-03
**Success Criteria** (what must be TRUE):
  1. User can run `coding --mastra` and get a working mastracode session inside the standard tmux layout
  2. The tmux statusline shows mastracode session status with LSL indicator and health monitoring (same pattern as claude/copilot/opencode)
  3. Enhanced-transcript-monitor captures mastracode conversations for LSL logging (via mastra lifecycle hooks, not pipe-pane)
**Plans**: TBD

#### Phase 22: Transcript Converters
**Goal**: Users can convert historical transcripts from all three agents into mastra observations via CLI
**Depends on**: Phase 20 (LibSQL storage, observe() API proven)
**Requirements**: CONV-01, CONV-02, CONV-03, CONV-04
**Success Criteria** (what must be TRUE):
  1. User can run a CLI command to convert Claude .jsonl transcript files into mastra observations stored in LibSQL
  2. User can run a CLI command to convert Copilot events.jsonl transcript files into mastra observations stored in LibSQL
  3. User can batch-convert git-tracked .specstory/ LSL files into mastra observations with manifest-based idempotency (no double-processing)
  4. All three converters normalize their input format to MastraDBMessage before calling observe() -- shared normalization layer, not three separate implementations
**Plans**: TBD

#### Phase 23: Live Observation Tap & Dashboard
**Goal**: Live coding sessions produce real-time observations alongside verbatim LSL, browsable from the health dashboard
**Depends on**: Phase 20 (storage), Phase 21 (mastracode LSL pattern), Phase 22 (observe() API usage proven at scale)
**Requirements**: LIVE-01, LIVE-02
**Success Criteria** (what must be TRUE):
  1. Enhanced-transcript-monitor produces mastra observations in real-time during `coding --claude` sessions without blocking or degrading verbatim LSL output
  2. Observations are browsable via a REST endpoint on the health dashboard (port 3032) with agent filtering and time range
**Plans**: TBD
**UI hint**: yes

### Progress

**Execution Order:** 20 -> 21 -> 22 -> 23

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 20. Foundation & OpenCode OM | v4.0 | 1/2 | In Progress|  |
| 21. Mastracode Agent Integration | v4.0 | 0/? | Not started | - |
| 22. Transcript Converters | v4.0 | 0/? | Not started | - |
| 23. Live Observation Tap & Dashboard | v4.0 | 0/? | Not started | - |

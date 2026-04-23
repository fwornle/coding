# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, shipped 2026-04-05)
- v5.0 -- Service Reliability & Health System Overhaul (Phases 24-27, in progress)

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

---

## v5.0 -- Service Reliability & Health System Overhaul

### Overview

Four phases that make the health system truthful and self-healing. Phase 24 builds the core detection layer: port liveness probes across all six service ports and supervisord process status integration — the minimal set needed to detect that something is wrong. Phase 25 adds deeper health checks for the data tier: SQLite integrity, malformed JSON detection, WAL management, and stale PID/status file detection for host-side processes. Phase 26 makes the dashboard reflect ground truth and adds auto-healing: auto-restart for crashed port-bound services and FATAL supervisord processes, accurate statusline, per-service failure cards, and a failure history timeline. Phase 27 closes the loop on insight quality by adding a codebase validator that checks whether file paths and function names cited in insights still exist.

### Phases

- [ ] **Phase 24: Port Liveness & Supervisord Checks** - Core failure detection for all services and container processes
- [ ] **Phase 25: Database Health & Process Lifecycle** - SQLite integrity, WAL management, stale PID detection, host process monitoring
- [ ] **Phase 26: Dashboard Accuracy & Auto-Healing** - Truthful dashboard, auto-restart for crashed services, failure history timeline
- [ ] **Phase 27: Insight Validation** - Verify insight claims against the codebase, flag stale references

### Phase Details

#### Phase 24: Port Liveness & Supervisord Checks
**Goal**: The health system detects any crashed service within 60 seconds via port probes and supervisord status reads
**Depends on**: Phase 23 (health verifier + dashboard exist)
**Requirements**: PORT-01, PORT-02, PORT-03, SUPV-01, SUPV-02, SUPV-04
**Success Criteria** (what must be TRUE):
  1. Health verifier probes all six ports (3030, 3032, 3033, 3848, 8080, 12435) every 30 seconds and marks unreachable ports as failures
  2. Killing any service makes the dashboard show that service as unhealthy within 60 seconds
  3. Dashboard health card displays per-port green/red status with a last-checked timestamp for each port
  4. Health verifier reads supervisord process status from inside the Docker container and exposes it to the API
  5. FATAL or STOPPED supervisord processes appear as critical violations in the health report
  6. Dashboard shows a supervisord process list with per-process status (RUNNING / FATAL / STOPPED)
**Plans**: 3 plans

Plans:
- [ ] 24-01-PLAN.md — Fix port 3030 disable, add port 3848 rule, implement supervisord integration
- [ ] 24-02-PLAN.md — Dashboard Service Detail section with per-port and per-supervisord-process status
- [ ] 24-03-PLAN.md — Docker rebuild and end-to-end visual verification

**UI hint**: yes

#### Phase 25: Database Health & Process Lifecycle
**Goal**: The health system detects data-tier corruption and stale host-side process state before they cause silent failures
**Depends on**: Phase 24 (health verifier polling loop established)
**Requirements**: DBHL-01, DBHL-02, DBHL-03, DBHL-04, PROC-01, PROC-02, PROC-03, PROC-04
**Success Criteria** (what must be TRUE):
  1. SQLite PRAGMA integrity_check runs periodically and reports any corruption as a health failure
  2. Malformed JSON rows in the observations DB are detected and surfaced in the health report
  3. Dashboard offers a DB repair action (dump valid rows, rebuild, restore) that requires user confirmation before executing
  4. WAL checkpoint runs automatically to prevent unbounded WAL file growth
  5. Stale PID files are detected — if a status file says "running" but the PID is gone, the health system flags the discrepancy
  6. Host-side processes (ETM, LLM proxy) are health-checked and included in the overall health report
  7. PSM supervision coverage includes all host-side services, with status file staleness flagged after 5 minutes of inactivity
**Plans**: TBD
**UI hint**: yes

#### Phase 26: Dashboard Accuracy & Auto-Healing
**Goal**: The dashboard shows true service state at all times and attempts automatic recovery when services crash
**Depends on**: Phase 24 (detection data), Phase 25 (full health data available)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, PORT-04, SUPV-03
**Success Criteria** (what must be TRUE):
  1. Killing any service causes the dashboard health card to turn red within 60 seconds -- no false greens remain
  2. The statusline hook reports the same health state as the dashboard (no split-brain between terminal and browser)
  3. Each service has its own health card showing failure reason and last-seen timestamp
  4. A failure history timeline shows when services went down and came back, visible on the dashboard
  5. A port unreachable for 2 consecutive checks triggers an auto-restart attempt, with outcome shown on the dashboard
  6. A FATAL supervisord process triggers an auto-restart via supervisord API, with outcome shown on the dashboard
**Plans**: TBD
**UI hint**: yes

#### Phase 27: Insight Validation
**Goal**: Users can verify whether insight claims still match the codebase and see stale references flagged inline
**Depends on**: Phase 23 (insights exist and are browsable on dashboard)
**Requirements**: IVAL-01, IVAL-02, IVAL-03, IVAL-04
**Success Criteria** (what must be TRUE):
  1. Each insight card on the dashboard has a Validate button the user can click
  2. Clicking Validate triggers a codebase check that extracts file paths and function names from the insight text and verifies they exist
  3. Stale claims show specific details (file moved, function renamed, line reference outdated) rather than a generic "stale" flag
  4. Validation results appear inline on the insight card -- each claim is marked verified, stale, or unknown without a page reload
**Plans**: TBD
**UI hint**: yes

### Progress

**Execution Order:** 24 -> 25 -> 26 -> 27

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 24. Port Liveness & Supervisord Checks | v5.0 | 0/3 | Planned | - |
| 25. Database Health & Process Lifecycle | v5.0 | 0/TBD | Not started | - |
| 26. Dashboard Accuracy & Auto-Healing | v5.0 | 0/TBD | Not started | - |
| 27. Insight Validation | v5.0 | 0/TBD | Not started | - |

---

## Backlog

### Phase 999.1: Extract Shared LLM Adapter Library (BACKLOG)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain → Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) — same pattern for claude-code.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

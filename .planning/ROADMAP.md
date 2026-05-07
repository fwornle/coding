# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, shipped 2026-04-05)
- v5.0 -- Service Reliability & Health System Overhaul (Phases 24-27, in progress)
- v6.0 -- Knowledge Context Injection (Phases 28-32, shipped 2026-04-25) -> [archive](milestones/v6.0-ROADMAP.md)
- v7.0 -- Health Monitoring Consolidation (Phase 33, in progress)

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

<details>
<summary>v7.0 Health Monitoring Consolidation -- Phase 33</summary>

### Phase 33: Health Monitoring Consolidation

**Goal:** Replace the four-layer host watchdog stack and parallel readers of `.health/*.json` with a single coordinator process owning one HTTP-served Single Source of Truth on `localhost:3034`, exposing per-session keyed entries, enforcing a 10s p95 detection SLA, and eliminating sledgehammer auto-heals — such that the dashboard at `:3032`, the constraint dashboard at `:3030`, the statusline daemon, the prompt-hook, and the in-container `/api/health-verifier/status` endpoint all derive their answer from the SAME SoT and never disagree.

**Plans:** 13/14 plans executed

Plans:
**Wave 1**
- [x] 33-01-PLAN.md — Wave 0 foundation: extract `lib/utils/log-rotator.js` and create test harness scaffold (10 files under `scripts/__tests__/health-coordinator/`)
- [x] 33-02-PLAN.md — Coordinator skeleton: `scripts/health-coordinator.js` (Express on `0.0.0.0:3034`, in-memory state, 4 endpoints, EADDRINUSE handler) + launchd plist (NOT loaded yet)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 33-03-PLAN.md — Coordinator behavior: rules loader + check registry + 5s tick + Docker `.State.Health.Status` passthrough + per-check error isolation (R6)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 33-04-PLAN.md — Reporter conversion: reduce `health-verifier.js` and `statusline-health-monitor.js` to reporter mode; add `lsl_heartbeat` POST to `enhanced-transcript-monitor.js`

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 33-05-PLAN.md — Reader migration: rewrite `health-prompt-hook.js`, dashboard backend (`server.js`, 4 routes), and constraint-monitor backend (`dashboard-server.js`, 2 routes) to fetch from coordinator

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 33-06-PLAN.md — Rules cleanup: delete `bind_mount_freshness` and `supervisord_status` from `health-verification-rules.json`; delete `refreshBindMounts()` and any `--force-recreate` from `health-remediation-actions.js`
- [x] 33-07-PLAN.md — Cutover: add `HEALTH_COORDINATOR_URL` to `docker-compose.yml`; rebuild container; delete 4 legacy daemon scripts; bootout legacy plist + bootstrap new plist; clean stale `.health/*.json`; human verify

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 33-08-PLAN.md — Acceptance: run all 13 SPEC AC checks against the cutover system; write `33-VERIFICATION-PRECHECK.md`; human verify

**Gap closure (from 33-08 acceptance failures, 6 plans):**

**Wave 1 (gap-closure parallel — disjoint files)**
- [x] 33-09-PLAN.md — G1 (HIGH): port liveness probes (HTTP + TCP) into coordinator's check registry; add `obs_api` rule so AC#6 detection-latency test can find it. Touches `scripts/health-coordinator.js`, NEW `lib/utils/service-probe.js`, NEW `scripts/__tests__/health-coordinator/service-liveness.test.sh`
- [x] 33-10-PLAN.md — G2 (HIGH): mount `/api/*` reverse-proxy in `integrations/system-health-dashboard/static-server.js` BEFORE the SPA `*` catch-all so port 3032 returns JSON for `/api/health-verifier/*`. Unblocks AC#5 and AC#9
- [x] 33-12-PLAN.md — G7 (HIGH, NEW from 33-08): declare `HEALTH_COORDINATOR_INJECT_THROW` (and friends) in plist `EnvironmentVariables` dict so `launchctl setenv` overrides reach child process. Unblocks AC#13. Includes human-verify checkpoint
- [x] 33-14-PLAN.md — G5+G6+G8 (LOW bundle): cleanup stale refs in `free-coding-ports.sh`; remove `--auto-heal` from `start-services-robust.js` spawn; bump `eviction.test.sh` sleep 17s→22s; remove `start_global_lsl_monitoring` no-op stub from `agent-common-setup.sh`

**Wave 2 (gap-closure — depends on 33-09 because both touch `scripts/health-coordinator.js`)**
- [x] 33-11-PLAN.md — G4 (MED): rename `pollDockerHealth()` output key `status` → `healthcheck` to match SPEC AC #4 / AC #12 jq paths AND existing readers (statusline daemon, dashboard reshape). Unblocks AC#4 + AC#12

**Wave 3 (gap-closure — depends on 33-09 + 33-11; option-c may touch `scripts/health-coordinator.js`)**
- [ ] 33-13-PLAN.md — G3 (MED): canonical session-id form for LSL keying — **starts with `checkpoint:decision`** (4 options: ETM normalizes / per-pane reads env / coordinator fuzzy / project-rollup canonical). Includes human-verify checkpoint for two-pane tmux scenario

**Acceptance gate after gap-closure:** re-run `bash scripts/__tests__/health-coordinator/run-all.sh` + re-execute plan 33-08's acceptance suite. Phase 33 declared complete when SPEC AC pass count goes from 7 → 13 (or 13 with documented deviations for AC#2 LLM-CLI-proxy out-of-scope).

</details>

---

## Backlog

### Phase 999.1: Extract Shared LLM Adapter Library (BACKLOG)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain -> Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) -- same pattern for claude-code.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

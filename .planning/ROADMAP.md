# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, shipped 2026-04-05)
- v5.0 -- Service Reliability & Health System Overhaul (Phases 24-27, in progress)
- v6.0 -- Knowledge Context Injection (Phases 28-32, shipped 2026-04-25) -> [archive](milestones/v6.0-ROADMAP.md)
- v7.0 -- Health Monitoring Consolidation (Phases 33-34, in progress)

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

**Plans:** 15/15 plans complete

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
- [x] 33-13-PLAN.md — G3 (MED): canonical session-id form for LSL keying — **starts with `checkpoint:decision`** (4 options: ETM normalizes / per-pane reads env / coordinator fuzzy / project-rollup canonical). Includes human-verify checkpoint for two-pane tmux scenario

**Acceptance gate after gap-closure:** re-run `bash scripts/__tests__/health-coordinator/run-all.sh` + re-execute plan 33-08's acceptance suite. Phase 33 declared complete when SPEC AC pass count goes from 7 → 13 (or 13 with documented deviations for AC#2 LLM-CLI-proxy out-of-scope).

### Phase 34: Proxy Supervision and ETM Legacy Cleanup

**Goal:** Close real LLM proxy supervision gaps in the central health coordinator (semantic-work probe, central network-mode publishing, on-the-fly VPN/CN re-detection, auto-heal wiring) AND execute the deferred Option B from commit 0049fc179 — delete the dead `StreamingKnowledgeExtractor` / `RealTimeTrajectoryAnalyzer` / related modules that the ETM still runs (2 LLM calls per exchange + 1 per prompt set, output unread since the [📚] badge rewire) — so the coordinator becomes the honest single source of truth for proxy semantic-readiness AND the ETM hot path stops doing dead work.

**Plans:** 6 plans

Plans:

**Wave 1 (parallel — disjoint files)**
- [x] 34-01-PLAN.md — Update llm_cli_proxy rule in config/health-verification-rules.json: flip auto_heal=true + add cooldown 3/5min (D-06 + D-07 kill-switch via existing POST /health/refresh)
- [x] 34-02-PLAN.md — Add state.proxy slice + pollProxySemantic (60s, D-01 payload, D-02 four-mode classification) + pollProxyMode (every tick) to scripts/health-coordinator.js — observation only, no FSM
- [x] 34-04-PLAN.md — ETM strip (D-08 Plan A): delete ~80 LoC of dead online-learning paths from scripts/enhanced-transcript-monitor.js + checkpoint cross-project ETM smoke verify (D-09 + D-10) — cherry-picked clean from `worktree-agent-a2ca353f2ad671350`; auto-merge resolved both 34-04's strip and this session's per-exchange tranche routing + lock fix; structural grep gates pass; live ETM smoke (D-09/D-10 hard-restart with prompt-flow check) deferred to operator window since the plan is `autonomous: false`
- [ ] 34-06-PLAN.md — Phase 33 leftover closure: AC #6 detection-latency P95 ≤ 10s + AC #11 destructive kill -9 respawn ≤ 30s + plist dead-key cleanup (D-15 + D-16 + D-17) — paused at Task 1 gate awaiting operator approval on plist cleanup approach

**Wave 2** *(depends on Wave 1 — Plan 34-03 reads RULES from 34-01 + adds FSM on top of 34-02; Plan 34-05 deletes files orphaned by 34-04 + surfaces state.proxy from 34-02)*
- [x] 34-03-PLAN.md — Auto-heal FSM (D-06 cooldown) + VPN/CN flap kickstart (D-05) wired into pollProxySemantic + pollProxyMode; rewrite restartLLMCLIProxy() in scripts/health-remediation-actions.js to use launchctl kickstart -k (PATTERNS.md anomaly #3) — Task 1 PID-change + D-07 kill-switch verified live; R3/R4 destructive tests deferred per SUMMARY operator runbook
- [ ] 34-05-PLAN.md — ETM Plan B + surface: delete 6 source files + clean dead readers in scripts/combined-status-line.js (corrected line list per PATTERNS.md anomaly #4) + add [🧠] proxy badge (collision-resolved with UKB indicator per anomaly #1) + add LLM Proxy Health card to system-health-dashboard (D-11 + FUSE caveat)
</details>

---

## Backlog

### Phase 999.1: Extract Shared LLM Adapter Library (BACKLOG)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain -> Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) -- same pattern for claude-code.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

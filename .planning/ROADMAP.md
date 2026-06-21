# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)
- v4.0 -- Mastra Integration & LSL Observational Memory (Phases 20-23, shipped 2026-04-05)
- v5.0 -- Service Reliability & Health System Overhaul (Phases 24-27, in progress)
- v6.0 -- Knowledge Context Injection (Phases 28-32, shipped 2026-04-25) -> [archive](milestones/v6.0-ROADMAP.md)
- v7.0 -- Health Monitoring Consolidation (Phases 33-36, in progress)
- v7.1 -- Knowledge Management Unification (Phases 37-46, in progress)

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
- [x] 34-06-PLAN.md — Phase 33 leftover closure: AC #6 detection-latency P95 ≤ 10s + AC #11 destructive kill -9 respawn ≤ 30s + plist dead-key cleanup (D-15 + D-16 + D-17) — Option B applied; bootout/bootstrap re-applied plist (uptime 4326s → 3s); AC #6 PASS (50 trials, both assertions green); AC #11 PASS (1s respawn vs 30s threshold); Phase 33 re-run halts on pre-existing two-session-agreement test-side bug from `8f304038e` compound-key migration — NOT a 34-06 regression; **D-14 24h soak gate CLOSED 2026-06-14** — soak window (originally targeted to expire 2026-05-13T04:26Z) elapsed >30 days ago; the proxy supervision FSM has run continuously since without operator-reported runaway kickstarts. R3 + R4 already closed 2026-05-12 via code review (R3) + production telemetry (R4) per MEMORY entry [project_phase34_close_gates.md]. Phase 34 is now fully closed.

**Wave 2** *(depends on Wave 1 — Plan 34-03 reads RULES from 34-01 + adds FSM on top of 34-02; Plan 34-05 deletes files orphaned by 34-04 + surfaces state.proxy from 34-02)*

- [x] 34-03-PLAN.md — Auto-heal FSM (D-06 cooldown) + VPN/CN flap kickstart (D-05) wired into pollProxySemantic + pollProxyMode; rewrite restartLLMCLIProxy() in scripts/health-remediation-actions.js to use launchctl kickstart -k (PATTERNS.md anomaly #3) — Task 1 PID-change + D-07 kill-switch verified live; R3/R4 destructive tests deferred per SUMMARY operator runbook
- [x] 34-05-PLAN.md — ETM Plan B + surface: delete 6 source files + clean dead readers in scripts/combined-status-line.js (Task 2(d) closed 2026-05-11 — methods 1+2 refactored to PSM-only; method 3 sync-constraint deferred; net -54 LoC) + add [🧠] proxy badge (collision-resolved with UKB indicator per anomaly #1) + add LLM Proxy Health card to system-health-dashboard (D-11 + FUSE caveat); W-1 live tmux render operator-verified 2026-05-11

</details>

### Phase 35: Observation & Digest Retention with JSON Cold-Store Fallback

**Goal:** Cap the SQLite `observations` and `digests` tables to a configurable retention window (default 7 days) while transparently merging older rows from `.data/observation-export/{observations,digests}.json` on dashboard queries so historical data stays browsable. Insights table untouched (long-term memory for prompt injection).

**Plans:** 5 plans across 3 waves

Plans:

**Wave 1 (parallel — disjoint files)** — DONE 2026-05-15

- [x] 35-01-PLAN.md — `retentionDays: 7` added to `.observations/config.json`; `ObservationWriter` exposes `this.retentionDays` with constructor-time throw on `< 1` (CONTEXT.md L4 dedup-floor invariant); 5-case Jest suite; also restored empty `test/setup.js` blocker (Rule-3 deviation, noted in SUMMARY) — commits `c470b8c05` + `b16f5ca2a` + SUMMARY `0c0500fe9`
- [x] 35-03-PLAN.md — `ColdStoreReader` read-only range query over `.data/observation-export/{observations,digests}.json` with day-bucketed LRU + fresh-rows-Map decoupling for windows larger than cacheSize; 7-case Jest suite includes source-grep invariant #3 (zero write-API references); commits `47cd10b9f` + `cbd32dd86` + `97ef09118` + SUMMARY `121b02dfc`

**Wave 2** *(sequenced — 35-04 wires both into obs-api)*

- [x] 35-02-PLAN.md — `ObservationPruner` module landed: stateless class, duck-typed DB handle, single transactional `.prune()`; FTS5 trigger drives `observations_fts` sync transparently; 5-case Jest suite (HAS_FTS5-gated) including source-grep invariant #2 — commits `f7ef097fd` + `3fcff881a` + SUMMARY `249954ea0`
- [ ] 35-04-PLAN.md — Wire pruner + reader into `scripts/observations-api-server.mjs`: 1h pruner interval on boot; `/api/observations` + `/api/digests` merge SQLite + ColdStoreReader rows on `offset === 0` when `from` is older than retention boundary (Option B — SQLite-only on `offset > 0` preserves pagination semantics); requires `launchctl kickstart` of obs-api to deploy

**Wave 3**

- [ ] 35-05-PLAN.md — Dashboard backend pass-through verify (`_forwardObsApi` byte-pipe is shape-agnostic, no code change required) + add non-mutating `JSON.parse` tap that logs `[Dashboard:ColdStore]` when `_metadata.fromColdStore === true`, preserving byte-for-byte body fidelity; FUSE-cache-aware rollout via `docker-compose restart coding-services`

### Phase 36: token-usage per-user hourly exports (mirror LSL conventions for git-trackable JSON)

**Goal:** Eliminate merge conflicts on the monolithic `.data/llm-proxy-export/token-usage.json` (637 KB, 1457 rows) by adopting the LSL filesystem convention — per-(date, time-window, user-hash) JSON files under `YYYY/MM/` — so multiple users sharing the project via git can each push their own hourly token-usage snapshots without colliding. Backed by a `user_hash`-discriminated SQLite schema (`UNIQUE (user_hash, id)`) and always-on `hydrateFromExports()` that ingests peers' files on every proxy boot via `ON CONFLICT DO NOTHING`. Closes the "DB still dirty" symptom by widening `.gitignore` to cover SQLite WAL/SHM.

**Requirements**: N/A (no .planning/REQUIREMENTS.md in this project; coverage gate satisfied by CONTEXT.md decisions + PATTERNS.md landmines)
**Depends on:** Phase 35
**Plans:** 7/7 plans executed ✅
**Status:** Complete (2026-05-16)

Plans:

**Wave 1 (parallel — disjoint files)**

- [x] 36-01-PLAN.md — Coordinator publishes `currentState.lsl_meta.current_window` at `/health/state` (HHMM-HHMM, via `getTimeWindow(utcToLocalTime(new Date()))`, cached `sessionDurationMs`, R6 'unknown' on error). Touches `scripts/health-coordinator.js` only.
- [x] 36-02-PLAN.md — `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` exports `LLM_PROXY_USER_HASH` before `exec node` (ESM `import()` of `scripts/user-hash-generator.js`, regex-validated, fallback to `'unknown'`). Wrapper IS what launchd invokes — `bin/coding` is NOT modified.

**Wave 2** *(depends on Wave 1 — needs both coordinator window publish AND env-side hash)*

- [x] 36-03-PLAN.md — Proxy writer rewrite in `_work/rapid-llm-proxy/src/token-usage.ts`: `resolveTokenExportDir`, `currentWindow` (coordinator-curl with 30s cache + local fallback, module-init warm), `exportToHourFile` (right-exclusive `[windowStart, windowEnd)` SELECT + `(user_hash, id)` safety-merge), per-window-keyed `Map<windowKey, Timer>` debounce. Defensive `// TODO(36-04)` fallback for the pre-migration SELECT. Build + kickstart.

**Wave 3** *(depends on Wave 2 — adds schema + replaces hydrate path on the same file)*

- [x] 36-04-PLAN.md — Schema migration in `initTokenDb`. Plan defect discovered during execution: SQLite refuses `ON CONFLICT(user_hash, id)` while `id` is `INTEGER PRIMARY KEY` (ROWID-aliased). User authorised composite-PK rebuild path: `PRIMARY KEY (user_hash, id)` instead of UNIQUE INDEX, INSERT OR IGNORE instead of ON CONFLICT, JS-managed `handle.nextLocalId()` instead of AUTOINCREMENT. Retag folded into the COPY's SELECT. Always-on `hydrateFromExports` (recursive walker port). Remove Plan 36-03's defensive fallback. Build + kickstart. Cross-user simulation verified.

**Wave 4** *(depends on Waves 2+3 — filesystem cleanup after the proxy can write/read the new layout)*

- [x] 36-05-PLAN.md — Two-commit close: (a) `.gitignore` adds explicit `*.db-wal` / `*.db-shm` / `*.db-journal` lines, preserves `!.data/llm-proxy-export/` allow-list, lands as own commit FIRST; (b) NEW `scripts/migrate-token-usage-export.mjs` (one-shot, --dry-run, idempotent) buckets the legacy monolithic file into per-(date, window, user) files under YYYY/MM/, deletes the monolith in the same commit. Idempotent re-run prints `monolith already removed`.

**Wave 5 (parallel — disjoint files, polish)** *(36-06 depends_on 36-04 for server.mjs co-edit ordering; 36-07 fully independent)*

- [x] 36-06-PLAN.md — Model-name canonicalization at the proxy persistence boundary. `canonicalizeModelName(raw)` pure function + `MODEL_CANONICAL_MAP` (17 entries) defined ABOVE `_tokenDb` init (TDZ fix). `model_raw TEXT` column via PRAGMA-guarded ALTER. Idempotent backfill at proxy init rewrote 1027 pre-existing rows (matches variant-table sum exactly); second boot scans 0. Dashboard "By Model" panel collapsed from 8 Claude rows to 3.
- [x] 36-07-PLAN.md — Treemap hover tooltip in `integrations/system-health-dashboard/src/pages/token-usage.tsx`. Add `TreemapTooltip` custom component (process / total / in-out split / calls / avg latency) wired as `<Tooltip content={...}>` child of the existing `<Treemap>` at line ~354 — currently NO Tooltip is wired and the "Hover for details" subtitle is aspirational. Plus SVG `<title>` inside `TreemapContent` for native-browser/screen-reader fallback. Browser-verified via /playwright-cli per CLAUDE.md E2E memory.

---

## v7.1 Knowledge Management Unification -- Phases 37-46

Extract a shared **KM-Core** from the three knowledge-management systems (A: Online Learning, B: Offline UKB, C: OKM) so each application uses a common codebase parameterized by per-system configuration (ontologies, ingest adapters, eval logic). Research seed: `.planning/research/v7.1-km-unification.md`.

### Phases

- [x] **Phase 37: KM-Core Foundation** - Canonical TS types, GraphKMStore adapter, UUID identifier scheme — the shared package B and C both consume. (completed 2026-05-20)
- [x] **Phase 38: Ontology Registry** - Auto-discovered upper + lower ontologies with `extends`-based property merging. (6/6 plans complete 2026-05-20; ready to verify)
- [x] **Phase 39: Entity Data Model** - Provenance fields and `validFrom`/`validUntil`/`supersedes` temporal validity on the canonical entity (locked before migrations). (completed 2026-05-20)
- [x] **Phase 40: Ingest Pipeline & Layered Dedup** - 4-stage `extract → dedup → store → synthesize` framework with the layered dedup pipeline B and C will implement against. (completed 2026-05-22)
- [x] **Phase 41: Online Learning Adapter & Post-Hoc Resolution** - INT-01 (A's SQLite hot path exposed as KM-Core entities) + PIPE-02 (post-hoc cross-class entity resolution as a shared maintenance op). (completed 2026-05-23)
- [x] **Phase 42: Offline UKB Migration (B)** - Full migration of `mcp-server-semantic-analysis` to KM-Core; folds in Phase 10 embeddings-not-reaching-GraphDB issue and the `workflow-runner.ts:469–530` wave-analysis race condition. (completed 2026-05-25 via the 42.1/42.1.1/42.1.2/42.2 sub-phase chain; SC#1-6 verification gate cleared by 42.2-06-PLAN — 5/6 PASS, 1 FAIL-WITH-FIX-LANDED on the project-anchor parity SC.)
- [x] **Phase 42.1: UKB Project-Anchor Parity** - Restore the `findBestParent` + post-sweep `contains`-edge pass that Phase 42-07 Phase B1 removed when replacing `persistence-agent.persistEntities` with `persistWithKmCore`. Without this, every `ukb full` orphans new entities from the `Coding` Project anchor (forensic 2026-05-24 evidence: +64 entities, 0 new edges to Coding). (closed via 42.1.1 + 42.1.2 + structural fix in 42.2-06; remaining residual = 18 ghost orphans in stale general.json which next clean wave-analysis will overwrite.)
- [x] **Phase 43: OKM Cross-Repo Migration (C)** - Cross-repo refactor of `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management` onto KM-Core; rapid-automations CI stays green. (CLOSED 2026-06-02: OKM PR #4 merged 34a0fc5; CI green twice — 108020147 + 108040202; all 4 SCs verified)
- [x] **Phase 44: REST API & Git Snapshots** - Common entity/search/clusters/snapshots/ontology REST contract + git-snapshot/restore identical across A/B/C. (completed 2026-06-04)
- [x] **Phase 45: Unified Viewer Routing Layer** (6/6 plans executed) - Routing scaffold (system-endpoints, multi-base ApiClient, ontology display-overlay) + minimal viewer shell. NOTE: the shipped UI is ~15% of VOKB's feature surface — operator 2026-06-09 visual review (see 45-VERIFICATION.md) confirmed unified viewer is functionally a regression for VOKB users. VKB+VOKB stay primary; the actual unified-viewer UI work (legend, OKB data routing, VOKB feature parity, node-shape encoding, Markdown/Entity panel UX, CAP environment-bound error UX) is split into Phase 55. The "MVP shipped" sign-off on 2026-06-08 was premature — the routing layer is real and useful, the viewer is a stub. Honest framing locked 2026-06-09.
- [x] **Phase 46: Per-System Documentation & Onboarding** - Each system's README documents which configs it owns; KM-Core ships an architecture diagram + onboarding guide. (completed 2026-06-09)

### Phase Details

#### Phase 37: KM-Core Foundation

**Goal:** Land the shared KM-Core package (canonical TypeScript entity/relation types, `GraphKMStore` adapter wrapping Graphology + LevelDB + git-tracked JSON export, UUID-keyed cross-system identifier scheme) so B and C have a single dependency to consume in subsequent migrations.

**Depends on:** Nothing (first v7.1 phase)
**Requirements:** CORE-01, CORE-02, CORE-03
**Success Criteria** (what must be TRUE):

  1. A developer can import `Entity` and `Relation` types from KM-Core in both `coding/` and `rapid-automations/` and get identical type definitions.
  2. The `GraphKMStore` adapter passes parity tests against the existing Graphology+LevelDB stores currently used by B and C (same read/write/export semantics).
  3. Every KM-Core entity carries a stable UUID identifier that survives export → restore round-trips.
  4. The `.data/knowledge-export/coding.json` and `.data/exports/*.json` paths still load via KM-Core without breaking the established two-commit / OKB-baseline guard hygiene.

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 37-01-PLAN.md — Wave 1: bootstrap ~/Agentic/km-core/ repo skeleton (package.json/tsconfig/vitest/MIT/README/CI), capture 4 frozen JSON fixtures from B+C, write all RED test scaffolds (5 unit + 1 integration TS + 1 integration shell). Sets Wave 0 harness per 37-VALIDATION.md.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 37-02-PLAN.md — Wave 2: land canonical Entity/Relation types + branded EntityId + mintEntityId/parseEntityId (UUIDv7) + BatchOp/FilterObject/event payload types + OntologyValidator stub. Closes type half of CORE-01 + CORE-03.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 37-03-PLAN.md — Wave 3: extract PersistenceManager (LevelDB+JSON-fallback+atomic temp-rename) and build Exporter (5s debounce + per-domain bucketing) from OKM + B's GraphKnowledgeExporter analogs. Closes storage primitives half of CORE-02.

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 37-04-PLAN.md — Wave 4: compose GraphKMStore (extends EventEmitter; repository API; UUIDv7 stamp; D-14..D-19) and wire the public barrel src/index.ts. Closes CORE-01/CORE-02/CORE-03 from inside the km-core repo; round-trip parity green across all 4 frozen fixtures.

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 37-05-PLAN.md — Wave 5 (autonomous:false, has human-verify checkpoint): coding-side wiring — submodule mount at lib/km-core/, Dockerfile install/rebuild/build, docker-compose bind-mount, BC symlink migration for .data/knowledge-export/coding.json -> .data/exports/coding.json (D-21), and a checkpoint verifying cross-repo TS import + OKB-baseline-guard hygiene end-to-end.

#### Phase 38: Ontology Registry

**Goal:** Land a single `OntologyRegistry` implementation that auto-discovers upper + N lower ontologies from a configured `ontology/` directory and supports lower-ontology `extends`-based property merging, so the pipeline (Phase 40) and per-system migrations (Phases 42–43) can classify entities against a uniform abstraction.

**Depends on:** Phase 37
**Requirements:** ONTO-01, ONTO-02
**Success Criteria** (what must be TRUE):

  1. Dropping a new `ontology/<domain>.json` file into the configured directory makes its classes available to KM-Core consumers without code changes.
  2. A lower ontology declaring `"extends": "<upper>"` exposes the merged class catalog (upper + lower) to the registry's consumers, with lower-ontology properties overriding upper ones on conflict.
  3. The existing B component-manifest (8 L1 + 5 L2) loads cleanly as a lower ontology against the upper ontology used by C.
  4. The registry surfaces ontology metadata (class list, parent chain, extension provenance) via a stable programmatic API.

**Plans:** 6/6 plans executed (Phase 38 COMPLETE 2026-05-20; ready to verify)

Plans:

**Wave 1 (parallel — no dependencies)**

- [x] 38-01-PLAN.md — Types + loader: create `~/Agentic/km-core/src/types/ontology.ts` (4 interfaces verbatim from OKM analog) + `~/Agentic/km-core/src/ontology/loader.ts` (sync JSON reader, throws on malformed input). [DONE 2026-05-20: km-core commits 4bea298 + 88dff82]
- [x] 38-02-PLAN.md — Test fixtures: 4 verbatim OKM ontology JSONs (upper/kpifw/business/raas) copied via `cp` + synthetic `coding-ontology.json` (B-shape proxy: 7 L1 + 5 L2 from `component-manifest.yaml`, D-26 SC#3 verification fixture). [DONE 2026-05-20: km-core commits 5e31b3e + 972bd3a; 5 files in `~/Agentic/km-core/tests/fixtures/ontology/`; source-count drift surfaced in SUMMARY — on-disk YAML is 7 L1 not 8 L1]

**Wave 2** *(blocked on Wave 1)*

- [x] 38-03-PLAN.md — OntologyRegistry class + sub-barrel + root-barrel re-exports. Adopts OKM's 86-line registry as base with 5 deltas (constructor injection D-28, async atomic reload D-29, stderr warn + strict mode D-27, collision warning text-verbatim D-27, provenance/parent-chain accessors). depends_on: 38-01. [DONE 2026-05-20: km-core commits 5651142 + f006e91; 4 files (2 created + 2 modified); package.json exports map extended for ./ontology sub-path per FLAG-1 option (a); external smoke compile clean for both root + sub-path imports; zero Phase 37 vitest regression]
- [x] 38-04-PLAN.md — `registryBackedValidator` factory in `src/validation/ontology.ts` + root barrel export. Bridges Phase 37's pluggable validator (D-19) to Phase 38's registry; preserves Phase 37 test regex `/Unknown ontology class/`. depends_on: 38-01, 38-03. [DONE 2026-05-20: km-core commits fe582ca + 3f9522f; 2 files modified (validation/ontology.ts 27→75, src/index.ts 62→68); type-only import for one-way dependency direction; error-message text VERBATIM for Phase 37 test compatibility; all 33 Phase 37 vitest tests still pass]

**Wave 3** *(blocked on Wave 2)*

- [x] 38-05-PLAN.md — Wire registry into `GraphKMStore` constructor: add `ontologyDir?` + `ontologyStrict?` options, instantiate registry internally, expose `store.ontology` getter, validator resolution chain (explicit > auto-wired > noop). Pure additive — Phase 37 BC-2 + T-37-04-06 + PersistenceManager/Exporter ordering all preserved. depends_on: 38-03, 38-04. [DONE 2026-05-20: km-core commit 1094046; 1 file modified (src/store/GraphKMStore.ts 519→575); all 4 Phase 37 NO-CHANGE invariants verified by grep+awk gates; all 33 Phase 37 vitest tests still pass — zero regression; Plan 38-06 unblocked]
- [x] 38-06-PLAN.md — Registry unit tests (`tests/unit/ontology-registry.test.ts`, 6 describe-blocks covering all 4 SCs) + 2 append-only tests in `tests/unit/graph-store.test.ts` (ontologyDir auto-wiring + skipOntologyCheck BC-2 preservation). depends_on: 38-02, 38-03, 38-05. [DONE 2026-05-20: km-core commits d624212 + b343a3b; 1 file created (581 lines, 21 tests) + 1 file modified (217→269 lines, 11→13 tests); final suite 7 files / 56 tests / 56 passed (33 Phase 37 baseline + 23 new); all 4 SCs verified by test-name mapping; D-27 collision warning text grep-asserted VERBATIM; all 11 Phase 37 protected graph-store names preserved; FLAG-2 OR-precedence neutralized; Phase 38 COMPLETE — ready for /gsd:verify-phase 38]

#### Phase 39: Entity Data Model

**Goal:** Lock the canonical KM-Core entity shape with first-class temporal validity (`validFrom`, `validUntil`, `supersedes`) and structured provenance (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment provenance) before B and C migrate, so neither has to backfill twice.

**Depends on:** Phase 37
**Requirements:** DATA-01, DATA-02
**Success Criteria** (what must be TRUE):

  1. Every KM-Core entity surfaces `validFrom`, `validUntil`, and `supersedes` fields, and an entity superseded by another is reachable via the supersedes chain from query API.
  2. Every KM-Core entity surfaces `createdBy`, `lastConfirmedBy`, `confirmationCount`, and per-segment provenance fields, populated by the writer rather than computed downstream.
  3. The B `KGEntity`/`SharedMemoryEntity` (`type`/`entityType` split, `persistence-agent.ts:583`) is replaced by the canonical KM-Core entity in the shared types; no consumer compiles against the old dual shape.
  4. A backfill operation can stamp `validFrom = createdAt` (A) or `validFrom = first-seen` (B) on legacy entities without losing existing observations or relations.

**Plans:** 4/4 plans complete

Plans:

**Wave 1 (parallel — disjoint files)**

- [x] 39-01-PLAN.md — Extend `GraphKMStore.putEntity` with writer-side stamping (D-30/D-31/D-32 + `PutEntityOpts` type + JSDoc tightening on `entity.ts`) — closes DATA-02 writer half (`createdBy`/`lastConfirmedBy`/`confirmationCount`)
- [x] 39-02-PLAN.md — `mergeDescriptionSegment` pure helper in `src/segments/merge.ts` (D-39/D-40/D-41 — whitespace-normalized identical-text test, stderr-warn at 100-segments/50-confirmations thresholds) — closes DATA-02 per-segment-provenance half

**Wave 2** *(depends on Plan 01 — both touch GraphKMStore.ts)*

- [x] 39-03-PLAN.md — Atomic supersession closure (D-33) + active-only default filter (D-34) + `getSupersessionChain` reverse-walk query API (D-35) — closes DATA-01 + ROADMAP SC#1

**Wave 3** *(depends on Plans 01 + 03 — provenance writer + iterate opt-in)*

- [x] 39-04-PLAN.md — `backfillEntityDataModel` library function (D-36/D-37/D-38) + atomic checkpoint helper + path-traversal guard — closes ROADMAP SC#4

**SC#3 note:** `SharedMemoryEntity` replacement is Phase 42 (INT-02) — Phase 39 only verifies the canonical Entity is expressive enough.

#### Phase 40: Ingest Pipeline & Layered Dedup

**Goal:** Define the 4-stage ingest-time consolidation framework (`extract → dedup → store → synthesize`) and the layered dedup pipeline (exact-name → embedding cosine → LLM semantic) in KM-Core, exposing pluggable stage hooks so A's digest/insight roll-up and B's wave-agents can both implement against the shared abstraction without code duplication.

**Depends on:** Phase 38, Phase 39
**Requirements:** PIPE-01, DEDUP-01
**Success Criteria** (what must be TRUE):

  1. A developer can wire a new ingest adapter into KM-Core by implementing the four named stage interfaces and registering it — no fork of the pipeline code required.
  2. Running the layered dedup pipeline on a synthetic batch with a known exact-name collision, a known embedding-cosine collision, and a known LLM-semantic collision catches all three at the correct layer in order.
  3. A user can choose which stages execute on what cadence per system (per ingest / per wave / cron) via configuration, with the framework enforcing the four-stage order.
  4. The shared dedup pipeline reuses B's existing fuzzy-name Jaccard logic and A's embedding-cosine logic as plug-in implementations of the respective layers — no duplicated dedup code remains across A/B/C.

**Plans:** 12/12 plans complete

Plans:

**Wave 1 (foundation — types + test scaffolding; unblocks 3-way parallelism in Wave 2)**

- [x] 40-01-PLAN.md — Pipeline + dedup public type surfaces (`src/pipeline/types.ts`, `src/dedup/types.ts`) + **universal** test fakes only (`tests/unit/_helpers/fakes.ts` — mkEntity / makeFakeExtractor / makeFakeSynthesizer / makeLayerStub / PROV). Client-specific fakes (EmbeddingClient + LLMClient) ship co-located with their matchers in Plans 40-03 / 40-04 per Warning #4 fix. PIPE-01 + DEDUP-01 type contracts; downstream layer ports compile against these.

**Wave 2 (parallel — 3 disjoint layer ports)**

- [x] 40-02-PLAN.md — `JaccardNameMatcher` — verbatim port of B's `calculateStringSimilarity` (deduplication.ts:436-445) + 7 unit tests. Default threshold 0.85. DEDUP-01 layer 1/3.
- [x] 40-03-PLAN.md — `CosineEmbeddingMatcher` + `EmbeddingClient` caller-injected interface + co-located `tests/unit/_helpers/fakes-embedding.ts` (Warning #4 fix) — verbatim port of A's `cosine()` (dedup-insights-by-embedding.js:56-64) + 7 unit tests. Default threshold 0.90. DEDUP-01 layer 2/3.
- [x] 40-04-PLAN.md — `LLMSemanticMatcher` + `LLMClient` caller-injected interface + co-located `tests/unit/_helpers/fakes-llm.ts` (Warning #4 fix) — verbatim port of OKM's `batchLLMDedup` prompt + 5-stage JSON unwrap (deduplicator.ts:421-475) + 9 unit tests. Default threshold 0.70, onError 'skip'. DEDUP-01 layer 3/3.

**Wave 3 (orchestrator depends on the 3 layers)**

- [x] 40-05-PLAN.md — `LayeredDeduplicator` — wraps the 3 layer slots with short-circuit-on-first-match (D-44); Pitfall 1 defensive guard for entities without ontologyClass/entityType; 9 unit tests including 6 RESEARCH-named contracts. DEDUP-01 orchestrator.

**Wave 4 (pipeline class + unit tests — IngestPipeline source on disk)**

- [x] 40-06a-PLAN.md — `IngestPipeline` 4-stage orchestrator class (extract → dedup → store → synthesize) + 10 unit tests (VALIDATION rows 40-T11..40-T18 + 2 extras). Pre-loads candidates via `store.findByOntologyClass` per D-46; threads `ProvenanceStamp` per CF-D30; supersession via Phase 39 `putEntity` (preserves CR-01 BatchOp.skipOntologyCheck). `runStage` declared as **4 typed function overloads** (LOCKED by RESEARCH Q2 RESOLVED — NOT a generic `<T>`). Synthesizer-input contract: matched-survivors-only per RESEARCH Example 5 line 646 verbatim. PIPE-01.

**Wave 4b (integration tests — sequential after 40-06a, depends on IngestPipeline class)**

- [x] 40-06b-PLAN.md — 3 integration test files exercising the cross-module boundaries: `pipeline-supersession.test.ts` (4 tests — Phase 39 D-33 atomic closure + CR-01 legacy-id path; VALIDATION rows 40-T20, 40-T21), `pipeline-candidate-pool.test.ts` (4 tests — D-46 + Phase 39 D-34 active-only filter; VALIDATION row 40-T22), `layered-dedup-collision-catch.test.ts` (1 test — **ROADMAP SC#2 synthetic 3-collision** with `llmClient.complete.mock.calls.length === 1` proving short-circuit through both upper layers; VALIDATION row 40-T19). PIPE-01 + DEDUP-01. No source-file changes — exercises 40-06a's IngestPipeline through real GraphKMStore instances.

**Wave 5 (barrel + final green gate)**

- [x] 40-07-PLAN.md — Amend `src/dedup/types.ts` with `EmbeddingClient` + `LLMClient` re-exports; create `src/pipeline/index.ts` + `src/dedup/index.ts` sub-barrels; append Phase 40 block to root `src/index.ts`; extend `package.json` exports map with `./pipeline` + `./dedup` sub-paths (mirrors Phase 38 `./ontology` precedent); external tmpdir smoke compile across root barrel + both sub-paths; final `npm run build` + `npm test` green gate. **depends_on:** 40-06b (not 40-06). PIPE-01 + DEDUP-01.

**Gap closure (from 40-VERIFICATION.md — 4 BLOCKERS + SC#1 human-verification, 4 plans):**

**Wave 7 (parallel — file-disjoint)**

- [x] 40-08-PLAN.md — CR-01 + CR-04 fix in `~/Agentic/km-core/src/pipeline/IngestPipeline.ts`. CR-01: hoist Pitfall-1 guard into the pipeline so `findByOntologyClass(undefined)` can never be called. CR-04: widen `runStage('extract')` overload to drop misleading `provenance` requirement + thread `opts?.domain` to `extractor.extract`. 2 new RED→GREEN unit tests. PIPE-01.
- [x] 40-09-PLAN.md — CR-02 fix across all 3 matchers (`JaccardNameMatcher.ts:53`, `CosineEmbeddingMatcher.ts:123`, `LLMSemanticMatcher.ts:132`). Remove the dead-on-happy-path + wrong-on-legacy-id-re-extraction self-id guard. 3 new RED→GREEN unit tests (one per matcher). DEDUP-01.
- [x] 40-11-PLAN.md — SC#1 closure: write `~/Agentic/km-core/examples/custom-adapter.ts` (~80-100 lines) demonstrating all 4 stage interfaces wired through the public-API barrel (no relative imports into `src/`). Companion integration test asserts the example compiles + runs end-to-end with `extractedCount > 0`. PIPE-01 + DEDUP-01. **depends_on:** 40-07.

**Wave 8 (sequential after 40-09 — same file: LLMSemanticMatcher.ts)**

- [x] 40-10-PLAN.md — CR-03 + WR-08 bundle in `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts`. Introduce typed `LLMDedupParseError` (with `raw` + `cause` fields, `instanceof`-discriminable from `SyntaxError`). Rewrite `parseDedupResponse` as candidate-list-of-tries (REVIEW.md offset 311-340 recipe) so the bare-brace stage gets a fair shot when the fence stage matches-but-emits-garbage. Graceful no-match fallback when all 4 candidates fail to parse. 3 new RED→GREEN unit tests. Plan 04 invariants (OOM verbatim, defaults) preserved. DEDUP-01.

**Phase boundary:** All algorithm code lives in `~/Agentic/km-core/`. Co-exist mode (D-45) — A's `ObservationConsolidator` and B's `WaveController` are NOT modified by Phase 40. Phase 41 (INT-01) migrates A; Phase 42 (INT-02) migrates B; full SC#4 discharge at end of Phase 42 when B's local Jaccard copy is deleted.

#### Phase 41: Online Learning Adapter & Post-Hoc Resolution

**Goal:** Land INT-01 — A's SQLite hot path stays on its existing transactional writes but exposes observations / digests / insights as KM-Core entities via a thin adapter — and ship PIPE-02 (post-hoc cross-class entity resolution) as a shared KM-Core maintenance operation that scans the graph by `ontologyClass` and LLM-merges duplicates that escaped per-batch dedup.

**Depends on:** Phase 40
**Requirements:** INT-01, PIPE-02
**Success Criteria** (what must be TRUE):

  1. A user can query A's observations / digests / insights through the KM-Core entity API and get the same content currently served by `/api/observations|digests|insights`, typed as ontology classes.
  2. A's SQLite hot write path remains unchanged — ETM writes still complete at the same latency and the cold-store JSON export contract is preserved.
  3. Triggering the post-hoc resolve-entities maintenance operation on a graph containing known cross-batch duplicates of a single ontology class collapses them into one canonical entity with merged provenance.
  4. The same post-hoc resolution API endpoint is callable against A's adapter-fronted graph (proving the operation works on KM-Core regardless of whether the underlying store is graph-native or SQLite-fronted).

**Plans:** 7/7 plans complete

Plans:

**Wave 1 (parallel — disjoint files; no inter-plan dependencies)**

- [x] 41-01-PLAN.md — Land `/Users/Q284340/Agentic/km-core/ontology/upper.json` + `learning-artifacts.json` (LearningArtifact upper + Observation/Digest/Insight lowers via `extends`); auto-discovery + extends-chain unit tests (INT-01 + PIPE-02 — class scan default branch depends on these classes)
- [x] 41-02-PLAN.md — Pure mapper functions in `src/adapters/online/mapper.ts` (`mapObservationRow`/`mapDigestRow`/`mapInsightRow`) + fixture export rows + null-handling unit tests; top-level `entity.legacyId = { system: 'A', id }` per Phase 39 CF-D37 canonical placement + `entity.metadata.subsystem = 'online'` as separate discriminator (INT-01)
- [x] 41-03-PLAN.md — Add `GraphKMStore.getDegree(id): Promise<number>` public method + 3 unit tests pinning literal degree values; survivor-selection support for PIPE-02 (PIPE-02)
- [x] 41-05-PLAN.md — `mergeEntities(store, survivorId, duplicateIds, opts)` atomic primitive + 11 unit tests (atomic merge + self-loop + edge-type + WR-02 + segment fold + resolutionHistory + edge-dedupe-by-identity-key) (PIPE-02). Uses Phase 37/39 primitives only — no Phase 41 prerequisites; Plan 06 consumes this in Wave 3.

**Wave 2** *(depends on Wave 1 — 41-04 depends_on 41-02 for mapper imports)*

- [x] 41-04-PLAN.md — `reprojectFromOnlineStore(store, opts)` library function + atomic checkpoint utility + adapter sub-barrel + 11 unit tests (idempotency via TOP-LEVEL legacyId scan + dryRun + resume + path-traversal + missing-dir-warning + provenance + canonical top-level legacyId + aggregation-edges + orphan-edge-warning + sources.sqlite-throw + sources.jsonExports-required-throw) (INT-01) — *depends_on: 41-02*

**Wave 3** *(depends on 41-03 + 41-04 + 41-05)*

- [x] 41-06-PLAN.md — `resolveEntities(store, opts)` per-class LLM-scan orchestrator + maintenance sub-barrel + package.json `./maintenance` + `./adapters/online` exports + root barrel Phase 41 block + 11 unit tests (incl. parentChainOf-by-name default-class resolution + unmatchable-matchedTo + deterministic lex-id tie-break on name+description collisions) + external smoke-compile (PIPE-02 + INT-01)

**Wave 4** *(depends on 41-06; autonomous: false — has human-verify checkpoint)*

- [x] 41-07-PLAN.md — `coding/scripts/reproject-online.mjs` operator CLI + km-core end-to-end integration test (`reproject → resolveEntities(dryRun) → real merge`) covering all 4 ROADMAP SCs + human-verify checkpoint against live `.data/observation-export/` (requires `npx tsc` exit-0 in km-core before script runs) (INT-01 + PIPE-02)

#### Phase 42: Offline UKB Migration (B)

**Goal:** Migrate B (the Offline UKB wave-analysis pipeline in `integrations/mcp-server-semantic-analysis`) to KM-Core while simultaneously fixing the long-running **Phase 10 embeddings-not-reaching-GraphDB issue** and the **`workflow-runner.ts:469–530` wave-analysis race condition** so the migration also discharges two carry-forward bugs flagged in active memory.

**Depends on:** Phase 40
**Requirements:** INT-02
**Success Criteria** (what must be TRUE):

  1. Running `ukb full` end-to-end produces a KM-Core-shaped knowledge graph (canonical entity, ontology registry, layered dedup, temporal validity) with the existing MCP interface unchanged.
  2. After a `wave-analysis` run completes, every persisted KG entity has its embedding present in the GraphDB (the Phase 10 issue no longer reproduces).
  3. The `workflow-runner.ts:469–530` race condition no longer fires "Race condition detected (0/0 steps) but no valid cache available" in Docker logs, and the dashboard reflects the workflow's true terminal state instead of staying "running" after completion.
  4. Wave-controller progress updates and KM-Core writes never deadlock or clobber each other — the dashboard's wave-stage view stays consistent with `.data/workflow-progress.json` throughout the run.
  5. B's existing component-manifest works unchanged as a lower ontology against KM-Core's `OntologyRegistry`.

**Plans:** 6/7 plans executed

Plans:

**Wave 1 (parallel — disjoint files/repos)**

- [x] 42-01-PLAN.md — km-core GraphKMStore strangler adapter + feature flag (`KM_CORE_PERSISTENCE`); rewire wave-controller.ts:1373 bypass write through the new adapter's `mergeAttributes`. Phase 10 fix lands here (SC#2 anchor).
- [x] 42-02-PLAN.md — Race condition fix: coordinator.writeProgressFile gains field-preserving merge for the state-machine subscriber's allowlist (`stepPaused`, `mockLLM`, `singleStepMode`, etc.) — SC#3 discharged (0 race-condition warnings post-run); SC#4 escalated to Plan 7 (terminal-state defect is the workflow-runner-exits-early issue, requires fix #1 single-writer refactor).
- [x] 42-03-PLAN.md — Ontology subsystem migration: flatten `.data/ontologies/` (8 JSONs to root); replace B's OntologyManager with km-core's OntologyRegistry; preserve OntologyClassifier/Validator/QueryEngine (D-53). SC#5 anchor.
- [x] 42-04-PLAN.md — **CROSS-REPO (km-core)** — add `embedding?: number[]` to Entity (D-52); land `syncQdrantFromStore` maintenance op (D-52a); land `FastembedEmbeddingClient` default + new `./embeddings` sub-path (D-52c).

**Wave 2** *(depends on 42-01)*

- [x] 42-05-PLAN.md — One-shot D-54 LevelDB migration script (`scripts/migrate-leveldb-to-kmcore.mjs`): idempotent in-place rewrite of `.data/knowledge-graph/` entities to canonical km-core Entity shape (top-level legacyId, ontologyClass, layer='evidence', descriptionSegments, provenance stamping). Includes 10 integration tests covering property-based invariants + idempotency + error budget.

**Wave 3** *(depends on 42-01 + 42-04 + 42-05)*

- [x] 42-06-PLAN.md — Wave-controller + wave1/wave2/wave3 agents + kg-operators emit canonical km-core Entity shape via new `canonical-mapper.ts` helper. `persistWaveResult` flag-gated to route through km-core adapter. `deduplication.ts:342 mergeEntityGroup` DELETED in favor of km-core `mergeEntities` (D-50a).

**Wave 4** *(depends on all prior; autonomous: false — has human-verify checkpoint)*

- [ ] 42-07-PLAN.md — Final cleanup + goal-backward verification gate. Atomic dir-swap of migrated LevelDB; DELETE GraphDatabaseService.js + KnowledgeStorageService.js + QdrantSyncService.js + persistence-agent.ts + graph-database-adapter.ts + persistence-flag.ts; remove KM_CORE_PERSISTENCE flag; rewire content-validation-agent.ts. Production wave-analysis workflow run + `syncQdrantFromStore` rebuild + SC#1-5 verification script + human-verify operator gate.

### Phase 42.2: Retire deferred 42-07 work: legacy persistence trio + atomic LevelDB dir-swap + canonical-emit gaps (LLM process attribution + team/project linkage in canonical-mapper) (INSERTED)

**Goal:** Land the four explicit deferred-work blocks recorded in 42-07-SUMMARY so Phase 42 can finally be marked COMPLETE — (1) canonical-emit gap fix (team + process attribution per D-Emit forensics), (2) full QdrantSync retirement routing through km-core syncQdrantFromStore, (3) legacy persistence trio retirement (persistence-agent.ts + graph-database-adapter.ts + GraphDatabaseService.js) with ~30 consumer rewires in coordinator.ts/tools.ts/content-validation-agent.ts, (4) atomic LevelDB dir-swap collapsing the two-store era, capped by the SC#1-6 verification gate (5 from Phase 42 ROADMAP + SC#6 orphan-count from Phase 42.1).
**Requirements**: none (decision-coverage gate against CONTEXT.md `<decisions>` — D-Wave, D-Qdrant, D-DirSwap, D-Emit)
**Depends on:** Phase 42
**Plans:** 6/6 plans complete

Plans:

**Wave 0 (forensics-discovery — sequential)**

- [x] 42.2-01-PLAN.md — Forensics pass over canonical-mapper emit paths + LLMService dispatch sites + 802-entity team-field audit; outputs .planning/forensics/report-42.2-00-canonical-emit.md with binary RE-MIGRATION REQUIRED/NOT REQUIRED verdict. BLOCKS Plan 02.

**Wave 1 (parallel — disjoint files)**

- [x] 42.2-02-PLAN.md — Canonical-emit gap fix (depends on 42.2-01): extend CanonicalMapperOptions with team?; thread metadata.team in toCanonicalEntity; thread process:'wave-analysis-{wave-N}' into LLMService calls in wave1/wave2/wave3 agents; submodule + outer-repo pointer-bump commit pair. Optional one-shot 802-entity augmentation script if forensics demands.
- [x] 42.2-03-PLAN.md — QdrantSync retirement (no dependency — fully parallel): rewrite scripts/sync-graph-to-qdrant.js to call km-core syncQdrantFromStore; delete QdrantSyncService field+init+shutdown from src/databases/DatabaseManager.js; delete src/knowledge-management/QdrantSyncService.js; monorepo grep-gate clean.

**Wave 2 (parallel — depends on Wave 1)**

- [x] 42.2-04-PLAN.md — Legacy persistence trio retirement (depends on 42.2-02 + 42.2-03). DONE 2026-05-25. Deleted persistence-agent.ts + graph-database-adapter.ts (real-subdir submodule deletions in commit a27aac6) + GraphDatabaseService.js + GraphDatabaseService.d.ts (symlinked-subdir outer-repo deletions in commit 8bfee7faf). Rewired ~30 consumer call sites in coordinator.ts + tools.ts + content-validation-agent.ts to km-core-adapter. Rule 1 scope expansion: also rewired wave-controller.ts (legacy GraphDatabaseAdapter import + 3 graphDB.* call sites — not in plan's <interfaces> block but caught by grep gate); type-only imports moved to new src/types/shared-memory-types.ts. Rule 3 scope expansions: DatabaseManager.initializeGraphDB() reduced to no-op stub; GraphKnowledgeExporter.js JSDoc rephrased; 2 orphan integration tests at submodule root deleted. New helpers in src/storage/legacy-consumer-helpers.ts (saveSuccessfulWorkflowCompletion / linkInsightDocuments / cleanupEntityFiles / exportKnowledgeToJSON). km-core-adapter extended with initialize/close/renameEntity/updateEntityObservations. ContentValidationAgent.setKmCoreAdapter collapses legacy setter pair. DeduplicationAgent.registerAgent retired without replacement. Full submodule test suite 80/80 GREEN before AND after deletion. Live-code grep gate clean. Known residual (out of scope; follow-up housekeeping): 8 orphan operator test scripts under scripts/ + 5 sibling files in src/knowledge-management/.
- [x] 42.2-05-PLAN.md — Atomic LevelDB dir-swap (depends on 42.2-04; autonomous: false): D-DirSwap recipe — stop container → cp -R .data/knowledge-graph .bak → verify migrated dir health (>=802 entities + 5 spot-checks) → OPERATOR GATE → mv pair (knowledge-graph → .bak.old; knowledge-graph-migrated → knowledge-graph) → revert wave-controller.ts:507 dbPath → restart → sanity probe. Both backups retained pending Wave 3 PASS.

**Wave 3 (autonomous: false — depends on all prior)**

- [x] 42.2-06-PLAN.md — SC#1-6 end-to-end verification gate (depends on 42.2-02 + 42.2-03 + 42.2-04 + 42.2-05): production `ukb full` against the post-everything state + Qdrant rebuild via the Plan 03 CLI + run verify-knowledge-graph-store.mjs (renamed from 42-07-end-to-end-verify.mjs in this plan) + OPERATOR GATE for dashboard eyeballing (token-usage process column non-unknown; metadata.team present on new entities; dedup/merge fired). Closes Phase 42 + Phase 42.2 in STATE.md + ROADMAP.md. (completed 2026-05-25)

#### Phase 42.1: UKB Project-Anchor Parity

**Goal:** Restore the project-anchor `contains`-edge pass that Phase 42-07 Phase B1 inadvertently removed from B's wave-analysis persist path so newly-emitted wave entities are no longer orphaned from the `Coding` Project anchor. Forensic 2026-05-24 root cause: Phase 42-07 Phase B1 replaced `persistence-agent.persistEntities()` with `persistWithKmCore` in `wave-controller.ts`, dropping the legacy `findBestParent` lookup + post-sweep `contains`-relation insertion that ran after every batch. Online (`ObservationConsolidator._ensureProjectAnchor`) and legacy (`persistence-agent.findBestParent` at L1043-1110) persist paths both still attach new entities to the project root; only the km-core wave path doesn't. Empirical evidence from the 2026-05-24 overnight `ukb full`: +64 entities, +1 relation, **0 new edges to the Coding project anchor**.

**Depends on:** Phase 42
**Requirements:** INT-02 (continuation — closes a deliverable gap in Phase 42's INT-02 success criterion)
**Success Criteria** (what must be TRUE):

  1. After a fresh `ukb full` completes, every newly-persisted km-core entity whose `entityType ∉ {Project, System}` and that did not arrive with an incoming `contains`/`parent-child` relation has at least one incoming `contains` edge from either a matching Component/SubComponent or from the `Coding` Project root.
  2. The `Coding` Project entity exists in the km-core store before the relation sweep runs (mint if absent — idempotent cold-start semantics matching the online path's `_ensureProjectAnchor`).
  3. The `findBestParent` longest-match heuristic from `persistence-agent.ts:1043-1071` is preserved in behavior: prefer SubComponent over Component over project root, longest substring match wins, falls back to `Coding` when no Component/SubComponent matches the new entity's name.
  4. The anchor pass is idempotent: re-running `ukb full` on the same store does not duplicate `contains` edges; existing parent relations are detected and skipped.
  5. The anchor pass is fail-soft: a single failed `storeRelationship` call increments a counter and emits one stderr line but does not abort the persist sweep — matching the existing `persistWithKmCore` pattern (T-42-06-03 mitigation precedent).
  6. The `42-07-end-to-end-verify.mjs` verifier (already in tree from Phase 42-07) reports `0 orphan entities` after a fresh `ukb full`, where "orphan" is defined as an entity with `entityType ∉ {Project, System}` that has no incoming `contains` edge.

**Out of scope for this phase** (deferred to follow-up phases):

  - Field-name reconciliation (`metadata.team` vs `metadata.domain` — the Exporter bucketing issue). Tracked separately.
  - LLM proxy attribution fix (`proxy-provider.ts` doesn't forward `agentId` → process column shows `'unknown'`). Touches the `_work/rapid-llm-proxy` repo; deferred to its own phase.
  - Legacy persistence trio retirement (Phase 42-07 deferral).
  - Atomic LevelDB dir-swap (Phase 42-07 deferral).
  - 802-entity back-fill for existing migrated entities (separate one-shot script — does not block this phase).

**Plans:** 1 plan

Plans:

- [ ] 42.1-01-PLAN.md — Restore findBestParent + ensureProjectAnchor + post-sweep contains-edge pass in wave-controller.persistWithKmCore; extend SC verifier with SC#6 orphan check; rebuild Docker + validate via production wave-analysis workflow.

### Phase 42.1.1: Ontology layout resolution — registry empty because loader expects .data/ontologies/{upper,lower}/ subdirs but files live flat at .data/ontologies/. Blocks 42.1 SC#6 + Phase 40 dedup. Forensic: .planning/forensics/report-20260524-130355.md (INSERTED)

**Goal:** Resolve the empty-ontology-registry blocker (Phase 42.1 SC#6 root cause) by adding a loader-side path-resolution layer (`src/ontology/ontologyPathResolver.ts`) that lets `OntologyConfigManager` find ontology JSONs under BOTH the legacy two-tier layout (`.data/ontologies/{upper,lower}/<file>.json`) AND the current flat layout (`.data/ontologies/<file>.json` + `.data/ontologies/upper.json` alias). No file moves; no caller path-construction changes. Path (a) per the forensic report.
**Requirements**: none (decision-coverage gate against CONTEXT.md `<decisions>`)
**Depends on:** Phase 42.1
**Plans:** 1/1 plans complete

Plans:

- [x] 42.1.1-01-PLAN.md — Implement ontologyPathResolver helper + unit tests; wire OntologyConfigManager.validatePaths() + injectOntology() through resolver + add integration test against real `.data/ontologies/` flat layout; public re-export + regression sweep. **COMPLETE 2026-05-24** (commits 6bde70ba0 + 6933264ed + ef9a4e9bd + e341152a8 + 00c6ca154; 18/18 node:test cases pass; layer-1 of SC#6 root cause unblocked; NEW known residual — Project class not on disk, layer-2 follow-up tracked separately. See 42.1.1-01-SUMMARY.md.)

### Phase 42.1.2: Register Project ontology class — surfaced by 42.1.1 Test C; ensureProjectAnchor('Coding') still throws "Unknown ontology class: Project" because Project is not declared in any on-disk JSON. Closes layer-2 of SC#6 root cause. (INSERTED)

**Goal:** Add a `Project` class definition to the on-disk ontology so that `km-core` `OntologyRegistry.isValidClass('Project')` returns `true` after `OntologyConfigManager.initialize()`. This unblocks `ensureProjectAnchor('Coding')` at runtime and closes the layer-2 follow-up identified by Phase 42.1.1 Test C (see 42.1.1-01-SUMMARY.md § Known Residuals + 42.1.1-VERIFICATION.md). Scope is strictly the ontology JSON change + a smoke test that proves `ensureProjectAnchor('Coding')` no longer throws; Phase 42.1 SC#6 wave-analysis re-run remains owned by Phase 42.1's verifier.
**Requirements**: none (decision-coverage gate against CONTEXT.md `<decisions>`)
**Depends on:** Phase 42.1.1
**Plans:** 3/3 plans complete

Plans:

- [x] 42.1.2-01-PLAN.md — Insert `Project` class block into `.data/ontologies/upper.json` (anchor-only, `name` required + `repoRoot` optional, `relationships: {}` — locked shape per CONTEXT.md).
- [x] 42.1.2-02-PLAN.md — Upgrade Test C in `OntologyConfigManager.layout.test.ts` to assert `registry.isValidClass('Project') === true` per team across the existing `TEAMS` literal (closes the Phase 42.1.1 Option-A residual). **COMPLETE 2026-05-25** (commit 3fee3a5f3; 5/5 layout tests pass, 14/14 sibling regression tests pass, grep gate emits "OK: 7 teams logged Project=valid". See 42.1.2-02-SUMMARY.md.)
- [x] 42.1.2-03-PLAN.md — Add integration smoke `wave-controller-ensure-project-anchor.test.ts` covering cold path (one storeEntity call with `{ name: 'Coding', entityType: 'Project', ontologyClass: 'Project', team: 'coding' }`), warm path (no storeEntity), and idempotency (two calls = one mint). **COMPLETE 2026-05-25** (submodule commit 7f71c8f + outer-repo pointer-bump 1577f1367; 3/3 integration smoke tests pass, 19/19 sibling regression tests pass; production `wave-controller.ts` byte-identical. Phase ready for `/gsd-verify-phase 42.1.2`. See 42.1.2-03-SUMMARY.md.)

#### Phase 43: OKM Cross-Repo Migration (C)

**Goal:** Execute the cross-repo refactor that migrates C (`~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management`) onto KM-Core; this is a **separate repository** with its own CI, release cycle, and packaging story, so success means landing KM-Core in OKM via the agreed packaging strategy without breaking rapid-automations' green build.

**Depends on:** Phase 40
**Requirements:** INT-03
**Success Criteria** (what must be TRUE):

  1. The `rapid-automations` CI pipeline is green on the migration branch and on `main` after merge.
  2. OKM consumes KM-Core via the agreed packaging strategy (decided during this phase's discuss phase — submodule, npm package, or vendored copy) without copying or forking KM-Core source.
  3. Existing OKM REST consumers (VOKB viewer, `/api/entities`, `/api/relations`, `/api/search`, `/api/clusters`, `/api/rca-lookup`) continue to return the same shape they did before migration.
  4. OKM's per-domain JSON exports under `.data/exports/{domain}.json` continue to land with the same commit hygiene as before the migration.

**Plans:** 7/11 plans executed

Plans:

**Wave 1 (parallel — no inter-plan dependencies)**

- [x] 43-01-PLAN.md — km-core schema pre-req (D-G4.2 layer-field verification + OntologyRegistry accessor parity audit + version tag) — independent km-core repo
- [x] 43-02-PLAN.md — OKM packaging: add lib/km-core submodule (HTTPS, public) + scripts/repack-km-core.sh helper (D-G1.1, D-G1.2, D-G1.4) — OKM
- [x] 43-03-PLAN.md — Delete vestigial @fwornle/km-core dep from rapid-automations root package.json (D-G1.3) — rapid-automations root

**Wave 2** *(blocked on 43-01 + 43-02)*

- [x] 43-04-PLAN.md — OntologyRegistry unification: swap every OKM consumer to import from @fwornle/km-core/ontology (D-G2.2) — OKM
- [x] 43-05-PLAN.md — Route /api/cleanup/resolve-entities to km-core; delete local resolveEntities methods; revert /api/km mount (D-G2.3, D-G2.4) — OKM
- [x] 43-06-PLAN.md — Pre-cutover REST fixtures + Zod contract tests (D-G5.1 part 1, SC#3) — OKM

**Wave 3** *(blocked on Waves 1+2)*

- [x] 43-07-PLAN.md — JSON-replay one-shot migration script; populate .data/leveldb-kmcore/ from .data/exports/{general,kpifw,raas}.json with legacyId.system=C stamping (D-G4.1, D-G4.3) — OKM

**Wave 4** *(blocked on 43-07; final-cleanup mirroring Phase 42 Plan 7)*

- [~] 43-08-PLAN.md — Storage cutover: atomic LevelDB swap + delete legacy backend + IGraphStore + adapter + flag + refactor every consumer to await km-core async API + cleanup grep gate (D-G3.1, D-G3.2) — OKM [autonomous: false; human-verify checkpoint] — PARTIAL: re-scoped into 43-08b/c-i/d + 43-08e-i/ii (all landed) + 43-08f (pending operator checkpoint). See 43-08-SUMMARY.md and 43-08e-SUMMARY.md.
  - [x] 43-08b — Bootstrap + intelligence cutover (`48bcdf6`, D-G3.2): pipeline + 7 intelligence modules + server + index + new src/lib/snapshot.ts; tsc 69→50
  - [x] 43-08c-i — Deduplicator cascade + pipeline shim removal (`c49a588`, D-G3.3); tsc 51→51 (clean ingestion path)
  - [x] 43-08d — Routes + server rewire via event-coherent adapter (`1db976d`, D-G3.4); tsc 51→0. PR #2 on bmw.ghe.com.
  - [x] 43-08e-i — Adapter deletion + 38 sync route handlers → async via 18 store* helpers; edge-key codec (base64url tuple); UUIDv7 minting in createEntity (km-core CORE-03); 9 source-file deletions (`21e6df1`, D-G3.5 src/ checkpoint); tsc 0; grep gate green
  - [x] 43-08e-ii — Test suite ported to km-core: fixture + 4 unit + 2 integration tests on GraphKMStore; 3 obsolete tests deleted (`49b0135`, D-G3.5 test checkpoint); 371/373 passing (was 323/325). PR #3 on bmw.ghe.com stacked on PR #2. Deferred: 13 tests inheriting pre-existing src/llm/* phantom imports (see 43-08e-SUMMARY.md).
  - [ ] 43-08f — Operator cutover checkpoint: atomic dir swap (.data/leveldb ↔ .data/leveldb-kmcore), OKM restart, /api/health + /api/stats smoke, Plan 06 rest-contract.test.ts pass (D-G5.1 SC#3) [autonomous: false; human-verify checkpoint]
- [~] 43-09-PLAN.md — Full re-embed pass with fastembed/all-MiniLM-L6-v2/384-dim; inline embedding storage (D-G7.1, D-G7.2) — OKM — PARTIAL: script + 4-case integration test landed (OKM `2840196` + `23ebcd4`, rapid-automations `2877e12`); production re-embed deferred to operator per execution-time scope clarification (runbook in 43-09-SUMMARY § "Operator Runbook"). 1665 entities verified ready via dry-run. All 4 tests pass in 2.4s warm.

**Wave 5** *(blocked on Waves 1-4)*

- [x] 43-10a-PLAN.md — TEST-ONLY src/store/ + src/llm/ + src/ontology/ shims restored (the "test suite restore" follow-up deferred at 43-08e SUMMARY line 159); createServer overload accepts pre-08e 8-arg shape via `_internalStore` duck-type detection; the four legacy tests (rest-contract / api-ingest / ingestion-pipeline / deduplicator) flip from FAIL → PASS; whole-suite failure count 13 → 3 — OKM `4dabb4c` + rapid-automations `098ff84` (pushes deferred to Plan 11). Unblocks Plan 10 Gates 1 (REST byte-equal lock) + 2 (verify-post-migration.mjs bootstrap path).
- [x] 43-10-PLAN.md — Post-cutover REST verification (3-gate D-G5.1 — Zod + byte-diff + VOKB viewer smoke); D-G6.1 bug-fix-only viewer edits allowed (SC#3, SC#4) — OKM [autonomous: false; human-verify checkpoint] ✓ 2026-06-02: Gate 1 9/10 (1 louvain flake, 10/10 in isolation); Gate 2 10/10 zero diff; Gate 3 4/4 PASS via gsd-browser visual smoke; NO viewer fixes needed. SC#4 path-corrected to .data/leveldb.exports/. OKM f451295 + rapid-automations d74812c. Includes 43-10a (TEST-ONLY shim restoration to unblock Gates 1+2; OKM 4dabb4c + rapid-automations 098ff84) inserted inline after the first execution pass surfaced Plan 08e's bootstrap deletion as a blocker.
- [x] 43-11-PLAN.md — Push to bmw.ghe.com (both repos via HTTPS) + watch rapid-automations CI for GREEN (SC#1 close) + Phase 43 final sign-off — OKM + rapid-automations [autonomous: false; two human checkpoints] ✓ 2026-06-02: OKM branch pushed + PR #4 opened/merged (4 commits incremental + 11 already on remote = 15 D-G commits trail); merge commit 34a0fc5; rapid-automations main pushed twice (d74812c + post-merge bump 0ce459c) with CI green 30s each; coding planning pushed via HTTPS (SSH proxy 502 fallback); all 4 Wiz security scanners passed on OKM PR; backup cleanup deferred to 2026-06-03 (24h soak).

#### Phase 44: REST API & Git Snapshots

**Goal:** Land the common REST contract (entity CRUD, search, clusters, snapshots, ontology metadata) and the git-snapshot/restore pattern over `.data/exports/` so all three systems expose the same query surface — necessary precondition for the unified viewer.

**Depends on:** Phase 41, Phase 42, Phase 43
**Requirements:** API-01, API-02
**Success Criteria** (what must be TRUE):

  1. The same REST request (e.g. `GET /api/entities?ontologyClass=...`) returns shape-identical responses against A, B, and C — only the data and ontology classes differ.
  2. A user can take a git snapshot of `.data/exports/` in any of the three systems and restore an earlier state via the shared snapshot/restore endpoint, with the resulting graph identical to the snapshot.
  3. A's existing `/api/observations|digests|insights` endpoints remain callable but resolve internally to typed views over `/api/entities?ontologyClass=...` (no consumer breakage during transition).
  4. The git two-commit pattern and OKB-baseline guard from existing export hygiene still hold under the unified snapshot endpoint.

**Plans:** 18/16 plans complete

Plans:
**Wave 1**

- [x] 44-01-PLAN.md — Wave 0 km-core test scaffolds (api-router, contracts, snapshot-roundtrip, observation-view) — supertest devDep + RED tests
- [x] 44-02-PLAN.md — Wave 0 coding-side test scaffolds (cross-system-parity, typed-views, okb-guard-snapshot-bypass, dashboard-observations) — RED tests
- [x] 44-03-PLAN.md — km-core Zod contracts + subpath exports (C-2)
- [x] 44-05-PLAN.md — km-core observation-view adapter (A-4 typed-view primitives)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 44-04-PLAN.md — km-core SnapshotManager (S-1/S-2/S-4) + coding-side OKB_SNAPSHOT=1 hook bypass (S-3 revised)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 44-06-PLAN.md — km-core createKmCoreRouter + 6 handler modules + Louvain port (R-1/R-2/C-1/C-3); 15 canonical endpoints

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 44-07-PLAN.md — A-side cutover: mount /api/v1 on obs-api + replace SQLite handlers with /api/coding/* typed views (R-4)
- [x] 44-08-PLAN.md — B-side cutover: mount /api/v1 on SSE server (same-port strategy per RESEARCH Example 3)
- [x] 44-09-PLAN.md — C-side OKM cutover: refactor routes.ts + viewer URL rewrites + fixture re-record + Zod schema-source migration (cross-repo, bmw.ghe.com HTTPS)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 44-10-PLAN.md — A-side SQLite → km-core migration (A-2) + backup + table drops (A-3) [autonomous: false; two human-verify checkpoints]

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 44-11-PLAN.md — End-of-phase verification: all 4 SCs + Wave 0 + cross-system parity + dashboard + VOKB visual smoke + restore round-trip [autonomous: false; human-verify checkpoint]

**Waves:** 0 (Plans 01,02 — test scaffolds) → 1 (Plans 03,05 — contracts + observation-view) → 2 (Plan 04 — SnapshotManager + hook bypass) → 3 (Plan 06 — router + handlers) → 4 (Plans 07,08,09 — A/B/C cutover, parallel) → 5 (Plan 10 — SQLite migration + table drop) → 6 (Plan 11 — phase verification)

#### Phase 45: Unified Viewer Routing Layer

> **Descope note 2026-06-09:** Phase 45's original goal (UI parity with VKB+VOKB) was not delivered. What shipped is a routing scaffold + minimal viewer shell. Operator visual review against `localhost:3002` (VOKB) confirmed ~85% of VOKB's surface is missing from the unified viewer. The remaining feature-parity work — legend, OKB data routing, VOKB feature parity (Layer/Domain filters, Ontology Class tree with counts, Trending Patterns, Issue Triage tab, Stats bar, Entity Details sub-tabs, Relationships by edge-type, Sources & Evidence, Occurrence History), node-shape encoding, Markdown/Entity panel UX, CAP environment-bound error UX — is tracked in Phase 55. Phase 45 is left checked-off in the milestone log because the routing layer is real, but the UI is a stub. See `.planning/phases/45-unified-web-viewer/45-VERIFICATION.md` for the full gap inventory.

**Goal (original):** Replace the two divergent viewers (VKB sigma.js for B, VOKB D3 for C) with a single web viewer parameterized by ontology configuration, so VKB and VOKB users migrate without losing functionality and KM-Core has one frontend surface to maintain.

**Goal (post-descope):** Land the routing layer (system-endpoints config, multi-base ApiClient, ontology display-overlay) and a minimal viewer shell that proves the routing layer works end-to-end. UI feature parity deferred to Phase 55.

**Depends on:** Phase 42, Phase 44
**Requirements:** UI-01
**Success Criteria** (what must be TRUE):

  1. A user can open the unified viewer pointed at A, B, or C's REST API and see the graph rendered with that system's ontology classes, colors, and hierarchy.
  2. Every interactive feature currently used by VKB users (entity click, expand, filter, search) and VOKB users (force-directed view, cluster overlays, RCA lookup) is present in the unified viewer.
  3. A VKB or VOKB user can switch to the unified viewer for daily work and not regress on any task they used to perform in the legacy viewer.
  4. The viewer's data layer reads exclusively through the Phase 44 REST contract — no direct LevelDB or SQLite access from the frontend.

**Plans:** 6/6 plans executed
**UI hint**: yes

Plans:

**Wave 1**

- [x] 45-01-PLAN.md — Scaffold greenfield `integrations/unified-viewer/` (Vite + React 18 + TS + Tailwind 3 + shadcn `new-york` preset verbatim from dashboard) + ApiClient with camelCase Zod schemas (Plan 44-16 wire-shape lock) + React Router DOM 7 routing with `/viewer/{system}` + `key={system}` remount + Zustand store + 15 shadcn primitives + SYSTEM_ENDPOINTS config

**Wave 2** *(depends on Wave 1)*

- [x] 45-02-PLAN.md — WebGL graph renderer at `src/graph/` using `@react-sigma/core` + `sigma` + `graphology` + ForceAtlas2 web-worker layout; FNV-1a HSL color fallback per UI-SPEC § Color; per-state stroke + opacity contract via sigma's `nodeReducer`; click/double-click/pan/zoom/hover wired

**Wave 3** *(depends on Wave 2)*

- [x] 45-03-PLAN.md — User-facing chrome — FilterRail (search + level + class) + EntityDetailPanel + NavBar + SidePanel tab shell + Footer + 8 State Contract surfaces + global keyboard model (`/`, `Esc`, `?`, `f`) + IconButton primitive (non-optional `ariaLabel` TS-narrowed) closes UI-SPEC § Icon-only controls FLAG remediation

**Wave 4** *(depends on Wave 3)*

- [x] 45-04-PLAN.md — MarkdownViewer panel (B's signature) — verbatim port of VKB `MarkdownViewer.tsx` minus Mermaid (per D-45-04) + theme-gated highlight.js + `useMarkdownHistory` + km-core handler extension at `lib/km-core/src/api/handlers/ontology.ts` with `?withDisplay=true` gated branch (preserves OKM `rest-contract.test.ts:257` BC) + `.data/ontologies/coding.display.json` seed file

**Wave 5** *(depends on Wave 4 — both touch `panels/SidePanel.tsx`)*

- [x] 45-05-PLAN.md — `OkmRcaClient` (separate from km-core ApiClient — RCA endpoints live at `/api/okm/rca/*`, NOT `/api/v1/*`) + `RcaOpsPanel` Option A verbatim port of VOKB ingestion-ops panel (UI-SPEC PLANNER NOTE + RESEARCH § Open Question #2) — 3 grouped dir lists + 5 shadcn-mapped stage pills + SSE subscription + 120s watchdog + EventSource cleanup discipline

**Wave 6** *(depends on Plans 02 + 03 + 04 + 05)*

- [x] 45-06-PLAN.md — Cross-system smoke + Wave 0 operator probes — 4 probes (C CORS, C SSE, lucide-react icon completeness, display-overlay strategy) + 9-spec Playwright suite under `tests/e2e/unified-viewer/` covering system-routing / entity-detail / expand-neighbors / filter-search / state-reset / markdown-viewer / rca-ingestion (mock fallback if CAP unreachable) / error-states / webgl-context (20-cycle Pitfall 8) + operator cutover gate

#### Phase 46: Per-System Documentation & Onboarding

**Goal:** Each of A, B, C ships a README documenting which configurations it owns (ontology files, LLM provider config, ingest adapter config, domain eval logic), and KM-Core ships an architecture diagram + onboarding guide — so future contributors can tell at a glance where to add a new ontology class, LLM provider, or ingest source without reading source.

**Depends on:** Phase 45
**Requirements:** DOC-01
**Success Criteria** (what must be TRUE):

  1. A new contributor reading A's, B's, or C's README can locate within five minutes the exact config file(s) they would edit to add a new ontology class or LLM provider for that system.
  2. KM-Core's architecture diagram clearly distinguishes shared core (types, store, registry, pipeline, dedup, REST, viewer) from per-system configuration (ontology files, LLM config, ingest adapters, domain eval).
  3. The onboarding guide walks a new developer from clone → run KM-Core tests → register a new lower ontology → ingest a sample entity, with each step verifiable.
  4. Each system's README cross-references the others and KM-Core, so a contributor entering through any of the four doors can navigate to the others.

**Plans:** 6/6 plans complete

Plans:

- [x] 46-01-PLAN.md — README-TEMPLATE.md + KM-Core README rewrite + 2 KM-Core PUMLs (architecture + ingest sequence) + PNG generation (template anchor; Wave 1)
- [x] 46-02-PLAN.md — A's project-root README: insert 5 template sections after Quick Start (Wave 2)
- [x] 46-03-PLAN.md — B's README rewrite (≤200 lines) + new AGENTS.md companion + b-architecture PUML + submodule pointer bump (Wave 2)
- [x] 46-04-PLAN.md — C's NEW README in OKM external repo on branch gsd/44-09-rest-cutover-v2 + okm-architecture PUML (Wave 2)
- [x] 46-05-PLAN.md — lib/km-core/docs/ONBOARDING.md (7-step LslHeartbeatRotator exercise) + cleanup-verifier spec (Wave 3)
- [x] 46-06-PLAN.md — Final cross-reference sweep across 4 READMEs to verify SC-4 (Wave 4)

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 37. KM-Core Foundation | 5/5 | Complete   | 2026-05-20 |
| 38. Ontology Registry | 1/6 | In Progress|  |
| 39. Entity Data Model | 4/4 | Complete    | 2026-05-20 |
| 40. Ingest Pipeline & Layered Dedup | 12/12 | Complete    | 2026-05-22 |
| 41. Online Learning Adapter & Post-Hoc Resolution | 7/7 | Complete    | 2026-05-23 |
| 42. Offline UKB Migration (B) | 6/7 | In Progress|  |
| 43. OKM Cross-Repo Migration (C) | 7/11 | In Progress|  |
| 44. REST API & Git Snapshots | 18/16 | Complete   | 2026-06-05 |
| 45. Unified Web Viewer | 6/6 | Complete    | 2026-06-08 |
| 46. Per-System Documentation & Onboarding | 6/6 | Complete    | 2026-06-09 |

### Phase 47: ObservationWriter: preserve prompt text when image attachments are present — CLOSED (subsumed by Phase 50)

**Goal:** Preserve user-prompt text when image attachments are present (originally surfaced via `9a3e700c-…` row that required manual hand-write recovery). See `.planning/phases/47-…/47-CONTEXT.md` for the full bug write-up.
**Status:** ✓ Closed 2026-06-14 — subsumed by Phase 50 (LSL-grounded async observation resolver). Phase 50's `_buildPriorContext` migration to the 3-prompt LSL window + the LSL-grounded resolver CLI together backfill these image-only rows from verbatim session logs; no separate phase needed. Recorded in STATE.md line 43 ("Phase 47: ObservationWriter drops user-prompt text when image attachment present (subsumed by Phase 50 `Could` recovery item)") and in 50-CONTEXT.md ("Subsumes Phase 47's `Could` recovery item").
**Requirements**: N/A (closed without planning)
**Depends on:** Phase 46
**Plans:** 0 plans (closed without planning)

Plans:

- [x] N/A — closed without planning; bug-class is fixed by Phase 50's resolver, not by a Phase 47 patch

### Phase 48: VKB graph viewer: System-type nodes vanish when their owning team is unchecked

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 47
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 48 to break down)

### Phase 49: VKB graph data: 187 orphan nodes lack project-anchor relations (online + manual)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 48
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 49 to break down)

### Phase 50: LSL-grounded async observation resolver — backfill ambiguous-reference and image-only rows from verbatim session logs

**Goal:** Stop carrying observation rows whose Intent line resolves to "some previously discussed feature" or stores only `[Image: source: …]` placeholders. Build an LSL-grounded async resolver that walks the verbatim Live Session Logs (3-user-prompt window, not 30-min wall-clock) and rewrites ambiguous summaries with a full audit trail, plus migrate the inline `_buildPriorContext` to use the same window primitive so both tiers agree on what "recent" means.
**Requirements**: None registered (out-of-milestone bug-fix phase; acceptance criteria in 50-CONTEXT.md)
**Depends on:** Phase 49
**Plans:** 3 plans

Plans:

- [x] 50-01-PLAN.md — Build `lib/lsl/window.mjs` + `lib/lsl/scan-and-convert.mjs` primitives + `scripts/resolve-observations-from-lsl.mjs` CLI. (completed 2026-05-26; 26 tests; 8 commits; W5 project-filter patch landed during planning)
- [x] 50-02-PLAN.md — Migrate `ObservationWriter._buildPriorContext` from 30-min observation-DB window to `getLSLWindow` + capture-time `needs_lsl_resolution` stamp (detector B). (completed 2026-05-26; 21 tests; 5 commits; D-47-Boundary 3-layer grep clean)
- [x] 50-03-PLAN.md — launchd job + idempotent installer + wrapper script for periodic background runs. (Tasks 1+2+4 completed 2026-05-26; 7 tests; 4 commits; Task 3 `/health/state` summary_integrity counter SKIPPED — health-coordinator.js is HTTP aggregator with no SQLite handle, architectural drift; Could #10 deferred. Task 4 = human-verify checkpoint awaiting host-side `bash scripts/install-lsl-resolver-launchd.sh`.)

### Phase 51: GSD wave-execution sub-agent transcripts are not captured as observations

**Goal:** Agent-agnostic sub-agent capture across LSL and observations for claude / opencode / copilot / mastra. Path B (sweep) ships first, Path A (live hooks) second per D-Order; D-LSL-Filename convention applied across all four agents; the 2026-05-24 statusline mitigation is replaced with registry-sourced reads; final closure surfaces sub_agent_capture in /health/state.
**Requirements**: TBD (out-of-milestone bug-fix; no requirement IDs registered)
**Depends on:** Phase 50
**Plans:** 16/16 plans complete

Plans:
**Wave 1**

- [x] 51-01-PLAN.md — Agent-agnostic sub-agent registry + sweep dispatcher (Wave 1; shared infrastructure)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 51-02-PLAN.md — Claude Code Path B sweep adapter + historical backfill of 2026-05-23 transcripts (Wave 2; CONTEXT.md AC #1)
- [x] 51-03-PLAN.md — OpenCode Path B sweep adapter (SQLite reader; Wave 2)
- [x] 51-04-PLAN.md — Copilot Path B sweep adapter + parseCopilot v1.0.48 fix (Wave 2)
- [x] 51-05-PLAN.md — Mastra Path B sweep adapter (forward-compat; sweep-only — Path A NOT VIABLE; Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 51-06-PLAN.md — D-LSL-Filename writer + LSL parity + 2026-05-23 historical LSL backfill (Wave 3; CONTEXT.md AC #2)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 51-07-PLAN.md — Claude Code Path A live hook (FSEvents watcher + tail-reader; Wave 4)
- [x] 51-08-PLAN.md — OpenCode Path A live hook (5s SQLite polling; Wave 4)
- [x] 51-09-PLAN.md — Copilot Path A live hook (file-tail; degraded LSL parity acknowledged; Wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 51-10-PLAN.md — Replace 2026-05-24 statusline mitigation with registry-sourced reads (Wave 5; D-Statusline)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 51-11-PLAN.md — launchd integration (4 plists) + health-coordinator sub_agent_capture block + final 6-AC verification (Wave 6; closure)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 51-12-PLAN.md — Gap-closure CR-04: resolve node binary path at install time so launchd plists work on Apple Silicon (Wave 7)
- [x] 51-13-PLAN.md — Gap-closure CR-01 + CR-02: OpenCode --limit plumb-through + heartbeat registry_rows emit (Wave 7)
- [x] 51-14-PLAN.md — Gap-closure CR-03: atomic upsert for observations_written increment in claude-fs-watch (Wave 7)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 51-15-PLAN.md — Gap-closure AC #2: production LSL backfill execution + WR-05 --historical flag fix (Wave 8)

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 51-16-PLAN.md — Gap-closure AC #3 + HUMAN-UAT re-attempt: kill stale daemons, restart launchd, restart health-coordinator, run small /gsd-execute-phase, verify 6 ACs (Wave 9; checkpoint:human-verify)

**Cross-cutting constraints:**

- Phase 50 primitives unchanged; D-Reuse cumulative gate clean

### Phase 52: Dashboard LLM routing label + process tag observability fix

**Goal:** Make the dashboard's claim of "what model handled this sub-step" verifiable from live telemetry, drive process tags to per-sub-step granularity (zero `unknown` from semantic-analysis container), and give operators live `{n}/{N}` progress feedback during multi-minute wave-analysis runs.
**Requirements**: D-01..D-15 (out-of-milestone bug-fix; decision IDs from 52-CONTEXT.md serve as requirement anchors)
**Depends on:** Phase 51
**Plans:** 3/3 plans executed — **Phase 52 COMPLETE** (Plan 01 closed 2026-05-28; Plan 02 closed 2026-05-30; Plan 03 closed 2026-05-31)

Plans:

- [x] 52-01-PLAN.md — Process-tags registry + per-call-site override factory + wave1/2/3/4 tagging + semantic-analyzer strangler swap + zero-unknown gate (D-05, D-06, D-07, D-09, D-10, D-11). **CLOSED 2026-05-28** (Tasks 1-4 = 11 min, Task 5 = ~110 min after strangler-ordering follow-up fix; commits `e8fcb1e` submodule + `364e86d87` outer-repo pointer bump). D-10 PASS: 0 unknown rows since anchor 2026-05-28T07:16:29Z; per-tag breakdown confirms wave-1/2/3/4 sub-steps routed via PROCESS_TAGS registry (wave-analysis-wave4-diagram tagged correctly after fix). See 52-01-SUMMARY.md.
- [x] 52-02-PLAN.md — Dashboard live LLM badges from /api/token-usage/recent + processTag wiring on WORKFLOW_AGENTS (D-01, D-02, D-03, D-04, D-08, D-11). **CLOSED 2026-05-30** (Tasks 1-5; Task 6 visual UAT operator-deferred per autonomous:false). Original work landed in commit `5fa110552` (2026-05-29); gap-closure in commit `93560c13e` (2026-05-30) added SubStepRow memoized component with full live→static→tier-label fallback chain, useRecentCalls error banner at TraceModal top, settings dialog renderProcessRow helper + registry/legacy section split, hooks.ts setInterval type-annotation tweak, plus pre-existing AgentInstanceRow `.agentType`→`.id` TS bug fix. See 52-02-SUMMARY.md.
- [x] 52-03-PLAN.md — Throttled per-item progress emission (wave1/2/3/4) + dashboard {n}/{N} ItemProgressBadge (D-12, D-13, D-14, D-15). **CLOSED 2026-05-31** (Tasks 1-3; Task 4 visual UAT operator-deferred per autonomous:false). Wave-controller half (maybeEmitItemProgress throttle helper K=5/2s + 5 instrumented emit points across wave1/2/3 classify + wave2/3 analyze + wave4 emission field expansion) landed in tree via submodule commits behind outer-repo pointer-bump `ad523f7db` on 2026-05-29. Dashboard half (ItemProgressBadge memoized component + WaveGroup type extension + waveGroups reducer extension with last-non-null-survivor rule + wave-row conditional render with D-15 triple-guard backward compat) landed in commit `5ad4f31f2` on 2026-05-31. Phase 42.2-02 single-writer invariant preserved (`grep -c preserveFromExisting wave-controller.ts` → 0). See 52-03-SUMMARY.md.

---

### Phase 53: UAT Probe — Sub-Agent Capture (THROWAWAY)

**Goal:** Trigger ONE executor sub-agent via `/gsd-execute-phase 53` to exercise the live-claude FSEvents watcher and close Phase 51 AC #3. Throwaway phase — entire directory + marker file may be removed after Phase 51 closes.
**Requirements:** none (operational verification only)
**Depends on:** Phase 51 plans 51-12, 51-13, 51-14 (CR fixes) on main
**Plans:** 1/1 plans complete

Plans:

- [x] 53-01-PLAN.md — Write throwaway marker file `.planning/uat-probes/2026-05-27-sub-agent-capture-probe.md`; sole purpose is to spawn one executor sub-agent for live-claude observation evidence.

---

### Phase 54: ETM Hardening — launchd plist + isProcessing reset audit (BACKLOG)

**Trigger:** 2026-06-02. ETM PID 98287 silently stalled for 16h 23m (Jun 1 16:58 UTC → Jun 2 07:25 UTC). Process alive (1m17s CPU over 18h55m) but `isProcessing` re-entrancy guard apparently locked `true` after an unhandled rejection somewhere in `_firePromptSetObservation`. No launchd wrapper means nothing respawned it. User noticed via dashboard knowledge indicator fading from green → orange → brown → black. Manual SIGTERM + nohup relaunch cleared it; first new observation landed within one 2s poll cycle.

**Goal:** Make ETM auto-respawn on hang or crash (parity with the seven other coding-* launchd-managed services); make the `isProcessing` guard always clear via top-level try/finally; add a stall self-check so operators see a `[STALL-DETECT]` log line before the dashboard goes dark.

**Requirements:**

- ETM-01: ETM must auto-respawn after crash or hang (launchd KeepAlive)
- ETM-02: `isProcessing` flag must never leak `true` across exceptions

**Plans (3 planned, 0 executed):**

- [ ] 54-01-PLAN.md — `~/Library/LaunchAgents/com.coding.etm.plist` modelled on `com.coding.obs-api.plist`; `KeepAlive: true`; logs to `~/Library/Logs/coding/etm-{out,err}.log`; `ThrottleInterval: 15`s
- [ ] 54-02-PLAN.md — top-level try/finally around `enhanced-transcript-monitor.js:4085-4135`; force-reset watchdog if `isProcessing` true > 60s with `[POLL] isProcessing forced-reset after Ns` line; periodic stall self-check (`[STALL-DETECT]` if pollCount advanced but no obs write in 5min and Claude jsonl is fresh)
- [ ] 54-03-PLAN.md — `bin/coding --claude` switches ETM startup to `launchctl kickstart`; collision handling for orphan manually-launched ETM; CLAUDE.md "Startup & Services" updated

Could-have (defer): extend health-coordinator with ETM heartbeat surface; migrate ETM polling to fsevents-based file watcher; **LSL rotation co-design with prompt-set-block remover** — periodic compactor as launchd job (`com.coding.lsl-compactor`, every 30 min, slots older than 1 hour, approach #3 from `.planning/todos/pending/lsl-rotation-removal-codesign.md`) to fix the 2026-05-27 size-aware rotation regression (commit `590c37432` reverted the picker change; the original "single-fat-slice → bloated file" pattern is back but file counts stay sane). Workaround until fixed: `scripts/backfill-lsl-rotation.mjs --apply` compacts oversized slots manually.

See `.planning/phases/54-etm-hardening-launchd-and-isprocessing-audit/54-CONTEXT.md` and `.planning/todos/pending/lsl-rotation-removal-codesign.md`.

### Phase 55: Unified Viewer Feature Parity with VOKB

**Trigger:** 2026-06-09. Operator visual comparison of unified viewer (`localhost:5173/viewer/{coding,okb,cap}`) against the legacy VOKB at `localhost:3002` revealed that the unified viewer is functionally a regression for VOKB users. Phase 45 shipped the routing layer + a minimal viewer shell; the actual UI is ~15% of VOKB's surface area. "MVP shipped with VKB+VOKB as fallback" was a premature framing — the verifier was never run, and a side-by-side screenshot comparison would have caught the depth gap immediately.

**Goal:** Bring the unified viewer to ≥90% feature parity with VOKB (the richer of the two legacy viewers), so VKB and VOKB users can actually migrate without losing functionality. Phase 45's routing layer is preserved as the scaffolding; this phase fills in the UI.

**Depends on:** Phase 45 (routing layer + display-overlay), Phase 44 (REST + typed views)

**Requirements:** UI-02 (NEW — operator-driven feature-parity requirement; complements UI-01 which now covers routing only)

**Success Criteria** (what must be TRUE):

1. **Data routing correctness.** OKB tab fetches from actual OKM data source (route to `:8090` for local-dev OKM or document the precondition), not from semantic-analysis's mirror of the coding KG. A new visitor to the OKB tab sees RaaS / KPI-FW / business entities, not `CodeAnalyzer` / `PersistenceAgent`.
2. **CAP environment-bound UX.** CAP tab detects DNS failure / TLS handshake failure and shows "OKM corporate URL unreachable — are you on the BMW VPN?" instead of the current misleading "(CORS)" banner. No misleading CORS error when the actual failure is DNS.
3. **Legend present.** Color and shape encoding for nodes (entity type, layer, confidence, etc.) is documented in an always-visible or one-click legend. Mirror VOKB's encoding wherever feasible.
4. **Node shape encoding by entity type.** Distinct shapes (square / diamond / circle) for distinct entity classes, matching VOKB's convention.
5. **Filter parity with VOKB.** Layer filter (Evidence / Pattern), Domain filter (RaaS / KPI-FW / General or system-equivalent), full Ontology Class tree with per-class counts. Show All Relations / Show Clusters / Merged Only / Hide Documentation toggles.
6. **Header stats bar.** Total nodes, total edges, evidence count, pattern count, orphan count, connectivity %, LIVE indicator — matching VOKB's stats bar pattern.
7. **Entity Details parity.** Right-side panel includes sub-tabs (Default / Evolution / Confidence / Timeline), Relationships breakdown by edge type with counts, Sources & Evidence with per-source icons, Occurrence History with date stamps.
8. **Markdown / Entity panel UX.** Markdown tab keeps the metadata header (Class chip, Level, Parent, Created, Last confirmed) and renders the description with markdown formatting. Entity tab unchanged. Side-panel widths harmonized between tabs.
9. **Trending Patterns sidebar.** Sparklines for top patterns (analog of VOKB's "Trending Patterns" left-sidebar surface).
10. **Issue Triage mode.** A separate viewer mode targeting operational triage (analog of VOKB's "Issue Triage" tab; may be partial in v1).

**Plans:** 13/13 plans complete

Plans:
**Wave 1**

- [x] 55-01-PLAN.md — Routing fix + CAP drop (D-55-01a/b/c) + RcaOpsPanel deletion + cc.bmwgroup.net purge
- [x] 55-02-PLAN.md — Encoding overlay schema extension (borderStyle/pulseRule) in km-core + coding.display.json (D-55-03)
- [x] 55-03-PLAN.md — Shared modules: vokb-palette.ts (semantic palette) + lib-domain/evidence-types.ts (port from VOKB)
- [x] 55-04-PLAN.md — Zustand store extensions (filter slices, mode, etmObservations ring buffer, hierarchy/LSL filters)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 55-05-PLAN.md — Renderer extension: SigmaCanvas shapes + dashed border + pulse halo with prefers-reduced-motion (depends_on: 55-03)
- [x] 55-06-PLAN.md — Backend endpoints: /api/v1/stats + /api/v1/trends + /api/v1/entities/:id/confidence + /api/coding/observations/stream (SSE) + /api/coding/lsl/sessions (depends_on: 55-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 55-07-PLAN.md — Shell wiring: StatsBar + LegendPanel + NavBar mode toggle + UnifiedViewer route + KeyboardHelpDialog (depends_on: 55-01,55-03,55-04,55-06)
- [x] 55-08-PLAN.md — Filter rail parity: LayerFilter + DomainFilter + OntologyFilter (groupingSchema) + GraphToggles (depends_on: 55-04)
- [x] 55-09-PLAN.md — Entity detail expansion: 4 sub-tabs + Relationships + Sources & Evidence + Occurrence History + Markdown harmonization (depends_on: 55-01,55-03,55-04)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 55-10-PLAN.md — Trending Patterns sidebar + IssueTriageView (Mode B) (depends_on: 55-03,55-04,55-06)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 55-11-PLAN.md — Coding-only surfaces batch 1: HierarchyNavigator + LslTimelineStrip (depends_on: 55-04,55-06,55-07,55-08)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 55-12-PLAN.md — Coding-only surfaces batch 2: EtmTailSheet (SSE) + WorkflowStatusPanel + NavBar ETM trigger (depends_on: 55-04,55-06,55-07,55-11)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 55-13-PLAN.md — E2E test suite + side-by-side VOKB screenshot harness + operator parity gate (depends_on: 55-01,55-05,55-07,55-08,55-09,55-10,55-11,55-12)

**Cross-cutting constraints:**

- Logger discipline: ZERO raw `console.*` in any file touched
- Logger discipline: ZERO raw `console.*`

**Out of scope (explicit):**

- The "what data should OKB tab actually show" architectural question — that's part of SC-1, but if the operator chooses "mirror OKM data into coding's km-core" instead of "proxy to :8090", a separate phase covers the mirror pipeline.
- Migration of VKB / VOKB consumers off their legacy viewers — Phase 45's routing layer + this phase's UI parity unblocks that, but the consumer-side cutover is a separate operator decision.
- BMW corporate CORS / DNS configuration for `https://okm.cc.bmwgroup.net` — environment-bound, not in this phase.

**Process amendment (post-mortem on Phase 45):**

- Every phase close-out MUST produce a VERIFICATION.md, even when the phase shipped under an MVP-fallback caveat. The verifier itself should distinguish "must_have failure" from "MVP-deferred".
- For viewer-touching plans, the verifier MUST include a side-by-side screenshot comparison against the legacy viewer being replaced (or a documented justification for the absence).

See `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-CONTEXT.md` (to be authored by `/gsd-discuss-phase 55`).

### Phase 56: Unified Viewer — Bidirectional Selection & Timeline Scale

**Goal:** As a developer exploring the unified knowledge graph viewer at localhost:5173/viewer/coding, I want to pivot between graph, timeline, and history-sidebar via a single shared selection, so that I never lose context when switching panes.
**Mode:** mvp
**Requirements**: TBD
**Depends on:** Phase 55
**Plans:** 4/4 plans complete

Plans:

- [x] 56-01-PLAN.md — Store selection-sync slice + Esc→clearSelection + RED Playwright spec (Wave 1 foundation)
- [x] 56-02-PLAN.md — History sidebar slice: atomic click write + data-history-id fix + highlight (Wave 2)
- [x] 56-03-PLAN.md — LSL timeline timestamp scale + tick→atomic Phase 56 fields (Wave 2)
- [x] 56-04-PLAN.md — D3 graph centering + bg-click→clearSelection + E2E suite GREEN + operator visual smoke (Wave 3)

---

## Backlog

### Phase 56.1: Unified Viewer — Many-to-Many Temporal-Knowledge Bridge (INSERTED)

**Goal:** Replace Phase 56's one-to-one selection sync with a many-to-many model: a timeline tick lights up ALL insights it touched (graph multi-ring + sidebar History-style card list); a graph node lights up ALL ticks where it was touched (timeline multi-highlight); drilling into a bucket card or single touched node returns to single-entity detail. Requires multi-selection store fields (`selectedBucketEntityIds`, `selectedNodeTickKeys`), a "which ticks touched node X?" lookup (likely new server endpoint or client-side scan), multi-mode sidebar (single entity vs bucket-card list), and updated D3/Timeline highlight rendering for N-element selection. Also incorporates the 4 Warnings deferred from Phase 56 code-review (WR-01 data-dep test, WR-02 diamond hierarchy, WR-03 selectedClasses race, WR-04 reset() field coverage).
**Requirements**: TBD
**Depends on:** Phase 56
**Plans:** 6/6 plans complete

Plans:

- [x] 56.1-01-PLAN.md — Wave 1: Store schema evolution (selectedNodeIds + focalNodeId + selectedBucketKeys + focalBucketKey) + WR-04 reset() coverage
- [x] 56.1-02-PLAN.md — Wave 1: ancestry.ts pickAllResolvable + computeAncestryPath WR-02 diamond-hierarchy BFS fix
- [x] 56.1-03-PLAN.md — Wave 2: D3GraphCanvas two-tier ring rendering (focal red + halo lighter blue) + drill-collapse click handler + SidePanel close button compliance (Locked Contract #5)
- [x] 56.1-04-PLAN.md — Wave 2: BucketCardList NEW component + SidePanel three-way mode switch + HistorySidebar onClick migration to new setSelection arg shape
- [x] 56.1-05-PLAN.md — Wave 3: useNodeToBucketsIndex pre-index hook + LslTimelineStrip multi-state write + two-tier tick render + WR-03 selectedClasses race fix + D3GraphCanvas node-click reverse cascade (D-2 both directions)
- [x] 56.1-06-PLAN.md — Wave 3 (autonomous: false, has human-verify): E2E WR-01 fix + 56.1-many-to-many.spec.ts (AC#1-9) + 56.1-PATTERNS-LOCK.md + operator visual smoke at localhost:5173/viewer/coding

### Phase 999.1: Extract Shared LLM Adapter Library — CLOSED (already-shipped)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain -> Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) -- same pattern for claude-code.
**Status:** ✓ Closed 2026-06-14 — both goals shipped out-of-band via the standalone `@rapid/llm-proxy` package, not as `lib/llm/`. Direct HTTP for Claude Max landed at rapid-llm-proxy commit `c043362` (2026-05-19, ~8x faster). Shared library lives at `~/Agentic/_work/rapid-llm-proxy/` and is consumed by coding (`src/llm-proxy/`, `lib/km-core/`, semantic-analysis agents) and OKM (`@rapid/llm-proxy` imports). No planning cycle required. See `.planning/phases/999.1-extract-shared-llm-adapter-library/999.1-CONTEXT.md` for closure rationale + audit trail.
**Requirements:** N/A (closed without planning)
**Plans:** 0 plans

Plans:

- [x] N/A — closed without planning; both goals shipped out-of-band via `@rapid/llm-proxy`

---

## Milestone v7.2: VKB & Online-Learning Quality (ACTIVE — started 2026-06-14)

**Goal:** Bring the online learning pipeline → km-core → unified viewer surface to production data quality, so operators rely on the graph view for navigation and triage instead of working around known-broken rendering.

**Phase numbering:** Continues from Phase 56.1. New phases are **57–61** (5 phases).

**Coverage:** 19 v7.2 requirements (EDGE-01..02, LOWERONTO-01..04, VKBUI-01..04, LSLTIME-01..03, OKBROUTE-01..02, ORPHAN-01..04) mapped to 5 phases. See `.planning/REQUIREMENTS.md` § v7.2 Traceability for the per-REQ-ID table.

### Phases

- [x] **Phase 57: Lower Ontology & Project Tagging Foundation** — declare coding-specific L2 classes (`LiveLoggingSystem`, `ConstraintMonitor`, `OnlineObservation`, `OnlineDigest`, `OnlineInsight`, `KnowledgeManagement`); optional upper-ontology growth; stamp `project` tag on every km-core entity. (completed 2026-06-15)
- [x] **Phase 58: Online Pipeline Semantic Edges on Insights** — `ObservationConsolidator` emits semantic-content edges (mentions / dependsOn / isRelatedTo / instanceOf) on online Insights, atomically with the Insight node, beyond the existing `capturedBy → LiveLoggingSystem` provenance. (completed 2026-06-15)
- [x] **Phase 59: Long-Tail Orphan Fixes & Baseline Reduction** — server-side System-type filter fix (legacy Phase 48); parent-hierarchy edges for online-learned Detail/SubComponent + one-shot migration (legacy Phase 49); per-team `CollectiveKnowledge --includes--> Project` writer + seed fix; drive `orphanCount` from 157 → ≤30. (completed 2026-06-17)
- [x] **Phase 60: Unified Viewer Rendering UX Integrity** — Evidence/Pattern filter symmetry; Legend derived from rendered graph (no static OKB bleed); Observation/Digest filtered out by default with debug toggle; CollectiveKnowledge visibility under Online filter; ontology-class filter renders L2 lower-ontology classes as expandable groups under their L1 parent with per-class count badges. (5/5 SCs PASS as of 2026-06-20. SC#5 closed by Plan 60-09: entities now carry L2 sub-classes [87 backfilled], OntologyFilter renders the real L0→L1→L2 tree with non-zero per-L2 counts + working L2 selection, Project as L0, level-None Insight/Digest rows. EtmDaemon is a valid-but-unpopulated L2 per the no-forced-L2 invariant — operator-approved PASS. See 60-VERIFICATION.md sc5_closure.)
- [x] **Phase 61: LSL Timeline & OKB Routing Honesty** — remove silent 200-record cap (`useLslSessions.ts`) with visible "N of M" label or honest streaming; honest "all" window (no silent 365-day cap); bi-source tick coloring (manual vs online); `/viewer/okb` ApiClient detects OKM Express `:8090` legacy `/api/entities` shape and routes correctly, showing real OKM business entities not coding-KG mirrors. (completed 2026-06-20)

### v7.2 Phase Details

### Phase 57: Lower Ontology & Project Tagging Foundation

**Goal:** Knowledge graph nodes carry a coding-specific ontology vocabulary and a per-project tag, so downstream consumers (viewer, migrations, orphan repair) can group, filter, and reason about entities by project AND by coding-domain class — not just by generic upper-ontology Component/SubComponent/Detail.
**Depends on:** Nothing (foundational ontology + data-shape work; runs first so Phases 58–61 stamp + consume the new fields)
**Requirements:** LOWERONTO-01, LOWERONTO-02, LOWERONTO-04
**Success Criteria** (what must be TRUE):

  1. An operator inspecting any recent km-core entity sees a `project` tag (`coding`, `okm`, `cap`, etc.) populated on the entity — the writer path stamps it at insert time, not as a one-shot backfill.
  2. The OntologyRegistry loads a lower-ontology file (`.data/ontologies/coding.lower.json` or equivalent project-scoped file) declaring at minimum `LiveLoggingSystem`, `ConstraintMonitor`, `OnlineObservation`, `OnlineDigest`, `OnlineInsight`, `KnowledgeManagement` as L2 classes extending their upper-ontology parents.
  3. Sampling 20 recent online-learned entities, at least 18 carry an `ontologyClass` value drawn from the new lower-ontology class set (not generic `Component` / `Detail` only).
  4. If the operator confirms upper-ontology growth in the discuss-phase (soft gate per LOWERONTO-02), the upper ontology declares ≥2 additional generic programming-aspect classes (e.g., `Diagnosis`, `Interface`); otherwise LOWERONTO-02 is honestly deferred without blocking the phase.

**Plans:** 6/6 plans complete

Plans:
**Wave 1**

- [x] 57-01-PLAN.md — km-core Project type registry (PROJECTS const + isProject typeguard + barrel re-exports)
- [x] 57-02-PLAN.md — `.data/ontologies/coding.lower.json` with 10 L2 classes + fixture-driven integration test
- [x] 57-06-PLAN.md — LOWERONTO-02 deferral marker in REQUIREMENTS.md + STATE.md (documentation-only)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 57-03-PLAN.md — Writer-path metadata.project stamping in semantic-analysis agents (canonical-mapper + dual-stamp at km-core-adapter); Tasks 1-3 complete; Task 4 HUMAN-UAT deferred as verification-debt per operator (runtime jq check against next `ukb full`). Container km-core resolution unified on lib/km-core via docker-compose.yml re-mount (commit 862336b84) — eliminates the two-clone drift pattern.
- [x] 57-05-PLAN.md — Backfill script `scripts/backfill-project-tag.mjs` + transitional viewer read in graph-builder.ts (metadata.project ?? metadata.team). Live operator-supervised backfill executed 2026-06-14T20:13Z: 743 entities migrated, 100% metadata.project coverage on live general.json, 0 errors, SC#1 PASS. LOWERONTO-04 runtime evidence satisfied; verifier should tick at phase close.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 57-04-PLAN.md — Classifier L2 emission. Tasks 1-2 complete 2026-06-14: `OntologyClassificationAgent.l2Classes` loads 10 classes from `coding.lower.json` at init (`loadL2Classes` filters L1 carriers); REFINEMENT STEP prompt addendum injected into `buildClassificationInput` (verified live in container — `docker exec coding-services grep -c "REFINEMENT STEP" ... → 2`); `scripts/check-l2-emission-rate.mjs` codifies SC#3 (`--sample 20 --min 18`). **Task 3 (HUMAN-UAT) DEFERRED as verification-debt** per operator at orchestrator checkpoint — same pattern as Plan 57-03 Task 4. Pre-cutover baseline returns `l2_emitted=0/20 FAIL` because most-recent online entities pre-date the cutover (latest 2026-05-23); discharge the debt at the next scheduled wave-analysis run per 57-04-SUMMARY.md § Verification Debt. Commits: submodule 33a8960+1250d1f; outer 548ceb691+6ac7d4f97+0cd90fd2e. 5 tests added (5/5 PASS); 4 neighbouring suites 33/33 PASS.

**UI hint:** yes

### Phase 58: Online Pipeline Semantic Edges on Insights

**Goal:** Online-generated Insight entities carry semantic-content edges to the domain entities they discuss — not just provenance edges back to `LiveLoggingSystem` — so a reader landing on an Insight can traverse to the Components / SubComponents / Details it talks about, and the graph view shows online learning as a connected sub-graph instead of a star of orphan-leaves around LSL.
**Depends on:** Phase 57 (lower-ontology classes for OnlineInsight + project tag; both surface on the new edges)
**Requirements:** EDGE-01, EDGE-02
**Success Criteria** (what must be TRUE):

  1. Sampling 20 random recent online-learned Insights, at least 18 carry at least one semantic-content relation type beyond `capturedBy → LiveLoggingSystem` — drawn from the discuss-phase-decided set (e.g., `mentions`, `dependsOn`, `isRelatedTo`, `instanceOf`).
  2. A concurrent `/api/v1/entities` reader running while `ObservationConsolidator` writes a new Insight never observes the Insight node without its semantic-content edges (no orphan-Insight intermediate state).
  3. Unified viewer rendered with the Online learning-source filter shows online Insights connected by semantic-content edges to domain entities, not as isolated nodes hanging off LiveLoggingSystem only.

**Plans:** 4/4 plans complete
- [x] 58-01-PLAN.md — MentionsClassifier module (pure helpers + rapid-llm-proxy client + unit tests)
- [x] 58-02-PLAN.md — Writer-path unification + atomicity (kmStore-native _pushInsightToKG, writeInsight extended with mentionsTargetIds)
- [x] 58-03-PLAN.md — Backfill script + bridge extension (scripts/backfill-insight-mentions.mjs, _relinkOrphanOnlineInsights extends to mentions)
- [x] 58-04-PLAN.md — Verification surface (integration test for atomicity + scripts/check-insight-mentions-coverage.mjs codifying SC#1)

### Phase 59: Digest / Insight Writer-Edge Repair & Orphan-Floor Maintenance

**Downscoped 2026-06-15** — see `.planning/phases/59-*/59-DOWNSCOPE-MEMO.md` (TBD). The original "Long-Tail Orphan Fixes & Baseline Reduction" scope (ORPHAN-01..04) is **closed by upstream work**: Phase 57 regression-recovery (2026-06-15 06:24) repaired the SubComponent/Detail orphan instances and wired `CollectiveKnowledge -[parent-child]-> Project` for all teams; the viewer migration from `memory-visualizer` to `unified-viewer`/km-core REST retired the `databaseClient.ts:262` System-strip surface; `/api/v1/stats` reports `orphanCount=7 (≤3% target met by 4× margin)`. The 7 remaining orphans are a **narrower, fresher writer-path bug**: every Digest written by `ObservationConsolidator._executeDigestStage` since the 2026-06-15 LevelDB rehydrate is zero-degree because the consolidator calls `kmStore.putEntity` for the Digest entity but never follows with `kmStore.addRelation` to emit the `Digest -[derivedFrom]-> Observation` edges that `metadata.observation_ids` references — same class of bug landed on 1 Insight via a probe-skip race in the consolidator-side `has_insight` follower.

**Goal:** Eliminate the writer-path bug at `src/live-logging/ObservationConsolidator.js:1293-1296` that leaves every newly-inserted `Digest` as a zero-degree node, harden the `has_insight` follower at `:677-694` so `Insight` entities are never written without their project-anchor edge, and run a one-shot repair against the 7 existing orphan Digests/Insight so the live km-core graph reaches `orphanCount ≤ 10` sustained across 24h of online-learning activity.
**Depends on:** Phase 57 (per-team `metadata.project` tag enables routing each Digest's `derivedFrom` edges to observations stamped with the right project); Phase 58 (insight-writer atomicity ground laid for `has_insight` hardening)
**Requirements:** ORPHAN-DIG-01, ORPHAN-DIG-02, ORPHAN-INS-01, ORPHAN-FLOOR
**Success Criteria** (what must be TRUE):

  1. Every `Digest` entity written by `ObservationConsolidator._executeDigestStage` (`src/live-logging/ObservationConsolidator.js:1293-1296`) is followed in the same try-block by `kmStore.addRelation` calls materializing one `Digest -[derivedFrom]-> Observation` edge per id in `row.observation_ids`. After this phase ships, newly-inserted Digests are never zero-degree — verified by a smoke test that triggers consolidation and asserts `graph.degree(digestId) >= 1` for every minted Digest.
  2. A one-shot repair script `scripts/repair-orphan-digest-insight-edges.mjs` walks the orphans returned by `/api/v1/graph/orphans` at phase-start, reads `metadata.observation_ids` (Digests) and `metadata.digest_ids` (Insights), and emits the missing `derivedFrom` / `synthesizedFrom` / `has_insight` edges with probe-before-write so a second invocation is a no-op. The 7 baseline orphans observed on 2026-06-15 21:46 drop to 0 after one run.
  3. The consolidator-side `has_insight` follower at `src/live-logging/ObservationConsolidator.js:677-694` is hardened so a freshly-minted `Insight` is never persisted without its project-anchor edge — either by wrapping `writeInsight` + `addRelation('has_insight')` in a single try-block whose failure rolls back the Insight (km-core delete) OR by tightening the probe so a transient `findRelations` mis-read can't false-negative the addRelation skip. The "1 orphan Insight per ~100 inserts" rate observed on 2026-06-15 is closed (acceptance: zero orphan Insights minted by a deliberate-failure-injection test).
  4. `/api/v1/stats` reports `orphanCount ≤ 10` at milestone close, sustained across 24h of online-learning activity (sampled hourly via a polling harness, not a snapshot reading). The measurement reads the live km-core graph that `unified-viewer @ :5173` reads — same `/api/v1/stats` endpoint cited by the pre-discuss reality check.

**Plans:** 5/5 plans complete
- [x] 59-01-PLAN.md — Refactor ObservationWriter.writeInsight to return {legacyId, mintedId} + unit tests (ORPHAN-INS-01 prerequisite)
- [x] 59-02-PLAN.md — Digest writer-fix: add derivedFrom loop after putEntity in consolidateDay plain-insert branch + unit tests (ORPHAN-DIG-01)
- [x] 59-03-PLAN.md — Update _pushInsightToKG to consume writeInsight's new {legacyId, mintedId} return shape; remove findByLegacyId race lookup (ORPHAN-INS-01)
- [x] 59-04-PLAN.md — Two-layer one-shot repair script: km-core graph orphan edges + cold-store digests.json dangling-ref scrub (ORPHAN-DIG-02; folds 2026-05-23 todo)
- [x] 59-05-PLAN.md — 24h orphan-floor soak harness + operator runbook (ORPHAN-FLOOR)

### Phase 60: Unified Viewer Rendering UX Integrity

**Goal:** The unified viewer at `localhost:5173/viewer/coding` becomes truthful — every filter checkbox has a symmetric, observable effect; the Legend reflects what is actually on screen; architecture-bleed entity types (`Observation`, `Digest`) are hidden by default; CollectiveKnowledge stays visible under the Online filter so focal-ancestry traces from leaf entities reach the system root; and the L2 lower-ontology classes from Phase 57 surface as expandable groups under their L1 parent in the ontology-class filter.
**Depends on:** Phase 57 (lower-ontology classes drive ontology-filter grouping + Legend computation)
**Requirements:** VKBUI-01, VKBUI-02, VKBUI-03, VKBUI-04, LOWERONTO-03
**Success Criteria** (what must be TRUE):

  1. Toggling the Layer filter Evidence checkbox OFF (Pattern ON) renders only Pattern-tagged nodes; toggling Pattern OFF (Evidence ON) renders only Evidence-tagged nodes. Both toggles produce the same direction of observable effect — neither is a silent no-op.
  2. The sidebar Legend (DOMAINS / LAYERS / SOURCE / RELATIONSHIPS sections) is computed from the currently-rendered graph; static OKB-domain entries such as `RuntimeDiagnostics` are NOT present when zero such nodes are rendered.
  3. `Observation` and `Digest` entity types do not appear in the production VKB graph render by default; an operator-visible debug toggle in the filter sidebar re-enables them for inspection without requiring a code change or query-string flag.
  4. With the Online learning-source filter active, `CollectiveKnowledge` remains visible in the rendered graph (or its path-trace anchor is preserved) so focal-ancestry traces from leaf entities still reach the system root — not truncated at the project level.
  5. The Ontology Class filter sidebar renders Phase 57's L2 lower-ontology classes as expandable groups under their L1 upper-ontology parent, each L2 row carries a per-class count badge, and the operator can collapse the group to filter all members at once.

**Plans:** 7/7 plans complete

Plans:

**Wave 1 (parallel — disjoint file surfaces)**

- [x] 60-01-PLAN.md — G1: Layer filter data contract — ship `integrations/unified-viewer/src/graph/layer.ts` `deriveLayer(entity, registry)` helper; wire into LayerFilter count badges + visibility-predicate (VKBUI-01)
- [x] 60-04-PLAN.md — G4: CollectiveKnowledge repair + writer-side hard-root guard — new `lib/km-core/src/types/hierarchy-roots.ts` HIERARCHY_ROOTS constant + `scripts/repair-ck-ontology-class.mjs` one-shot + ontology-classification-agent.ts guard (autonomous: false, has operator checkpoint for live repair-script execution) (VKBUI-04)
- [x] 60-05-PLAN.md — G5: L2 lower-ontology classes in OntologyFilter — drop hardcoded CODING_SCHEMA + Typed Views; build L1/L2 groups dynamically from `GET /api/v1/ontology/classes?withDisplay=true` (LOWERONTO-03)

**Wave 2** *(depends on 60-01 — Legend's LAYERS section + visibility-predicate VisibilityFilters interface both reach into the layer.ts module + visibility-predicate.ts)*

- [x] 60-02-PLAN.md — G2: Dynamic Legend — full rewrite of LegendPanel.tsx to receive entities + relations props and derive DOMAINS / LAYERS / SOURCE / RELATIONSHIPS from rendered set (VKBUI-02)
- [x] 60-03-PLAN.md — G3: Observation/Digest debug toggle — `showDebugEntityTypes: boolean` store field + GraphToggles row + predicate gate (VKBUI-03) — moved to Wave 2 because both 60-01 and 60-03 mutate the `VisibilityFilters` interface in `visibility-predicate.ts`; sequencing fixes the disjoint-file-surface invariant

**Wave 3** *(depends on all behavior plans landing)*

- [x] 60-06-PLAN.md — Cross-cutting verification — gsd-browser visual smoke against `localhost:5173/viewer/coding` for SC#1..SC#5 + Phase 56 viewport-stability + Phase 56.1 multi-selection invariants; produces 60-VERIFICATION.md (autonomous: false, operator checkpoint)

**Wave 4 — Gap closure (SC#5 follow-up)**

- [~] 60-07-PLAN.md — SC#5 gap closure: HIERARCHY_ROOTS-backed L0 synthesis + extends-derived parent fallback + L1/L2 data annotation in the ontology API. Tasks 1+2 complete (9/9 vitest); Task 3 is a blocking `human-verify` operator checkpoint (L0 anchors render; L1/L2 absent pending Deviation-3 obs-api registry-sourcing follow-up). (autonomous: false)

**Wave 5 — Gap closure (UX integrity, SC#2/SC#3 follow-up)**

- [x] 60-08-PLAN.md — Gaps C/D/E (+F): node-shape rendering per ontology class (legend↔canvas parity), selection breakdown header (`N items · X visible · Y hidden`), bidirectional hover (`hoveredNodeId` slice + CSS pulse), and a focal-node empty-panel fix. Implemented in `10e5ef12f` (2026-06-19); SUMMARY closed out 2026-06-20 after tests/tsc/build/browser re-verification. (VKBUI-02, VKBUI-03; autonomous: false)
**UI hint:** yes


**Wave 6 — Gap closure (SC#5 L2 classification — the real fix)**

- [x] 60-09-PLAN.md — SC#5 gap closure (LOWERONTO-03): classify entities at L2 so the OntologyFilter renders the real L0->L1->L2 tree. Deterministic name+description keyword classifier (`l2-subsystem-classifier.ts`) over the closed 10-class vocabulary (no LLM); going-forward writer wiring + submodule build/process-restart (dist is bind-mounted, no image rebuild); one-shot `backfill-l2-subsystem-class.mjs` migration (operator-checkpointed); `Project` level:0 in the ontology data; OntologyFilter renders level-None classes entities carry (Insight/Digest) + Project L0; operator visual re-verify flips 60-VERIFICATION SC#5 PARTIAL->PASS. (LOWERONTO-03; autonomous: false)

### Phase 61: LSL Timeline & OKB Routing Honesty

**Goal:** The LSL timeline strip stops lying about how much data it shows (no silent 200-record cap, no silent 365-day "all" window, no single tick color for two distinct session sources), and the unified viewer's OKB tab actually reaches the OKM Express server on `:8090` so operators see real RaaS / KPI-FW / business entities — not the coding-KG mirror they currently see.
**Depends on:** Nothing (independent UI + routing surgery on the unified viewer; can run in parallel with Phase 60 if operator wishes)
**Requirements:** LSLTIME-01, LSLTIME-02, LSLTIME-03, OKBROUTE-01, OKBROUTE-02
**Success Criteria** (what must be TRUE):

  1. The LSL timeline strip either streams every session in the selected window with no silent truncation, OR surfaces a visible "showing N of M total" label whenever the in-strip count is below the underlying total — the operator can never be silently fooled by the legacy 200-record `fetchSessions` cap.
  2. The "all" window option shows every ingested session in the LSL history, OR is renamed to honestly reflect what it actually shows (e.g., "1 year"). The current silent 365-day `WINDOW_MS` cap is no longer hidden behind an "all" label.
  3. LSL timeline ticks for manual-source sessions (Batch / Manual) and online-source sessions (Auto) render in two visually distinct colors; an operator scanning the strip can tell the two sources apart at a glance without hovering.
  4. Visiting `/viewer/okb` while the OKM Express server is running on `:8090` renders real RaaS / KPI-FW / business entities from OKM Express — the ApiClient detects the legacy `/api/entities` contract shape and routes correctly without forcing the km-core `/api/v1/entities` shape.
  5. The OKB tab never shows coding-KG mirror entities (e.g., `CodeAnalyzer`, `PersistenceAgent`); if the OKM Express server is unreachable, the tab surfaces a truthful "OKM Express unreachable on :8090" message rather than silently rendering the wrong data source.

**Plans:** 3/3 plans complete

Plans:

**Wave 1 (parallel — disjoint files)**

- [x] 61-01-PLAN.md — obs-api `/api/coding/lsl/sessions` adds additive `total` (true M) + per-session `source` ('online'|'batch', any-`manual`→`batch` rule) + extends `obs-api.coding-lsl-sessions.test.js` (LSLTIME-01, LSLTIME-03 backend dependency)
- [x] 61-02-PLAN.md — okb-scoped ApiClient path-rewrite (`/api/v1/`→`/api/` for `:8090` OKM Express) + relation cap 2000 / drop `CORRELATED_WITH` + visible "N of M relations" indicator + client-side 1-hop node-expand + E2E (no-mirror, truthful `:8090` unreachable) (OKBROUTE-01, OKBROUTE-02)

**Wave 2** *(depends on 61-01 for the backend total+source fields)*

- [x] 61-03-PLAN.md — strip frontend: "showing N of M" badge, `'all'`→`'1y'` rename (6 sites + toggle), amber/pink bi-source ticks, raise client cap to 500 + human-verify visual checkpoint (LSLTIME-01, LSLTIME-02, LSLTIME-03)
**UI hint:** yes

## Milestone v7.3: LLM Proxy Performance — Claude CLI Worker Pool (ACTIVE — started 2026-06-20)

**Goal:** Replace the per-call `claude` CLI `execFile` spawn on the claude-code fallback path with a small pool of warm, persistent stream-JSON workers — cutting sonnet/opus fallback latency from ~10–14s to ~2–3s steady-state and keeping Anthropic's prompt-cache warm. The direct OAuth bearer path stays primary for haiku (~0.9s) and is behaviorally unchanged; the pool serves ONLY the CLI-fallback path (sonnet/opus on HTTP 429, transient 401).

**Phase numbering:** Continues from Phase 61 (v7.2). New phases are **62–66** (5 phases). Does NOT reset to 1.

**Coverage:** 14 v7.3 requirements (POOL-01..04, WLIFE-01..04, GUARD-01..03, PERF-01..03) mapped to 5 phases. See `.planning/REQUIREMENTS.md` § v7.3 Traceability for the per-REQ-ID table.

**Code under change:** `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — the `claude-code` provider's two-tier dispatch (direct OAuth bearer → CLI `execFile` fallback on HTTP 429). **Research seed:** `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` (filename retains v7.2 origin; content is the v7.3 seed — measured latency breakdown, design constraints, acceptance criteria).

**Dependency order:** Worker-pool core + stream-JSON transport (Phase 62) must land first, with the `LLM_PROXY_DISABLE_WORKER_POOL=1` escape hatch (GUARD-01) wired in the same phase so every subsequent phase can fall back safely. Lifecycle / crash-recovery / cancellation (Phase 63) and long-lived-worker hygiene (Phase 64) build on the pool. The steady-state latency + crash-survival acceptance probe (Phase 65) and dashboard observability (Phase 66) close the milestone once behavior is in place.

**Out of scope:** Cross-provider fallback (claude-code → copilot — deliberately excluded; pinning to claude-code expresses user intent); general-purpose work queue / scheduler; worker pools for other CLI-based providers (claude-code is the only one where CLI spawn dominates latency).

### Phases

- [x] **Phase 62: Worker Pool Core & stream-JSON Transport** — persistent `claude -p --input-format stream-json --output-format stream-json` workers, per-model pinned, concurrency-1, serving ONLY the CLI-fallback path; `LLM_PROXY_DISABLE_WORKER_POOL=1` escape hatch wired first. (completed 2026-06-20)
- [x] **Phase 63: Worker Lifecycle — Lazy Spawn, Idle Eviction, Crash Recovery & Cancellation** — lazy spawn on first fallback, idle-evict after configurable timeout (default 30 min), crash → RETRYABLE + lazy respawn (no spin-loop), client-disconnect aborts the in-flight stream-JSON request. (all 5 plans landed 2026-06-21; mechanisms UNIT-proven in Plans 01-04 and confirmed by the `--live` SC-1..SC-4 verification suite in Plan 05. **WLIFE-01..04 ROADMAP-discharged 2026-06-21** by the operator `LLM_PROXY_LIVE=1` run — 9/9 tests PASS, exit 0, zero orphaned workers; SC-1..SC-4 all PASS. See 63-05-SUMMARY § Operator Live-Run — PASSED.)
- [x] **Phase 64: Worker Hygiene — CLI Version Pinning & stderr Throttling** — record `claude --version` at boot, recycle worker on version drift to keep prompt-cache assumptions valid; drain + throttle worker stderr to once-per-minute-per-worker so persistent-worker CLI warnings don't flood logs. (completed 2026-06-21)
- [ ] **Phase 65: Steady-State Latency & Crash-Survival Acceptance** — warm-worker sonnet `say OK` probe completes ≤3s steady-state (cold first-spawn may still be ~10s); pool survives a worker SIGKILL without dropping subsequent same-model requests; idle-eviction observable via `ps`; escape hatch reverts cleanly.
- [ ] **Phase 66: Dashboard Latency Observability** — the dashboard's claude-code/sonnet median latency column shows the ~14s → ≤3s drop within 24h of rollout.

### v7.3 Phase Details

### Phase 62: Worker Pool Core & stream-JSON Transport
**Goal:** The proxy can serve a claude-code CLI-fallback request through a warm, persistent `claude` CLI worker over stream-JSON stdio instead of spawning `execFile` per call — and an operator can disable the whole mechanism with a single env var to fall back to today's behavior unchanged.
**Depends on:** Nothing (first phase of the milestone; introduces the worker abstraction every later phase builds on)
**Requirements:** POOL-01, POOL-02, POOL-03, POOL-04, GUARD-01
**Success Criteria** (what must be TRUE):
  1. A claude-code CLI-fallback request for sonnet is served by a long-lived `claude -p --input-format stream-json --output-format stream-json` worker that booted once (auth + auto-injected system prompt loaded) and serves the request without spawning a fresh subprocess; a second sequential sonnet request reuses the same worker (verified by a stable worker PID across the two calls in `ps`).
  2. A request for model M is served only by a worker booted with `--model M` — a sonnet request never lands on a haiku-booted worker, and each model's pool stays cold (zero subprocesses) until that model's first fallback request.
  3. Two concurrent same-model fallback requests are never interleaved on a single worker's stdio — each worker serves at most one in-flight request; the second request either queues for that worker or dispatches to a sibling worker (2–3 per model).
  4. The direct OAuth bearer path remains the primary route for haiku at ~0.9s and is behaviorally unchanged — the worker pool is engaged ONLY on the CLI-fallback path (sonnet/opus HTTP 429, transient 401), verified by a haiku probe that never spawns a worker.
  5. Setting `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts the claude-code provider to the current per-call `execFile` path with no behavioral change vs. today (no workers spawn; latency and response shape match the pre-milestone baseline).
**Plans:** 3/3 plans complete

Plans:
**Wave 1 (test scaffolding — foundation)**
- [x] 62-01-PLAN.md — Wave-0 test scaffolding: shared mock-claude-stdio helper + RED unit suite (POOL-01 parsing, POOL-02 keying, POOL-03 concurrency-1 + D-06 overflow) + argv-gated `--live` integration suite (POOL-01 PID reuse, POOL-04 no-spawn-on-direct, GUARD-01, cancel seam). Encodes the 5 success criteria as named tests.

**Wave 2** *(depends on 62-01 — implements against the test contracts)*
- [x] 62-02-PLAN.md — `ClaudeWorker` class in NEW `proxy-bridge/worker-pool.mjs`: persistent `claude -p` stream-JSON spawn (verbatim strip flags, prompt-over-stdin), JSON-Lines framing (partial-line safe, stderr drained), one-promise-per-request, `{content,model,tokens}` extraction, `cancel()` interrupt seam (worker survives — Q3), threshold-driven recycle bounding cross-call context leakage (mandatory hazard control), reap-on-exit. (POOL-01)

**Wave 3** *(depends on 62-02 — both touch worker-pool.mjs)*
- [x] 62-03-PLAN.md — `WorkerPool` router (key=model×prompt-hash D-01, concurrency-1 + sibling dispatch POOL-03, overflow→execFile D-06, LRU prompt-pool cap D-02, lazy/no-allowlist D-07) + `completeClaudeCode()` dispatcher edit: `viaCliPath` helper gated by `LLM_PROXY_DISABLE_WORKER_POOL` (GUARD-01) orthogonal to `DISABLE_CLAUDE_DIRECT` (D-08); direct path + `completeClaudeCodeViaCLI` untouched (POOL-04). (POOL-02, POOL-03, POOL-04, GUARD-01)

### Phase 63: Worker Lifecycle — Lazy Spawn, Idle Eviction, Crash Recovery & Cancellation
**Goal:** Worker subprocesses come and go correctly under real traffic — they spawn only when needed, free their RAM when idle, survive individual crashes without spin-looping, and never get pinned by a dead client — so a concurrency-1 pool stays healthy across busy and idle periods.
**Depends on:** Phase 62 (the worker abstraction + per-model pool the lifecycle logic manages)
**Requirements:** WLIFE-01, WLIFE-02, WLIFE-03, WLIFE-04
**Success Criteria** (what must be TRUE):
  1. No workers spawn at proxy boot; the first claude-code fallback request for a model is what lazily spawns that model's first worker (verified by `ps` showing zero `claude -p` workers immediately after proxy start, then one appearing on first fallback).
  2. A worker that has been idle past the configurable idle timeout (default 30 min) exits and frees its RAM (observable via `ps` — the subprocess is gone), and a subsequent request for that model lazily respawns a fresh worker.
  3. A worker that exits unexpectedly is marked dead, its in-flight request is surfaced to the caller as RETRYABLE (not a hard error), and it respawns lazily only on the next request — never auto-restarted in a tight loop (verified by killing a worker mid-request and confirming no respawn-storm in logs).
  4. Client disconnect / request abort propagates to the worker so the in-flight stream-JSON request is cancelled (protocol cancel if supported, else SIGTERM + respawn) — a dead client never leaves a concurrency-1 worker pinned to a zombie request.
**Plans:** 5/5 plans complete

Plans:

**Wave 1**

- [x] 63-01-PLAN.md — D-08 synchronous dispose+drop helper + D-04/WLIFE-02 per-worker unref'd idle timer (unit)

**Wave 2** *(depends on 63-01)*

- [x] 63-02-PLAN.md — D-07 EPIPE-as-crash guard + D-02 monotonic generation guard against stray results (unit)

**Wave 3** *(depends on 63-01, 63-02)*

- [x] 63-03-PLAN.md — D-06 crash cooldown -> execFile overflow (respawn-storm guard) + boot-crash mock helper (unit)

**Wave 4** *(depends on 63-01, 63-02)*

- [x] 63-04-PLAN.md — D-01/D-03 cancellation: in-flight abort = SIGTERM+dispose+drop+cold-respawn; queued abort = dequeue-only (unit)

**Wave 5** *(depends on 63-01..04; autonomous:false — live OAuth)*

- [x] 63-05-PLAN.md — `--live` lifecycle verification suite: ps-based cold-start (WLIFE-01/SC-1), idle-evict (SC-2), crash (SC-3), cancel (SC-4 — Phase-62 hang now passes)

### Phase 64: Worker Hygiene — CLI Version Pinning & stderr Throttling
**Goal:** Long-lived workers stay correct and quiet across CLI upgrades and noisy CLI warnings — prompt-cache assumptions don't silently rot when the `claude` binary changes under a running worker, and persistent-worker stderr doesn't flood the logs.
**Depends on:** Phase 62 (worker boot + recycle hooks); benefits from Phase 63 lifecycle (recycle reuses the respawn path)
**Requirements:** GUARD-02, GUARD-03
**Success Criteria** (what must be TRUE):
  1. Each worker records the `claude` CLI version at boot; when `claude --version` drifts from a worker's boot version, that worker is recycled (drained + respawned) before serving the next request, keeping prompt-cache assumptions valid across CLI upgrades (verified by simulating a version change and observing the worker recycle).
  2. Worker stderr is drained continuously (so the pipe never blocks the subprocess) and throttled to at most one log line per minute per worker — persistent-worker CLI warnings (e.g. "no stdin data received") do not appear once-per-line in the proxy logs.
**Plans:** 2/2 plans complete

**Wave 1**

- [x] 64-01-PLAN.md — GUARD-02 CLI version pinning: deps-injectable boot-version capture + pool current-version snapshot + drift-flag-at-reuse through the existing _reapStale path (unit: simulated drift)

**Wave 2** *(depends on 64-01 — shared worker-pool.mjs/test file)*

- [x] 64-02-PLAN.md — GUARD-03 stderr drain+throttle (per-worker <=1/min, <=200-char, deps logger+clock) + WR-02 fold-in (cache-inclusive recycle-ceiling token sum) (unit: fake clock + summed-token payload)

### Phase 65: Steady-State Latency & Crash-Survival Acceptance
**Goal:** Prove the milestone's headline performance and resilience claims against the live proxy — the warm-pool fallback path is fast, survives a worker crash, evicts idle workers, and the escape hatch reverts cleanly — so the speedup is demonstrated, not assumed.
**Depends on:** Phase 62 (pool core), Phase 63 (lifecycle: crash recovery + idle eviction the probes exercise), Phase 64 (hygiene so steady-state runs don't degrade)
**Requirements:** PERF-01, PERF-02
**Success Criteria** (what must be TRUE):
  1. A sonnet `say OK` probe routed through the claude-code provider via a warm worker (cache hit) completes in ≤3s steady-state, repeatably (the cold first-spawn call may still take ~10s; the acceptance measurement is the warm steady-state path).
  2. SIGKILL-ing one worker PID for a model does not drop the subsequent fallback requests for that model — the next request is served (after a lazy respawn) and returns a valid completion, demonstrating the pool survives at least one worker crash.
  3. Idle eviction is observable end-to-end: after the configured idle timeout the worker exits (gone from `ps`), and a fresh request spawns a new one within the expected bound — confirming the idle-evict ↔ lazy-respawn cycle holds under the acceptance probe.
  4. Setting `LLM_PROXY_DISABLE_WORKER_POOL=1` and re-running the probe reverts cleanly to the per-call `execFile` path (no workers in `ps`, baseline latency restored) — the escape hatch is a safe rollback at acceptance time.
**Plans:** 1 plan

Plans:
- [ ] 65-01-PLAN.md — Formal acceptance gate (verify-only, autonomous:false): extend worker-pool-live.test.mjs with PERF-01 steady-state warm-latency probe (median of N>=5 warm `say OK` <=3s, hard gate + cache-presence floor), PERF-02 crash-survival (SIGKILL pid -> next request returns a valid completion from a NEW pid), SC-3 bounded idle respawn, SC-4 escape-hatch zero-ps + restored baseline latency; operator live-run records results in 65-HUMAN-UAT.md (discharges PERF-01/PERF-02; PERF-01 left blocked on a miss, no bar relaxation).

### Phase 66: Dashboard Latency Observability
**Goal:** Operators can see the speedup land in production — the dashboard's claude-code latency column reflects the warm-pool steady-state, so the ~14s → ≤3s improvement is visible and trackable within a day of rollout rather than only provable by an ad-hoc probe.
**Depends on:** Phase 62 (pool emitting the fast-path latencies), Phase 65 (acceptance probe establishes the ≤3s steady-state the dashboard should reflect)
**Requirements:** PERF-03
**Success Criteria** (what must be TRUE):
  1. The dashboard's claude-code latency column surfaces median claude-code/sonnet latency, and within 24h of worker-pool rollout that median drops from ~14s to ≤3s — the operator reads the speedup off the dashboard, not off a manual probe.
  2. The latency figure the dashboard shows for claude-code/sonnet is sourced from the same fallback-path traffic the pool serves (token-usage / latency telemetry), so a regression (e.g. pool disabled via escape hatch, or workers thrashing) would be visible as the median climbing back toward the ~14s baseline.
**Plans:** TBD
**UI hint:** yes

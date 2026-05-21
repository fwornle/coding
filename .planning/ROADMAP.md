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
- [x] 34-06-PLAN.md — Phase 33 leftover closure: AC #6 detection-latency P95 ≤ 10s + AC #11 destructive kill -9 respawn ≤ 30s + plist dead-key cleanup (D-15 + D-16 + D-17) — Option B applied; bootout/bootstrap re-applied plist (uptime 4326s → 3s); AC #6 PASS (50 trials, both assertions green); AC #11 PASS (1s respawn vs 30s threshold); Phase 33 re-run halts on pre-existing two-session-agreement test-side bug from `8f304038e` compound-key migration — NOT a 34-06 regression; D-14 24h soak gate PENDING by design (post-merge)

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
- [ ] **Phase 40: Ingest Pipeline & Layered Dedup** - 4-stage `extract → dedup → store → synthesize` framework with the layered dedup pipeline B and C will implement against.
- [ ] **Phase 41: Online Learning Adapter & Post-Hoc Resolution** - INT-01 (A's SQLite hot path exposed as KM-Core entities) + PIPE-02 (post-hoc cross-class entity resolution as a shared maintenance op).
- [ ] **Phase 42: Offline UKB Migration (B)** - Full migration of `mcp-server-semantic-analysis` to KM-Core; folds in Phase 10 embeddings-not-reaching-GraphDB issue and the `workflow-runner.ts:469–530` wave-analysis race condition.
- [ ] **Phase 43: OKM Cross-Repo Migration (C)** - Cross-repo refactor of `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management` onto KM-Core; rapid-automations CI stays green.
- [ ] **Phase 44: REST API & Git Snapshots** - Common entity/search/clusters/snapshots/ontology REST contract + git-snapshot/restore identical across A/B/C.
- [ ] **Phase 45: Unified Web Viewer** - Single viewer parameterized by ontology config; VKB (B) and VOKB (C) users migrate without functional regression.
- [ ] **Phase 46: Per-System Documentation & Onboarding** - Each system's README documents which configs it owns; KM-Core ships an architecture diagram + onboarding guide.

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

**Plans:** 5/8 plans executed

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

- [ ] 40-06a-PLAN.md — `IngestPipeline` 4-stage orchestrator class (extract → dedup → store → synthesize) + 10 unit tests (VALIDATION rows 40-T11..40-T18 + 2 extras). Pre-loads candidates via `store.findByOntologyClass` per D-46; threads `ProvenanceStamp` per CF-D30; supersession via Phase 39 `putEntity` (preserves CR-01 BatchOp.skipOntologyCheck). `runStage` declared as **4 typed function overloads** (LOCKED by RESEARCH Q2 RESOLVED — NOT a generic `<T>`). Synthesizer-input contract: matched-survivors-only per RESEARCH Example 5 line 646 verbatim. PIPE-01.

**Wave 4b (integration tests — sequential after 40-06a, depends on IngestPipeline class)**

- [ ] 40-06b-PLAN.md — 3 integration test files exercising the cross-module boundaries: `pipeline-supersession.test.ts` (4 tests — Phase 39 D-33 atomic closure + CR-01 legacy-id path; VALIDATION rows 40-T20, 40-T21), `pipeline-candidate-pool.test.ts` (4 tests — D-46 + Phase 39 D-34 active-only filter; VALIDATION row 40-T22), `layered-dedup-collision-catch.test.ts` (1 test — **ROADMAP SC#2 synthetic 3-collision** with `llmClient.complete.mock.calls.length === 1` proving short-circuit through both upper layers; VALIDATION row 40-T19). PIPE-01 + DEDUP-01. No source-file changes — exercises 40-06a's IngestPipeline through real GraphKMStore instances.

**Wave 5 (barrel + final green gate)**

- [ ] 40-07-PLAN.md — Amend `src/dedup/types.ts` with `EmbeddingClient` + `LLMClient` re-exports; create `src/pipeline/index.ts` + `src/dedup/index.ts` sub-barrels; append Phase 40 block to root `src/index.ts`; extend `package.json` exports map with `./pipeline` + `./dedup` sub-paths (mirrors Phase 38 `./ontology` precedent); external tmpdir smoke compile across root barrel + both sub-paths; final `npm run build` + `npm test` green gate. **depends_on:** 40-06b (not 40-06). PIPE-01 + DEDUP-01.

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

**Plans:** TBD

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

**Plans:** TBD

#### Phase 43: OKM Cross-Repo Migration (C)

**Goal:** Execute the cross-repo refactor that migrates C (`~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management`) onto KM-Core; this is a **separate repository** with its own CI, release cycle, and packaging story, so success means landing KM-Core in OKM via the agreed packaging strategy without breaking rapid-automations' green build.

**Depends on:** Phase 40
**Requirements:** INT-03
**Success Criteria** (what must be TRUE):

  1. The `rapid-automations` CI pipeline is green on the migration branch and on `main` after merge.
  2. OKM consumes KM-Core via the agreed packaging strategy (decided during this phase's discuss phase — submodule, npm package, or vendored copy) without copying or forking KM-Core source.
  3. Existing OKM REST consumers (VOKB viewer, `/api/entities`, `/api/relations`, `/api/search`, `/api/clusters`, `/api/rca-lookup`) continue to return the same shape they did before migration.
  4. OKM's per-domain JSON exports under `.data/exports/{domain}.json` continue to land with the same commit hygiene as before the migration.

**Plans:** TBD

#### Phase 44: REST API & Git Snapshots

**Goal:** Land the common REST contract (entity CRUD, search, clusters, snapshots, ontology metadata) and the git-snapshot/restore pattern over `.data/exports/` so all three systems expose the same query surface — necessary precondition for the unified viewer.

**Depends on:** Phase 41, Phase 42, Phase 43
**Requirements:** API-01, API-02
**Success Criteria** (what must be TRUE):

  1. The same REST request (e.g. `GET /api/entities?ontologyClass=...`) returns shape-identical responses against A, B, and C — only the data and ontology classes differ.
  2. A user can take a git snapshot of `.data/exports/` in any of the three systems and restore an earlier state via the shared snapshot/restore endpoint, with the resulting graph identical to the snapshot.
  3. A's existing `/api/observations|digests|insights` endpoints remain callable but resolve internally to typed views over `/api/entities?ontologyClass=...` (no consumer breakage during transition).
  4. The git two-commit pattern and OKB-baseline guard from existing export hygiene still hold under the unified snapshot endpoint.

**Plans:** TBD

#### Phase 45: Unified Web Viewer

**Goal:** Replace the two divergent viewers (VKB sigma.js for B, VOKB D3 for C) with a single web viewer parameterized by ontology configuration, so VKB and VOKB users migrate without losing functionality and KM-Core has one frontend surface to maintain.

**Depends on:** Phase 42, Phase 44
**Requirements:** UI-01
**Success Criteria** (what must be TRUE):

  1. A user can open the unified viewer pointed at A, B, or C's REST API and see the graph rendered with that system's ontology classes, colors, and hierarchy.
  2. Every interactive feature currently used by VKB users (entity click, expand, filter, search) and VOKB users (force-directed view, cluster overlays, RCA lookup) is present in the unified viewer.
  3. A VKB or VOKB user can switch to the unified viewer for daily work and not regress on any task they used to perform in the legacy viewer.
  4. The viewer's data layer reads exclusively through the Phase 44 REST contract — no direct LevelDB or SQLite access from the frontend.

**Plans:** TBD
**UI hint**: yes

#### Phase 46: Per-System Documentation & Onboarding

**Goal:** Each of A, B, C ships a README documenting which configurations it owns (ontology files, LLM provider config, ingest adapter config, domain eval logic), and KM-Core ships an architecture diagram + onboarding guide — so future contributors can tell at a glance where to add a new ontology class, LLM provider, or ingest source without reading source.

**Depends on:** Phase 45
**Requirements:** DOC-01
**Success Criteria** (what must be TRUE):

  1. A new contributor reading A's, B's, or C's README can locate within five minutes the exact config file(s) they would edit to add a new ontology class or LLM provider for that system.
  2. KM-Core's architecture diagram clearly distinguishes shared core (types, store, registry, pipeline, dedup, REST, viewer) from per-system configuration (ontology files, LLM config, ingest adapters, domain eval).
  3. The onboarding guide walks a new developer from clone → run KM-Core tests → register a new lower ontology → ingest a sample entity, with each step verifiable.
  4. Each system's README cross-references the others and KM-Core, so a contributor entering through any of the four doors can navigate to the others.

**Plans:** TBD

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 37. KM-Core Foundation | 5/5 | Complete   | 2026-05-20 |
| 38. Ontology Registry | 1/6 | In Progress|  |
| 39. Entity Data Model | 4/4 | Complete    | 2026-05-20 |
| 40. Ingest Pipeline & Layered Dedup | 5/8 | In Progress|  |
| 41. Online Learning Adapter & Post-Hoc Resolution | 0/? | Not started | - |
| 42. Offline UKB Migration (B) | 0/? | Not started | - |
| 43. OKM Cross-Repo Migration (C) | 0/? | Not started | - |
| 44. REST API & Git Snapshots | 0/? | Not started | - |
| 45. Unified Web Viewer | 0/? | Not started | - |
| 46. Per-System Documentation & Onboarding | 0/? | Not started | - |

---

## Backlog

### Phase 999.1: Extract Shared LLM Adapter Library (BACKLOG)

**Goal:** Extract `lib/llm/` to a shared submodule used by coding and rapid-automations/OKB. Add direct HTTP path for Claude Max (OAuth token from keychain -> Anthropic API, no CLI spawn) to eliminate 12-15s latency. Copilot provider already does direct HTTP (~2-5s) -- same pattern for claude-code.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

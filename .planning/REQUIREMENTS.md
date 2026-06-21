# Project Requirements

This file tracks the active milestone's requirements at the top, with previous milestones' requirements retained below for traceability.

---

# Milestone v7.3 Requirements — LLM Proxy Performance: Claude CLI Worker Pool (ACTIVE)

**Goal:** Replace the per-call `claude` CLI `execFile` spawn on the claude-code fallback path with a small pool of warm, persistent stream-JSON workers — cutting sonnet/opus fallback latency from ~10–14s to ~2–3s steady-state and keeping Anthropic's prompt-cache warm.

**Research seed:** `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` (filename retains v7.2 origin; content is the v7.3 seed — measured latency breakdown, design constraints, acceptance criteria). Code: `_work/rapid-llm-proxy/proxy-bridge/server.mjs`.

**Phase numbering:** Continues from Phase 61 (v7.2) → v7.3 phases start at **Phase 62**.

---

## v7.3 Requirements

### Worker Pool Core (POOL)

- [x] **POOL-01:** The proxy maintains persistent `claude` CLI workers communicating over `--input-format stream-json --output-format stream-json`; each worker boots once (auth + auto-injected system prompt loaded) and serves multiple sequential requests without re-spawning.
- [x] **POOL-02:** Workers are pinned per-model (haiku/sonnet/opus) — a request for model M routes only to a worker booted with `--model M`. Pool size is 2–3 workers per model, lazily spawned (a model's pool stays cold until its first fallback request).
- [x] **POOL-03:** Each worker serves at most one in-flight request at a time (concurrency 1); concurrent same-model requests queue or dispatch to a sibling worker — never interleaved on one worker's stdio.
- [x] **POOL-04:** The worker pool serves ONLY the claude-code CLI-fallback path (sonnet/opus on HTTP 429, transient 401). The direct OAuth bearer path remains the primary route for haiku (~0.9s) and is behaviorally unchanged.

### Worker Lifecycle (WLIFE)

- [x] **WLIFE-01:** Workers spawn lazily on the first claude-code fallback request for their model — no workers spawn at proxy boot.
- [x] **WLIFE-02:** An idle worker is evicted (subprocess exits, RAM freed) after a configurable idle timeout (default 30 min); a subsequent request lazily respawns it.
- [x] **WLIFE-03:** A worker that exits unexpectedly is marked dead, its in-flight request is surfaced as RETRYABLE (not a hard error), and it respawns lazily on the next request — never auto-restarted in a tight loop.
- [x] **WLIFE-04:** Client disconnect / request abort propagates to the worker — the in-flight stream-JSON request is cancelled (protocol cancel if supported, else SIGTERM + respawn) so a dead client never pins a concurrency-1 worker.

### Safety & Compatibility (GUARD)

- [x] **GUARD-01:** Setting `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts the claude-code provider to the current per-call `execFile` path with no behavioral change vs. today.
- [x] **GUARD-02:** The pool records the `claude` CLI version at worker boot and recycles a worker when `claude --version` drifts from its boot version, keeping prompt-cache assumptions valid across CLI upgrades.
- [x] **GUARD-03:** Worker stderr is drained and throttled (logged at most once per minute per worker, not once per line) so persistent-worker CLI warnings (e.g. "no stdin data received") do not flood logs.

### Performance & Observability (PERF)

- [x] **PERF-01:** A sonnet `say OK` probe routed through the claude-code provider via a warm worker (cache hit) completes in ≤ 3s steady-state. (Cold first-spawn call may still take ~10s.)
- [x] **PERF-02:** The pool survives at least one worker crash (e.g. SIGKILL a worker PID) without dropping subsequent requests for that model.
- [ ] **PERF-03:** The dashboard's claude-code latency column shows the speedup — median claude-code/sonnet latency drops from ~14s to ≤3s within 24h of rollout.

---

## Future Requirements (deferred from v7.3)

- Cross-provider fallback on 429 (claude-code → copilot) — deliberately excluded; pinning to claude-code expresses user intent, not "anything that works".
- General-purpose work queue / scheduler — the use case (2–3 concurrent fallback calls) is served by a fixed pool.
- Worker pools for other CLI-based providers — claude-code is the only provider where CLI spawn dominates latency.

## v7.3 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| POOL-01 | Phase 62 | Complete |
| POOL-02 | Phase 62 | Complete |
| POOL-03 | Phase 62 | Complete |
| POOL-04 | Phase 62 | Complete |
| GUARD-01 | Phase 62 | Complete |
| WLIFE-01 | Phase 63 | Complete (live-proven 2026-06-21 — 63-05 `--live` SC-1 cold-start PASS in the operator `LLM_PROXY_LIVE=1` run; 9/9 exit 0, zero orphans) |
| WLIFE-02 | Phase 63 | Complete (live-confirmed 2026-06-21 — 63-05 SC-2 idle-evict PASS) |
| WLIFE-03 | Phase 63 | Complete (63-02 EPIPE-as-crash fold-in; 63-03 crash-cooldown respawn-storm guard; live-confirmed 2026-06-21 — 63-05 SC-3 crash PASS) |
| WLIFE-04 | Phase 63 | Complete (63-02 stray-result generation guard + 63-04 D-01/D-03 SIGTERM+dispose+drop in-flight / dequeue queued; commits 959f6d3/a33629b; live-confirmed 2026-06-21 — 63-05 SC-4 cancel PASS) |
| GUARD-02 | Phase 64 | Complete (64-01: _bootVersion capture via deps.readVersion + pool _currentVersion snapshot + drift-flag-at-reuse through _reapStale; proxy commit cc4a0b6; unit-proven via simulated version change, 53 tests pass) |
| GUARD-03 | Phase 64 | Complete (64-02: drain-and-throttle stderr handler — every chunk drained, <=200-char sample logged <=1/min/worker via injected logErr + injectable clock; WR-02 fold-in cache-inclusive recycle ceiling; proxy commit 8fbc8d2; unit-proven via fake-clock throttle + summed-token ceiling, 58 tests pass) |
| PERF-01 | Phase 65 | Complete (live-proven 2026-06-21 — 65-01 `--live` PERF-01 SC-1 steady-state warm-latency probe PASS: median-of-N≥5 warm `say OK` ≤3000ms hard gate held with summed-`tokens.input` cache-presence floor cleared; the earlier ~3.9s informal observation did NOT reproduce. Operator run 12/12 exit 0, zero orphans — 65-HUMAN-UAT.md) |
| PERF-02 | Phase 65 | Complete (live-proven 2026-06-21 — 65-01 `--live` PERF-02 SC-2 crash-survival PASS: SIGKILL a worker pid read off the live handle, next same-key request returns a VALID non-empty completion from a NEW pid (acceptance delta over Phase-63 SC-3); SC-3 bounded idle respawn + SC-4 escape-hatch zero-ps + baseline both PASS — 65-HUMAN-UAT.md) |
| PERF-03 | Phase 66 | Not started |

**Coverage:** 14/14 v7.3 requirements mapped to 5 phases (62–66). No orphans, no duplicates.

---

# Milestone v7.2 Requirements — VKB & Online-Learning Quality (SHIPPED)

**Goal:** Bring the online learning pipeline → km-core → unified viewer surface to production data quality, so operators rely on the graph view for navigation and triage instead of working around known-broken rendering.

**Scope seed:** 9-todo cluster surfaced during Phase 56.1 visual smoke (2026-06-13/14) — see `.planning/MILESTONES.md` § v7.2.

---

## v7.2 Requirements

### Online pipeline semantic edges (EDGE)

- [x] **EDGE-01:** Online-generated Insight entities carry at least one semantic-content relation type (`mentions`, `dependsOn`, `isRelatedTo`, `instanceOf`, or equivalent — exact set decided in discuss-phase) beyond the existing `capturedBy → LiveLoggingSystem` provenance edge. Verified by sampling 20 random recent Insights; ≥18 carry such an edge. **Delivered Phase 58 (2026-06-15): `mentions` edge type only (D-01); SC#1 gate `--sample 20 --min 18` = PASS.**
- [x] **EDGE-02:** `ObservationConsolidator` writes the new Insight node and its semantic-content relations atomically — no orphan-Insight intermediate state observable from a concurrent `/api/v1/entities` reader. **Delivered Phase 58 (2026-06-15): atomic emission inside `ObservationWriter.writeInsight` try-block; integration tests #2/#3/#6 lock the ordering and fail-fast contracts.**

### Lower ontology + project grouping (LOWERONTO)

- [ ] **LOWERONTO-01:** Lower ontology declares coding-project-specific L2 classes for at least: `LiveLoggingSystem`, `ConstraintMonitor`, `OnlineObservation`, `OnlineDigest`, `OnlineInsight`, `KnowledgeManagement`. Loaded via `OntologyRegistry` from `.data/ontologies/coding.lower.json` (or equivalent project-scoped file).
- [ ] **LOWERONTO-02:** Upper ontology extended with ≥2 additional generic programming-aspect classes (e.g., `Diagnosis`, `Interface`) **IF** the operator confirms during the discuss-phase that the upper-ontology surface should grow. (Soft gate — may be deferred without blocking the milestone.) **[deferred — Phase 57 D-12]** Operator deferred upper-ontology growth at v7.2 phase 57 discuss-time; tracked in STATE.md for v7.2 retro reopening.
- [x] **LOWERONTO-03:** Unified viewer Ontology Class filter renders L2 lower-ontology classes as expandable groups under their L1 upper-ontology parent, with a per-class count badge. (Closed Phase 60 / Plan 60-09, 2026-06-20 — 9/10 L2 classes populated; EtmDaemon valid-but-unpopulated per no-forced-L2.)
- [ ] **LOWERONTO-04:** Every KG entity carries a `project` tag (e.g., `coding`, `okm`, `cap`); unified viewer exposes a project-grouping mode in the filter sidebar that visually clusters or filters nodes by project.

### VKB rendering UX integrity (VKBUI)

- [ ] **VKBUI-01:** Layer filter checkboxes are symmetric — toggling Evidence OFF (Pattern ON) renders only Pattern-tagged nodes; toggling Pattern OFF (Evidence ON) renders only Evidence-tagged nodes. Both have the same observable effect-direction (currently one is a no-op).
- [ ] **VKBUI-02:** Sidebar Legend (DOMAINS / LAYERS / SOURCE / RELATIONSHIPS sections) is computed from the currently-rendered graph — no static OKB-domain entries (e.g., `RuntimeDiagnostics`) appear when they have zero rendered instances.
- [ ] **VKBUI-03:** `Observation` and `Digest` entity types are filtered out of the VKB graph render by default (architecture bleed from the observations pipeline). An operator-visible toggle re-enables them for debugging. Per the 2026-06-11 cleanup digest, those entity types should never appear in the production VKB view.
- [ ] **VKBUI-04:** When the Online learning-source filter is active, `CollectiveKnowledge` remains visible in the rendered graph (or its path-trace anchor is preserved) so focal-ancestry traces from leaf entities reach the system root — not truncated at the project level.

### LSL timeline scale honesty (LSLTIME)

- [ ] **LSLTIME-01:** LSL timeline strip removes the silent 200-record hard cap in `useLslSessions.ts` `fetchSessions`. Either expose the cap via a user-visible "showing N of M total" label OR remove the cap entirely and stream all sessions in the selected window.
- [ ] **LSLTIME-02:** The "all" window option in the LSL timeline shows ALL ingested session history (currently `WINDOW_MS` caps it at 365 days). Either remove the cap or rename the option honestly (e.g., "1 year").
- [ ] **LSLTIME-03:** LSL timeline tick coloring distinguishes manual-source (Batch/Manual) sessions from online-source (Auto) sessions via two visually distinct colors (currently single-color).

### OKB data routing (OKBROUTE)

- [ ] **OKBROUTE-01:** `/viewer/okb` ApiClient detects the OKM Express server's legacy `/api/entities`-shape contract on `:8090` and routes correctly to it WITHOUT requiring km-core's `/api/v1/entities` shape. Adapter logic in `lib/system-endpoints.ts` or `ApiClient.ts`.
- [ ] **OKBROUTE-02:** When `/viewer/okb` successfully loads, it renders real RaaS / KPI-FW / business entities from OKM Express — NOT coding-KG mirror entities (e.g., `CodeAnalyzer`, `PersistenceAgent`).

### Long-tail orphan fixes (ORPHAN) — superseded 2026-06-15 (see DOWNSCOPED below)

ORPHAN-01..04 are **closed by upstream work** (Phase 57 regression-recovery on 2026-06-15 06:24 + viewer migration from `memory-visualizer` to `unified-viewer`/km-core REST). Evidence captured during the Phase 59 pre-discuss reality check on 2026-06-15 21:46:
- `/api/v1/stats` reports `nodes=840, edges=1675, orphanCount=7 (~0.83%), connectivity=98.5%` — `orphanCount ≤ 30` (ORPHAN-04) **met by 4× margin**.
- 326 `SubComponent` + 312 `Detail` entities exist in the live graph; **zero** are in the orphan list — ORPHAN-02's 122-orphan instance set is gone.
- `CollectiveKnowledge` carries `parent-child` edges to all 4 Project anchors (`Coding`, `Normalisa`, `Timeline`, `DynArch`) — ORPHAN-03 functionally met (edge type is `parent-child`, not `--includes-->` as written, but structurally equivalent).
- Only 1 `System` entity exists (`CollectiveKnowledge`) and it has 16 edges; the operator-facing viewer is `unified-viewer @ :5173` (no System-strip) — `memory-visualizer/databaseClient.ts:262` is the wrong target (line has been refactored to `loadKnowledgeGraph()`). ORPHAN-01 no longer operative.

- [x] **ORPHAN-01:** Closed-upstream (2026-06-15). Memory-visualizer no longer the operator surface; unified-viewer reads km-core `/api/v1/*` with no System-strip.
- [x] **ORPHAN-02:** Closed-upstream (2026-06-15). 0 SubComponent/Detail orphans in live km-core graph.
- [x] **ORPHAN-03:** Closed-upstream (2026-06-15). All 4 Project anchors carry `parent-child` from `CollectiveKnowledge`.
- [x] **ORPHAN-04:** Met-upstream (2026-06-15). `orphanCount=7 ≤ 30`. Restated as ORPHAN-FLOOR below with a tighter floor.

### Digest/Insight writer-edge repair (ORPHAN-DIG / ORPHAN-INS / ORPHAN-FLOOR) — downscoped Phase 59 (2026-06-15)

- [ ] **ORPHAN-DIG-01:** `ObservationConsolidator._executeDigestStage` (`src/live-logging/ObservationConsolidator.js:1293-1296`) follows every `kmStore.putEntity(legacyDigestToEntity(row, ...))` call with `kmStore.addRelation` calls materializing one `Digest -[derivedFrom]-> Observation` edge per id in `row.observation_ids` (probe-before-write for idempotency, mirroring the `has_insight` pattern at OC.js:684-690). New Digest inserts after this phase ships are NEVER zero-degree.
- [ ] **ORPHAN-DIG-02:** One-shot repair script walks the existing orphan Digests + Insights at phase-start, reads `metadata.observation_ids` and `metadata.digest_ids`, emits the missing `derivedFrom` / `synthesizedFrom` / `has_insight` edges. Idempotent on re-invocation. Reduces baseline 7 orphans to 0.
- [ ] **ORPHAN-INS-01:** The consolidator-side `has_insight` follower at `src/live-logging/ObservationConsolidator.js:677-694` is hardened so a freshly-minted `Insight` entity is never persisted without its project-anchor `has_insight` edge — either by wrapping entity+edge in a single km-core transaction or by failing the Insight insert when `addRelation` throws (current code skips silently per Landmine 5). The "1 orphan Insight in 100" rate observed on 2026-06-15 is closed.
- [ ] **ORPHAN-FLOOR:** `/api/v1/stats` `orphanCount ≤ 10` sustained across 24h of online-learning activity (NOT a snapshot reading) at milestone close. Stricter floor than the closed-upstream ORPHAN-04 target.

---

## Future Requirements (deferred)

- Bi-directional Insight ↔ Domain entity reasoning (graph queries that walk both `capturedBy` provenance edges AND semantic-content edges) — defer until EDGE-01/02 ship and we know what semantic edges actually look like in practice.
- Re-running existing online-learning batches to backfill semantic edges on historic Insights — defer to a separate maintenance phase once EDGE-01 stabilizes.
- Cross-viewer (VKB ↔ VOKB ↔ unified) feature reconciliation — defer until v7.2 ships and VKB at `:8080` is honestly retired or relabeled as legacy.
- Ontology versioning (semver-style upper/lower ontology versions with migration policy) — defer until LOWERONTO-01..04 prove stable in practice.

## Out of Scope

- LLM proxy worker pool performance work — queued as v7.3.
- Cross-agent performance measurement system — queued as v7.4.
- Phase 51 follow-up todos (`opencode-schema-migration-update.md`, `sweep-llm-proxy-probe-fix.md`, `json-export-missing-source-field.md`, sub-agent dashboard observability gap) — agent-capture concerns, not graph data quality.
- Phase 54 ETM hardening — runs in parallel as a separate backlog phase.
- Phase 35-04/05 retention pruner + cold-store reader wiring — runs in parallel.
- Phase 46 ONBOARDING.md operator UAT — v7.1 close-out, runs in parallel.
- Migrating `.observations/observations.db` to km-core entirely — Plan 44-18 closed that loop; no further consolidation.
- Replacing Graphology / LevelDB / JSON export — KM-Core wraps these, doesn't replace them (constraint preserved from v7.1).

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EDGE-01 | Phase 58 | Complete (2026-06-15) |
| EDGE-02 | Phase 58 | Complete (2026-06-15) |
| LOWERONTO-01 | Phase 57 | Not started |
| LOWERONTO-02 | Phase 57 | Deferred (D-12) |
| LOWERONTO-03 | Phase 60 | Done (2026-06-20) |
| LOWERONTO-04 | Phase 57 | Not started |
| VKBUI-01 | Phase 60 | Not started |
| VKBUI-02 | Phase 60 | Not started |
| VKBUI-03 | Phase 60 | Not started |
| VKBUI-04 | Phase 60 | Not started |
| LSLTIME-01 | Phase 61 | Planned |
| LSLTIME-02 | Phase 61 | Planned |
| LSLTIME-03 | Phase 61 | Planned |
| OKBROUTE-01 | Phase 61 | Planned |
| OKBROUTE-02 | Phase 61 | Planned |
| ORPHAN-01 | Phase 59 | Closed-upstream (2026-06-15) |
| ORPHAN-02 | Phase 59 | Closed-upstream (2026-06-15) |
| ORPHAN-03 | Phase 59 | Closed-upstream (2026-06-15) |
| ORPHAN-04 | Phase 59 | Met-upstream (2026-06-15) — restated as ORPHAN-FLOOR |
| ORPHAN-DIG-01 | Phase 59 | Not started |
| ORPHAN-DIG-02 | Phase 59 | Not started |
| ORPHAN-INS-01 | Phase 59 | Not started |
| ORPHAN-FLOOR | Phase 59 | Not started |

**Coverage:** 23 requirements — will be mapped to phases by `gsd-roadmapper`.

---

# Milestone v7.1 Requirements — Knowledge Management Unification (SHIPPED — archived for traceability)

**Goal (v7.1):** Extract a shared KM-Core from three knowledge-management systems (A: Online Learning, B: Offline UKB, C: OKM) so each application uses a common codebase parameterized by per-system configuration.

**Research seed:** `.planning/research/v7.1-km-unification.md`

**Status:** 10 of 10 numbered phases done (37-46); one Phase 46 ONBOARDING.md operator UAT remains pending. v7.1 will be formally archived once that UAT lands.

---

## v7.1 Requirements

### Core types & storage (CORE)

- [x] **CORE-01:** KM-Core package exports canonical entity and relation TypeScript types consumed by all three systems.
- [x] **CORE-02:** GraphKMStore adapter (Graphology in-memory + LevelDB durable + git-tracked JSON export) is consumed by B and C without code duplication.
- [x] **CORE-03:** All cross-system entity references use a stable UUID-keyed identifier scheme.

### Ontology system (ONTO)

- [x] **ONTO-01:** OntologyRegistry auto-discovers upper + lower ontologies from a configured directory (`ontology/*.json`).
- [x] **ONTO-02:** Lower ontologies extend upper ontologies via an `extends` field with property merging.

### Consolidation framework (PIPE)

- [x] **PIPE-01:** 4-stage ingest-time consolidation pipeline (extract → dedup → store → synthesize) is defined in KM-Core; A's daily-digest/weekly-insight roll-up and B's wave-agents both implement against it.
- [x] **PIPE-02:** Post-hoc entity resolution is exposed as a KM-Core maintenance operation that scans the existing graph by `ontologyClass` and runs LLM semantic matching across the whole class.

### Deduplication (DEDUP)

- [x] **DEDUP-01:** Layered dedup pipeline (exact name → embedding cosine → LLM semantic) defined in KM-Core; A, B, and C each plug system-specific implementations into the shared stages.

### Entity data model (DATA)

- [x] **DATA-01:** All entities carry `validFrom`, `validUntil`, and `supersedes` fields.
- [x] **DATA-02:** Structured provenance fields (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment provenance) are present on every entity.

### Query API & snapshots (API)

- [x] **API-01:** Common REST contract (entity CRUD, search, clusters, snapshots, ontology metadata) is exposed by all three systems.
- [x] **API-02:** Git snapshot + restore on `.data/exports/` works identically in all three systems.

### Unified viewer (UI)

- [x] **UI-01:** A single web viewer renders any KM-Core graph parameterized by ontology config; both VKB (B) and VOKB (C) users migrate to it without functional regression. *(Phase 45 MVP — 2026-06-08; routing layer + minimal viewer shell.)*
- [x] **UI-02:** Unified viewer reaches ≥90% feature parity with VOKB plus four coding-specific surfaces. *(Phase 55 — 13/13 plans complete; 55-VERIFICATION.md present.)*

### Per-system integration (INT)

- [x] **INT-01:** A (Online Learning) keeps its SQLite hot path; a thin KM-Core adapter exposes observations/digests/insights as KM-Core entities.
- [x] **INT-02:** B (Offline UKB) migrated to KM-Core; the Phase 10 embeddings-not-reaching-GraphDB issue and the `workflow-runner.ts:469–530` wave-analysis race condition are fixed during migration.
- [x] **INT-03:** C (OKM in `~/Agentic/_work/rapid-automations`) migrated to KM-Core via cross-repo refactor; rapid-automations CI remains green.

### Documentation (DOC)

- [x] **DOC-01:** Each system has a README documenting which configurations it owns; KM-Core has an architecture diagram + onboarding guide. *(One Phase 46 operator HUMAN-UAT pending: ONBOARDING.md dry-run.)*

---

## v7.1 Future Requirements (deferred at milestone close)

- Migrate A's SQLite hot path to the graph model — defer until KM-Core has proven hot-write performance under ETM load.
- Real-time bidirectional sync between systems via event bus — premature until each system is on KM-Core and the event shape is stable.
- Embedding/vector-store unification (Qdrant) — keep as optional sidecar; converge in a later milestone if A/B/C diverge meaningfully on retrieval semantics.

## v7.1 Out of Scope (locked at milestone close)

- Rewriting the MCP server interface for B — `ukb full` invocation contract stays.
- Replacing Graphology, LevelDB, or the existing JSON export format — KM-Core wraps these, doesn't replace them.
- Breaking changes to existing `.data/observation-export/*.json` and `.data/knowledge-export/coding.json` paths.
- Cross-repo dependency injection between coding/ and rapid-automations/ via private npm — out for v7.1; OKM consumes KM-Core via the agreed packaging strategy.
- New ingest adapters for A/B/C — each system keeps its existing source set.

## v7.1 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 37 | Complete |
| CORE-02 | Phase 37 | Complete |
| CORE-03 | Phase 37 | Complete |
| ONTO-01 | Phase 38 | Complete |
| ONTO-02 | Phase 38 | Complete |
| DATA-01 | Phase 39 | Complete |
| DATA-02 | Phase 39 | Complete |
| PIPE-01 | Phase 40 | Complete |
| DEDUP-01 | Phase 40 | Complete |
| INT-01 | Phase 41 | Complete |
| PIPE-02 | Phase 41 | Complete |
| INT-02 | Phase 42 | Complete (via 42.1/42.1.1/42.1.2/42.2 chain) |
| INT-03 | Phase 43 | Complete (OKM PR #4 merged 2026-06-02) |
| API-01 | Phase 44 | Complete |
| API-02 | Phase 44 | Complete |
| UI-01 | Phase 45 | Complete (Phase 45 MVP) |
| UI-02 | Phase 55 | Complete (13/13 plans; VERIFICATION present) |
| DOC-01 | Phase 46 | Complete (one operator HUMAN-UAT pending — ONBOARDING.md dry-run) |

**Coverage:** 18/18 v7.1 requirements mapped, all phases complete (Phase 46 has one outstanding operator-side UAT).

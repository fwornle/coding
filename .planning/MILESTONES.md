# Milestones

## v7.3 LLM Proxy Performance — Claude CLI Worker Pool (Shipped: 2026-06-21)

**Phases completed:** 5 phases (62–66), 16 plans
**Git range:** `638d525e3` (62-01) → milestone close — 2026-06-20 → 2026-06-21
**Audit:** `tech_debt` — 14/14 requirements satisfied, integration_ok, 0 blockers (see `milestones/v7.3-MILESTONE-AUDIT.md`)
**Known deferred items at close:** 23 pre-existing cross-milestone artifacts (acknowledged — see STATE.md Deferred Items) + 1 new non-blocking `overhead_ms` export/hydrate gap

**Outcome:** Replaced the per-call `claude` CLI `execFile` spawn on the claude-code fallback path with a pool of warm, persistent stream-JSON workers — cutting sonnet/opus fallback latency from ~10–14s to ~2–3s steady-state and keeping Anthropic's prompt-cache warm.

**Key accomplishments:**

- **Persistent worker pool (Phase 62 — POOL-01..04, GUARD-01):** per-model (haiku/sonnet/opus), concurrency-1, lazily-spawned `claude -p` stream-JSON workers serving ONLY the claude-code CLI-fallback path, behind the orthogonal `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch; direct-OAuth path unchanged.
- **Full worker lifecycle (Phase 63 — WLIFE-01..04, live-proven 9/9):** lazy spawn, idle eviction (default 30 min), crash-recovery surfaced as RETRYABLE with a per-key respawn-storm cooldown, and client-disconnect cancellation (SIGTERM+dispose+drop in-flight / dequeue queued) so a dead client never pins a concurrency-1 worker.
- **Worker hygiene (Phase 64 — GUARD-02/03):** CLI version-drift recycle (keeps prompt-cache assumptions valid across `claude` upgrades) + stderr drain-and-throttle (≤1 log/min/worker).
- **Acceptance, operator live-run (Phase 65 — PERF-01/02, 12/12 PASS):** warm sonnet `say OK` ≤3s steady-state with cache-presence floor; pool survives a worker SIGKILL and keeps serving; idle respawn + escape-hatch revert both clean.
- **Dashboard observability (Phase 66 — PERF-03):** introduced a per-model SPAWN/QUEUE `overhead_ms` metric (dispatch→first-output, EXCLUDING generation — the latency the pool actually controls) with a NULL-safe `p50_overhead_ms` median, graded green/amber/red on both `:3032` surfaces. Gap-closure arc (66-03/04/05): the executor refused to fake an unreachable SC-2 red on this fast host, surfaced the threshold-vs-real-overhead mismatch, and closed it with an opt-in `LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam — SC-1 (warm→green) and SC-2 (regression→red) both live-proven via gsd-browser computed-rgb read-back.

---

## v7.2 VKB & Online-Learning Quality — Graph Data Quality, Ontology Rework, Viewer UX Integrity (ACTIVE)

**Why:** Phase 56.1 visual smoke (2026-06-13/14) surfaced a cluster of seven inter-related quality issues across the unified viewer + online learning pipeline + ontology layer. The foundational pipeline is healthy (km-core export at 1262 nodes / 1592 edges / 88% connectivity after the 2026-06-10 backfill + repair commits), but the long tail of data quality issues makes operators work around the graph view instead of relying on it. Two of the surfaced todos carry operator-set `scope_hint: This is a multi-phase milestone, not a single TODO`.

**Goal:** Bring the online learning pipeline → km-core → unified viewer surface to production data quality, so operators rely on the graph view for navigation and triage instead of working around known-broken rendering.

**Target features (6):**

1. Online pipeline emits semantic-content edges (mentions / dependsOn / isRelatedTo / instanceOf) on Insights — not just `capturedBy → LiveLoggingSystem`.
2. Ontology rework — clarify upper/lower split, build out lower ontology for coding-specific concepts (LSL, ConstraintMonitor, Online-Observation/Digest/Insight tiers), per-project grouping in viewer.
3. VKB rendering UX integrity — Evidence/Pattern filter symmetry, Legend derived from rendered graph, eliminate Observations/Digests architecture bleed, restore CollectiveKnowledge visibility under Online filter.
4. LSL timeline scale honesty — remove 200-record silent cap, honest "all" window name, bi-source coloring (manual vs online) on ticks.
5. OKB data routing fix — resolve `/api/entities` vs `/api/v1/entities` contract mismatch so `/viewer/okb` reaches OKM Express on :8090.
6. Long-tail orphan fixes — close Phase 48 (System-type vanish), Phase 49 (orphan project-anchor relations); reduce 157-orphan baseline materially.

**Scope seed (cluster of 9 todos):**

- `.planning/todos/pending/2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source.md` *(operator-flagged multi-phase milestone)*
- `.planning/todos/pending/2026-06-14-ontology-rework-lower-ontology-and-project-grouping.md` *(operator-flagged multi-phase milestone)*
- `.planning/todos/pending/2026-06-14-online-filter-hides-ck-truncates-trace.md`
- `.planning/todos/pending/2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md`
- `.planning/todos/pending/2026-06-14-vkb-legend-static-cross-domain-bleed.md`
- `.planning/todos/pending/2026-06-14-vkb-shows-observations-digests-architecture-bleed.md`
- `.planning/todos/pending/2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md`
- `.planning/todos/pending/2026-06-10-okm-express-api-contract-bridge.md`
- ROADMAP entries Phase 48 (System-type vanish) + Phase 49 (project-anchor orphans) — placeholders folded into v7.2 phase scoping

**Out of scope:**

- LLM proxy worker pool perf (now queued as v7.3 — see below)
- Cross-agent performance measurement system (now queued as v7.4)
- Phase 51 follow-up todos (`opencode-schema-migration-update`, `sweep-llm-proxy-probe-fix`, `json-export-missing-source-field`, sub-agent dashboard observability gap) — agent-capture concerns, not graph data quality
- Phase 54 ETM hardening — operationally adjacent but already its own backlog phase with 3 plans pre-drafted (runs in parallel)
- Phase 35-04/05 retention wiring — runs in parallel
- Phase 46 ONBOARDING.md operator UAT — v7.1 close-out, runs in parallel

**Phase numbering:** Continues from current state. Phase 56.1 was last; new milestone phases start at **Phase 57**.

**Status:** ACTIVE 2026-06-14. Started while v7.1 still has one Phase 46 HUMAN-UAT pending (ONBOARDING.md operator dry-run). v7.1 will be formally archived once that UAT lands.

---

## v7.3 LLM Proxy Performance — Claude CLI Worker Pool (QUEUED, not active — renumbered from v7.2 on 2026-06-14)

**Why:** The `claude-code` direct OAuth path (~0.9s, real token counts) handles haiku perfectly, but Anthropic rate-limits the bearer endpoint per-model. Sonnet/opus on Max-OAuth hit HTTP 429, and the proxy now falls back to the `claude` CLI subprocess — which works against the same Max subscription via a different rate-limit bucket but costs ~10-14s per call due to per-request CLI spawn + the ~16-22K cache_creation system prompt the CLI auto-injects.

**Goal:** Maintain a small persistent pool of warm `claude` CLI workers communicating over stream-JSON stdin/stdout, eliminating the per-call spawn (~3-5s) and keeping Anthropic's prompt-cache warm for the auto-injected system prompt (~2-3× cheaper + faster on cache hits). Expected: 7-15s → ~2-3s per CLI-fallback call.

**Research seed:** `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` *(filename retains the v7.2 origin — content unchanged; new milestone slot is v7.3)*

**Status:** Queued. Do NOT activate while v7.2 (VKB & Online-Learning Quality) is in progress. Plan-phase work to begin after v7.2 ships.

---

## v7.4 Performance Measurement System — Cross-agent Token + Route + Outcome Attribution (QUEUED, not active — renumbered from v7.3 on 2026-06-14)

**Why:** Today we have no quantitative basis for recommending agent / model / framework / spec-level choices to dev teams. The proxy's `/api/token-usage` Evolution chart covers background services (wave-analysis, observation-writer, health-coordinator), but the agent-side spend — user ↔ CA conversations, sub-agents, per-tool-call breakdowns — is invisible. Without per-task attribution across both sides, "approach X cost Y for task type Z" is anecdote, not evidence.

**Goal:** Build a measurement rig that quantifies, per task, the full cost across all four supported agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task. Attribution at the best granularity each agent surfaces (Claude per-turn + per-reasoning-step for extended thinking, Copilot per-session-aggregate or per-turn pending verification, OpenCode per-llm-call via proxy, Mastra TBD). Time-series on one timeline via the existing `.observations/token-usage.db` extended with `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens`. Full snapshot/restore for reproducibility (git + KB + `.planning/` + routing config + MCP inventory + external HTTP fixtures). New km-core KB of `Experiment / Run / Route / Step / Decision / Outcome / Report` entities and a "Performance" dashboard tab (slotted after Tokens).

**Scoping artifacts:**

- `.planning/notes/v73-perf-measurement-exploration.md` — 7 architectural decisions + 9-phase shape sketch with Phase 3 flagged FOUNDATIONAL *(filename retains v73 origin; new slot is v7.4)*
- `.planning/notes/v73-token-attribution-contract.md` — storage / measurement-span / per-agent adapter contracts
- `.planning/spikes/copilot-proxy-interception.md` — completed spike (4-approach verdict table + recommendation)
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md` — hard requirements

**Out of scope:** VS Code Copilot Chat (state.vscdb opaque); policy automation / auto-routing (queued as v7.5); currency conversion (v7.5).

**Status:** Queued. Do NOT activate while v7.2 (VKB & Online-Learning Quality) or v7.3 (LLM Proxy Worker Pool) is in progress. The full `/gsd-new-milestone` workflow (requirements + roadmap) runs after both ship. Todo: `.planning/todos/pending/start-v73-milestone.md` *(filename retains v73 origin; the todo body refers to the same scope, now slotted as v7.4)*.

---

## v6.0 v6.0 (Shipped: 2026-04-25)

**Phases completed:** 7 phases, 11 plans, 25 tasks

**Key accomplishments:**

- fastembed ONNX embedding service with all-MiniLM-L6-v2 (384-dim), content hashing for idempotency, and Qdrant collection management for 4 knowledge tiers
- One-shot CLI backfill of 1464 knowledge items (645 observations, 132 digests, 12 insights, 675 KG entities) into 4 Qdrant collections with content-hash idempotency
- Redis pub/sub event bus wiring ObservationWriter to embedding listener for automatic Qdrant upserts within seconds of observation creation
- Hybrid retrieval engine combining RRF-fused semantic (Qdrant) + keyword (FTS5/LIKE) + recency search with tier-weighted scoring and gpt-tokenizer budget enforcement
- POST /api/retrieve endpoint wired into health API server with input validation, latency tracking, and Docker bind-mount for retrieval modules
- UserPromptSubmit hook injecting Qdrant-retrieved knowledge (insights, digests, entities, observations) as system-reminder context into Claude Code conversations with fail-open design
- Shared fail-open HTTP retrieval client with context-aware scoring (project 1.15x, cwd 1.10x, recent_files 1.20x cumulative boosts)
- Migrated Claude hook to global settings with shared retrieval client; created OpenCode/Copilot/Mastra session-start adapters; wired all into agent launch pipeline with fail-open timeout
- Live working memory from VKB KG entities + STATE.md frontmatter, token-budgeted to 300 tokens, prepended to every retrieval response
- Per-agent RRF scoring profiles with tier weight multipliers flowing from all four adapters through retrieval service to fusion layer
- Session state writer on agent exit with cross-agent injection via working memory using 2-hour staleness window and fail-open design

---

## v4.0 Mastra Integration & LSL Observational Memory (Shipped: 2026-04-05)

**Phases completed:** 4 phases, 11 plans, 22 tasks

**Key accomplishments:**

- LLM proxy bridge server ported from OKM, delegating to existing lib/llm/LLMService with network-adaptive routing. Token budget and plugin config files created.
- Mastra OpenCode install/uninstall/test functions added to lifecycle scripts with Node 22+ gate, LibSQL storage at .observations/, and 5-check smoke test
- Mastracode agent adapter, launch wrapper, and --mastra CLI flag enabling `coding --mastra` to start mastracode in standard tmux layout
- Mastra agent registered in tmux statusline (magenta M: prefix), health monitor, process supervisor, and remediation with non-blocking LLM proxy checks
- MastraTranscriptReader watching NDJSON lifecycle hook transcripts with full ETM pipeline integration -- mastra conversations flow through exchange extraction, classification, and LSL output
- hooks.json populated with 6 lifecycle hook commands writing NDJSON transcript events to .observations/transcripts/ for MastraTranscriptReader consumption
- Three-format transcript normalizer (Claude JSONL, Copilot events, specstory markdown) with LLM-proxy-routed observation writer and CLI skeleton
- Claude JSONL and Copilot events.jsonl converter handlers with hardened parsers, exchange grouping, and streaming progress reporting
- Batch .specstory converter with SHA-256 manifest idempotency, chronological processing, and --force override
- ETM fires per-exchange observations via ObservationWriter (fire-and-forget) and health API serves GET /api/observations with agent/time/project/FTS5 filtering
- Observations dashboard with sidebar filters, agent-colored expandable cards, pagination, and 30s auto-refresh via react-router-dom routing

---

## v2.1 Wave Pipeline Quality Restoration (Shipped: 2026-03-10)

**Phases completed:** 6 phases (9-14), 20 plans
**Audit status:** tech_debt (Plan 14-03 deferred — workflow state management needs redesign before E2E verification is meaningful)

**Key accomplishments:**

- Full agent pipeline integration (semantic analysis, persistence, insight generation, ontology classification) into wave architecture
- All 6 KG operators restored (conv, aggr, embed, dedup, pred, merge)
- Content quality gate with QA validation and coordinator retry-with-feedback
- Pipeline observability with trace modal (LLM counts, timing, model info, data flow)
- Code-graph-rag integration as code-evidence source for wave agents
- Relationship diagrams and constraint validation gate (Plans 14-01, 14-02)

**Deferred to v3.0:**

- Plan 14-03: Wave 4 diagram wiring + Docker E2E verification
- Workflow state management redesign (fundamental architecture issue)
- Dashboard substep coloring (blocked by state management issues)
- "Batch" label rename (cosmetic, bundled with state machine work)

### Phases

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 9 | Agent Pipeline Integration | 3/3 | Complete (2026-03-07) |
| 10 | KG Operations Restoration | 5/5 | Complete (2026-03-08) |
| 11 | Content Quality Gate | 3/3 | Complete (2026-03-09) |
| 12 | Pipeline Observability | 4/4 | Complete (2026-03-09) |
| 13 | Code Graph Agent Integration | 3/3 | Complete (2026-03-09) |
| 14 | Documentation Generation | 2/3 | Partial (14-03 deferred) |

## v1.0 UKB Pipeline Fix & Improvement (Shipped: 2026-03-03)

**Phases completed:** 2 phases (1 + 4), 9 plans
**Audit status:** tech_debt (12/12 executed requirements satisfied, Phases 2-3 deferred)

**Key accomplishments:**

- Multi-format pattern extraction parser (JSON + markdown + LLM retry) with generic name filtering
- Correct PascalCase entity naming across all 7 naming paths
- LLM-synthesized observations in all 4 observation creation methods
- Configurable analysisDepth parameter (surface/deep/comprehensive)
- TypeScript interfaces extended with hierarchy fields across 4 systems (KGEntity, SharedMemoryEntity, VKB Entity/Node)
- Component manifest (8 L1 + 5 L2 components) and ontology types (Component/SubComponent)

**Deferred to future milestones:**

- Phase 2: Insight Generation & Data Routing (7 requirements)
- Phase 3: Significance & Quality Ranking (2 requirements)

**Known gaps:**

- SC-2 (hierarchy field round-trip persistence) deferred to Phase 5
- 4 human verification items pending runtime confirmation

### Phases

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Core Pipeline Data Quality | 7/7 | Complete (2026-03-02) |
| 2 | Insight Generation & Data Routing | 0/? | Deferred |
| 3 | Significance & Quality Ranking | 0/? | Deferred |
| 4 | Schema & Configuration Foundation | 2/2 | Complete (2026-03-01) |

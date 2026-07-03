# Coding Project — Knowledge Management

## What This Is

An agentic coding environment with multi-agent support (Claude, Copilot, OpenCode, Mastracode), live session logging, real-time observational memory, semantic knowledge management, and a health dashboard. v1.0-v2.1 shipped the UKB analysis pipeline. v3.0 added workflow state machine. v4.0 integrated mastra.ai's observational memory alongside LSL, added mastracode as a fourth coding agent, and built transcript converters + a live observation dashboard. v5.0 overhauled service reliability and health monitoring.

## Core Value

A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable — across all AI coding agents.

## Current State

**v7.3 — LLM Proxy Performance (Claude CLI Worker Pool) — SHIPPED 2026-06-21.** The per-call `claude` CLI `execFile` spawn on the claude-code fallback path is replaced with a pool of warm, persistent, per-model stream-JSON workers — cutting sonnet/opus fallback latency from ~10–14s to ~2–3s steady-state while keeping Anthropic's prompt-cache warm. The pool is lazily spawned, idle-evicted (30 min), crash-recovers as RETRYABLE, cancels on client disconnect, recycles on CLI-version drift, and reverts cleanly via `LLM_PROXY_DISABLE_WORKER_POOL=1`. Acceptance was operator-live-proven (Phase 65, 12/12). Phase 66 made the speedup glanceable: a per-model SPAWN/QUEUE `overhead_ms` metric (the latency the pool actually controls, excluding generation) graded green/amber/red on both `:3032` surfaces — both the warm→green and the regression→red paths are live-proven, the latter via an opt-in `LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam. 14/14 requirements satisfied; audit `tech_debt` (0 blockers). See `milestones/v7.3-*`.

**v7.2 shipped.** The online-learning → km-core → unified viewer surface reached production data quality: online pipeline emits semantic-content edges on Insights, ontology upper/lower split clarified, VKB rendering UX integrity restored, LSL timeline honesty fixed, OKB data routing corrected, and the long-tail orphan baseline reduced. Builds on v6.0's knowledge context injection (live across all four coding agents via Qdrant semantic search, per-agent scoring, cross-agent continuity, 300-token working-memory prefix).

Stack: Four coding agents (`coding --claude/--copilot/--opencode/--mastra`), live ETM observations, Qdrant vector search, hybrid retrieval (semantic + keyword + recency), Redis pub/sub for write-time embedding, per-agent adapters, session state handoff.

## Requirements

### Validated

- ✓ Pattern extraction handles JSON + markdown LLM responses — v1.0
- ✓ Entity names use correct PascalCase — v1.0
- ✓ Observations are LLM-synthesized, not template strings — v1.0
- ✓ analysisDepth is configurable (surface/deep/comprehensive) — v1.0
- ✓ Garbage insight names filtered via blocklist — v1.0
- ✓ Bold formatting stripped from observations — v1.0
- ✓ KGEntity/SharedMemoryEntity/VKB interfaces extended with hierarchy fields — v1.0
- ✓ Component manifest defines L1/L2 hierarchy as source of truth — v1.0
- ✓ Ontology accepts Component/SubComponent entity types — v1.0

### Shipped in v6.0

- ✓ Embedding pipeline — all knowledge tiers (obs, digests, insights, KG) in Qdrant — Phase 28
- ✓ Write-time auto-embedding via Redis pub/sub — Phase 28
- ✓ One-shot backfill CLI with content-hash idempotency — Phase 28
- ✓ Hybrid retrieval service (semantic + keyword + recency via RRF) — Phase 29
- ✓ Token-budgeted markdown assembly with tier-weighted scoring — Phase 29
- ✓ POST /api/retrieve on health API (port 3033), <500ms latency — Phase 29

### Shipped in v6.0 (continued)

- ✓ Claude UserPromptSubmit hook with fail-open design — Phase 30
- ✓ Cross-project hook (global settings), all 4 agent adapters — Phase 30.1
- ✓ Context-aware relevance boosting (project, cwd, recent files) — Phase 30.1
- ✓ Working memory (KG structure + STATE.md, 300-token budget) — Phase 31
- ✓ Per-agent scoring profiles (tier weight multipliers) — Phase 32
- ✓ Cross-agent session continuity (session state file, 2-hour window) — Phase 32

### Active

See **Current Milestone: v7.5** below — requirements tracked in `.planning/REQUIREMENTS.md`.

## Current Milestone: v7.5 Cross-Agent Comparison Experiment Runner

**Goal:** Turn the v7.4 measurement rig into an experiment tool — a user states a goal plus a variant matrix ("develop X, measure it under settings A vs B"), and the system drives each variant across agents from an identical starting snapshot, then returns a scored, side-by-side comparison with variance.

**Target features:**
- **Measurement-validity fixes (prerequisite — must precede the runner):** canonical per-run model attribution (not the most-frequent token-row model, which the judge-call skew corrupts); correct route wallclock/step math over long interactive windows; outcome-rubric coverage for non-GSD / ad-hoc tasks (so a "straight coding" variant scores on all dimensions, not 2/5). Diagnosed as O1/O2/O3 in the `exp-dash-start-control` pilot run.
- **Declarative experiment spec** — a variant matrix over model / framework / approach (e.g. `{A: opus-4.8·claude-code, B: fable}` or `{A: straight, B: gsd/SDD}`), with N repeats per variant.
- **Cross-agent experiment runner** — per variant × repeat: restore the same snapshot (Phase 67 replay rig) → launch the specified agent in the specified model/framework autonomously against the goal → measured span auto-wraps → stop + score → aggregate. Agents: Claude / OpenCode / Mastra (Copilot gated on a headless-drivability check).
- **Comparison report** — side-by-side tokens / time / route / outcome across variants with per-variant variance; an objective success gate (tests/UAT) so cost is only compared between runs that both actually succeeded.
- **Experiment surface** — expose the run + comparison via CLI and (optionally) the Performance dashboard tab built in v7.4.

**Key context:**
- Continues phase numbering from the previous milestone (v7.4). Orchestration layer on existing primitives — NOT greenfield.
- Builds on the v7.4 substrate: `measurement-start/stop.mjs`, `task_hash` comparability, the experiment km-core KB + `experiments-*` CLIs, proxy routing for all four agents (commit `2a23a9a25`), and the Phase 67 reproducibility-replay rig.
- Hard constraints: Copilot headless/per-prompt drivability is an open question (Phase-32 issue) — treat the Copilot variant as gated on a spike; agentic nondeterminism forces N-repeats-with-variance, not single-shot A-vs-B.
- Reslot: the previously-earmarked v7.5 (policy automation / auto-routing, currency conversion) moves to **v7.6** — it consumes this runner's comparisons, so this milestone is its prerequisite.
- v7.4 (Performance Measurement System) reached 100% of phases (9/9) and is complete pending a formal `/gsd-complete-milestone` close (audit + archive).

### v7.4 Complete (pending formal close) — Performance Measurement System — Cross-agent Token + Route + Outcome Attribution

**Goal:** Build a measurement rig that quantifies, per task, the full cost across all four supported coding agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task — so "approach X cost Y for task type Z" becomes evidence, not anecdote.

**Target features:**
- Reproducibility rig — snapshot/restore internal state (git SHA, KB, routing config, MCP inventory, prompt, `.planning/`, env, agent binary version) + record/replay external state (LLM responses via proxy, WebSearch/Fetch, frozen clock) so N=1 runs become comparable
- Single-Run km-core KB (`Experiment / Run / Route / Step / Decision / Outcome / Report`) — comparisons as queries; task taxonomy + run-end tag enforcement
- Token attribution — extend `.observations/token-usage.db` with `agent / task_id / tool_call_id / parent_call_id / granularity_tier / reasoning_tokens` at the best granularity each agent surfaces (all four agents)
- Goal-anchored route metrics — `goal_sentence` per run; steps / loops / detours, syntactic + semantic
- 5-dimension success rubric with LLM-judge synthesis
- "Performance" dashboard tab (after Tokens) — query-builder + Report views

**Key context:**
- Continues phase numbering from Phase 66 (v7.3) → v7.4 starts at **Phase 67**.
- Scoping artifacts: `.planning/notes/v73-perf-measurement-exploration.md` (7 decisions + 9-phase sketch, Phase 3 FOUNDATIONAL — filename retains v73 origin), `.planning/notes/v73-token-attribution-contract.md`, completed spike `.planning/spikes/copilot-proxy-interception.md`, hard requirements in `memory/feedback_perf_measurement_requirements.md`.
- Agent reach: ALL FOUR agents this milestone (Claude Code per-turn + per-reasoning-step; Copilot per-session/turn pending verification; OpenCode per-llm-call via proxy; Mastra granularity TBD).
- Out of scope (deliberate): policy automation / auto-routing (v7.5 — `seeds/v74-policy-engine.md`), VS Code Copilot Chat (opaque `state.vscdb`), currency conversion.

### v7.3 Shipped (LLM Proxy Performance — Claude CLI Worker Pool — Phases 62–66)

- ✓ **Persistent per-model stream-JSON worker pool** behind the `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch, claude-code CLI-fallback path only (POOL-01..04, GUARD-01) — Phase 62
- ✓ **Worker lifecycle** — lazy spawn, idle eviction, crash-recovery as RETRYABLE with respawn-storm cooldown, client-disconnect cancellation (WLIFE-01..04, live-proven 9/9) — Phase 63
- ✓ **Worker hygiene** — CLI version-drift recycle + stderr drain/throttle (GUARD-02/03) — Phase 64
- ✓ **Acceptance** — warm sonnet ≤3s steady-state + crash survival, operator live-run 12/12 (PERF-01/02) — Phase 65
- ✓ **Dashboard observability** — per-model spawn/queue `overhead_ms` graded on both `:3032` surfaces; SC-1 green + SC-2 red live-proven via the `LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam (PERF-03) — Phase 66

Out of scope (deliberate): cross-provider fallback (claude-code→copilot expresses user intent), general work queue/scheduler, worker pools for other CLI-based providers.

## v7.2 Shipped (VKB & Online-Learning Quality)

**Goal:** Bring the online learning pipeline → km-core → unified viewer surface to production data quality, so operators rely on the graph view for navigation and triage instead of working around known-broken rendering.

**Target features:**
- ✓ **Online pipeline emits semantic-content edges on Insights** — Phase 58 shipped 2026-06-15: `mentions` edge type emitted atomically in `ObservationWriter.writeInsight` (EDGE-01 + EDGE-02 complete); one-shot live backfill covered 96 historical Insights; verified by SC#1 `--sample 20 --min 18 = PASS`, SC#2 atomicity integration tests, SC#3 unified-viewer screenshot
- Ontology rework — clarify upper/lower split, build lower ontology for coding-specific concepts (LSL, ConstraintMonitor, Online-Observation/Digest/Insight tiers), per-project grouping in viewer
- VKB rendering UX integrity — Evidence/Pattern filter symmetry, Legend derived from rendered graph, eliminate Observations/Digests architecture bleed, restore CollectiveKnowledge visibility under Online filter
- LSL timeline scale honesty — remove 200-record silent cap, honest "all" window name, bi-source coloring (manual vs online) on ticks
- OKB data routing fix — resolve `/api/entities` vs `/api/v1/entities` contract mismatch so `/viewer/okb` reaches OKM Express on :8090
- Long-tail orphan fixes — close Phase 48 (System-type vanish), Phase 49 (orphan project-anchor relations); reduce 157-orphan baseline materially

**Key context:**
- Foundation is healthy: km-core export at 1262 nodes / 1592 edges / 88% connectivity / 10 relation types after the 2026-06-10 backfill + repair commits trail (`bc5fe8012`, `a283c9be1`, `7ab1f9cd8`, `939f8d506`). Qdrant collections live: observations=5509, digests=1601, insights=225, kg_entities=675. This milestone is about the LONG TAIL of data quality, not foundational repair.
- Scope seeds: the 9-todo cluster surfaced during Phase 56.1 visual smoke (2026-06-13/14), listed in `.planning/MILESTONES.md` under the v7.2 entry. Two carry operator-set `scope_hint: This is a multi-phase milestone, not a single TODO`.
- Phase 48 + Phase 49 (legacy ROADMAP TBD placeholders) fold into v7.2 phase numbering — close the old slots as superseded.
- Phase numbering continues from Phase 56.1 → new phases start at **Phase 57**.
- v7.1 (KM Unification — Phases 37-46) was functionally shipped before this milestone opened; one Phase 46 HUMAN-UAT (ONBOARDING.md operator dry-run) remains pending. v7.1 will be archived once that UAT lands; it runs in parallel.
- Out of scope: LLM proxy worker pool (v7.3), cross-agent perf measurement (v7.4), Phase 51 follow-ups, Phase 54 ETM hardening, Phase 35-04/05 retention wiring — all run in parallel as backlog phases.

### v7.1 Shipped (Knowledge Management Unification — Phases 37-46)

- ✓ Shared KM-Core types + GraphKMStore (Graphology + LevelDB + JSON exports) — Phase 37
- ✓ OntologyRegistry with dynamic upper + lower ontology discovery — Phase 38
- ✓ Uniform entity shape (kills KGEntity/SharedMemoryEntity split) + temporal validity fields — Phase 39
- ✓ 4-stage consolidation framework + layered dedup pipeline — Phase 40
- ✓ Online-learning adapter + post-hoc resolution (System A) — Phase 41
- ✓ Offline UKB migration (System B) — Phase 42 + 42.1/42.1.1/42.1.2/42.2
- ✓ OKM cross-repo migration (System C) — Phase 43
- ✓ Common REST query API + git-snapshot/restore — Phase 44
- ✓ Unified viewer routing layer + UI feature parity with VOKB — Phase 45 + 55
- ⏳ Per-system documentation + onboarding — Phase 46 (one operator HUMAN-UAT pending: ONBOARDING.md dry-run)

### Shipped in v4.0

- ✓ Mastracode agent integration (`coding --mastra`) — Phase 21
- ✓ Transcript-to-observation converters (Claude, Copilot, Specstory) — Phase 22
- ✓ Historical LSL batch converter (git-tracked .specstory files → observations) — Phase 22
- ✓ Live observation tap (ETM fire-and-forget per exchange) — Phase 23
- ✓ Observations dashboard (REST API + React page with FTS search) — Phase 23
- ✓ LLM proxy bridge for observer/reflector agents — Phase 20

### Out of Scope

- v1.0 deferred work (significance scoring) — revisit after v2.0
- Changing the MCP server interface — `ukb full` invocation stays the same
- Agent framework rewrite — extend existing coordinator, don't rewrite
- Real-time pipeline monitoring — v2+ concern

## Context

- **Pipeline location:** `integrations/mcp-server-semantic-analysis`
- **Knowledge graph storage:** `.data/knowledge-graph/` (Graphology + LevelDB + JSON exports)
- **Export file:** `.data/knowledge-export/coding.json` (30 entities, hierarchical L0→L3)
- **VKB viewer:** `vkb` command, runs on http://localhost:8080
- **Key interface:** `KGEntity` in `kg-operators.ts` — hierarchy fields (parentId, level, hierarchyPath)
- **Component manifest:** `config/component-manifest.yaml` — 8 L1 + 5 L2 components
- **Current pipeline:** DAG steps in `coordinator.ts` — batch extraction → observation synthesis → persistence
- **Current problem:** Entities have 1 banal observation each, 2-3 sub-nodes per component (should be many more)

## Constraints

- **Storage:** Must work with existing Graphology + LevelDB infrastructure
- **Interface:** `ukb full` / `mcp__semantic-analysis__execute_workflow` must remain unchanged
- **Architecture:** Extend existing coordinator; add wave orchestration on top of DAG
- **Backward compat:** VKB viewer must still display entities even if hierarchy features aren't fully loaded
- **Build pipeline:** Submodule build + Docker rebuild required for pipeline changes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix existing pipeline, not redesign | Pipeline worked before — architecture is sound | ✓ Good |
| Keep batched execution mode | Working and wanted | ✓ Good |
| Defer v1.0 Phases 2-3 | Pipeline quality is good enough; hierarchy is higher priority | ✓ Good (shipped v1.0) |
| All hierarchy fields optional (?) | Full backward compatibility | ✓ Good |
| Replace flat DAG with wave-based agents | Flat pass produces shallow knowledge; waves produce depth | — Pending |
| Wave-per-level architecture | Each wave operates at one hierarchy level, spawns next | — Pending |
| Rich observations + insight docs per entity | One-liner observations are insufficient for useful knowledge | — Pending |
| Worker pool serves ONLY the claude-code CLI-fallback path | Direct OAuth bearer (haiku ~0.9s) is already fast; CLI spawn dominates only sonnet/opus fallback latency | ✓ Good (v7.3) |
| `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch wired first (Phase 62) | A one-flag revert to the proven per-call path de-risks every later pool change | ✓ Good (v7.3) |
| Grade dashboard on spawn/queue `overhead_ms`, not total latency | Total latency is generation-dominated and can never meet a ≤3s bar; overhead is the component the pool actually controls | ✓ Good (v7.3 — PERF-03 made meaningful) |
| `LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam to prove the red path | Real cold-spawn overhead on a fast host (~2.5s) never crosses the 5s red threshold; a deterministic, opt-in no-op-when-unset seam makes SC-2 reproducible on any host rather than faking it | ✓ Good (v7.3) |

---
## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-03 — v7.5 Cross-Agent Comparison Experiment Runner milestone started (declarative A/B variant matrix + cross-agent runner + scored comparison, on the v7.4 measurement substrate; phases continue from the previous milestone). v7.4 (Performance Measurement System) reached 100% of phases (9/9), complete pending formal close; auto-routing/policy reslotted to v7.6. v7.3 (LLM Proxy Worker Pool, Phases 62–66) shipped 2026-06-21. v7.2 (VKB & Online-Learning Quality) and v7.1 (KM-Core Unification) previously shipped.*

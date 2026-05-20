---
gsd_state_version: 1.0
milestone: v7.1
milestone_name: Knowledge Management Unification
status: executing
stopped_at: Completed 37-03-PLAN.md (CORE-02 — PersistenceManager + Exporter both GREEN; km-core pushed cd3af5d)
last_updated: "2026-05-20T05:10:42.818Z"
last_activity: 2026-05-20
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 5
  completed_plans: 3
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable -- across all AI coding agents.
**Current focus:** Phase 37 — km-core-foundation

## Current Position

Phase: 37 (km-core-foundation) — EXECUTING
Plan: 4 of 5
Status: Ready to execute
Last activity: 2026-05-20

## Performance Metrics

**Velocity:**

- Total plans completed: 27 (v6.0)
- Average duration: 3 min
- Total execution time: 0.05 hours

*Updated after each plan completion*

## Accumulated Context

### Roadmap Evolution

- Phase 30.1 inserted after Phase 30: Cross-Project Agent-Agnostic Knowledge Injection (URGENT) — make injection work across all projects and agents with focused relevance
- Phase 36 added: token-usage per-user hourly exports (mirror LSL conventions for git-trackable JSON)
- v7.1 roadmap created 2026-05-19: 10 phases (37–46) covering KM-Core extraction across A/B/C systems; CORE→ONTO→DATA→PIPE foundation, then INT-01+PIPE-02→INT-02→INT-03 migration order, capped by API→UI→DOC. Phase 42 (B migration) folds in Phase 10 embeddings bug + workflow-runner.ts:469-530 race condition. Phase 43 (C migration) is cross-repo into rapid-automations.

### Decisions

- [v6.0 start]: Agent-agnostic architecture -- retrieval service is standalone HTTP API, each coding agent has its own adapter
- [v6.0 start]: Use existing Qdrant instance for vector storage (not LibSQL vector)
- [v6.0 start]: All four knowledge tiers as sources (observations, digests, insights, KG entities)
- [v6.0 start]: Mastra-inspired but adapted -- their Observer/Reflector pattern maps to our existing ETM/consolidation pipeline
- [v6.0 roadmap]: Embedding pipeline is strict foundation -- nothing works without vectors in Qdrant
- [v6.0 roadmap]: Retrieval service runs host-side (not Docker) to avoid SQLite WAL lock contention
- [v6.0 roadmap]: Claude hook is primary adapter -- prove value before other agents
- [v6.0 roadmap]: fastembed with all-MiniLM-L6-v2 (384-dim) pinned as embedding model
- [v6.0 roadmap]: Token budget default ~1000 tokens (research recommends 800-1000, not the 2K initially planned)
- [28-01]: EmbeddingModel.AllMiniLML6V2 enum verified at runtime; queryEmbed returns Float32Array converted via Array.from()
- Deterministic UUID from KG entity keys via MD5 hash for Qdrant point IDs
- Fire-and-forget Redis publish with fail-fast retryStrategy ensures observation writes never block on embedding
- Plain JS for src/retrieval/ modules to match server.js consumer and avoid TS compilation step
- Import compiled dist/embedding/ outputs from retrieval modules (not raw src/embedding/ TS)
- Added src/retrieval bind-mount to docker-compose.yml for retrieval modules in Docker
- Set absolute cacheDir in FlagEmbedding.init() to prevent CWD-relative model loading
- Reset _initPromise on failure for retry support in RetrievalService
- [30-01]: Plain JS hook with MIN_WORDS=4 threshold, fail-open HTTP with 2s timeout + 5s safety ceiling
- Cumulative context boost factors (1.15 project, 1.10 cwd, 1.20 recent_files) for relevance scoring
- Claude hook moved to global settings for cross-project firing; Copilot adapter uses AUTO-KNOWLEDGE markers for safe file merging
- Working memory (300-token KG+state prefix) integrated into retrieve() pipeline with fail-open VKB fetch and STATE.md parsing
- Per-agent RRF scoring profiles: agent identity flows from adapters through context.agent to rrf-fusion for two-pass tier weighting
- Session state written to .coding/session-state.json with 2-hour staleness window for cross-agent continuity
- [33-05]: Three consumer migrations done — prompt-hook + system-health-dashboard + constraint-monitor dashboard all fetch /health/state from coordinator instead of readFileSync of `.health/*.json`. SPEC AC #7 grep gate clean. Coordinator unreachable surfaces as `overallStatus: 'unknown'` (NEVER 'healthy'). Q3 graceful no-op preserved when prompt-hook is invoked outside the coding repo (empty additionalContext). Dashboard frontend `dist/` NOT rebuilt — backward-compat preserved per SPEC R8.
- [Phase ?]: [36-07]: TreemapTooltip uses recharts <Tooltip content={...}/> child-of-Treemap pattern; SVG <title> as native-browser/screen-reader fallback for sub-60x40 boxes
- [v7.1 roadmap]: DATA (39) lands before INT-02/03 (42/43) so migrations stamp the canonical entity shape once, not twice
- [v7.1 roadmap]: PIPE-01 + DEDUP-01 combined into Phase 40 — dedup IS the second stage of the 4-stage pipeline; splitting them creates artificial seams
- [v7.1 roadmap]: INT-01 (A's SQLite adapter) bundled with PIPE-02 in Phase 41 — exercises the KM-Core surface before B/C bet on it, and A's long-running insight corpus is the first proving ground for post-hoc resolution
- [v7.1 roadmap]: API (44) lands AFTER migrations so REST contracts are shaped against real KM-Core consumers, not in a vacuum
- [Phase 37-02]: Adopted OKM Entity shape VERBATIM and applied 4 deltas: id->EntityId brand, Edge->Relation rename with from/to, legacyId for Phase 39 backfill, no bin types (D-11/D-13/D-14)
- [Phase 37-02]: Defensive s.charAt(14) === '7' v7 variant check in parseEntityId rejects v4 UUIDs that UUID.parse would otherwise accept (37-PATTERNS DELTAS)
- [Phase 37-02]: Per-module barrel src/types/index.ts re-exports EntityId alongside Entity/Relation so consumers can take a sub-surface import
- [Phase ?]: [Phase 37-03]: Preserved OKM method names persistGraph/exportJson verbatim (not renamed) because RED test contract calls these names
- [Phase ?]: [Phase 37-03]: Exporter exposes scheduleExport(snapshot)+exportJson(data) directly per RED test (no getSnapshot callback); event-wiring stays with Plan 04 GraphKMStore consumer
- [Phase ?]: [Phase 37-03]: PersistenceManager.hydrate fallback always reads general.json even when consumer domains list omits it — protects against colleague-machine unknown-domain nodes
- [Phase ?]: [Phase 37-03]: Atomic temp+rename lives as private writeAtomic per module (DRY-via-similarity, not extracted utility) — defer extraction to Plan 04 if duplication grows

### Blockers/Concerns

- [Phase 28]: Verify Docker base image supports fastembed (requires glibc/Debian, not Alpine)
- [Phase 32]: OpenCode plugin injection API needs runtime validation before implementation
- [Phase 32]: Copilot per-prompt injection may not be supported -- may need refresh daemon approach
- [v7.1 Phase 43]: OKM cross-repo packaging strategy (submodule vs published npm vs vendored) — must be decided in INT-03's discuss phase
- [v7.1 Phase 45]: D3 (VOKB) vs sigma.js (VKB) viewer choice — open question, research seed leans D3

## Deferred Items

Items acknowledged and deferred at v6.0 milestone close on 2026-04-25:

| Category | Item | Status |
|----------|------|--------|
| debug | entity-naming-paths | unknown |
| debug | llm-synthesis-failures | diagnosed |
| debug | pattern-extraction-data-loss | investigating |
| verification | Phase 28 (28-VERIFICATION.md) | human_needed |
| verification | Phase 30 (30-VERIFICATION.md) | human_needed |
| verification | Phase 30.1 (30.1-VERIFICATION.md) | human_needed |
| todo | llm-based-semantic-deduplication | pending |
| todo | replace-console-log-with-proper-logging | pending |
| Phase 36 P07 | 32 | 1 tasks | 1 files |
| Phase 37 P02 | 14min | 2 tasks | 8 files |
| Phase 37 P03 | 10 | 2 tasks | 2 files |

## Session Continuity

Last session: 2026-05-20T05:10:42.812Z
Stopped at: Completed 37-03-PLAN.md (CORE-02 — PersistenceManager + Exporter both GREEN; km-core pushed cd3af5d)
Resume with: `/gsd:plan-phase 37`

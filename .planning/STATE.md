---
gsd_state_version: 1.0
milestone: v7.1
milestone_name: Knowledge Management Unification -- Phases 37-46
status: executing
stopped_at: Phase 38 Plan 02 complete -- 5 fixture JSONs in km-core/tests/fixtures/ontology/ (commits 5e31b3e, 972bd3a)
last_updated: "2026-05-20T11:55:00Z"
last_activity: 2026-05-20 -- Phase 38 Plan 02 complete (4 verbatim OKM fixtures + synthetic coding-ontology.json B-shape proxy)
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 11
  completed_plans: 7
  percent: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable -- across all AI coding agents.
**Current focus:** Phase 38 — ontology-registry

## Current Position

Phase: 38 (ontology-registry) — EXECUTING
Plan: 3 of 6 (Plans 01 + 02 complete; Wave 1 done — 38-03 + 38-04 unblocked in Wave 2)
Status: Executing Phase 38
Last activity: 2026-05-20 -- Phase 38 Plan 02 complete (5 fixture JSONs in km-core/tests/fixtures/ontology/)

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
- [Phase ?]: [Phase 37-04]: GraphKMStore.restore(serialized) added as bulk-import escape hatch — no validation, no defaults, no events. Round-trip parity tests + Phase 39 backfill use it.
- [Phase ?]: [Phase 37-04]: skipOntologyCheck:true extended to bypass parseEntityId (trusted-caller semantics). Plain putEntity path remains strict per CORE-03.
- [Phase ?]: [Phase 37-04]: addRelation skips parseEntityId on from/to (relies on hasNode safety check). Threat-model invariant preserved because trusted-bulk-import IS the path producing non-v7 ids.
- [Phase ?]: [Phase 37-04]: _convert-b.ts uses entity name (not legacy nanoid id) as Graphology node key — B's relations reference entities by name not by id.
- [Phase ?]: [Phase 37-04]: Round-trip test normalizes both sides (drop orphan edges + sort by key + strip undirected:false) — test asserts EXPORT FIDELITY not migration-cleanup behavior.
- [Phase ?]: [Phase 37-05]: Task 3 split into two commits per the LIVE OKB-guard rule (KB-only OR non-KB-only allowed; mixed blocked) — D-23 (hook is source of truth) wins over plan text.
- [Phase ?]: [Phase 37-05]: Step 3 (Docker rebuild) skipped via approved-skip-docker resume signal — Phase 42 will exercise container path when B consumes GraphKMStore.
- [Phase ?]: [Phase 37-05]: Cross-repo TS smoke uses dev-side node_modules/@fwornle/km-core symlink. Phase 42 owns permanent wiring when B's adapter is swapped.
- [Phase 38-01]: Adopted OKM ontology type analog (29 lines) verbatim with one delta — `OntologyClass.defaultLayer?: Layer` imports `Layer` from `./entity.js` instead of inlining `'evidence' | 'pattern'`. Single source of truth for the Layer union remains anchored in Phase 37 Plan 02's entity.ts.
- [Phase 38-01]: Loader (`loadOntologyFile`) stays synchronous (Pattern S4) and throws on shape error. Plan 38-03 registry owns strict-mode policy (catch-and-rethrow OR warn-and-skip per D-29 atomicity). Loader is policy-free.
- [Phase 38-01]: No barrel changes in this plan. Plan 38-03 owns the atomic root-barrel + sub-barrel update so the registry surface (class + types + factory) lands together.
- [Phase 38-02]: 4 OKM ontology JSONs (upper/kpifw/business/raas) copied byte-identical into ~/Agentic/km-core/tests/fixtures/ontology/ via `cp` (PATTERNS.md verbatim-copy landmine respected); `cmp` exit 0 against each OKM source. Synthetic coding-ontology.json authored with 7 L1 + 5 L2 = 12 classes (on-disk component-manifest.yaml truth — CONTEXT/PATTERNS quoted 8 L1, doc-drift surfaced in SUMMARY).
- [Phase 38-02]: Synthetic fixture exercises both kinds of `extends`: ontology-level (meta.extends:"upper") AND per-class (7 L1 each extends "Component" from upper; 5 L2 each extends their L1 parent). meta.description self-documents synthetic nature + Phase 42 ownership + source-count drift call-out (T-38-02-03 mitigation).
- [Phase 38-02]: Empty relationships:{} on all 12 synthetic classes — type-valid for OKM's `Record<string,string[]>` contract, avoids inventing semantic content that Phase 42 would have to re-validate during the real YAML→JSON conversion.

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
| Phase 37 P04 | 25min | 2 tasks | 5 files |
| Phase 37 P05 | 5min | 4 tasks | 5 files |
| Phase 38 P01 | 2min | 2 tasks | 2 files |
| Phase 38 P02 | 3min | 2 tasks | 5 files |

## Session Continuity

Last session: 2026-05-20T11:55:00Z
Stopped at: Phase 38 Plan 02 complete -- 5 fixture JSONs in km-core/tests/fixtures/ontology/ (commits 5e31b3e, 972bd3a); Wave 1 complete; Plans 38-03 (registry) + 38-04 (factory) unblocked in Wave 2
Resume with: `/gsd:execute-phase 38`

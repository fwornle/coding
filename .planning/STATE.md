---
gsd_state_version: 1.0
milestone: v7.1
milestone_name: Knowledge Management Unification -- Phases 37-46
status: executing
stopped_at: Phase 42.1.1-01 complete (ontologyPathResolver + OntologyConfigManager loader-path wiring + Test C softened per Option A; 18/18 node:test pass; layer-1 SC#6 unblocked; NEW known residual — Project class not on disk, layer-2 follow-up tracked separately)
last_updated: "2026-05-24T17:30:00.000Z"
last_activity: 2026-05-24 -- Phase 42.1.1 plan 01 complete (layer-1 of SC#6 root cause)
progress:
  total_phases: 19
  completed_phases: 7
  total_plans: 44
  completed_plans: 43
  percent: 38
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable -- across all AI coding agents.
**Current focus:** Phase 42.1.1 — ontology-layout-resolution-registry-empty-because-loader-exp

**v7.1 milestone status (KM-Core unification — 5 of 10 phases done):**

| # | Title | System | Status |
|---|-------|--------|--------|
| 37 | KM-Core Foundation | shared | ✓ |
| 38 | Ontology Registry | shared | ✓ |
| 39 | Entity Data Model | shared | ✓ |
| 40 | Ingest Pipeline & Layered Dedup | shared | ✓ |
| 41 | Online Learning Adapter & Post-Hoc Resolution | A (ODI) | ✓ |
| **42** | **Offline UKB Migration** | **B (mcp-server-semantic-analysis)** | **NEXT** |
| 43 | OKM Cross-Repo Migration | C (rapid-automations/OKM) | pending |
| 44 | REST API & Git Snapshots | shared (requires A+B+C) | pending |
| 45 | Unified Web Viewer | shared (requires API) | pending |
| 46 | Per-System Docs & Onboarding | shared | pending |

**Out-of-milestone backlog (NOT v7.1 work — bug-fix phases that got slotted by number):**

- Phase 47: ObservationWriter drops user-prompt text when image attachment present
- Phase 48: VKB graph strips `entity_type='System'` nodes when their team is unchecked
- Phase 49: 187 orphan VKB entities (~24%) lack project-anchor relations
- Phase 50: LSL-grounded async observation resolver

These are real bugs; address them after v7.1 closes, or as side-tracks between milestone phases if they become blocking.

## Current Position

Phase: 42.1.1 (ontology-layout-resolution-registry-empty-because-loader-exp) — COMPLETE (loader fix, layer 1 of SC#6)
Plan: 1 of 1 complete
Status: Phase 42.1.1 closed. Awaiting layer-2 follow-up (add `Project` class to `.data/ontologies/upper.json`) before `/gsd-verify-phase 42.1` will pass.
Next step: Either (a) open a new bug-fix phase to register `Project` on disk, then `/gsd-verify-phase 42.1`; OR (b) continue with Phase 42 (Offline UKB Migration) and address the Project-class follow-up in parallel.
Last activity: 2026-05-24 -- Phase 42.1.1 plan 01 complete (layer-1 SC#6 unblocked; 18/18 node:test pass; commits 6bde70ba0..00c6ca154; SUMMARY 42803f2b6)

## Performance Metrics

**Velocity:**

- Total plans completed: 50 (v6.0)
- Average duration: 3 min
- Total execution time: 0.05 hours

*Updated after each plan completion*

## Accumulated Context

### Roadmap Evolution

- Phase 30.1 inserted after Phase 30: Cross-Project Agent-Agnostic Knowledge Injection (URGENT) — make injection work across all projects and agents with focused relevance
- Phase 36 added: token-usage per-user hourly exports (mirror LSL conventions for git-trackable JSON)
- v7.1 roadmap created 2026-05-19: 10 phases (37–46) covering KM-Core extraction across A/B/C systems; CORE→ONTO→DATA→PIPE foundation, then INT-01+PIPE-02→INT-02→INT-03 migration order, capped by API→UI→DOC. Phase 42 (B migration) folds in Phase 10 embeddings bug + workflow-runner.ts:469-530 race condition. Phase 43 (C migration) is cross-repo into rapid-automations.
- Phase 47 added 2026-05-21: ObservationWriter drops user-prompt text when image attachments are present (only `[Image: source: …]` placeholders are stored). Surfaced when row `9a3e700c-…` failed automated backfill and required a manual summary; see `.planning/phases/47-…/47-CONTEXT.md` for the full bug write-up and scope.
- Phase 48 added 2026-05-22: VKB graph viewer strips `entity_type='System'` nodes when their owning team is unchecked, because per-team `queryEntities` runs *before* the "System nodes belong to all teams" visualization filter. Root cause in `integrations/memory-visualizer/src/api/databaseClient.ts:262` (server-side fix preferred). See `.planning/phases/48-…/48-CONTEXT.md`.
- Phase 49 added 2026-05-22: VKB graph data integrity — 187 of 797 entities (~24%) are orphans with zero relations. Two patterns: 122 online-learned Detail/SubComponent nodes lacking parent hierarchy edges, and 7 team-anchor Projects (every non-coding team) missing the `CollectiveKnowledge --includes-->` edge that exists only for `Coding`. Scope covers one-shot repair migration + writer-path fix + seed-script fix. See `.planning/phases/49-…/49-CONTEXT.md`.
- Phase 41 directory scaffolded 2026-05-22: roadmap entry has existed since v7.1 was created (Online Learning Adapter & Post-Hoc Resolution — INT-01 + PIPE-02), but the `.planning/phases/41-online-learning-adapter-post-hoc-resolution/` directory was created only now after Phase 40 closure. STATE Current Position re-pointed from Phase 47 back to Phase 41 to reflect the milestone (v7.1) phase order. Phases 42–46 still need directories.
- Phase 50 added 2026-05-23: LSL-grounded async observation resolver — backfills observation rows that are unrecoverably vague on their own (ambiguous-reference summaries like "some previously discussed feature" + Phase 47's image-only rows) by walking the verbatim Live Session Logs. Critical design decision: window is measured in user→assistant **prompt count** (default N=3), NOT wall-clock minutes — a naive 15-min window misses the antecedent of "do the same again" after a 6-hour autonomous task. Subsumes Phase 47's `Could` recovery item; `_buildPriorContext` (shipped today as `2f4cbf7d7`) should be migrated to the same N-prompt window in Phase 50's Should-scope. See `.planning/phases/50-…/50-CONTEXT.md`.
- Phase 51 added 2026-05-23 (scope broadened same day): agent-agnostic sub-agent capture across LSL **and** observations. Original framing was Claude-Code-only observation backfill; real requirement is sub-agents must appear in both LSL (`.specstory/history/`) and observations panel, in real time, for claude/opencode/copilot/mastra alike. Live (spawn-time hook) + sweep (periodic backfill) tiers both needed. LSL naming convention proposed: `{YYYY-MM-DD}_{HHHH-HHHH}_S{slot}-{idx}-{hash}[-part{N}].md`. First plan-phase step is per-agent research into how each spawns sub-agents. See `.planning/phases/51-…/51-CONTEXT.md`. (Concrete trigger: 25 sub-agent transcripts under `<parent>/subagents/agent-*.jsonl` confirmed today during the Phase 42 wave — backfill running via `scripts/backfill-subagent-transcripts.mjs` proof-of-concept.)
- Phase 52 added 2026-05-24: Dashboard LLM routing label + process tag observability fix. Two issues surfaced during the phase 42.1 production ukb run. (1) Wave-analysis HTTP calls don't set `body.process`, so all UKB sub-step calls land in `.data/llm-proxy/token-usage.db` with `process='unknown'` — operators can't pin per-sub-step provider/model via `processOverrides` in `llm-settings.json`. (2) Dashboard sub-step badges hardcode `'Groq: llama-3.3-70b-versatile'` (constants.ts:603 + 18 literals) although the proxy's auto-route preference order is `claude-code → copilot → groq → openai → anthropic`. Token-usage telemetry for the 2026-05-24 11:34Z run confirmed ZERO groq calls — all wave-analysis traffic went to copilot (6) + claude-code (4). Routing is correct; the dashboard label is misleading. Bug-fix style phase, outside v7.1 milestone scope. See `.planning/phases/52-…/NOTES.md` for evidence base.
- Phase 42.1.1 inserted after Phase 42.1: Ontology layout resolution — registry empty because loader expects .data/ontologies/{upper,lower}/ subdirs but files live flat at .data/ontologies/. Blocks 42.1 SC#6 + Phase 40 dedup type signal. See .planning/forensics/report-20260524-130355.md (URGENT)
- Phase 42.1.1 plan 01 complete 2026-05-24: layer-1 of SC#6 root cause unblocked (ontologyPathResolver helper + OntologyConfigManager.{validatePaths,injectOntology} wired through resolver). 18/18 node:test pass against real `.data/ontologies/` flat layout for all 7 teams. Path-a invariant preserved (zero caller modifications, zero `.data/ontologies/*` modifications). NEW known residual surfaced during execution: the `Project` class — which `ensureProjectAnchor('Coding')` mints at runtime — is NOT declared in any on-disk ontology JSON (upper.json exposes File/Service/Feature/Contract/RuntimeDiagnostics; team ontologies declare L2 team-specific classes). Test C was softened per user Option A (drop `isValidClass('Project')`, add `domains.length === 8` + keep `isValidClass('Component')`). A follow-up ticket is required to add `Project` to `.data/ontologies/upper.json` before `/gsd-verify-phase 42.1` will pass — this is layer 2 of the SC#6 cascade and is separate from both 42.1 and 42.1.1. See `.planning/phases/42.1.1-…/42.1.1-01-SUMMARY.md` § Known Residuals.

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
- [Phase 38-03]: OntologyRegistry class (249 lines) adopts OKM's 86-line analog as base with all 5 PATTERNS deltas applied: constructor-injected ontologyDir (D-28), async atomic reload with two-statement swap (D-29), stderr warn + strict-mode rethrow on malformed lower files (D-27 + no-console-log), collision warning text VERBATIM per D-27 spec, and provenance + parent-chain accessors (parentChainOf / provenanceOf / classCatalog ReadonlyMap / domains ReadonlySet).
- [Phase 38-03]: registerClasses signature refactored to `registerClasses(target, file, source)` with explicit target Map argument — both `loadFromDisk()` and `reload()` invoke it with their respective target maps (`this.classes` constructor path; local `newClasses` for reload). Avoids duplicating the loop body AND the pre-swap shared-state hazard during atomic rebuild.
- [Phase 38-03]: FLAG-1 from 38-PLAN-CHECK addressed via option (a) — extended package.json `exports` map with `./ontology` entry so `'@fwornle/km-core/ontology'` resolves for external consumers. Verified by tmpdir smoke compile (`npm install` km-core + @types/node + typescript, NodeNext+ES2022 tsconfig, both root and sub-path imports compile clean).
- [Phase 38-03]: All 33 Phase 37 vitest tests still pass after registry + barrel + package.json changes — zero regression.
- [Phase 38-04]: registryBackedValidator(registry: OntologyRegistry): OntologyValidator factory appended to src/validation/ontology.ts as pure additive edit (27 → 75 lines). Type-only import (`import type { OntologyRegistry } from '../ontology/registry.js'`) erases at compile time so the validator module has zero runtime dependency on the registry; one-way dependency direction grep-verified (registry has 0 imports from validation/ontology.ts).
- [Phase 38-04]: Error-message text VERBATIM `Unknown ontology class: ${entityType}` — load-bearing for Phase 37 test contract preservation (graph-store.test.ts:198 regex `/Unknown ontology class/`). Plan 38-05's auto-wired path is a drop-in replacement for the strict-stub at lines 187-192.
- [Phase 38-04]: Root barrel re-export placed adjacent to existing noopOntologyValidator (group exports by source file). All 33 Phase 37 vitest tests still pass — zero regression. km-core commits fe582ca + 3f9522f.
- [Phase 38-05]: GraphKMStore constructor extended with `ontologyDir?: string` + `ontologyStrict?: boolean` options (D-28 — no env-var/cwd pickup; consumer wires defaults at call site). When `ontologyDir` is set, the constructor instantiates `new OntologyRegistry({ ontologyDir, strict })` into a `private readonly registry` field; the validator is then resolved via a 3-way chain (most-specific wins): explicit `opts.ontologyValidator` > auto-wired `registryBackedValidator(registry)` > `noopOntologyValidator`. New public `get ontology(): OntologyRegistry | undefined` getter exposes the registry; the validator stays private (internal plumbing).
- [Phase 38-05]: All 4 Phase 37 NO-CHANGE invariants preserved: PersistenceManager+Exporter ordering (awk p<e at lines 146,149 — gated), line 240-242 trusted-path `if (!trusted) validator.validate` block byte-identical (grep-verified), mergeAttributes ontology-skip untouched (T-37-04-06 accepted disposition stands), skipOntologyCheck BC-2 widening preserved (no separate skipIdCheck flag introduced). All 33 Phase 37 vitest tests still pass — zero regression. km-core commit 1094046.
- [Phase 38-06]: Verification spine landed — `tests/unit/ontology-registry.test.ts` (581 lines, 21 tests across 6 describe-blocks + 1 top-level test) covers ALL FOUR SCs: SC#1 auto-discovery (5 tests in §auto-discovery + 1 reload-add test in §reload), SC#2 extends+merge (3 tests including verbatim child-relationship inheritance via kpifw.KPIPipeline→upper.Pipeline + synthetic-conflict child-wins property override), SC#3 B-shape coding-ontology fixture (2 tests in isolated tmpdir to avoid kpifw/business/raas cross-contamination — 7 L1 + 5 L2 names all valid; L2 parent chains correct; L1 inherit Component relationships), SC#4 stable API surface (5 accessor-tests + 1 top-level named-export witness test). D-27 collision warning text VERBATIM grep-asserted (full template string, stronger than the plan's substring-match minimum). Two appended graph-store tests verify Plan 38-05 auto-wired registry validator + Phase 37 BC-2 (skipOntologyCheck widening) preservation. Total final test count: 56 across 7 files (was 33 — +23 net). All 11 Phase 37 protected graph-store test names preserved verbatim. FLAG-2 OR-precedence neutralized by canonical `registry` variable name. km-core commits d624212 (ontology-registry.test.ts) + b343a3b (graph-store.test.ts append). Phase 38 complete (6/6) and ready for `/gsd:verify-phase 38`.
- [Phase ?]: [Phase 42-01]: km-core strangler adapter landed — KM_CORE_PERSISTENCE='km-core' literal env match flips bypass writes to GraphKMStore.mergeAttributes; legacy default preserved (Phase 10 fix wired, e2e deferred to Plan 7 SC#2)
- [Phase ?]: [Phase 42-01]: km-core injected into Docker via bind-mount (${HOME}/Agentic/km-core → /coding/node_modules/@fwornle/km-core:ro), not package.json dep — matches existing strangler pattern; reverted in Phase 42 final cleanup plan
- [Phase ?]: [Phase 42-01]: Adapter resolves entity names via store.iterate() scan (km-core 0.1.0 has no findByName) — O(n) acceptable for B's <1000-entity bypass loop; Plan 5+ may add name index if profiling warrants
- [Phase ?]: [Phase 42-02]: Field-preserving merge landed in coordinator.writeProgressFile — PROGRESS_PRESERVE_KEYS allowlist mirrors workflow-state-machine.ts:117-162 verbatim (stepPaused/pausedAtStep/pausedAt/mockLLM/mockLLMDelay/singleStepMode/stepIntoSubsteps/llmState + nested config.singleStepMode). SC#3 PASS (0 race-condition warnings post-run); SC#4 escalated to Plan 7 (workflow-runner exits before terminal write — RESEARCH §2 fix #1 single-writer architecture)
- [Phase ?]: [Phase 42-02]: preserveFromExisting helper exported from coordinator.ts as a module-level function (not a private method) so tests can import directly. Both writeFileSync(progressPath,...) call sites — writeProgressFile body + checkSingleStepPause — now route through the same allowlist guard
- [Phase ?]: [Phase 42-03]: km-core OntologyRegistry adopted via LegacyOntologyAdapter shim (100 lines) — Validator/Classifier/QueryEngine kept (D-53); B's 8 ontology JSONs flattened + structurally converted to km-core OntologyFile shape under D-53b (entities -> classes; hoist meta:{}); Detail class added to coding-ontology.json (D-53b minimal addition); team argument is silently dropped by adapter (single-team registry per instance)
- [Phase ?]: [Phase 42-04]: km-core Phase 42 INT-02 surfaces landed — Entity.embedding?: number[] (D-52), syncQdrantFromStore maintenance op (D-52a), FastembedEmbeddingClient default + ./embeddings sub-path (D-52c). Cross-repo: 6 commits in /Users/Q284340/Agentic/km-core (TDD RED+GREEN per task); container-side bind-mount picks up new code with no Docker rebuild. 242/242 km-core tests pass (+18 net).
- [Phase ?]: [Phase 42-04]: Real EmbeddingClient interface is single-text (Phase 40 contract); FastembedEmbeddingClient implements embed(text) and adds separate embedBatch(texts) for batch ergonomics — plan's <interfaces> block had the wrong signature. Documented as Rule 1 deviation.
- [Phase ?]: [Phase 42-04]: QdrantClient is a structural interface defined inside syncQdrantFromStore.ts (not from @qdrant/*) — km-core stays Qdrant-agnostic at the type level (Phase 40 LLMClient precedent extended to vector stores). Caller wraps their concrete client to match upsert(collection, points).
- [Phase ?]: [Phase 42-05]: D-54 in-place LevelDB→km-core migration script lands at scripts/migrate-leveldb-to-kmcore.mjs (~395 LoC) + 10-case integration test. Idempotent via top-level legacyId.system==='B' AND parseable UUIDv7 id check (CF-D37 placement, mirrors Phase 41 reproject pattern). Fail-loud 5% error budget. Trusted-path bulk writes (skipOntologyCheck:true so ad-hoc B classes still land). Atomic dir swap deferred to Plan 7.
- [Phase ?]: [Phase 42-05]: Production dry-run inside coding-services container: 802 entities (RESEARCH baseline 727; 75 added since), 0 errors, 19 ontologyClassUnregistered flags. The 19 are Project (11) + System (1) + Knowledge (7) — NOT the specialized Config/Port/Container classes RESEARCH §6 Risk 3 warned about (those ARE registered post-Plan-42-03). Surface area for Plan 7 to consider extending the ontology with Project/System/Knowledge classes.
- [Phase ?]: [Phase 42-05]: Live container holds LOCK on .data/knowledge-graph LevelDB; dry-run requires snapshotting source to /tmp inside container + removing the LOCK file before opening. Read-only intent honored. Plan 7 e2e gate's real migration run must either stop the container first OR snapshot pre-migration.
- [Phase ?]: [Phase 42-05]: B's LevelDB shape is single-blob, not key-per-entity (GraphDatabaseService._persistGraphToLevel writes all nodes under one key 'graph' as {nodes:[{key,attributes},...], edges:[], metadata:{}}). Plan text said "iterate all entries via streaming API" — actual implementation reads the blob and iterates nodes[]. Same end-result; documented as plan-text staleness.
- [Phase ?]: [Phase 42-06]: canonical km-core Entity emit shape via toCanonicalEntity + augmentWithCanonical in src/agents/canonical-mapper.ts. Wave1/Wave2/Wave3 agents stamp ontologyClass + entityType + legacyId + metadata.{subsystem,descriptionSegments,provenance} onto every emitted entity at the wave's return point. KGEntity interface extended with 4 optional canonical fields; legacy 'type' field kept with deprecation note (Phase 43 removes it).
- [Phase ?]: [Phase 42-06]: wave-controller persistWaveResult now flag-gated. When KM_CORE_PERSISTENCE=km-core AND kmCoreAdapter is bootstrapped, routes through new persistWithKmCore method that bypasses the 7-layer pipeline entirely (D-52b). Per-entity / per-relation errors fail-soft (Phase 41 resolveEntities precedent — T-42-06-03 mitigation). Legacy path preserved verbatim when flag is off.
- [Phase ?]: [Phase 42-06]: DeduplicationAgent local mergeEntityGroup function DELETED (D-50a). Replacement mergeDuplicateGroup forwards to km-core mergeEntities (imported from '@fwornle/km-core' root barrel per Plan 42-01 SUMMARY exports-map deviation). New setKmCoreStore(store, runId) injector is opt-in — orphan callers without injection skip merges + log stderr without throwing.
- [Phase ?]: [Phase 42-06]: Plan-text staleness — wave2 emits ONLY SubComponent entities (not Component AND SubComponent as plan's <interfaces> block suggested). The 7 Component entities in production all trace to wave1's L1 emit (wave1-project-agent.ts:497), NOT a wave2 sub-emit path. All wave2 entities mapped to ontologyClass='SubComponent' in Plan 6.
- [Phase ?]: [Phase 42-06]: augmentation-over-substitution pattern P42-06-1 — wave agents stamp canonical fields ON the existing KGEntity (in-place augment via augmentWithCanonical) rather than substituting a new Entity object. Both shapes coexist during the strangler transition; Plan 7 cleanup deletes legacy fields after all readers migrate.
- [Phase 42.1.1-01]: Layout-tolerant ontology resolver lives at `src/ontology/ontologyPathResolver.ts` (NOT inside km-core) because km-core is consumer-agnostic by design — knowledge of the project's `.data/ontologies/` directory shape belongs in the consumer (B's mcp-server-semantic-analysis). Resolver is exposed via the ontology barrel so future consumers (insight-generation-agent cleanup) can adopt the same lookup without re-implementing the dirname-walk.
- [Phase 42.1.1-01]: Probe-counter test-only API (`__resetProbeCounter`/`__getProbeCount`) chosen over the "delete file and retry" cache-hit assertion strategy because (a) it works against the real `.data/ontologies/` directory without filesystem mutation, (b) it's idempotent across parallel test runs, and (c) the plan locks it as "the single canonical assertion for cache behaviour". Double-underscore prefix marks it as non-public — documented as test-only in JSDoc.
- [Phase 42.1.1-01]: Test C softened per user Option A — dropped `isValidClass('Project') === true`, kept Component canary + added `domains.length === 8`. Rationale: Project class is not declared in any on-disk ontology JSON; asserting on it would require either editing `.data/ontologies/upper.json` (path-b explicitly rejected by CONTEXT.md) or registering Project at runtime (out of scope for a loader fix). Per CONTEXT.md line 93-94, SC#6 promotion is owned by Phase 42.1's verifier, not 42.1.1. The new known residual (add Project to on-disk JSON) is layer-2 of the SC#6 cascade and tracked as a separate follow-up.

### Blockers/Concerns

- [Phase 28]: Verify Docker base image supports fastembed (requires glibc/Debian, not Alpine)
- [Phase 32]: OpenCode plugin injection API needs runtime validation before implementation
- [Phase 32]: Copilot per-prompt injection may not be supported -- may need refresh daemon approach
- [v7.1 Phase 43]: OKM cross-repo packaging strategy (submodule vs published npm vs vendored) — must be decided in INT-03's discuss phase
- [v7.1 Phase 45]: D3 (VOKB) vs sigma.js (VKB) viewer choice — open question, research seed leans D3
- [Phase 42.1 SC#6 — layer 2 of the cascade — NEW 2026-05-24]: After Phase 42.1.1 plan 01 closed (loader layer 1 unblocked, 18/18 node:test pass), `ensureProjectAnchor('Coding')` will still raise `Unknown ontology class: Project` at runtime because the `Project` class is not declared in any on-disk `.data/ontologies/*.json`. `/gsd-verify-phase 42.1` will not pass until a follow-up phase adds `Project` to `.data/ontologies/upper.json` (or `coding-ontology.json`) with a minimal schema sufficient for the post-sweep anchor pass. Recommended title: "Phase 42.1.2 — register Project ontology class for ensureProjectAnchor". See `.planning/phases/42.1.1-…/42.1.1-01-SUMMARY.md` § Known Residuals.

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
| Phase 38 P03 | 4min | 2 tasks | 4 files |
| Phase 38 P04 | 3min | 2 tasks | 2 files |
| Phase 38 P05 | 2min | 1 task  | 1 file  |
| Phase 38 P06 | 4min | 2 tasks | 2 files |
| Phase 42 P01 | 16min | 3 tasks | 5 files |
| Phase 42 P02 | 26min | 2 tasks | 3 files |
| Phase 42 P03 | 27m | 3 tasks | 13 files |
| Phase 42 P04 | 12m | 4 tasks | 11 files |
| Phase 42 P05 | 30m | 2 tasks | 2 files |
| Phase 42 P06 | 45m | - tasks | - files |
| Phase 42.1.1 P01 | ~50m (cross-session) | 3 tasks | 5 files |

## Session Continuity

Last session: 2026-05-24T17:30:00Z
Stopped at: Phase 42.1.1-01 complete (ontologyPathResolver + OntologyConfigManager loader-path wiring + Test C softened per Option A; 18/18 node:test pass; layer-1 SC#6 unblocked; NEW known residual — Project class not on disk, layer-2 follow-up tracked separately)
Resume with: Either open a new bug-fix phase (proposed 42.1.2) to register `Project` on disk and re-run `/gsd-verify-phase 42.1`, OR continue with Phase 42 (Offline UKB Migration) and address the Project-class follow-up in parallel.

Plan 02 follow-up for Plan 7:

- Read .planning/phases/42-offline-ukb-migration-b/42-02-VERIFY-FAIL.log
- SC#4 (terminal-state consistency within 5s of process exit) requires the
  RESEARCH §2 fix #1 single-writer architecture refactor. The workflow runner
  process exits silently before any coordinator.writeProgressFile call fires
  from a completed wave, so the dashboard sees a stuck "running" state.

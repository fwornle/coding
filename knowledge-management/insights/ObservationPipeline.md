# ObservationPipeline

**Type:** SubComponent

## What It Is

ObservationPipeline is the write→consolidate→export subsystem of LiveLoggingSystem, implemented across three dedicated modules in `src/live-logging/`: `ObservationWriter.js`, `ObservationConsolidator.js`, and `ObservationExporter.js`, supported by `scripts/enhanced-transcript-monitor.js` upstream and `src/live-logging/raw-fallback.js` as a shared marker utility. It persists per-prompt-set observations, aggregates them into daily digests and longer-lived insights, and serializes all three tiers to git-tracked JSON under `.data/observation-export/` for dashboard consumption.

![ObservationPipeline — Architecture](images/observation-pipeline-architecture.png)

## Architecture and Design

The pipeline follows a strict three-stage Pipeline/ETL pattern — capture, write, consolidate, export — where each stage is sequential but independently invokable. This realizes a two-level memory hierarchy reminiscent of Observer/Reflector designs: fine-grained observations roll up into `digests` via `consolidateDay()`, which in turn synthesize into `insights` via `synthesizeInsights()`.

A notable single-owner writer pattern governs the Insight-write surface: although `ObservationConsolidator` computes insight content, it routes writes back through `ObservationWriter.writeInsight` (Phase 58 Plan 02, D-06) rather than touching km-core directly, keeping `ObservationWriter` the sole owner of persistence even under tight coupling between the two modules. Observation reads, by contrast, remain loosely coupled. `ObservationExporter` is deliberately decoupled from the live write path — it re-derives export files from the km-core graph rather than tailing a log, applying a safety-merge/tombstone pattern in `_mergeWithExisting()` to prevent data loss across export passes.

The subsystem underwent a hard Phase 44 cutover from SQLite to km-core's `GraphKMStore`, explicitly "no dual-write window; no feature flag" — a deliberate risk trade-off favoring simplicity over rollback safety.

## Implementation Details

`ObservationWriter.js` persists entities into `GraphKMStore` and defines the `capturedBy` provenance scheme via `ANCHOR_ROOT = 'LiveLoggingSystem'` and `ANCHOR_FOR_KIND`, mapping observations/digests/insights to specific writer/consolidator anchors rather than a single global anchor (replacing 1,244 edges previously pointing only at `LiveLoggingSystem`). Notably, per-run identifiers (`_runId`) are stored only in `metadata.provenance`, never minted as graph nodes, since that approach previously produced 401 low-value nodes after 500 runs. This module also hosts `ObservationWriteEventBus`, a process-wide `_observationEmitter` singleton (Phase 55 Plan 06 Task 3) whose lifecycle is tied to module load.

`ObservationConsolidator.js` implements `consolidateDay()` and `synthesizeInsights()`, lazily constructing an `ObservationWriter` (`_ensureObservationWriter`) sharing the kmStore. It houses the dedup/facet logic child component InsightDedupAndFacetBands describes: `INSIGHT_DEDUP_THRESHOLD` (0.88) and `INSIGHT_FACET_THRESHOLD` (0.83) for cosine similarity, plus Jaccard bands (0.60 merge, 0.30 facet), calibrated against a measured 0.89–0.92 MiniLM-L6-v2 floor. A critical fix here replaced blocking `execFileSync` git calls with `execFileAsync`, since a synchronous call froze every obs-api HTTP route, including the 2s heartbeat.

`ObservationExporter.js`'s `keepInExport()` excludes `quality === 'low'` rows except `[Raw]` fallback rows, detected via `isRawFallbackSummary()` from `raw-fallback.js` — the isolation of that module exists purely so export-only test paths avoid pulling in ioredis/km-core. This raw-preservation logic is the concrete mechanism behind child component RawFallbackReceipt. `_mergeWithExisting()` uses `contentKey()` (date+theme for digests, topic for insights) to avoid re-accumulating km-core-rekeyed rows, and honors `metadata.absorbed` tombstones written when duplicate insights are merged.

Upstream, `scripts/enhanced-transcript-monitor.js` normalizes cross-agent tool-call shapes via `toolCallArgs()`, reconciling `StreamingTranscriptReader`/`AdaptiveExchangeExtractor`'s `input` objects against `PiSessionReader`'s `{name, type, content}` shape — a gap that once caused 0 of 21 pi observations to carry an artifact. `extractFileChanges()`/`bashWriteTargets()` filter shell redirection noise, reducing 175 candidate targets to 15 true positives.

## Integration Points

![ObservationPipeline — Relationship](images/observation-pipeline-relationship.png)

ObservationPipeline sits directly beneath LiveLoggingSystem, which also hosts sibling health-monitoring concerns like LSLConfigValidator's PID-staleness checks. Its four children — RawFallbackReceipt, EvidenceFloorGate, ObservationWriteEventBus, InsightDedupAndFacetBands — represent conceptual/embedded mechanisms rather than separate files, living inside the writer and consolidator modules. obs-api is the single-threaded, in-process owner of km-core's LevelDB, meaning any blocking call inside the pipeline is a global availability risk, as demonstrated when a synchronous git call left obs-api at 2.7% CPU with a 7.5-minute-stale heartbeat, correctly surfaced as "Degraded" by the dashboard. Test infrastructure must respect this: a Typed-Views Test Suite incident showed the write endpoint is effectively single-threaded, timing out under concurrent Jest workers.

## Usage Guidelines

Because the SQLite→km-core cutover was a hard switch with no feature flag, no code path should attempt dual-write or fallback to SQLite. Any new blocking synchronous subprocess calls inside `ObservationConsolidator` should be avoided in favor of `execFileAsync`-style patterns, given obs-api's single-threaded, in-process ownership of the LevelDB. Test suites exercising observation-write endpoints must serialize or cap worker concurrency rather than assume parallel safety. When modifying export logic, preserve the `[Raw]` fallback exception in `keepInExport()` and the tombstone-respecting merge in `_mergeWithExisting()` — both encode hard-won fixes for previously silent data loss. Avoid minting per-run graph nodes; use `metadata.provenance` instead, per the anchoring scheme's design rationale.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap notes periodic re-synthesis of parent-node descriptions from accumulated child observations is fully implemented in production with one open guard-coverage defect.
- The 'Typed-Views Test Suite — obs-api Contention Timeout' record establishes that the observation pipeline's write endpoint on obs-api is effectively single-threaded, and that concurrent Jest test workers calling it in parallel from the typed-views suite caused a timeout failure — meaning any future test infrastructure exercising the observation-writing paths must serialize or limit worker concurrency against this endpoint rather than assuming safe parallelism.

## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents

### Children
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] The 'RawFallbackReceipt' component appears not as a named class but as a conceptual pattern spanning raw-fallback.js's isRawFallbackSummary()/RAW_FALLBACK_PREFIX, ObservationWriter.js's referenced _fallbackSummary() method, and ObservationExporter.js's keepInExport() gate — a receipt is a row stamped with the '[Raw]' prefix when the LLM proxy is unreachable, preserving the raw messages for later re-summarization rather than discarding the turn.
- [EvidenceFloorGate](./EvidenceFloorGate.md) -- [LLM] None of the supplied files — `scripts/enhanced-transcript-monitor.js`, `src/live-logging/ObservationConsolidator.js`, `src/live-logging/ObservationExporter.js`, `src/live-logging/ObservationWriter.js`, and `src/live-logging/raw-fallback.js` — define, import, or reference a symbol, class, or file named `EvidenceFloorGate`. A grep-equivalent scan of every export, constant, and comment in these five files turns up no match for 'Evidence', 'Floor', or 'Gate' as a compound identifier.
- [ObservationWriteEventBus](./ObservationWriteEventBus.md) -- [LLM] The component referred to as "ObservationWriteEventBus" is not a standalone class or file — it is the module-level `_observationEmitter` singleton defined near the top of `src/live-logging/ObservationWriter.js`, alongside the `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` provenance constants. The code's own comment ("Phase 55 Plan 06 Task 3 — process-wide observation-write event bus") is the closest thing to a name for this component, confirming the entity is real but embedded inside the writer module rather than factored out, so its lifecycle is tied to the writer's module load rather than to any writer instance.
- [InsightDedupAndFacetBands](./InsightDedupAndFacetBands.md) -- [LLM] The dedup/facet threshold constants (INSIGHT_DEDUP_THRESHOLD=0.88, INSIGHT_FACET_THRESHOLD=0.83, INSIGHT_TOPIC_JACCARD_MERGE=0.60, INSIGHT_TOPIC_JACCARD_FACET=0.30) are defined directly in ObservationConsolidator.js, which is the closest concrete code to what 'InsightDedupAndFacetBands' would name. These constants encode a two-band decision surface: pairs above the strict threshold get merged as duplicates, pairs in the borderline band get cross-linked as 'facets' rather than merged, calibrated against a measured MiniLM-L6-v2 cosine floor of 0.89-0.92 for same-project documents.

### Siblings
- [LSLConfigValidator](./LSLConfigValidator.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents.
- [SessionFactIndex](./SessionFactIndex.md) -- [LLM] None of the retrieved code files reference a `SessionFactIndex` class, export, or file. The closest named artifact is `session-facts.ts`, cited only in the parent entity's own observations ('Session facts extracted from live transcripts... anchored onto the knowledge graph primarily via `metadata.parentId`, with a fallback resolution path through `contains` edges'), but that file was not part of this retrieval — the actual anchoring logic, its parentId-stamping code path, and its contains-edge fallback are not visible here to verify or ground further.
- [TranscriptAdapters](./TranscriptAdapters.md) -- [LLM] No file in the supplied code evidence is named or scoped as 'TranscriptAdapters'. The closest candidates — enhanced-transcript-monitor.js, PiSessionReader.js, StreamingTranscriptReader.js, AdaptiveExchangeExtractor.js, PiSessionWriter.js — are transcript readers/writers referenced as imports inside enhanced-transcript-monitor.js, but none of them is shown, and no adapter-registry or adapter-interface abstraction is visible in the truncated excerpts provided.
- [TmuxSessionWrapper](./TmuxSessionWrapper.md) -- [LLM] None of the five supplied files (scripts/enhanced-transcript-monitor.js, src/live-logging/ObservationWriter.js, src/live-logging/ObservationConsolidator.js, src/live-logging/ObservationExporter.js, src/live-logging/raw-fallback.js) define, import, or reference anything named TmuxSessionWrapper, nor any tmux-specific process spawning, pane/window management, or terminal-multiplexer control logic. The retrieved set clusters around the Observation write/consolidate/export pipeline and the ETM (enhanced-transcript-monitor) prompt-capture loop — a thematically adjacent but distinct part of LiveLoggingSystem from whatever wraps a tmux session.


---

*Generated from 11 observations*

# ObservationWriter

**Type:** SubComponent

## What It Is

ObservationWriter is a class defined in `ObservationWriter.js` (`src/live-logging/ObservationWriter.js`), part of the LiveLoggingSystem. It is imported directly into `scripts/enhanced-transcript-monitor.js` (`import { ObservationWriter } from '../src/live-logging/ObservationWriter.js';`), where it is wired up via the `_initObservationWriter` method on EnhancedTranscriptMonitor. Its core responsibility, per the parent record, is to mediate all observation persistence between the transcript monitor (ETM) and the database, applying turn-aware semantic deduplication and snapshot promotion before data lands in storage. Health monitoring is provided by `fetchLastObservationWriterCallAge` in `health-coordinator.js`, and `ObservationConsolidator.js` depends on it via `_ensureObservationWriter`, indicating the writer's lifecycle is externally supervised rather than self-managed.

## Architecture and Design

![ObservationWriter — Architecture](images/observation-writer-architecture.png)

The dominant pattern is a mediator/write-through: ObservationWriter sits between ETM (producer) and the database (sink), decoupling the ingestion side from persistence concerns. Upstream, ETM's `extractFileChanges()` and `toolCallArgs()` normalize four divergent tool-call shapes (Claude/opencode's `input` object vs. pi's stringified `content`) into a uniform `{modifiedFiles, readFiles}` structure before anything reaches the writer — meaning ObservationWriter's dedup/snapshot logic is architecturally decoupled from per-agent tool-call formats, though it is also dependent on that upstream normalization being complete (pi's historically poor artifact-capture rate is a noted risk to the signal the writer receives).

The code graph's import clustering places ObservationWriter.js alongside ObservationConsolidator.js and MentionsClassifier.js, suggesting these three form a de facto observation-pipeline stack: write → consolidate → classify-mentions. ObservationConsolidator (a sibling) later performs dirty-parent-only re-synthesis on data the writer persisted, a division of labor consistent with write-time dedup living in ObservationWriter and read-time re-synthesis living downstream.

Notably, ETM imports both ObservationWriter and ObservationApiClient, hinting at two parallel write paths whose split responsibility is not resolved in the available material — this is a documented ambiguity rather than a confirmed dual-path design.

## Implementation Details

Core mechanics are described mainly at the session-record level rather than verified in source excerpts: turn-aware semantic dedup and a snapshot-promotion step run before persistence. A degraded-mode path produces `[Raw]` fallback observations when a proxy call times out mid-classification; this path is logged as "storing" but has been repeatedly observed to silently fail to persist — the log output actively reports success while no row lands, a defect distinct from ordinary write failures. This fallback logic corresponds to the child component RawFallbackPath. A later revision added an "evidence-floor gate" to the writer specifically to stop legitimate, non-duplicate turns from being misclassified as redundant and discarded by the semantic-dedup logic — implying the pre-gate dedup had a false-positive failure mode on valid work turns.

Three other children — AnchorEdgeWriter, ObservationEventBus, and WriterPathUnification — are named in the component tree but are not evidenced in any supplied file; retrieval for these returned only the parent's neighborhood, so their implementations remain undocumented here rather than inferred.

Directory-wide conventions likely (but not code-verified for this file) extend from sibling MentionsClassifier.js: exclusive use of `process.stderr.write` for logging (no `console.*`, enforced by a grep check), a fail-fast contract where proxy errors propagate rather than get swallowed, and a `_paced()` gate protecting the shared rapid-llm-proxy from saturation.

## Integration Points

![ObservationWriter — Relationship](images/observation-writer-relationship.png)

ObservationWriter's primary caller is EnhancedTranscriptMonitor, via `_initObservationWriter`, and its primary downstream dependent is ObservationConsolidator, via `_ensureObservationWriter`. Health-coordinator's `fetchLastObservationWriterCallAge` implies external polling of the writer's activity to detect outages — consistent with the Observation Pipeline's documented failure modes where the pipeline appears down or data appears lost despite being persisted. Imports listed against ObservationWriter.js include `repo-router.mjs` (`routeFromArtifacts`), `task-id.mjs` (`resolveLiveTaskIdSafe`), `window.mjs` (`getLSLWindow`), `ConfigurableRedactor.js`, and `MentionsClassifier.js`, plus test-only reset hooks like `__resetCacheForTests` and `ObservationConsolidator.js` — indicating the writer coordinates task/window resolution, redaction, and mention classification as part of its persistence flow.

## Usage Guidelines

Callers should not treat a "storing" log line from ObservationWriter as proof of durable persistence — the `[Raw]` fallback path is a known exception where success is logged despite silent failure, so any reliability-sensitive code path should verify persistence independently (e.g., via health-coordinator's call-age check) rather than trusting the writer's own log output. Anyone modifying the semantic-dedup logic should preserve the evidence-floor gate's intent: distinguishing genuinely redundant turns from legitimate low-signal-but-valid ones. Because dedup/snapshot quality depends on upstream normalization in ETM's `extractFileChanges()`/`toolCallArgs()`, gaps there (as with pi's historically poor capture rate) will silently degrade the writer's effectiveness without an error surfacing in the writer itself — test coverage in `ObservationWriter.test.js`, `ObservationWriter.anchor-target.test.js`, `ObservationWriter.needs-lsl-resolution.test.js`, and `ObservationWriter.pre-llm-dedup.test.js` should be consulted and extended when touching these paths, and `makeObservationWriterStub` (in `live-opencode-sqlite-poll.test.js`) is available for simulating the writer in integration tests.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ObservationWriter (class) in ObservationWriter.js
- _initObservationWriter (method) in enhanced-transcript-monitor.js
- fetchLastObservationWriterCallAge (function) in health-coordinator.js
- _ensureObservationWriter (method) in ObservationConsolidator.js
- makeObservationWriterStub (function) in live-opencode-sqlite-poll.test.js
- The code graph's key-entities list confirms ObservationWriter (class) lives in ObservationWriter.js and is imported directly into scripts/enhanced-transcript-monitor.js, alongside ObservationApiClient, at the top-level import block (`import { ObservationWriter } from '../src/live-logging/ObservationWriter.js';` / `import { ObservationApiClient } from '../src/live-logging/ObservationApiClient.js';`). The graph also lists `_initObservationWriter` as a method on enhanced-transcript-monitor.js, which is the wiring point where ETM hands its extracted exchange data to the writer — but that method's body is not present in the supplied excerpt, so only the dependency edge (ETM → ObservationWriter) is verifiable here, not the call contract itself.

**Relationships:**
- Calls: debug
- Imports: repo-router.mjs, routeFromArtifacts, task-id.mjs, resolveLiveTaskIdSafe, window.mjs, getLSLWindow, ConfigurableRedactor.js, MentionsClassifier.js, __resetCacheForTests, ObservationConsolidator.js (+3 more)

**Other:**
- ObservationWriter.js (module) in ObservationWriter.js
- ObservationWriter.test.js (module) in ObservationWriter.test.js
- ObservationWriter.anchor-target.test.js (module) in ObservationWriter.anchor-target.test.js
- ObservationWriter.needs-lsl-resolution.test.js (module) in ObservationWriter.needs-lsl-resolution.test.js
- ObservationWriter.pre-llm-dedup.test.js (module) in ObservationWriter.pre-llm-dedup.test.js
- The code graph's import list places ObservationWriter.js/ObservationWriter directly alongside ObservationConsolidator.js/ObservationConsolidator and MentionsClassifier.js/`__resetCacheForTests`, suggesting these three modules are commonly imported together as the observation-pipeline stack (write → consolidate → classify-mentions), consistent with the parent record's description of ObservationWriter mediating persistence while ObservationConsolidator handles later dirty-parent re-synthesis.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent: [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist.
- Observation Pipeline — Outage, Backfill, and Data-Loss Modes: the observation pipeline persists agent session activity including file-change artifacts, and documents known failure modes where the pipeline appears down or data appears lost despite being persisted.
- Per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record, [Raw] fallback observations — generated specifically when a proxy call times out mid-classification — are logged by the pipeline as 'storing' yet have been repeatedly observed to silently fail to persist to the database. This means the writer's own log output cannot be trusted as evidence of durable storage for that observation class, a gap distinct from ordinary write failures because the code path actively reports success while the row never lands.
- The same record also establishes that a later revision added an 'evidence-floor gate' to ObservationWriter specifically to prevent valid work turns from being silently dropped — implying the semantic-dedup logic had, prior to that gate, an observed failure mode where legitimate (non-duplicate) turns were being classified as redundant and discarded rather than persisted, which the evidence-floor check now guards against.

## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observation persistence between ETM and the database, applying turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist

### Children
- [RawFallbackPath](./RawFallbackPath.md) -- [SESSION] ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent: [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist.
- [AnchorEdgeWriter](./AnchorEdgeWriter.md) -- [LLM] None of the five supplied files (lib/lsl/adapters/claude-jsonl-tree.mjs, lib/lsl/token/stop-adapter-registry.mjs, scripts/enhanced-transcript-monitor.js, scripts/tmux-session-wrapper.sh, src/live-logging/MentionsClassifier.js) define, export, import, or even mention a class, function, or module named 'AnchorEdgeWriter'. The retrieval set was drawn from the parent ObservationWriter's neighbourhood (same src/live-logging/ directory and its ETM caller) rather than from this entity's own source, so this analysis is grounded in the parent's documented behavior and in filenames visible in the parent's code-graph listing, not in AnchorEdgeWriter's implementation.
- [ObservationEventBus](./ObservationEventBus.md) -- [LLM] None of the five supplied files define, export, or reference a class, module, or symbol named ObservationEventBus. scripts/enhanced-transcript-monitor.js imports ObservationWriter and ObservationApiClient directly (`import { ObservationWriter } from '../src/live-logging/ObservationWriter.js'; import { ObservationApiClient } from '../src/live-logging/ObservationApiClient.js';`) and appears to hand exchange data to the writer synchronously rather than through any publish/subscribe or event-emitter abstraction. If an ObservationEventBus exists in this codebase, it is not among the files retrieved for this component.
- [WriterPathUnification](./WriterPathUnification.md) -- [LLM] None of the supplied code files (claude-jsonl-tree.mjs, stop-adapter-registry.mjs, enhanced-transcript-monitor.js, tmux-session-wrapper.sh, MentionsClassifier.js) implement anything named WriterPathUnification, nor do they reference a unification layer between multiple writer paths. The only concrete tie to the parent ObservationWriter subject is the import edge in enhanced-transcript-monitor.js and MentionsClassifier's shared-module role described in the parent observations.

### Siblings
- [ObservationConsolidator](./ObservationConsolidator.md) -- [SESSION] Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap: implements a dirty-parent-only scheduled re-consolidation strategy that re-synthesizes only parents with new children, far cheaper than full re-synthesis while nearly matching quality.
- [MentionsClassifier](./MentionsClassifier.md) -- [CGR] MentionsClassifier.js (module) in MentionsClassifier.js
- [EnhancedTranscriptMonitor](./EnhancedTranscriptMonitor.md) -- [CGR] EnhancedTranscriptMonitor (class) in enhanced-transcript-monitor.js
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] `STOP_ADAPTERS` (lib/lsl/token/stop-adapter-registry.mjs) is the component's core data structure: a per-agent keyed registry where each entry declares `mode: 'transcript'` (claude, copilot, opencode) or `mode: 'stamp-only'` (pi), with only 'transcript' entries carrying a `build`/`locate` pair. This is a deliberate Strategy/Adapter hybrid — the keyed-map shape lets `captureForegroundTokens` treat all four agents uniformly while the mode flag encodes a hard invariant (D-04): only agents that bypass rapid-llm-proxy get a transcript rebuild, because building one for a proxy-routed agent would double-count tokens already present in `token_usage`.
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Claude sub-agent transcript discovery path via `walkSubAgentJsonl()`, which recursively visits `~/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` and filters every candidate through `SUBAGENT_PATH_RE` at the candidate stage rather than after conversion. The regex captures three groups — encoded-cwd, parent session UUID, and agent hex id — that are re-extracted downstream by three separate single-purpose functions (`projectFromClaudeSubagentPath`, `parentSessionFromClaudeSubagentPath`, `agentIdFromClaudeSubagentPath`) instead of being threaded through as a parsed object, so every caller that needs row metadata re-runs the same regex against the same path.


---

*Generated from 23 observations*

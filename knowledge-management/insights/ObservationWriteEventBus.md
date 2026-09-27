# ObservationWriteEventBus

**Type:** Detail

## What It Is

`ObservationWriteEventBus` is not a standalone class or file — it is the module-level `_observationEmitter` singleton (a Node `EventEmitter`) defined near the top of `src/live-logging/ObservationWriter.js`, alongside the `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` provenance constants. Its identity comes from an in-code comment — "Phase 55 Plan 06 Task 3 — process-wide observation-write event bus" — rather than from any exported symbol bearing that name. It is embedded inside `ObservationWriter.js`, so its lifecycle is tied to module load, not to construction of any particular `ObservationWriter` instance. As a child of `ObservationPipeline`, it functions as the pipeline's write-completion signal, sitting alongside siblings `RawFallbackReceipt`, `EvidenceFloorGate`, and `InsightDedupAndFacetBands` as one of several conceptual (rather than class-named) pieces of the observation write path.

## Architecture and Design

The core pattern is observer/pub-sub via a module-level singleton EventEmitter, deliberately chosen over an instance-scoped emitter to solve an ordering problem: obs-api constructs `ObservationWriter` lazily, so if the emitter were tied to that instance, SSE subscribers would need to wait for or trigger construction before subscribing. Making the bus module-scoped decouples "who can listen" from "has the writer been built yet." This is a narrow, deliberately justified architectural decision rather than a generic pub-sub adoption.

A second pattern is the test-injection seam: `_resetObservationEmitterForTests()` and `_emitObservationWrittenForTests(row)` allow the SSE integration test for `/api/coding/observations/stream` to drive handlers deterministically without running the full LLM/dedup pipeline or a live km-core write. Idempotent unsubscribe is also a named pattern — the closure returned by `subscribeObservationWritten` uses an `unsubscribed` boolean guard to prevent double-`off` calls.

Notably, the bus provides no internal listener isolation: correctness ("listeners MUST NOT throw") is enforced by convention and by consumer-side try/catch, not by the bus itself.

## Implementation Details

The public contract is exactly three functions: `subscribeObservationWritten(listener)`, `_resetObservationEmitterForTests()`, and `_emitObservationWrittenForTests(row)`. Only one event, `'written'`, is emitted, carrying a payload mirroring `writeObservation`'s internal `obsRow` shape. `_observationEmitter.setMaxListeners(32)` overrides Node's default cap of 10 — a defensive, explicitly commented deviation, since production expects only ~2 SSE clients (unified-viewer dev server plus one browser tab); 32 exists solely to silence `MaxListenersExceededWarning` under transient conditions, not to support real fan-out.

Per D-06 in `ObservationConsolidator.js` (`_ensureObservationWriter()`), Insight writes now route through `ObservationWriter.writeInsight` rather than writing km-core directly, making it likely — though not directly confirmable from the given file slice, since `writeInsight`'s body is truncated — that the same `_observationEmitter` is the sole write-completion signal for both Observation and Insight persistence.

## Integration Points

The bus's principal consumer is the SSE handler for `/api/coding/observations/stream`, which subscribes via `subscribeObservationWritten` and wraps `res.write` in its own try/catch to satisfy the "MUST NOT throw" contract. Upstream, it is fed by `ObservationWriter`'s write path and, transitively, by `ObservationConsolidator` through the D-06 `writeInsight` routing. It shares its process — and thus its event-loop — with obs-api's single-threaded HTTP server and km-core LevelDB, the same contention domain documented in the "Typed-Views Test Suite — obs-api Contention Timeout" record and addressed elsewhere via the `execFileSync`→`execFileAsync` fix in `ObservationConsolidator.js`. This means a slow `'written'` listener competes for the same event loop that other write and route handling depends on.

## Usage Guidelines

Listeners registered via `subscribeObservationWritten` must never throw synchronously, since an exception would surface inside the writer's hot write path and could derail subsequent observation processing; any risky work belongs behind a listener-side try/catch, as the SSE handler already does. The 32-listener cap should not be treated as a scalability allowance — it reflects a measured ~2-client topology, and any future consumer adding many long-lived subscriptions should revisit this ceiling. Because the bus lives in the same process as obs-api's LevelDB and HTTP routes, listeners should avoid blocking operations. Tests should use `_resetObservationEmitterForTests()` between runs and `_emitObservationWrittenForTests(row)` to simulate writes rather than exercising the full pipeline.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Typed-Views Test Suite — obs-api Contention Timeout' record establishes that obs-api's write endpoint is effectively single-threaded; because `_observationEmitter` lives in the same in-process obs-api that owns the km-core LevelDB and answers HTTP routes, any slow or misbehaving `'written'` listener would compete for the same event loop the record already shows can be starved by a single blocking call (the sibling `execFileSync`→`execFileAsync` fix in `ObservationConsolidator.js` addresses an analogous event-loop-blocking risk in the same process).

## Hierarchy Context

### Parent
- [ObservationPipeline](./ObservationPipeline.md) -- [SESSION] Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap notes periodic re-synthesis of parent-node descriptions from accumulated child observations is fully implemented in production with one open guard-coverage defect.

### Siblings
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] The 'RawFallbackReceipt' component appears not as a named class but as a conceptual pattern spanning raw-fallback.js's isRawFallbackSummary()/RAW_FALLBACK_PREFIX, ObservationWriter.js's referenced _fallbackSummary() method, and ObservationExporter.js's keepInExport() gate — a receipt is a row stamped with the '[Raw]' prefix when the LLM proxy is unreachable, preserving the raw messages for later re-summarization rather than discarding the turn.
- [EvidenceFloorGate](./EvidenceFloorGate.md) -- [LLM] None of the supplied files — `scripts/enhanced-transcript-monitor.js`, `src/live-logging/ObservationConsolidator.js`, `src/live-logging/ObservationExporter.js`, `src/live-logging/ObservationWriter.js`, and `src/live-logging/raw-fallback.js` — define, import, or reference a symbol, class, or file named `EvidenceFloorGate`. A grep-equivalent scan of every export, constant, and comment in these five files turns up no match for 'Evidence', 'Floor', or 'Gate' as a compound identifier.
- [InsightDedupAndFacetBands](./InsightDedupAndFacetBands.md) -- [LLM] The dedup/facet threshold constants (INSIGHT_DEDUP_THRESHOLD=0.88, INSIGHT_FACET_THRESHOLD=0.83, INSIGHT_TOPIC_JACCARD_MERGE=0.60, INSIGHT_TOPIC_JACCARD_FACET=0.30) are defined directly in ObservationConsolidator.js, which is the closest concrete code to what 'InsightDedupAndFacetBands' would name. These constants encode a two-band decision surface: pairs above the strict threshold get merged as duplicates, pairs in the borderline band get cross-linked as 'facets' rather than merged, calibrated against a measured MiniLM-L6-v2 cosine floor of 0.89-0.92 for same-project documents.


---

*Generated from 10 observations*

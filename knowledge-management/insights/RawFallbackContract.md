# RawFallbackContract

**Type:** Detail

## What It Is

RawFallbackContract is implemented as a single-purpose module at `src/live-logging/raw-fallback.js`, exporting exactly two symbols: the `RAW_FALLBACK_PREFIX` constant (`'[Raw]'`, defined at line 20) and the `isRawFallbackSummary()` predicate (line 31). It is not a class or service but a shared micro-contract — a small piece of vocabulary that lets two otherwise-independent modules, `ObservationWriter.js` and `ObservationExporter.js`, agree on how to recognize a placeholder observation without either module importing the other. It is listed as contained by LSLConfigValidator in the hierarchy, though no observation actually ties its logic to that parent's PID-staleness/health-coordinator concerns — the parent linkage appears structural/organizational rather than functional.

## Architecture and Design

The core pattern is a **shared minimal-predicate module** used to avoid duplicating a string-matching check across a producer, a quality classifier, and a repair script. Rather than having `ObservationExporter.js` import `ObservationWriter.js` directly, both depend on the small, dependency-free `raw-fallback.js`, which the module's own docstring explains was split out specifically so ObservationExporter's test suite doesn't pull in `ioredis` and `km-core` transitively through `ObservationWriter.js`.

A second pattern is **receipt-not-record fallback**: when the LLM proxy is unreachable, `ObservationWriter.js`'s `_fallbackSummary()` method stamps a placeholder summary with `RAW_FALLBACK_PREFIX` while preserving the full message array in `metadata.messages`, so nothing is lost even though no real summary could be generated — this is a receipt of failure, not a semantic record, kept around for later repair.

A third, more unusual pattern is **deliberate divergence between quality classification and export inclusion** for the same row. `ObservationExporter.js`'s `keepInExport(row)` treats `isRawFallbackSummary(row.summary)` as an explicit exception to its default `quality !== 'low'` filter, but the row's `quality` field intentionally stays `'low'` — so `ObservationConsolidator.js` (per its own inline comments near lines 1392/1687) still excludes it from digest consolidation while the dashboard renders it faintly. Rather than introducing a new quality tier to resolve this tension, the system resolves it narrowly through this one predicate, keeping the classification and export-eligibility concerns cleanly separate.

## Implementation Details

`isRawFallbackSummary` is deliberately lenient: it trims and lowercases the input before matching (`summary.trimStart().toLowerCase().startsWith(RAW_FALLBACK_PREFIX.toLowerCase())`). This shape wasn't designed prospectively — the docstring cites a specific real row, `'[Raw] needs backfill'` from 2026-05-28, as the forensic evidence that motivated case-insensitive matching. The module's design was reverse-engineered from production data rather than speculative.

The producer side, `ObservationWriter.js`'s `_fallbackSummary()`, is the sole writer of `[Raw]`-prefixed summaries, invoked when the LLM proxy is unreachable. The consumer side, `ObservationExporter.js`'s `keepInExport(row)`, is the sole reader, using the predicate to carve out an exception to its low-quality filter. Neither file imports the other; `raw-fallback.js` is the only shared surface between them, keeping the coupling minimal and explicit.

## Integration Points

The contract's producer/consumer relationship spans `ObservationWriter.js` (producer) and `ObservationExporter.js` (consumer), with `raw-fallback.js` as the sole shared dependency between them. `ObservationConsolidator.js` also participates indirectly as the owner of quality classification, since it relies on the `quality` field staying `'low'` for these rows even after export. `scripts/backfill-raw-observations.mjs` is the downstream repair tool meant to reprocess these placeholder rows using the preserved `metadata.messages`.

This contract sits alongside siblings ObservationExportSafetyMerge (also within `ObservationExporter.js`, implementing `_mergeWithExisting`'s defensive union logic for `observations.json`/`digests.json`/`insights.json`), HostPathResolver, and PostLLMEvidenceFloor — though observations note the latter two have no evidence of implementation in the retrieved live-logging files at all, suggesting retrieval-by-filename mismatch is a recurring risk across this component family, and indeed the parent LSLConfigValidator's own documented content (health-coordinator PID staleness) appears unrelated to RawFallbackContract's actual mechanics.

## Usage Guidelines

Developers should treat `raw-fallback.js` as the single source of truth for detecting `[Raw]`-prefixed placeholder summaries — any new code needing this check should call `isRawFallbackSummary()` rather than re-implementing prefix matching, since a prior conflation of `quality:'low'` with proxy-failure receipts caused a real incident (2026-09-23) where 26 turns were silently excluded from the dashboard export, 7 unrecoverably, and even invisible to the backfill script itself. Do not "fix" the quality/export split by promoting a new quality tier; the divergence is intentional and documented. Keep `raw-fallback.js` free of heavy dependencies (`ioredis`, `km-core`) to preserve the exporter test suite's isolation — this is a load-bearing constraint, not incidental. Finally, any change to the prefix format or matching logic should be validated against real stored rows, since the current case-insensitive, trim-tolerant behavior was itself derived from an actual production artifact rather than a spec.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- No parent-context work record documents RawFallbackContract's own history directly; the nearest parent observations concern the unrelated LSLConfigValidator/health-coordinator PID-staleness subsystem, which the retrieval pipeline appears to have surfaced only via thematic 'LSL'/live-logging filename adjacency rather than genuine linkage to this component.

## Hierarchy Context

### Parent
- [LSLConfigValidator](./LSLConfigValidator.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents.

### Siblings
- [HostPathResolver](./HostPathResolver.md) -- [LLM] No file, class, or function named `HostPathResolver` appears anywhere in the supplied code. The five retrieved files (`enhanced-transcript-monitor.js`, `ObservationConsolidator.js`, `ObservationExporter.js`, `ObservationWriter.js`, `raw-fallback.js`) belong to the live-logging observation write/consolidate/export pipeline, a subsystem thematically adjacent to path resolution (they resolve config paths, export directories, and km-core ontology directories) but none of them define a dedicated host-path-resolution component.
- [PostLLMEvidenceFloor](./PostLLMEvidenceFloor.md) -- [LLM] None of the five retrieved files — scripts/enhanced-transcript-monitor.js, src/live-logging/ObservationConsolidator.js, src/live-logging/ObservationExporter.js, src/live-logging/ObservationWriter.js, and src/live-logging/raw-fallback.js — define, import, export, or even mention a symbol, class, constant, or comment string named 'PostLLMEvidenceFloor'. A full-text scan of every function name, export, and JSDoc block in these files (loadConfig, keepInExport, isRawFallbackSummary, _isSemanticallyDuplicate, extractFileChanges, etc.) turns up no match, and the supplied <code_graph> block is empty, so there is no structural (node/edge) evidence for this component either.
- [ObservationExportSafetyMerge](./ObservationExportSafetyMerge.md) -- [LLM] The component's implementation is squarely in `src/live-logging/ObservationExporter.js`, specifically the `_mergeWithExisting(dbObs, dbDigests, dbInsights)` method (with its nested `mergeArrays` closure). This is the actual 'safety merge': for each of `observations.json`, `digests.json`, and `insights.json`, it compares the freshly-derived km-core records against the file already on disk, and only accepts the new set outright when `existing.length <= dbRecords.length`. When the on-disk export has MORE records than the current km-core read produced, it treats that as a signal the store may have been reset/recreated and falls back to a union rather than an overwrite — `preserved` (historic rows not present in the new pull) concatenated with `dbRecords` (the current pull). This is defensive data-loss prevention explicitly for git-tracked export files, not a database transaction.


---

*Generated from 9 observations*

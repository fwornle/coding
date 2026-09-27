# ObservationExportSafetyMerge

**Type:** Detail

## What It Is

ObservationExportSafetyMerge is implemented in `src/live-logging/ObservationExporter.js`, centered on the `_mergeWithExisting(dbObs, dbDigests, dbInsights)` method and its nested `mergeArrays` closure. It is not a database transaction mechanism; it is a defensive reconciliation layer that protects git-tracked JSON export files (`observations.json`, `digests.json`, `insights.json`) from being clobbered by a fresh-but-incomplete read of the km-core store. The core rule: a freshly computed record set is only accepted outright when it is at least as large as what's already on disk; otherwise the merge falls back to a union of preserved historic rows and current rows.

Note the parent component listed (LSLConfigValidator, described in terms of daemon session/heartbeat tracking) does not appear connected to this logic in the observations — the actual functional home of this entity is the live-logging export pipeline, alongside siblings RawFallbackContract and PostLLMEvidenceFloor (the latter unverifiable in these files) and HostPathResolver (also unverifiable here).

## Architecture and Design

The design follows a "never blindly overwrite" reconciliation pattern: diff against disk state rather than trusting the latest computation. This is paired with a content-addressable identity fallback — `contentKey(filename, r)` builds type-specific keys (`D|date|theme` for digests, `I|topic` for insights, `O|id` for observations) so that km-core's UUID v7 re-minting of legacy SQLite rows doesn't get misread as new data, which would otherwise duplicate rows indefinitely.

A tombstone pattern layers on top: `_collectTombstones(records)` reads `metadata.absorbed` (a shape written by ObservationConsolidator, not by the exporter itself) to distinguish intentional deletions from accidental loss, explicitly excluding tombstoned ids from resurrection and logging a separate "skipped N tombstoned" count versus "kept N historic."

A fourth exclusion category, `_knownObservationIds()`, narrows this further for observations only, using module-level `keepInExport(row)` to avoid resurrecting rows this export pass deliberately filtered (low quality, non-raw-fallback).

Finally, a derived-data consistency cascade runs after merging: `_stripDanglingObservationIds` cleans digest→observation references once the merged, pruned observation set is known, chaining referential-integrity cleanup after loss-prevention.

## Implementation Details

`_mergeWithExisting` is invoked with up to three record sets and shares one `mergeArrays` implementation across all three files, parameterized by which tier is dirty — it returns `null` early when `dbRecords` is `null`, so callers merging only a subset of the three JSON files leave the others untouched. Three call sites exist: `exportAll()` (full three-tier, likely post-migration/backfill), `exportObservations()` (post-write, observations only), and `exportConsolidated()` (post-consolidation, digests/insights only).

`keepInExport(row)` excludes `quality === 'low'` rows unless `isRawFallbackSummary(row.summary)` is true, imported from `raw-fallback.js`'s `RAW_FALLBACK_PREFIX`/predicate pair — preserving `[Raw]` placeholder rows awaiting reprocessing by `scripts/backfill-raw-observations.mjs` while dropping genuine no-content duds.

The constructor supports a legacy compatibility seam: `kmStore` (preferred, km-core `GraphKMStore`) or a legacy better-sqlite3 `db` handle for pre-44 fixtures. Documented behavior: against an archived 4KB stub DB, the SELECT throws, `exportAll` returns `[]`, and the safety-merge preserves historic JSON unchanged — the mechanism that makes running the exporter against a stale handle safe.

## Integration Points

The merge reads directly from the exporter's own prior output files via `fs.readFileSync(path.join(this.exportDir, filename))`, coupling it to its own write history rather than any external log. It has a cross-cutting dependency on ObservationConsolidator's tombstone convention (`metadata.absorbed`) despite not writing that shape itself, and on `raw-fallback.js`'s shared `RAW_FALLBACK_PREFIX`/`isRawFallbackSummary()` — the same module sibling RawFallbackContract documents was split out specifically to avoid ObservationExporter needing to import ObservationWriter.js (and thus ioredis/km-core) just for marker-string recognition.

## Usage Guidelines

Treat this merge logic as permanent defensive infrastructure, not a removable migration artifact — it originated as a Plan 44-18 SQLite→km-core cutover guardrail but now protects any partial or degraded read. Any change to ObservationConsolidator's `metadata.absorbed` shape or to raw-fallback's constants must be checked against this merge's assumptions, since it consumes both without owning them. When adding new export tiers or call sites, route through `_mergeWithExisting`/`mergeArrays` rather than duplicating overwrite logic, and always run `_stripDanglingObservationIds` after any merge affecting observations to keep digest provenance consistent.


## Hierarchy Context

### Parent
- [LSLConfigValidator](./LSLConfigValidator.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents.

### Siblings
- [HostPathResolver](./HostPathResolver.md) -- [LLM] No file, class, or function named `HostPathResolver` appears anywhere in the supplied code. The five retrieved files (`enhanced-transcript-monitor.js`, `ObservationConsolidator.js`, `ObservationExporter.js`, `ObservationWriter.js`, `raw-fallback.js`) belong to the live-logging observation write/consolidate/export pipeline, a subsystem thematically adjacent to path resolution (they resolve config paths, export directories, and km-core ontology directories) but none of them define a dedicated host-path-resolution component.
- [RawFallbackContract](./RawFallbackContract.md) -- [LLM] The contract is implemented as a single-purpose module, src/live-logging/raw-fallback.js, exporting exactly two symbols: the RAW_FALLBACK_PREFIX constant ('[Raw]') and the isRawFallbackSummary() predicate. Its docstring explains the module was split out specifically so ObservationExporter.js does not have to import ObservationWriter.js (which would drag ioredis and km-core into every exporter test) just to recognize the marker string — a dependency-avoidance rationale baked directly into the file's own comments rather than inferred.
- [PostLLMEvidenceFloor](./PostLLMEvidenceFloor.md) -- [LLM] None of the five retrieved files — scripts/enhanced-transcript-monitor.js, src/live-logging/ObservationConsolidator.js, src/live-logging/ObservationExporter.js, src/live-logging/ObservationWriter.js, and src/live-logging/raw-fallback.js — define, import, export, or even mention a symbol, class, constant, or comment string named 'PostLLMEvidenceFloor'. A full-text scan of every function name, export, and JSDoc block in these files (loadConfig, keepInExport, isRawFallbackSummary, _isSemanticallyDuplicate, extractFileChanges, etc.) turns up no match, and the supplied <code_graph> block is empty, so there is no structural (node/edge) evidence for this component either.


---

*Generated from 10 observations*

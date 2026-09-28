# LegacyIngestAdapterCutover

**Type:** Detail

## What It Is

`LegacyIngestAdapterCutover` is the migration mechanism that retires SQLite as the write-path store for the observation system while preserving row-shaped compatibility for existing consumers. It is implemented across `src/live-logging/ObservationWriter.js` and `src/live-logging/ObservationConsolidator.js`, both importing the forward adapters `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` from `@fwornle/km-core/adapters/legacy-ingest` to convert former SQLite-row shapes into km-core `Entity` objects. As a child of the parent `ObservationPipeline` (which describes the overall write-side hard cutover), this component specifically names the adapter-pairing shape of that cutover: one canonical forward mapping shared by two writers, plus a locally hand-rolled inverse mapping in the consolidator only.

## Architecture and Design

The defining pattern is a bidirectional adapter with asymmetric ownership: forward conversion (legacy row → Entity) is centralized in km-core's shared adapter module, but inverse conversion (Entity → legacy row shape) is reimplemented locally in `ObservationConsolidator.js` via `_toLegacyObsRow`, `_toLegacyDigestRow`, and `_toLegacyInsightRow`. This is a Strangler/hard-cutover, not a dual-write migration — there is no transitional window where SQLite and km-core are both live sources of truth; the SQLite handle is fully retired, with `dbPath` fields on both classes repurposed as inert path strings for `projectRoot` derivation only.

The design also encodes a fail-fast philosophy over lazy initialization: `ObservationConsolidator._ensureObservationWriter()` throws immediately if `this._kmStore` is not configured, deliberately eliminating a historical lazy-construct fallback that risked producing two unsynchronized LevelDB handles. This mirrors sibling `CapturedByAnchoring`'s kind-based `ANCHOR_FOR_KIND` split, both being cutover-era refinements driven by measured evidence rather than speculative design.

Notably, `ObservationExporter.js` breaks from this hard-cutover discipline, accepting either `kmStore` or a legacy `db` handle, with kmStore given precedence when both exist. This reflects a conscious risk-scoping decision: the write path was the actual site of the Plan 44-07 bug (unsynchronized dual sources), so it needed a hard cutover; the read/export path only needs to tolerate stale test fixtures, so a soft compatibility shim suffices there.

## Implementation Details

`ObservationWriter.js`'s inverse-adapter-free design contrasts directly with `ObservationConsolidator.js`, which not only reimplements the reverse mapping but attaches an `_entity` back-reference onto returned legacy-shaped rows. This lets downstream code call `mergeAttributes` and write back into km-core without a round-trip lookup — a leaky abstraction that couples the "legacy view" tightly to the live entity, existing specifically because consuming code's row-shaped expectations were never rewritten during the cutover.

The `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` constants in `ObservationWriter.js`, detailed fully by sibling `CapturedByAnchoring`, are tied to this same writer/consolidator split, routing `capturedBy` provenance to `'ObservationWriter'` or `'ObservationConsolidator'` based on entity kind. Phase 44 Plan 13 replaced SQLite-era methods `_findExistingByContentHash`, `_isSemanticallyDuplicate`, and `_maybePatchArtifacts` with km-core equivalents `findByContentHash`, `findRecentByAgent`, `findByLegacyId`, and `putEntity`.

## Integration Points

This cutover's weight has ripple effects: because `ObservationWriter`/`ObservationConsolidator` now carry km-core and ioredis dependencies, sibling `RawFallbackReceipt` (`src/live-logging/raw-fallback.js`) was extracted as a zero-import leaf module purely so `ObservationExporter` could reuse `RAW_FALLBACK_PREFIX` without dragging in that dependency graph — a direct architectural consequence of this cutover's import cost. It also delegates single-owner write responsibility to `ObservationWriter.writeInsight`, consumed by `ObservationConsolidator`, and interacts with `GraphKMStore.putEntity` as documented at the parent `ObservationPipeline` level.

## Usage Guidelines

Developers extending write paths should follow the fail-fast convention (`this._kmStore` required, no lazy fallback) rather than reintroducing dual-source risk. When adding new legacy-shaped consumers, prefer routing through the shared forward adapters rather than duplicating inverse-mapping logic outside `ObservationConsolidator`; if a reverse adapter is unavoidable, preserve the `_entity` back-reference convention to avoid redundant lookups. Any new heavyweight import added to `ObservationWriter`/`ObservationConsolidator` should be evaluated for extraction into a dependency-light satellite module, as was done with `raw-fallback.js`, to protect the export/read path's leaner dependency footprint.


## Hierarchy Context

### Parent
- [ObservationPipeline](./ObservationPipeline.md) -- [LLM] ObservationWriter.js implements the write side of the pipeline as a hard cutover from SQLite to km-core: `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` (imported from `@fwornle/km-core/adapters/legacy-ingest`) are the single source of truth for mapping SQLite-row shapes onto km-core `Entity` objects written via `GraphKMStore.putEntity`. The class comment documents that this eliminated a dual-source problem from Plan 44-07's read-only cutover, where the dashboard read km-core while new writes still landed in SQLite and were invisible until a manual migration ran. The `ANCHOR_FOR_KIND` map (observation→'ObservationWriter', digest/insight→'ObservationConsolidator') refines every `capturedBy` edge away from a single undifferentiated `ANCHOR_ROOT` ('LiveLoggingSystem') once the code measured that all 1,244 existing edges split cleanly by writer subsystem — with `ANCHOR_ROOT` retained as fallback because losing the anchor entirely orphaned 22 Insights on 2026-06-15.

### Siblings
- [CapturedByAnchoring](./CapturedByAnchoring.md) -- [LLM] The anchoring mechanism this component names is implemented directly in `src/live-logging/ObservationWriter.js` as the `ANCHOR_ROOT` ('LiveLoggingSystem') and `ANCHOR_FOR_KIND` ({observation: 'ObservationWriter', digest: 'ObservationConsolidator', insight: 'ObservationConsolidator'}) constants. The comment block above them documents the measured basis for the split: all 1,244 pre-existing `capturedBy` edges pointed at the single undifferentiated `ANCHOR_ROOT` until 2026-09-21, and when audited, every one of them cleanly attributed to a writer subsystem via its `runId` prefix (`obs-writer` vs `obs-consolidator`/`insight-resynthesize`) — meaning the kind-based split required no heuristic, only a lookup on which caller invoked the write.
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] `src/live-logging/raw-fallback.js` is the entire implementation of what the parent context calls the 'raw fallback receipt': a two-export leaf module (`RAW_FALLBACK_PREFIX = '[Raw]'` and `isRawFallbackSummary()`) with zero imports. Its own docstring frames it not as a formatting helper but as a bug-fix artifact — the `[Raw]` prefix used to be duplicated verbatim across `ObservationWriter._fallbackSummary`, `ObservationWriter._classifyQuality`, and `scripts/backfill-raw-observations.mjs`, and one of those three copies silently drifted from the others. When it did, `ObservationExporter.keepInExport` stopped recognizing placeholder rows as placeholders and dropped legitimate un-summarized receipts out of the export entirely. Extracting the constant and its matcher into one module is a textbook 'single source of truth' fix for a classic string-literal drift bug.
- [PostLlmEvidenceFloor](./PostLlmEvidenceFloor.md) -- [LLM] The string "PostLlmEvidenceFloor" does not appear anywhere in the supplied code files (ObservationWriter.js, ObservationConsolidator.js, ObservationExporter.js, raw-fallback.js, enhanced-transcript-monitor.js), and the accompanying <code_graph> block is empty — there is no class, function, export, or comment in this evidence set that names or implements this component. Everything below is therefore inference from thematically adjacent code, not a description of an actual PostLlmEvidenceFloor implementation.


---

*Generated from 9 observations*

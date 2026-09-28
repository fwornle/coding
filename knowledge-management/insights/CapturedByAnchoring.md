# CapturedByAnchoring

**Type:** Detail

# CapturedByAnchoring — Technical Insight Document

## What It Is

CapturedByAnchoring is the mechanism, implemented in `src/live-logging/ObservationWriter.js`, that determines what a `capturedBy` graph edge points to when an entity is written into km-core. It is defined by two constants: `ANCHOR_ROOT` (`'LiveLoggingSystem'`), the coarse universal fallback, and `ANCHOR_FOR_KIND` (`{observation: 'ObservationWriter', digest: 'ObservationConsolidator', insight: 'ObservationConsolidator'}`), a static lookup that refines the edge target based on the entity's kind. It is not a class or service but a small, deliberately constrained piece of write-path logic embedded in the parent ObservationPipeline, whose job is to decide — at write time, for every observation/digest/insight — which subsystem node "owns" the entity being captured.

## Architecture and Design

The core pattern is fallback-with-refinement: `ANCHOR_ROOT` guarantees every entity always gets *some* `capturedBy` target, while `ANCHOR_FOR_KIND` layers a more precise subsystem-level target on top, without ever replacing the guarantee. The design comment in `ObservationWriter.js` is explicit that this ordering of priorities is intentional — "a missing subsystem node costs precision, never the tether" — a principle traced back to a concrete incident (22 orphaned Insights on 2026-06-15) rather than abstract caution.

The kind-to-anchor mapping is implemented as a static plain object, not a dynamic classifier. This is safe only because the three write call sites are already segregated by kind at the point of invocation — observations always come from ObservationWriter's own path; digests and insights always come from consolidation. This lets the anchoring decision remain a constant-time string lookup with no need to inspect entity shape or metadata.

A companion delegation pattern prevents logic duplication: `ObservationConsolidator.js`'s `_ensureObservationWriter()` (per Phase 58 Plan 02, D-06) routes Insight writes through `ObservationWriter.writeInsight` rather than reimplementing the anchor call independently. This makes `capturedBy → LiveLoggingSystem` anchoring "inherited for free," closing a drift risk between writer, bridge, and consolidator write paths — conceptually similar to the sibling LegacyIngestAdapterCutover's asymmetric adapter sharing (one canonical forward transform reused by two writers).

## Implementation Details

The measured justification behind the kind-based split is documented directly in the comment block above the constants: all 1,244 pre-existing `capturedBy` edges pointed at the undifferentiated `ANCHOR_ROOT`, and an audit showed every one attributed cleanly to a writer subsystem via its `runId` prefix (`obs-writer` vs. `obs-consolidator`/`insight-resynthesize`). No heuristic was needed — just a lookup on which caller invoked the write.

A more granular alternative — one anchor node per process run — was explicitly considered and rejected. Because `_runId` regenerates on every `ObservationWriter` construction, per-run anchoring would mint a fresh node on every service restart; the comment quantifies this cost as 500 runs describing 2,398 entities, 401 of which would cover three rows or fewer. Instead, run-level provenance is pushed to `metadata.provenance`, queryable via `/api/v1/graph/runs` and `/api/v1/entities?runId=`, keeping `capturedBy` edge targets bounded to four fixed values.

Notably, this anchoring metadata has no representation in the cold-store export path: `ObservationExporter.js`'s `observations.json`/`digests.json`/`insights.json` projections and their `_toLegacy*Row` counterparts in `ObservationConsolidator.js` carry `id`, `summary`, and `metadata`, but never `capturedBy` or the anchor target. The mechanism is therefore observable only in the live km-core graph via `GraphKMStore.putEntity`, not in exported artifacts read by ColdStoreReader or the dashboard.

## Integration Points

CapturedByAnchoring sits inside ObservationPipeline, the parent component that performs the hard SQLite→km-core write cutover using `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` from `@fwornle/km-core/adapters/legacy-ingest`. Anchoring is applied at the same point these entities are constructed and written via `GraphKMStore.putEntity`.

It is tightly coupled to sibling LegacyIngestAdapterCutover's write paths (`ObservationWriter.js` and `ObservationConsolidator.js`), sharing the same call-site segregation that makes the static kind lookup safe. It is architecturally orthogonal to run identity: anchor target selection lives on a fixed graph edge, while run provenance lives on an open-ended `metadata.provenance` field, queried through separate API endpoints — a deliberate separation to keep anchor node population bounded regardless of run volume.

It has no direct relationship with RawFallbackReceipt (`src/live-logging/raw-fallback.js`), which addresses a different concern (placeholder summary detection), though both exist as small, single-purpose fixes layered onto the same writer subsystem for similar "single source of truth" reasons.

## Usage Guidelines

Developers extending write paths in ObservationWriter or ObservationConsolidator must preserve the guarantee that some `capturedBy` target always exists — do not remove or bypass `ANCHOR_ROOT` as a fallback. New entity kinds should be added to `ANCHOR_FOR_KIND` only if their write call sites are cleanly segregated by kind, since the lookup carries no logic to infer kind from entity content. Any new consolidation-style write path should delegate to `ObservationWriter.writeInsight` (or an equivalent inherited call) rather than reimplementing anchoring logic directly against `GraphKMStore`/`kmStore.putEntity`, to avoid reintroducing the drift risk D-06 was designed to close. Finally, do not expect `capturedBy`/anchor data to appear in exported JSON artifacts — any tooling or dashboard feature depending on anchor information must query the live km-core graph, not ColdStoreReader-based exports.


## Hierarchy Context

### Parent
- [ObservationPipeline](./ObservationPipeline.md) -- [LLM] ObservationWriter.js implements the write side of the pipeline as a hard cutover from SQLite to km-core: `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` (imported from `@fwornle/km-core/adapters/legacy-ingest`) are the single source of truth for mapping SQLite-row shapes onto km-core `Entity` objects written via `GraphKMStore.putEntity`. The class comment documents that this eliminated a dual-source problem from Plan 44-07's read-only cutover, where the dashboard read km-core while new writes still landed in SQLite and were invisible until a manual migration ran. The `ANCHOR_FOR_KIND` map (observation→'ObservationWriter', digest/insight→'ObservationConsolidator') refines every `capturedBy` edge away from a single undifferentiated `ANCHOR_ROOT` ('LiveLoggingSystem') once the code measured that all 1,244 existing edges split cleanly by writer subsystem — with `ANCHOR_ROOT` retained as fallback because losing the anchor entirely orphaned 22 Insights on 2026-06-15.

### Siblings
- [LegacyIngestAdapterCutover](./LegacyIngestAdapterCutover.md) -- [LLM] The cutover is implemented as a pair of adapter modules imported from `@fwornle/km-core/adapters/legacy-ingest`: `ObservationWriter.js` pulls in `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` to convert SQLite-row-shaped writes into km-core `Entity` objects, while `ObservationConsolidator.js` imports the same `legacyDigestToEntity`/`legacyInsightToEntity` pair for its own write path and additionally hand-rolls the INVERSE transforms (`_toLegacyObsRow`, `_toLegacyDigestRow`, `_toLegacyInsightRow`) so that internal code written against the old row shape can keep operating against km-core `Entity` objects without a rewrite. This asymmetry — one canonical forward adapter shared by two writers, but a locally-defined reverse adapter only in the consolidator — is the concrete shape of 'LegacyIngestAdapterCutover': the cutover eliminated the SQLite handle but preserved its row contract as an in-memory shim.
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] `src/live-logging/raw-fallback.js` is the entire implementation of what the parent context calls the 'raw fallback receipt': a two-export leaf module (`RAW_FALLBACK_PREFIX = '[Raw]'` and `isRawFallbackSummary()`) with zero imports. Its own docstring frames it not as a formatting helper but as a bug-fix artifact — the `[Raw]` prefix used to be duplicated verbatim across `ObservationWriter._fallbackSummary`, `ObservationWriter._classifyQuality`, and `scripts/backfill-raw-observations.mjs`, and one of those three copies silently drifted from the others. When it did, `ObservationExporter.keepInExport` stopped recognizing placeholder rows as placeholders and dropped legitimate un-summarized receipts out of the export entirely. Extracting the constant and its matcher into one module is a textbook 'single source of truth' fix for a classic string-literal drift bug.
- [PostLlmEvidenceFloor](./PostLlmEvidenceFloor.md) -- [LLM] The string "PostLlmEvidenceFloor" does not appear anywhere in the supplied code files (ObservationWriter.js, ObservationConsolidator.js, ObservationExporter.js, raw-fallback.js, enhanced-transcript-monitor.js), and the accompanying <code_graph> block is empty — there is no class, function, export, or comment in this evidence set that names or implements this component. Everything below is therefore inference from thematically adjacent code, not a description of an actual PostLlmEvidenceFloor implementation.


---

*Generated from 9 observations*

# RawFallbackReceipt

**Type:** Detail

## What It Is

RawFallbackReceipt is implemented at `src/live-logging/raw-fallback.js`, a small standalone module exporting exactly one constant, `RAW_FALLBACK_PREFIX = '[Raw]'` (line 23), and one pure predicate, `isRawFallbackSummary(summary)` (lines 36-38), which case-insensitively tests whether a trimmed summary string starts with that prefix. It represents a deliberate, recoverable placeholder record: when `ObservationWriter._fallbackSummary()` cannot reach the LLM proxy synchronously, it stores the turn under this `[Raw]`-prefixed summary rather than discarding it, preserving the full message array in `metadata.messages` so `scripts/backfill-raw-observations.mjs` can re-summarize it later. As the parent-context observation notes, no direct code retrieval exists for `SessionFactIndex` itself, but RawFallbackReceipt sits beneath it and beneath ObservationPipeline as a concrete, verifiable mechanism within the broader live-logging observation lifecycle.

## Architecture and Design

The defining architectural decision is isolating the prefix/predicate pair into its own module specifically to break a dependency-weight coupling. The module's own header comment states it exists because "the two sides of that contract sit in modules that must not import each other's weight" — `ObservationExporter.js` needs `isRawFallbackSummary()` but must not transitively import `ObservationWriter.js`'s heavyweight dependencies (`ioredis`, `@fwornle/km-core`). This is a textbook dependency-firewall pattern: a tiny shared-contract module lets two otherwise-related consumers (writer and exporter) stay independently testable.

A second pattern is the sentinel/marker-prefix approach: rather than adding a schema field, row state ("pending re-summarization") is encoded as a string prefix within the existing free-text `summary` field. Third is the receipt/placeholder-for-durability pattern — on failure, the system persists a recoverable stand-in instead of dropping the event. Fourth, and most subtle, is a content-based override of a coarse status field: `quality: 'low'` remains unchanged for these rows, and `isRawFallbackSummary()` overrides the exporter's exclusion rule locally, without altering the shared `quality` value that `ObservationConsolidator.js` (lines 1392, 1687) and the dashboard also depend on.

## Implementation Details

`ObservationExporter.js` imports `isRawFallbackSummary` (line 65) and uses it inside `keepInExport(row)` (lines 75-76): normally rows are excluded when `quality !== 'low'` fails, but `[Raw]`-prefixed summaries are exempted from that exclusion even though the writer classifies them as `quality: 'low'` — "classified low only because it has no content YET," per the exporter's comment. This guards against a documented regression: conflating raw-fallback receipts with genuine low-quality duds cost 26 turns in a historical audit, 7 of which had no summarized counterpart and were invisible to everything, including the repair script itself, because the export filter had excluded them from the only file the dashboard's `/api/coding/observations` endpoint reads.

`ObservationExporter._mergeWithExisting()` further treats a `[Raw]` receipt later repaired into a genuine summary (e.g., "No actionable content.") as a legitimate content change, not data loss — intentionally excluding the stale pre-repair copy so exports don't pin outdated text. This logic interacts with `_collectTombstones` and `contentKey()`, which distinguish "the store lost this row" from "the store still has it and this pass chose not to export it," with the raw-fallback lifecycle falling into the latter category via `_knownObservationIds()`.

## Integration Points

`ObservationWriter.js` imports `RAW_FALLBACK_PREFIX` and `isRawFallbackSummary` (line 37) to classify and stamp fallback rows during writes. `ObservationExporter.js` imports only the predicate, never the writer, keeping its dependency graph light. `ObservationConsolidator.js` independently keys off the `quality` field (not the prefix) to exclude contentless rows from digest consolidation, illustrating how the same `quality: 'low'` value is overloaded across modules for different purposes — consolidation eligibility versus pending-content signaling — reconciled only by convention and comments, not a shared enum. Within the hierarchy, RawFallbackReceipt is a sibling concept to ConsolidationDedupEngine (dedup logic embedded in `ObservationConsolidator.js`), InsightProvenanceAnchors (anchoring via `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` in `ObservationWriter.js`), and MentionsClassifier — none of which have direct code overlap with `raw-fallback.js`, but all share the live-logging/ObservationPipeline substrate.

## Usage Guidelines

Developers should never repurpose `quality` to mark raw-fallback state directly — the design intentionally keeps quality untouched and keys behavior off the `[Raw]` prefix instead, since promoting a distinct quality tier would silently change consolidation and dashboard-rendering behavior. Any new consumer needing to detect fallback rows should import `isRawFallbackSummary` from `raw-fallback.js` directly rather than reimplementing prefix checks or importing `ObservationWriter.js`, preserving the dependency firewall. When repairing `[Raw]` rows via `scripts/backfill-raw-observations.mjs`, treat the resulting summary change as an intentional content update, not a merge conflict to protect — the exporter's merge logic already assumes this. Given the historical 26-turn audit bug, any modification to `keepInExport` or export filtering logic should be tested to ensure raw-fallback rows remain visible until repaired.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- No session work record in the parent context names `raw-fallback.js`, `RawFallbackReceipt`, or the `[Raw]` marker directly by task/plan ID — the parent's own observations describe it only through code-level analysis (the sixth bullet, itself an [LLM] observation about `raw-fallback.js`), not through a dated session record, so there is no session-log grounding to cite for this component beyond the code comments themselves.

## Hierarchy Context

### Parent
- [SessionFactIndex](./SessionFactIndex.md) -- [LLM] None of the retrieved code files reference a `SessionFactIndex` class, export, or file. The closest named artifact is `session-facts.ts`, cited only in the parent entity's own observations ('Session facts extracted from live transcripts... anchored onto the knowledge graph primarily via `metadata.parentId`, with a fallback resolution path through `contains` edges'), but that file was not part of this retrieval — the actual anchoring logic, its parentId-stamping code path, and its contains-edge fallback are not visible here to verify or ground further.

### Siblings
- [ConsolidationDedupEngine](./ConsolidationDedupEngine.md) -- [LLM] No class, file, export, or identifier named `ConsolidationDedupEngine` appears anywhere in the retrieved code. The nearest functional analogue is dedup logic embedded directly as module-level constants and instance methods inside `src/live-logging/ObservationConsolidator.js` — there is no standalone 'engine' abstraction; dedup is a set of thresholds and helper methods living inside the consolidator class itself, not a separately named or exported component.
- [InsightProvenanceAnchors](./InsightProvenanceAnchors.md) -- [LLM] The supplied files contain no class, function, export, or comment named `InsightProvenanceAnchors`. The nearest conceptual match is the `capturedBy` anchoring logic in ObservationWriter.js (`ANCHOR_ROOT`, `ANCHOR_FOR_KIND`), which anchors Observation/Digest/Insight entities to subsystem nodes, but this is a distinct, already-named mechanism in a different module — not evidence of a dedicated 'InsightProvenanceAnchors' component.
- [MentionsClassifier](./MentionsClassifier.md) -- [CGR] MentionsClassifier.js (module) in MentionsClassifier.js


---

*Generated from 9 observations*

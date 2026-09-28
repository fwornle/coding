# RawFallbackMarker

**Type:** Detail

# RawFallbackMarker: Technical Insight Document

Note on hierarchy: the supplied observations directly and fully implement RawFallbackMarker, but neither the stated parent (TokenAttributionAdapters) nor sibling (ClaudeSubagentSweep) are substantiated by any of the source files — those relationships appear to be filename-proximity artifacts rather than actual code relationships. This document is grounded solely in the RawFallbackMarker observations themselves.

## What It Is

RawFallbackMarker is implemented in `src/live-logging/raw-fallback.js`, a small, dependency-free module exporting exactly two symbols: the string constant `RAW_FALLBACK_PREFIX` (`'[Raw]'`, defined at raw-fallback.js:20) and the predicate `isRawFallbackSummary(summary)` (raw-fallback.js:30-33), which lowercases and trim-starts its input before comparing it against the lowercased prefix. Its purpose is to mark and later detect observation rows whose summaries are placeholders rather than genuine content — specifically rows produced when the LLM proxy is unreachable and `ObservationWriter._fallbackSummary()` stores the turn under a `[Raw]`-prefixed summary "so it isn't discarded," preserving the full message array under `metadata.messages` for later reprocessing.

## Architecture and Design

The module is a textbook example of the shared-contract pattern: a single, tiny file isolates a magic string and its matching logic so that multiple independent consumers never re-derive or duplicate it. The docstring is explicit about why this extraction exists — to prevent `ObservationExporter.js` from having to import `ObservationWriter.js` (and transitively `ioredis` and `km-core`) just to check a string prefix. This is a deliberate dependency-weight isolation boundary: raw-fallback.js has zero imports and zero external dependencies, making it a leaf module that any file can consume at no cost.

The marker also embodies the sentinel/marker-value pattern (a string prefix tagging placeholder data) and a fail-soft/deferred-processing pattern (preserving raw data for reprocessing instead of dropping it on failure). Architecturally, `ObservationWriter.js` (producer) and `ObservationExporter.js` (consumer) both depend on raw-fallback.js but are explicitly forbidden from depending on each other for this concern — a one-directional dependency boundary enforced purely through extraction into a third module.

## Implementation Details

`isRawFallbackSummary` is intentionally forgiving: it lowercases and trims leading whitespace before comparison, a design choice with documented history rather than defensive boilerplate — the docstring notes that a 2026-05-28 generation of rows read `"[Raw] needs backfill"`, implying earlier variance in casing/phrasing that the predicate must still catch, since "the writer's own quality classifier has always matched lowercased." The `trimStart()` call guards against leading whitespace variants.

Critically, the resulting row is classified `quality: 'low'` — the same tier used for genuinely low-value content — and this is a deliberate, not accidental, overlap. Quality classification and fallback-marker detection are intentionally orthogonal signals: `isRawFallbackSummary` is the *only* mechanism able to distinguish "no actionable content" from "a proxy-outage receipt awaiting backfill." Any consumer needing to separate these cases must import the exact predicate rather than re-deriving prefix logic, which is precisely the drift the module was built to prevent — the docstring recounts the prefix having been "duplicated in three places... when the export filter silently stopped matching it."

## Integration Points

Two concrete consumers are confirmed via visible imports. `ObservationWriter.js` imports `{ RAW_FALLBACK_PREFIX, isRawFallbackSummary }` and uses them in `_fallbackSummary()` to produce the marked rows. `ObservationExporter.js` imports `isRawFallbackSummary` and applies it in `keepInExport(row)`:

```
return row.quality !== 'low' || isRawFallbackSummary(row.summary);
```

This line is the fix for a documented historical incident: the exporter's normal rule drops all `quality:'low'` rows from the JSON files served to the dashboard via `/api/coding/observations`, which meant fallback receipts — despite being successfully captured — were invisible everywhere except the graph. A 2026-09-23 audit found 26 affected turns, seven with no summarized counterpart, existing as rows nothing outside the graph (not even the repair script) could see. A third referenced integration point is `scripts/backfill-raw-observations.mjs`, the deferred process meant to re-summarize `[Raw]` rows once the proxy recovers, and `ObservationConsolidator.js` (lines 1392, 1687), which relies on the row staying `quality:'low'` to keep contentless rows out of digests while the exporter's exemption keeps them dashboard-visible (rendered faintly).

## Usage Guidelines

Any code that needs to distinguish a genuine low-quality row from a fallback placeholder must import and call `isRawFallbackSummary` directly rather than reimplementing prefix-matching — the module's own history shows this invariant has been violated before, causing silent data-visibility bugs. Developers should not invent a separate quality tier for fallback rows; the design intentionally keeps them at `quality:'low'` and relies on this predicate as the sole disambiguating signal, so any new consumer that filters or displays observations by quality must also check `isRawFallbackSummary` if it cares about not silently discarding backfill-pending receipts. Because the module is a deliberately zero-dependency leaf, new consumers should preserve this property rather than adding imports that reintroduce the dependency weight (`ioredis`, `km-core`) the module was extracted to avoid.


## Hierarchy Context

### Parent
- [TokenAttributionAdapters](./TokenAttributionAdapters.md) -- [LLM] None of the supplied source files (enhanced-transcript-monitor.js, ObservationConsolidator.js, ObservationExporter.js, ObservationWriter.js, raw-fallback.js) define or reference any 'TokenAttributionAdapters' class, module, or naming convention. The files cover transcript capture, observation consolidation, JSON export, and raw-fallback marking — none of which mention token attribution, adapter interfaces, or per-token routing logic.

### Siblings
- [ClaudeSubagentSweep](./ClaudeSubagentSweep.md) -- [LLM] None of the five supplied files (enhanced-transcript-monitor.js, ObservationConsolidator.js, ObservationExporter.js, ObservationWriter.js, raw-fallback.js) define, export, or reference any identifier resembling 'ClaudeSubagentSweep' — no class, function, constant, or comment contains 'Subagent' or 'Sweep'. The files implement transcript capture/artifact extraction, observation consolidation into digests/insights, JSON cold-store export, and a shared '[Raw]' fallback-marker contract respectively.


---

*Generated from 8 observations*

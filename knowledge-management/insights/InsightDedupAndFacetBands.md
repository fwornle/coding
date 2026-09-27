# InsightDedupAndFacetBands

**Type:** Detail

## What It Is

InsightDedupAndFacetBands is best understood as a decision-surface concept rather than a discrete class: the concrete code closest to its name is a set of threshold constants defined in `src/live-logging/ObservationConsolidator.js` — `INSIGHT_DEDUP_THRESHOLD` (0.88), `INSIGHT_FACET_THRESHOLD` (0.83), `INSIGHT_TOPIC_JACCARD_MERGE` (0.60), and `INSIGHT_TOPIC_JACCARD_FACET` (0.30) — alongside a stricter, separately calibrated `DIGEST_DEDUP_THRESHOLD` (0.97) used for digest-tier consolidation. These constants encode a two-band classification: insight pairs scoring above the dedup threshold are merged as duplicates, pairs falling into the borderline "facet band" between the facet and dedup thresholds are cross-linked rather than merged, and pairs below both are treated as distinct insights. Critically, the observations confirm that the actual function implementing this branching logic (something like a `_dedupeInsight` method that computes cosine similarity, applies these thresholds, and dispatches to merge/facet/new-insight paths) is not present in the supplied, truncated excerpt of ObservationConsolidator.js — only the constants and their calibration rationale are visible. This document should therefore be read as documenting the decision surface and its calibration, not a verified algorithm implementation.

## Architecture and Design

The design is explicitly dual-signal / defense-in-depth: embedding cosine similarity (calibrated against a measured MiniLM-L6-v2 floor of 0.89–0.92 for same-project documents) is the primary signal, backstopped by a lexical topic-Jaccard measure (`TOPIC_STOPWORDS` plus the JACCARD_MERGE/FACET constants) that catches paraphrase cases where cosine similarity alone under-fires — the cited example being "LLM CLI Proxy" vs. "LLM CLI Proxy — VPN/Corporate Network Detection." This reflects a conscious trade-off: rather than trusting a single embedding metric, the system accepts added complexity (two thresholds per signal, four constants total) to reduce false negatives on near-duplicate insights with divergent surface wording.

A second architectural decision is per-tier threshold calibration: digests and insights are deliberately given different dedup floors (0.97 vs 0.88) because digests cluster at higher cosine similarity due to shared toolchain/path vocabulary. Any future dedup-and-facet-banding logic operating over new entity tiers would need its own calibrated threshold rather than reusing these constants wholesale.

Structurally, this dedup/facet logic lives inside `ObservationConsolidator.js`, coupled in the same module as digest consolidation — an explicit design note flags this as coupling insight-synthesis and dedup calibration together in one file rather than factoring dedup into its own module. The system is split across a two-part boundary: consolidation-side decisions (merge/facet/distinct) live in ObservationConsolidator, while export-side safety lives in `ObservationExporter.js`, whose `_collectTombstones()`/`_mergeWithExisting()` methods prevent already-merged/absorbed insights from resurrecting during export-merge, using `metadata.absorbed` to build the tombstone set. This is a related but distinct concern — a downstream safety net operating on decisions already made upstream by the dedup/facet logic.

## Implementation Details

The four insight-tier constants form the actual decision surface: values above 0.88 cosine similarity trigger a merge; values between 0.83 and 0.88 trigger a facet cross-link; the topic-Jaccard measures (0.60 merge threshold, 0.30 facet threshold) act as a secondary vote when the embedding signal is ambiguous or under-fires on paraphrased titles. `TOPIC_STOPWORDS` supports this by filtering common terms out of the Jaccard computation so it reflects meaningful topic overlap rather than noise. The 0.97 `DIGEST_DEDUP_THRESHOLD` is implemented as a structurally separate constant, reinforcing that this is a tiered calibration system rather than one universal similarity floor.

On the export side, `ObservationExporter._collectTombstones()` constructs a set of already-absorbed insight identifiers from `metadata.absorbed`, and `_mergeWithExisting()` consults this set to avoid re-introducing insights that consolidation has already merged away. This is the enforcement mechanism that makes the dedup decision durable across export cycles.

What is explicitly *not* present in the observed code is the branching function itself — the method that would take two insight embeddings/topics, compute both signals, compare against the four thresholds, and return a merge/facet/distinct verdict. This gap is called out directly in the observations and should not be inferred or fabricated in future work on this component.

## Integration Points

InsightDedupAndFacetBands sits within the ObservationPipeline, whose parent-level responsibility is periodic re-synthesis of parent-node descriptions from accumulated child observations — described as fully implemented in production with one open guard-coverage defect. The dedup/facet bands are the mechanism by which that re-synthesis avoids creating redundant or near-duplicate insights during consolidation.

It integrates directly with ObservationWriter via the single-owner write-routing pattern (ObservationConsolidator routes Insight writes through `ObservationWriter.writeInsight`), meaning any merge/facet decision ultimately flows through a single write path rather than multiple writers touching insight state. It also integrates with ObservationExporter's tombstone mechanism as its downstream safety complement, and shares the module ObservationConsolidator.js with digest consolidation logic.

Among its siblings — RawFallbackReceipt, EvidenceFloorGate, and ObservationWriteEventBus — the most relevant relationship is architectural rather than functional: ObservationWriteEventBus (the `_observationEmitter` singleton in ObservationWriter.js) demonstrates the same pattern of "real behavior embedded in a module rather than factored into a standalone class," which is exactly the situation here. EvidenceFloorGate, notably, could not be located anywhere in the supplied files, underscoring that not every named sibling concept has a traceable implementation — a caution that applies equally to verifying InsightDedupAndFacetBands's missing algorithm body before relying on it.

## Usage Guidelines

Developers should not assume a single unified similarity threshold applies across entity tiers — insight thresholds (0.88/0.83) and digest thresholds (0.97) are deliberately different and recalibrating one without checking the empirical cosine floor for that tier risks under- or over-merging. When adjusting or extending facet-banding, treat the topic-Jaccard signal as a required companion to embedding cosine similarity, not an optional fallback, since it's specifically there to catch cases the embedding model misses. Any change to `_collectTombstones()`/`_mergeWithExisting()` in ObservationExporter should be reviewed alongside ObservationConsolidator's thresholds, since the two form a single logical system split across files — changing merge criteria without updating tombstone handling (or vice versa) could allow merged insights to resurface. Finally, before extending this component, future work should locate and document the actual branching function (the real `InsightDedupAndFacetBands` implementation), since current documentation is grounded only in its supporting constants and rationale, not a verified decision procedure.


## Hierarchy Context

### Parent
- [ObservationPipeline](./ObservationPipeline.md) -- [SESSION] Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap notes periodic re-synthesis of parent-node descriptions from accumulated child observations is fully implemented in production with one open guard-coverage defect.

### Siblings
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] The 'RawFallbackReceipt' component appears not as a named class but as a conceptual pattern spanning raw-fallback.js's isRawFallbackSummary()/RAW_FALLBACK_PREFIX, ObservationWriter.js's referenced _fallbackSummary() method, and ObservationExporter.js's keepInExport() gate — a receipt is a row stamped with the '[Raw]' prefix when the LLM proxy is unreachable, preserving the raw messages for later re-summarization rather than discarding the turn.
- [EvidenceFloorGate](./EvidenceFloorGate.md) -- [LLM] None of the supplied files — `scripts/enhanced-transcript-monitor.js`, `src/live-logging/ObservationConsolidator.js`, `src/live-logging/ObservationExporter.js`, `src/live-logging/ObservationWriter.js`, and `src/live-logging/raw-fallback.js` — define, import, or reference a symbol, class, or file named `EvidenceFloorGate`. A grep-equivalent scan of every export, constant, and comment in these five files turns up no match for 'Evidence', 'Floor', or 'Gate' as a compound identifier.
- [ObservationWriteEventBus](./ObservationWriteEventBus.md) -- [LLM] The component referred to as "ObservationWriteEventBus" is not a standalone class or file — it is the module-level `_observationEmitter` singleton defined near the top of `src/live-logging/ObservationWriter.js`, alongside the `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` provenance constants. The code's own comment ("Phase 55 Plan 06 Task 3 — process-wide observation-write event bus") is the closest thing to a name for this component, confirming the entity is real but embedded inside the writer module rather than factored out, so its lifecycle is tied to the writer's module load rather than to any writer instance.


---

*Generated from 9 observations*

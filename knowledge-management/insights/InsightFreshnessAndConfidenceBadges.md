# InsightFreshnessAndConfidenceBadges

**Type:** Detail

# InsightFreshnessAndConfidenceBadges

## What It Is

`InsightFreshnessAndConfidenceBadges` is implemented entirely within `integrations/system-health-dashboard/src/pages/insights.tsx`, comprising three React components — `FreshnessBadge`, `ConfidenceBadge`, and `TruthfulnessPanel` — plus a set of supporting TypeScript interfaces (`CodeVerification`, `DecayBreakdown`, `InsightMetadata`, `Insight`). Together these render a compact visual signal for how "fresh" (still verified against code) and how "confident" (post-decay-adjusted) an insight is, within the Insights parent surface. Critically, this is a pure presentation layer: the actual scoring — verification ratios, decay drags — is computed upstream and merely rendered here.

## Architecture and Design

The dominant pattern is progressive disclosure: each badge shows a glanceable classification (a colored pill) while the `title=` tooltip carries the full computed breakdown or methodology explanation. This is paired with a two-tier state-rendering strategy — components branch not on ordinary conditionals but on whether upstream-computed fields (`metadata.codeVerification`, `metadata.decayBreakdown`) exist at all, distinguishing "not yet scored" from "scored and good/bad." `FreshnessBadge` takes this further with a genuine three-state contract: no badge when `cv` is undefined, a distinct `UNVERIFIABLE` slate pill when `totalClaims === 0`, and only otherwise a `FRESH`/`PARTIAL`/`STALE` band thresholded at 0.7/0.5 via `freshnessClass`/`freshnessLabel`. This is a deliberate design decision, documented inline, to avoid "the green-by-default illusion" of treating zero evidence as strong evidence.

Style mapping is implemented as pure functions (`confidenceColor`, `confidenceBar`, `freshnessClass`, `freshnessLabel`), keeping numeric-to-Tailwind-class logic isolated and side-effect-free. There is no adapter/normalization layer between fetch and render — the UI interfaces are tightly coupled to the backend's on-the-wire insight metadata shape, meaning any upstream schema change flows directly into these components without an intermediate translation boundary.

## Implementation Details

`ConfidenceBadge` encodes a two-path tooltip: when `decayBreakdown` is present, it walks a `dragLine()` helper over `ageDrag`, `emergentDrag`, and `truthfulnessDrag`, suppressing near-zero contributions via an epsilon check (`<= 0.001`) rather than strict inequality, to avoid float-noise artifacts. When absent (pre-consolidation insights), it falls back to a generic prose description of the decay model. The underlying formula, reproduced in tooltip text, is `final = max(0.30, base − ageDrag − emergentDrag − truthfulnessDrag)`, with `ageDrag` explicitly churn-gated (only accrues when a referenced file has changed since `lastUpdated`, not from elapsed time alone) and `emergentDrag` capped at 0.10 and only applying after 90 days of zero churn — a two-tier decay policy the code comments call out as intentional.

`TruthfulnessPanel` extends this into a full `methodologyTooltip`, documenting that verification checks filesystem existence (with submodule/path-suffix fallbacks) and uses `git grep -F` for symbols/routes/env vars across the main repo, submodules, and sibling `_work/*` repos, refreshed on a 7-day cadence. Notably, this UI tooltip is the only place in the supplied evidence that names the downstream retrieval-scoring consequence: `rrfScore` is scaled by `(0.3 + 0.7 × ratio)` for insight-tier results, and confidence itself loses up to 0.20 when ratio drops below 50%.

The `Insight` interface (`id`, `topic`, `summary`, `confidence`, `digestIds`, `lastUpdated`, `metadata.decayBreakdown`) independently corroborates the canonical Insight schema also inferred by the code graph's `repair-writer-ontology-class.mjs`, whose `arbitrate()` function uses presence of `digestIds`/`decayBreakdown`/`topic` as its Insight-vs-hierarchy-row signature.

## Integration Points

This component sits under the Insights parent and is a pure consumer of an upstream scoring pipeline not present in the supplied evidence — it never computes verification ratios or decay drags itself. It assumes insights arriving for render already cleared generation-time evidence gating (per the UKB Insight Generation Pipeline record), and it assumes, but does not enforce, corpus-level dedup: near-duplicate filtering is a separate best-effort job (`scripts/compact-insights.mjs`, embedding-cosine + topic-Jaccard clustering) rather than something applied at write time, especially since embedding-based dedup in `writeInsight` is still gated behind a dry-run flag per sibling InsightCompactionPipeline. The badges therefore may render freshness/confidence for insight rows that are near-duplicates of each other. Relatedly, sibling InsightRollupPipeline's `ObservationConsolidator.js` controls `metadata.parentId` assignment, shaping which insights surface where in the knowledge graph, though this badge component itself doesn't participate in that routing.

## Usage Guidelines

Developers extending these badges should preserve the three-state/two-tier branching rather than collapsing it into a single numeric render path — the UNVERIFIABLE-vs-FRESH distinction and the decay-breakdown-vs-fallback-prose split are intentional, documented safeguards against misleading defaults. Any change to threshold values (0.7/0.5 for freshness, the 0.30 floor and drag caps for confidence) should stay synchronized with the retrieval-scoring formula described in `TruthfulnessPanel`'s tooltip, since that formula is otherwise undocumented elsewhere in the codebase. Because there's no schema adapter layer, backend metadata shape changes must be coordinated directly with these TypeScript interfaces to avoid silent breakage.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The `Insight` TypeScript interface in insights.tsx (fields `id`, `topic`, `summary`, `confidence`, `digestIds`, `lastUpdated`, `metadata.decayBreakdown`) mirrors the structural signature the code graph's `repair-writer-ontology-class.mjs` uses to distinguish Insight rows from hierarchy rows — that script's `arbitrate()` function treats presence of `digest_ids`/`digestIds`, `decayBreakdown`, or `topic` as the Insight signature. This is independent corroboration from two different files that this shape (topic + digestIds + decayBreakdown) is the canonical on-the-wire Insight schema, though `InsightSchema` itself (named in the code graph's `schemas.ts`) was not among the retrieved files.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The UKB Insight Generation Pipeline — Evidence Gating and Document Quality record establishes that insight documents are only written by the wave pipeline when sufficient real evidence exists, specifically to keep empty stub 'Insight' entities out of the knowledge base. This is a generation-time gate, structurally distinct from the decay/truthfulness scoring `ConfidenceBadge` and `TruthfulnessPanel` compute at display time — the badges assume they are scoring insights that already cleared the evidence bar at write time, and are not themselves a substitute quality filter.
- The writeInsight Embedding-Based Dedup Integration record notes that embedding-based near-duplicate detection into the writeInsight path is still unlanded and gated behind a dry-run flag pending latency/precision validation. Because of this, the insight rows rendered by `FreshnessBadge`/`ConfidenceBadge` are not guaranteed to be free of near-duplicates at write time — the corpus-level dedup pass those badges implicitly assume (visible instead in `scripts/compact-insights.mjs`'s embedding-cosine + topic-Jaccard clustering) runs as a separate, best-effort periodic job rather than at insertion.

## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- [SESSION] writeInsight Embedding-Based Dedup Integration tracks embedding-based near-duplicate detection being wired into the writeInsight path behind a dry-run flag so live writes are unaffected until latency/precision are validated.

### Siblings
- [InsightCompactionPipeline](./InsightCompactionPipeline.md) -- [SESSION] writeInsight Embedding-Based Dedup Integration tracks a separate, still-unlanded effort to wire embedding-based near-duplicate detection directly into the writeInsight path behind a dry-run flag, distinct from this scheduled compaction job.
- [InsightRollupPipeline](./InsightRollupPipeline.md) -- [SESSION] Insight Roll-up Pipeline — Synthesis and Parent Visibility establishes that this component assigns observations/insights to SubComponent 'parent' entities via metadata.parentId, implemented in src/live-logging/ObservationConsolidator.js, and that this assignment directly controls distribution across the knowledge graph — the coverage-diversity-vs-hub-concentration trade-off downstream KB views exhibit. None of the retrieved code files are ObservationConsolidator.js or otherwise contain a parentId-assignment routine, so this observation is reportable only via the work record, not the supplied source.


---

*Generated from 10 observations*

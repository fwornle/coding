# InsightFreshnessVerification

**Type:** Detail

## What It Is

InsightFreshnessVerification is a read-time display and consumption layer implemented entirely within `integrations/system-health-dashboard/src/pages/insights.tsx`. It is not a verification engine itself, but a set of UI components — `FreshnessBadge`, `TruthfulnessPanel`, and `ConfidenceBadge` — that consume a precomputed `CodeVerification` object stored at `metadata.codeVerification` on each Insight and render its meaning to a user. As a child concern of the Insights parent component, it answers a specific question the parent's Intent Spine Derivation Pipeline does not: not "what does this insight cluster into," but "can I still trust this insight's backticked claims against the live codebase."

## Architecture and Design

The dominant pattern is a pure consumer of precomputed metadata: no verification logic (filesystem checks, `git grep`, ratio computation) executes client-side. This mirrors the design philosophy seen in sibling InsightCompactionPipeline, where `compact-insights.mjs` similarly avoids reimplementing heavy logic locally and defers to a backend process — here, an unseen verifier script writes `codeVerification` back onto the insight, and `insights.tsx` only renders its output contract.

A second key decision is treating "unverifiable" as a distinct third state rather than defaulting to true/false. `FreshnessBadge` renders nothing when `cv` is undefined, a slate `UNVERIFIABLE` pill when `totalClaims` is 0, and only computes `FRESH`/`PARTIAL`/`STALE` bands (thresholds 0.7/0.5) when `verificationRatio` is a real number. The inline comment about avoiding "the green-by-default illusion that a 0/0 insight is 100% true" is an explicit trade-off favoring epistemic honesty over a cleaner three-state UI.

Third, freshness and confidence are modeled as separate but composed signals. `ConfidenceBadge`'s `DecayBreakdown` blends `truthfulnessDrag` (capped 0.20, triggered when ratio < 0.5) with `ageDrag` and `emergentDrag` into one auditable score, while `FreshnessBadge` shows the raw ratio independently — the two can legitimately disagree.

## Implementation Details

`CodeVerification`/`StaleClaim` interfaces define the contract: claim counts, a `verificationRatio`, and a `staleClaims` list tagged by type (`PATH`, `FUNCTION`, `SYMBOL`, `ROUTE`, `PACKAGE`). `TruthfulnessPanel` renders a collapsible breakdown of these plus an `Info`-icon `methodologyTooltip` — the only place in the supplied code documenting the actual check: filesystem existence for paths (with submodule and path-suffix fallbacks) and `git grep -F` for symbols/routes/env vars, run across the project repo, submodules, and sibling `_work/*` repos, on a 7-day cadence. `formatVerifiedAgo` and `freshnessClass`/`freshnessLabel` handle presentation formatting.

## Integration Points

The tooltip text asserts that `verificationRatio` also feeds retrieval ranking, scaling `rrfScore` by `(0.3 + 0.7 × ratio)` for insight-tier results — though that ranking code is absent from supplied files, so this is attributable only to documented tooltip text, not verified implementation. Upstream, this read-time check is temporally distinct from the write-time Evidence Gating in the UKB Insight Generation Pipeline and from the dry-run-gated dedup writes in writeInsight — both operate before an insight is persisted, while freshness verification re-checks claims afterward, periodically.

## Usage Guidelines

Developers should not conflate `verificationRatio` (raw freshness) with `finalConfidence` (decayed, recoverable score) — treat disagreement between `FreshnessBadge` and `ConfidenceBadge` as expected. Any future implementation of the verifier itself should preserve the UNVERIFIABLE distinction and the 7-day cadence guard, and should keep methodology documentation embedded in tooltip text as established practice, since no external docs currently exist for this mechanism.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The UKB Insight Generation Pipeline — Evidence Gating and Document Quality record establishes that insight documents are only written when sufficient real evidence exists at synthesis time, which is a write-time gate distinct from the freshness verification implemented in `insights.tsx` — the latter re-checks an already-written insight's claims against the live codebase after the fact, on the 7-day cadence the tooltip describes, rather than gating what gets written in the first place.
- The writeInsight Embedding-Based Dedup Integration record establishes that near-duplicate detection was being wired into the write path behind a dry-run flag specifically to avoid affecting live writes until latency and precision were validated — an in-progress, adjacent write-path control that, like evidence gating, operates upstream of the read-time freshness verification this component displays.

## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- [SESSION] Intent Spine Derivation Pipeline describes deriving an 'intent spine' by clustering insights into Intent entities via aggregate edges, consolidating five prior ad-hoc scripts into one producer script.

### Siblings
- [InsightCompactionPipeline](./InsightCompactionPipeline.md) -- [LLM+CGR] scripts/compact-insights.mjs is a thin client that POSTs to obs-api's /api/insights/compact endpoint and polls /api/insights/compact/status rather than performing clustering itself; the module comment explains this replaced a prior design that instantiated its own ObservationConsolidator with no kmStore, which threw 'km-core not configured' on every invocation and meant the insight corpus had never actually been compacted.
- [HierarchicalInsightRollup](./HierarchicalInsightRollup.md) -- [SESSION] Insight Roll-up Pipeline — Synthesis and Parent Visibility establishes that observations/insights are assigned to SubComponent 'parent' entities via metadata.parentId, directly controlling coverage diversity vs. hub concentration in downstream KB views.


---

*Generated from 9 observations*

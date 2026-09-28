# InsightCompactionPipeline

**Type:** Detail

## What It Is

InsightCompactionPipeline is the scheduled maintenance job responsible for deduplicating and consolidating the insight corpus within the Insights subsystem. Its only visible surface in the supplied files is `scripts/compact-insights.mjs`, a CLI script that runs on a weekly launchd cadence. Critically, this script is a thin client: it POSTs to obs-api's `/api/insights/compact` endpoint and polls `/api/insights/compact/status`, rather than implementing any clustering or merge logic itself. The actual clustering/merge/LLM-verdict logic lives server-side in obs-api and is not present in the reviewed source — a fact explicitly noted in the Architecture Notes observation.

## Architecture and Design

The dominant pattern is thin-client/fat-server: CLI scripts submit work and poll status against a single obs-api process that owns the LevelDB store. This constraint — that only one process can open the LevelDB store — is shared with sibling maintenance script `scripts/repair-writer-ontology-class.mjs`, forcing both into the same async job pattern (submit → receive jobId → poll until inflight clears).

The consolidation algorithm itself, though executed server-side, is described in the script's comments: insights are clustered via embedding cosine similarity plus topic-Jaccard using single-linkage connected-components, then an LLM issues MERGE/FACET/SEPARATE verdicts per cluster. A `MAX_CLUSTER_SIZE` (default 20) deliberately caps automatic merging — oversized single-linkage chains are reported but never auto-merged, because transitive similarity chaining at scale is judged unreliable. This is a notable trade-off: correctness/safety over completeness, accepting that some large duplicate clusters require manual attention rather than risking bad automatic merges.

A bounded `TIMEOUT_MS` (default 45 minutes) wraps the polling loop, since one LLM call per multi-member cluster on a large corpus can legitimately take a long time. The script exits with a distinct `EX_TEMPFAIL` (75) code on 409 busy responses, a fail-safe pattern letting cron/launchd distinguish "retry me" from genuine failure.

## Implementation Details

Key constants controlling behavior are `MAX_CLUSTER_SIZE` and `TIMEOUT_MS`, both defined in `compact-insights.mjs`. The script's own comment history is instructive: a prior version bypassed the API and built a local `ObservationConsolidator` with no `kmStore`, which threw `'km-core not configured'` on every invocation — meaning the insight corpus had never actually been compacted until the current thin-client rewrite. This is a key piece of grounding: the present architecture is a corrective response to a completely non-functional predecessor.

The population this pipeline operates over — "Insights" — is structurally identified elsewhere in the codebase: `repair-writer-ontology-class.mjs`'s `arbitrate()` function defines the Insight signature as presence of `metadata.digest_ids`/`digestIds`, `decayBreakdown`, or `topic`, distinguishing Insight nodes from hierarchy rows reached via contains/parent-child edges. Though `arbitrate()` serves a different script's purpose, this signature is presumed to be what compact-insights.mjs's server-side clustering query relies on to select which nodes to compact — a tight, if indirect, coupling between two otherwise unrelated scripts.

## Integration Points

InsightCompactionPipeline sits under the Insights parent component alongside two siblings: InsightRollupPipeline (which assigns observations/insights to SubComponent parents via `metadata.parentId` in `ObservationConsolidator.js`) and InsightFreshnessAndConfidenceBadges (which renders `FreshnessBadge` states from `metadata.codeVerification`). While these three components address different concerns — parent-assignment, freshness display, and duplicate consolidation — they collectively operate on the same Insight documents and their metadata surface.

Notably, compaction is explicitly decoupled from the write-path deduplication effort described under the parent Insights component: an in-progress embedding-based near-duplicate detector is being wired directly into `writeInsight` behind a dry-run flag. The compaction script's own stated rationale is to "catch dupes that slipped through the per-synthesis dedup band" — these are two independent, only partially overlapping duplicate-prevention mechanisms operating at different points in time (write-time vs. scheduled batch). Additionally, upstream evidence gating in the insight generation pipeline reduces but does not eliminate the volume of garbage/duplicate insights that compaction must later resolve.

## Usage Guidelines

Developers should not attempt to reimplement consolidation logic in new CLI scripts — the established convention is a thin HTTP client against obs-api, dictated by the single-owner LevelDB constraint. Any new insight-maintenance tooling should follow the same submit/poll/EX_TEMPFAIL(75) pattern for cron compatibility. When adjusting clustering behavior, `MAX_CLUSTER_SIZE` and `TIMEOUT_MS` are the primary tunable levers, and increasing the cluster ceiling should be weighed against the known unreliability of large transitive similarity chains. Since the Insight structural signature (`digest_ids`/`decayBreakdown`/`topic`) is relied upon implicitly by compaction's node selection, changes to Insight metadata shape in `repair-writer-ontology-class.mjs` or elsewhere should be checked for compaction impact. Finally, because compaction and write-path dedup are independent safety nets, neither should be treated as sufficient alone — both are expected to coexist as complementary, partially redundant guards against duplicate insights.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- scripts/compact-insights.mjs is a thin client that POSTs to obs-api's /api/insights/compact endpoint and polls /api/insights/compact/status, deliberately NOT reimplementing consolidation logic locally — the comment block explains that a prior version built its own ObservationConsolidator with no kmStore and threw 'km-core not configured' on every invocation, meaning the insight corpus had never been compacted even once until this rewrite.
- The compaction algorithm described in scripts/compact-insights.mjs clusters insights via embedding cosine similarity plus topic-Jaccard (connected-components, single-linkage), then asks an LLM to issue MERGE/FACET/SEPARATE verdicts per cluster; MAX_CLUSTER_SIZE (default 20) caps what gets merged automatically, with oversized single-linkage chains reported but never merged since transitive similarity chaining at scale is unreliable.
- scripts/repair-writer-ontology-class.mjs's arbitrate() function is directly relevant to compaction correctness: it identifies the Insight structural signature as presence of metadata.digest_ids/digestIds, decayBreakdown, or topic, distinct from hierarchy rows reached via contains/parent-child edges — this signature is presumably what compact-insights.mjs's clustering query relies on to select the Insight population it operates over.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- writeInsight Embedding-Based Dedup Integration tracks a separate, still-unlanded effort to wire embedding-based near-duplicate detection directly into the writeInsight path behind a dry-run flag, distinct from this scheduled compaction job.
- The writeInsight Embedding-Based Dedup Integration record establishes that embedding-based near-duplicate detection is being wired into the writeInsight write path behind a dry-run flag, separate from and prior to the periodic compaction pass in compact-insights.mjs — meaning compaction currently exists as a scheduled self-heal (weekly launchd cadence) precisely because per-synthesis dedup does not yet catch everything, per the script's own stated use case of 'catch dupes that slipped through the per-synthesis dedup band'.
- The UKB Insight Generation Pipeline — Evidence Gating record establishes that insight documents are only written when sufficient real evidence exists, preventing empty stub entities; this upstream quality gate reduces (but per compact-insights.mjs's own rationale does not eliminate) the garbage/duplicate insights that the compaction pipeline must later cluster and resolve.

## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- [SESSION] writeInsight Embedding-Based Dedup Integration tracks embedding-based near-duplicate detection being wired into the writeInsight path behind a dry-run flag so live writes are unaffected until latency/precision are validated.

### Siblings
- [InsightRollupPipeline](./InsightRollupPipeline.md) -- [SESSION] Insight Roll-up Pipeline — Synthesis and Parent Visibility establishes that this component assigns observations/insights to SubComponent 'parent' entities via metadata.parentId, implemented in src/live-logging/ObservationConsolidator.js, and that this assignment directly controls distribution across the knowledge graph — the coverage-diversity-vs-hub-concentration trade-off downstream KB views exhibit. None of the retrieved code files are ObservationConsolidator.js or otherwise contain a parentId-assignment routine, so this observation is reportable only via the work record, not the supplied source.
- [InsightFreshnessAndConfidenceBadges](./InsightFreshnessAndConfidenceBadges.md) -- [LLM] `FreshnessBadge` (integrations/system-health-dashboard/src/pages/insights.tsx) implements a deliberate three-state rendering contract over `metadata.codeVerification`: no badge at all when `cv` is undefined (insight never went through the verifier), a solid-slate `UNVERIFIABLE` pill when `cv.totalClaims === 0` (zero backticked claims to check), and a `FRESH`/`PARTIAL`/`STALE` band from `freshnessClass`/`freshnessLabel` when `verificationRatio` is a number, thresholded at 0.7 and 0.5. The UNVERIFIABLE case is explicitly NOT folded into the FRESH band — the inline comment states this avoids 'the green-by-default illusion that a 0/0 insight is 100% true', i.e. absence of evidence is visually distinguished from strong evidence rather than defaulting to the best-looking state.


---

*Generated from 11 observations*

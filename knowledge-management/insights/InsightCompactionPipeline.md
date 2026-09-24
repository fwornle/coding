# InsightCompactionPipeline

**Type:** Detail

## What It Is

InsightCompactionPipeline is implemented at `scripts/compact-insights.mjs`, a CLI script that performs corpus-wide, post-hoc deduplication and consolidation of insights already written to the knowledge base. It is a thin client: rather than performing clustering itself, it POSTs to obs-api's `/api/insights/compact` endpoint and polls `/api/insights/compact/status` for completion. The module's own comment records that this replaced an earlier design that instantiated a local `ObservationConsolidator` with no `kmStore` configured, which threw `'km-core not configured'` on every invocation — meaning the insight corpus had, in practice, never been compacted until this HTTP-client rewrite. As a child of the Insights parent component, it serves as one of the maintenance passes over the same corpus that Insights' intent-spine derivation and rollup logic operate on.

## Architecture and Design

The defining architectural decision is that km-core's LevelDB is single-owner — only the obs-api process may open it — so compaction, like its sibling script `scripts/rollup-insights.mjs`, must not touch the store directly. This produces a consistent pattern across insight-corpus maintenance tooling: stateless CLI wrappers dispatching work to a single stateful HTTP service. Both scripts share the accept/poll/timeout job pattern (POST to start, poll a status endpoint, bounded deadline) and identical busy-state handling: a 409 response exits with code 75 (`EX_TEMPFAIL`), signaling cron/launchd-safe retry rather than a hard failure — critical since this runs as a weekly launchd job that must not hang.

Clustering logic (server-side, invoked via the endpoint) uses single-linkage connected-components, explicitly noted as prone to transitive chaining — similarity edges can glue together insights that aren't directly similar. `MAX_CLUSTER_SIZE` (default 20) bounds which components are actually merged; oversized components are reported but left unmerged, a deliberate trade-off favoring precision over aggressive consolidation.

## Implementation Details

The CLI exposes three modes mapped onto request-body fields sent to obs-api: `--clusters-only` and `--apply` are explicit flags, with dry-run being the default — mutating state always requires explicit opt-in. These map to `dryRun` and `clustersOnly` in the compact request. `TIMEOUT_MS` (default 45 minutes) bounds the polling loop. The compaction endpoint issues MERGE/FACET/SEPARATE verdicts via LLM judgment over already-written insights — a fundamentally different quality gate than the generation-time evidence gating described for the UKB Insight Generation Pipeline, which decides whether an insight gets written at all.

## Integration Points

InsightCompactionPipeline depends entirely on obs-api's `/api/insights/compact` and `/api/insights/compact/status` endpoints, never on km-core directly. It is architecturally parallel to `scripts/rollup-insights.mjs` (`/api/insights/rollup`), which instead collapses many Detail-level insights into SubComponent-level parents — mirroring the HierarchicalInsightRollup sibling's `metadata.parentId` assignment model — archiving rather than deleting children via `metadata.archivedAt`/`rolledUpInto`. Compaction is also functionally distinct from, but complementary to, the emerging embedding-based dedup at the `writeInsight` path: that mechanism catches near-duplicates at write time, while compact-insights.mjs is the scheduled sweep catching "dupes that slipped through the per-synthesis dedup band."

## Usage Guidelines

Always run in dry-run mode first; `--apply` is required to mutate state. Expect and handle exit code 75 as a retryable busy signal rather than an error in any wrapping automation. Do not attempt to bypass obs-api to touch km-core's LevelDB directly — this will fail due to single-owner semantics, as the prior broken design demonstrated. Be aware that `MAX_CLUSTER_SIZE` intentionally leaves large connected components unmerged; large reported-but-unmerged clusters are expected output, not a bug, and reflect the single-linkage chaining risk rather than an incomplete run.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- scripts/compact-insights.mjs is a thin client that POSTs to obs-api's /api/insights/compact endpoint and polls /api/insights/compact/status rather than performing clustering itself; the module comment explains this replaced a prior design that instantiated its own ObservationConsolidator with no kmStore, which threw 'km-core not configured' on every invocation and meant the insight corpus had never actually been compacted.
- The compaction flow supports three modes via CLI flags (--clusters-only, default dry-run, --apply) that map directly onto the request body fields dryRun and clustersOnly sent to obs-api, and the polling loop enforces a bounded TIMEOUT_MS (default 45 minutes) so a wedged weekly launchd job cannot hang indefinitely — busy responses (HTTP 409) exit with code 75 (EX_TEMPFAIL) to signal a cron-safe retry.
- Clustering is single-linkage over connected components (per the comment 'Connected-components clustering is single-linkage, so similarity chains transitively'), and MAX_CLUSTER_SIZE (default 20) caps which clusters are actually merged; oversized components are reported but never merged, since single-linkage chaining can transitively glue unrelated insights together.
- scripts/rollup-insights.mjs is architecturally parallel to compact-insights.mjs — same thin-client HTTP dispatch to obs-api (/api/insights/rollup, /api/insights/rollup/status), same accept/poll/timeout pattern, same 409→exit(75) busy handling — but serves a distinct purpose: collapsing many Detail-level insights into fewer SubComponent-level parents via 'cluster' or 'bucket' strategies, archiving children with metadata.archivedAt/rolledUpInto rather than deleting them.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The writeInsight Embedding-Based Dedup Integration record establishes that embedding-based near-duplicate detection is being wired into the writeInsight write path behind a dry-run flag, kept separate from the periodic compact-insights.mjs sweep described in its own header as catching 'dupes that slipped through the per-synthesis dedup band' — i.e., two independent dedup layers, one at write time (in progress) and one as a scheduled corpus-wide cleanup.
- The UKB Insight Generation Pipeline — Evidence Gating and Document Quality record establishes that insight documents are only written when sufficient real evidence exists, which is a generation-time quality gate distinct from compact-insights.mjs's post-hoc MERGE/FACET/SEPARATE LLM verdicts on already-written insights.

## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- [SESSION] Intent Spine Derivation Pipeline describes deriving an 'intent spine' by clustering insights into Intent entities via aggregate edges, consolidating five prior ad-hoc scripts into one producer script.

### Siblings
- [HierarchicalInsightRollup](./HierarchicalInsightRollup.md) -- [SESSION] Insight Roll-up Pipeline — Synthesis and Parent Visibility establishes that observations/insights are assigned to SubComponent 'parent' entities via metadata.parentId, directly controlling coverage diversity vs. hub concentration in downstream KB views.
- [InsightFreshnessVerification](./InsightFreshnessVerification.md) -- [LLM] `FreshnessBadge` in `integrations/system-health-dashboard/src/pages/insights.tsx` renders three distinct states off a single `CodeVerification` object read from `metadata.codeVerification`: no badge at all when `cv` is undefined (insight never went through the verifier), a solid-slate `UNVERIFIABLE` pill when `cv.totalClaims` is 0 (zero backticked claims to check), and a `FRESH`/`PARTIAL`/`STALE` band from `freshnessClass`/`freshnessLabel` when `verificationRatio` is a number, using thresholds of 0.7 and 0.5. The component deliberately avoids defaulting an unmeasured insight to green, per the comment 'avoids the green-by-default illusion that a 0/0 insight is 100% true'.


---

*Generated from 10 observations*

# HierarchicalInsightRollup

**Type:** Detail

## What It Is

HierarchicalInsightRollup is implemented in `scripts/rollup-insights.mjs`. It is a thin CLI client that collapses many granular `Detail`/`Insight` rows into fewer, denser `SubComponent`-level insights, archiving the originals behind them rather than deleting them. The script itself contains no clustering or LLM-synthesis logic; it POSTs a request to `${OBS_API}/api/insights/rollup` and polls `${OBS_API}/api/insights/rollup/status` until the job completes.

## Architecture and Design

The core pattern is thin-client / single-owner store: km-core's LevelDB has a single owner (obs-api), so `rollup-insights.mjs` never opens the store directly — all reads/writes go through HTTP calls to `OBS_API_URL` (default `http://localhost:12436`). This is identical in shape to its sibling `InsightCompactionPipeline` (`scripts/compact-insights.mjs`), which POSTs to `/api/insights/compact` and polls `/api/insights/compact/status` — same jobId/poll/exit-code pattern, same base URL, same constraint documented in compact-insights.mjs's header.

Job submission uses a submit-then-poll pattern: POST returns an `accepted.jobId`, and the script polls every 5s until `st.lastJob.id === accepted.jobId`, honoring HTTP 409 (busy) by exiting with code 75 (EX_TEMPFAIL) — a well-defined tempfail convention for callers/schedulers. Execution is staged across three modes to gate cost and side effects: `--plan` (grouping only, no LLM, no writes), a bare dry run (LLM synthesis without writes), and `--apply` (writes parents, archives children).

Two grouping strategies are selectable via `--strategy`: `cluster` (default, lexical near-duplicate collapsing, measured 678→533 on the coding corpus) and `bucket` (chunks each subsystem into groups of `--chunk-size`, described as "the one that yields a corpus a human will actually read," with chunk-size 20 yielding ~47 entries and 25 yielding ~40). Grouping strategy and archiving semantics are decided client-side in the request payload but executed server-side inside obs-api.

## Implementation Details

Numeric knobs (`chunk-size`, `max-groups`, `min-group-size`, `max-group-size`, `timeout`) are parsed permissively from `process.argv` via a shared `--k=v` reducer and only forwarded in the request body when explicitly provided, so obs-api's own defaults govern unset knobs. The script hardcodes only a 60-minute poll `TIMEOUT_MS` default and 30s/15s `AbortSignal.timeout` values on the initial POST and each status poll respectively.

Archiving is explicitly non-destructive: children get `metadata.archivedAt` and `metadata.rolledUpInto` set, never deleted. The insights typed-view hides archived rows unless `includeArchived=true`, and a roll-up is reversible simply by clearing those two metadata keys — though no dedicated "unroll" API endpoint exists; reversibility is purely a metadata convention, not a first-class operation.

`--source-class` defaults to `Insight`, but the script's usage comment flags an asymmetry: `Detail` and `Digest` rows carry no `project` field, so they require `--project=unknown` since the candidate filter reads `metadata.project ?? 'unknown'`. Getting this wrong silently selects zero candidates rather than erroring — an undocumented coupling between CLI usage and server-side filter internals.

## Integration Points

The script depends entirely on obs-api's `/api/insights/rollup` and `/api/insights/rollup/status` endpoints, sharing that dependency shape with `InsightCompactionPipeline`'s compact endpoints. Within the parent `Insights` component, this is one of several distinct roll-up/organization mechanisms: it is explicitly a parallel path to the SESSION-documented `ObservationConsolidator.js` mechanism (`src/live-logging/ObservationConsolidator.js`), which assigns observations/insights to `SubComponent` parents via `metadata.parentId` as an ongoing per-write process, controlling coverage diversity vs. hub concentration. `rollup-insights.mjs` instead performs periodic batch consolidation, organizing existing rows by lexical/subsystem proximity rather than per-write parent assignment.

It is also structurally distinct from the Intent Spine Derivation Pipeline (parent-level, single consolidated producer script), which clusters insights into `Intent` entities via `aggregate` edges to build a purpose-based taxonomy layer. HierarchicalInsightRollup instead densifies rows within the same entity class rather than introducing a new one — complementary but non-overlapping taxonomy mechanisms over the same corpus. It also shares no direct relationship with sibling `InsightFreshnessVerification` (`FreshnessBadge` in `insights.tsx`), though both operate on the same insight metadata surface.

## Usage Guidelines

Always use `--plan` first to inspect grouping before spending LLM cost, then a dry run to review synthesis, then `--apply` to commit writes — the staged mode design exists specifically to support this workflow. Choose `bucket` over `cluster` when the goal is human readability of the resulting corpus rather than maximal lexical deduplication; tune `--chunk-size` accordingly (20–25 is a documented sweet spot). When rolling up `Detail`-level rows via `--source-class=Detail`, remember to also pass `--project=unknown`, since Detail/Digest rows carry no `project` field and the fallback filter will otherwise silently match nothing. Treat archiving as reversible but understand that reversal requires manually clearing `archivedAt`/`rolledUpInto`, and that any reader not applying the `includeArchived` convention will see a corpus diverging from the true stored state. Respect the 409/exit-75 busy signal in any automation wrapping this script, since it indicates another job (rollup or compact) already holds obs-api's single LevelDB owner.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- scripts/rollup-insights.mjs is the direct implementation of HierarchicalInsightRollup: it collapses many granular Detail/Insight rows into fewer SubComponent-level insights and archives the originals behind them. It exposes two grouping strategies selected via `--strategy`: `cluster` (default, lexical near-duplicate collapsing only — 'measured 678 -> 533 on the coding corpus') and `bucket` (chunks each subsystem into groups of `--chunk-size`, described in the header comment as 'the one that yields a corpus a human will actually read', with chunk-size 20 producing ~47 entries and 25 producing ~40). Three run modes gate cost and side effects: `--plan` (grouping only, no LLM, no writes), a bare dry run (LLM synthesis without writes), and `--apply` (writes parents, archives children).
- Archiving is explicitly non-destructive: the header comment states children are 'ARCHIVED, never deleted: metadata.archivedAt + rolledUpInto', that the insights typed-view hides archived rows unless `includeArchived=true`, and that a roll-up is reversible by clearing those two metadata keys. This gives the roll-up an undo path that a hard delete would not, at the cost of the visible corpus and the true stored corpus permanently diverging unless every reader consistently applies the same archived-filter convention.
- `--source-class` defaults to `Insight`, but the script's own usage comment flags an asymmetry: 'Detail and Digest rows carry no `project`, so they need `--project=unknown`: the candidate filter reads `metadata.project ?? 'unknown'`.' This means rolling up Detail-level entities (as opposed to the default Insight-level ones) requires the caller to know this filter fallback in advance, or the run silently selects zero candidates rather than erroring.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Insight Roll-up Pipeline — Synthesis and Parent Visibility establishes that observations/insights are assigned to SubComponent 'parent' entities via metadata.parentId, directly controlling coverage diversity vs. hub concentration in downstream KB views.
- The Insight Roll-up Pipeline — Synthesis and Parent Visibility work record describes a DIFFERENT roll-up mechanism than the one in this file: it states insights/observations are assigned to SubComponent parent entities via `metadata.parentId`, implemented in `src/live-logging/ObservationConsolidator.js`, and that this assignment directly controls coverage diversity vs. hub concentration across the knowledge graph. `rollup-insights.mjs` instead writes `rolledUpInto` on archived children and synthesizes a new parent row per group — the two are parallel roll-up paths (ongoing per-write parent assignment vs. periodic batch consolidation) rather than the same code path described twice.
- The Intent Spine Derivation Pipeline work record establishes that a separate, single consolidated producer script derives an 'intent spine' by clustering insights into `Intent` entities via `aggregate` edges, replacing five prior ad-hoc scripts, and that this gives the KB an intent-first taxonomy layer the unified viewer can render as an alternate hierarchy. That pipeline organizes insights by inferred PURPOSE into a new entity class (`Intent`); `rollup-insights.mjs` instead organizes existing Insight/Detail rows by lexical/subsystem proximity into denser rows of the SAME entity class — the two are complementary but structurally distinct taxonomy mechanisms over the same insight corpus.

## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- [SESSION] Intent Spine Derivation Pipeline describes deriving an 'intent spine' by clustering insights into Intent entities via aggregate edges, consolidating five prior ad-hoc scripts into one producer script.

### Siblings
- [InsightCompactionPipeline](./InsightCompactionPipeline.md) -- [LLM+CGR] scripts/compact-insights.mjs is a thin client that POSTs to obs-api's /api/insights/compact endpoint and polls /api/insights/compact/status rather than performing clustering itself; the module comment explains this replaced a prior design that instantiated its own ObservationConsolidator with no kmStore, which threw 'km-core not configured' on every invocation and meant the insight corpus had never actually been compacted.
- [InsightFreshnessVerification](./InsightFreshnessVerification.md) -- [LLM] `FreshnessBadge` in `integrations/system-health-dashboard/src/pages/insights.tsx` renders three distinct states off a single `CodeVerification` object read from `metadata.codeVerification`: no badge at all when `cv` is undefined (insight never went through the verifier), a solid-slate `UNVERIFIABLE` pill when `cv.totalClaims` is 0 (zero backticked claims to check), and a `FRESH`/`PARTIAL`/`STALE` band from `freshnessClass`/`freshnessLabel` when `verificationRatio` is a number, using thresholds of 0.7 and 0.5. The component deliberately avoids defaulting an unmeasured insight to green, per the comment 'avoids the green-by-default illusion that a 0/0 insight is 100% true'.


---

*Generated from 11 observations*

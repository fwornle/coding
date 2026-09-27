# GraphDensityBudgetAssertion

**Type:** Detail

# GraphDensityBudgetAssertion — Technical Insight Document

## What It Is

GraphDensityBudgetAssertion is implemented in `integrations/unified-viewer/scripts/assert-graph-density.ts`. It is a CI/health-check gate that measures how many nodes would render in an aggregated project view and fails (`exit 1`) if any single project's visible-node count exceeds a configurable ceiling — `GRAPH_MAX_NODES_PER_PROJECT` (default 40), moderated by `GRAPH_DETAIL_LEVEL` (default `'overview'`). Its header comment explicitly records that the file was renamed from `assert-aggregated-node-budget.ts` to avoid conflating this rendering-density check with the repo's real token/cost budgets (tracked separately under Token Usage → Cost). The "budget" here is strictly a screen-density ceiling, not a financial one.

## Architecture and Design

The defining architectural choice is the **shared-predicate pattern**: rather than reimplementing visibility, hierarchy, or attribution logic, the script imports `isEntityVisible` from `src/graph/visibility-predicate.ts`, `deriveParents` from `src/graph/hierarchy-parents.ts`, and `rootOf`/`categoriseUnattributed`/`CATEGORY_LABEL` from `src/graph/attribution.ts` — the same module exercised by its sibling entity, GraphAttributionCategorization, via `attribution.test.ts`. This guarantees the assertion can only diverge from the render layer (`D3GraphCanvas.tsx`, `SigmaCanvas.tsx`) if the shared predicate itself changes, not through independent drift — a direct response to a documented prior failure mode where three separate walks of "visibility" (footer, canvas, `useGraphVisibility`) produced three different counts.

A second pattern, **golden-config replication**, has the script's `DEFAULT_FILTERS` copy the viewer-store's seeded defaults (`viewer-store.ts` ~519–973) byte-for-byte, including `learningSource: 'combined'`, so the gate measures exactly the default view a user sees rather than some idealized filter state.

Attribution failures use **categorised-exception reporting**: unattributed nodes are bucketed into `recordedParent`, `wrongClass`, `danglingRef`, and `unclaimed` — the same priority-ordered, mutually exclusive taxonomy defined and unit-tested in GraphAttributionCategorization's `attribution.test.ts`. Finally, the budget check follows a **fail-loud-on-worst-case** philosophy: it compares against the single worst project, not an average, and treats unrooted nodes as failures rather than exemptions.

## Implementation Details

The script fetches its entire dataset from a live obs-api instance via `OBS_API` (default `http://127.0.0.1:12436`), calling `/api/v1/entities?limit=60000` and `/api/v1/relations?limit=60000` before any visibility logic runs — making it an integration-level check rather than a unit test. Each entity is filtered through `isEntityVisible(e, DEFAULT_FILTERS)`, then walked up the `parents` map produced by `deriveParents` and attributed to its owning Project or System via `rootOf`. Nodes whose walk terminates in `null` are not folded into a pseudo-project; they are counted separately as `unrooted` and factor into `overBudget` via `unrooted > 0` — guarding against a real regression where a collapse reported "PASS, Coding at 11" while 43 rows rendered under no project at all.

For class resolution, the script maps `ontologyClass ?? entityType ?? ''`, explicitly acknowledging (per its own comments) that the two fields "disagree on some rows," mirroring the authoritative-vs-inert field distinction documented for the viewer layer elsewhere. The attribution categorisation calls `rootOf(id, parents, (nodeId) => classOf.get(nodeId))` and `categoriseUnattributed(visible, forPredicate, relations, parents, classOf)`, destructuring results into `unrootedByCategory` for the JSON/text report — directly reusing the four-category taxonomy pinned by `attribution.test.ts`.

## Integration Points

This component sits inside `integrations/unified-viewer` specifically so it can import the viewer's own rendering predicates rather than duplicating them in obs-api — a deliberate placement choice recorded in the file's header. It depends on: (1) a running obs-api serving layer for entities/relations data, (2) `viewer-store.ts`'s seeded filter defaults, and (3) the `graph/` predicate modules shared with `D3GraphCanvas.tsx` and `SigmaCanvas.tsx`. As a Detail-level component, it belongs under the ManualLearning parent, alongside siblings WaveInsightPersistenceGap and GraphAttributionCategorization — the latter supplying the exact attribution logic this script consumes downstream.

## Usage Guidelines

Two documented incidents underscore a real maintenance hazard: the `DEFAULT_FILTERS` copy has silently drifted from `viewer-store.ts` twice — once when `hideArchived` was split into `hideRolledUp`/`showStale` (script kept the old key, rendering everything and falsely reporting Coding 157-over-budget), and once when `selectedClasses` was left as an empty `Set`, which the predicate reads as "nothing visible," causing a false PASS. Both bugs were invisible to `tsc` because `scripts/` is excluded from the tsconfig `include`. Anyone changing `viewer-store.ts`'s default filter shape must manually update `DEFAULT_FILTERS` here, and anyone changing this file should be aware type-checking will not catch shape mismatches. Additionally, note that `attribution.byCategory.recordedParent` can legitimately undercount plausible parent matches by design — a recorded name resolving to two rooted entities is deliberately not treated as a suggestion — so a low `recordedParent` count is not necessarily a bug.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- `attribution.test.ts` is the unit-test surface for the exact `categoriseUnattributed`/`rootOf` pair that `assert-graph-density.ts` imports and calls (`rootOf(id, parents, (nodeId) => classOf.get(nodeId))` and `categoriseUnattributed(visible, forPredicate, relations…, parents, classOf)`). The tests pin four distinct, mutually exclusive categories — `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed` — matching the same four keys the density script destructures into `unrootedByCategory` for its JSON/text report. The test asserting 'a recorded name that resolves to TWO rooted entities is NOT a suggestion' (because 40 of 98 live roll-up parents share their child's name) documents why the density script's `attribution.byCategory.recordedParent` count can undercount plausible parent matches by design rather than by bug.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Knowledge Management Subsystem — km-core/obs-api Pipeline, Storage, Dedup, Ancestry' work record describes obs-api as the serving layer for the graph consumed by dashboards, viewers, and verification tools; `assert-graph-density.ts` is one such verification tool, fetching its entire input set from `OBS_API` (default `http://127.0.0.1:12436`) via `/api/v1/entities?limit=60000` and `/api/v1/relations?limit=60000` before running any visibility or attribution logic.
- The 'Unified Viewer — Timeline Strip and History Sidebar Data Sourcing' work record establishes which viewer fields are authoritative versus inert/legacy for anchoring and classification bug fixes; `assert-graph-density.ts` reads `ontologyClass` for its class/hierarchy logic while separately noting the wire also carries `entityType`, and the script's own comment states the two 'disagree on some rows' — the density gate resolves this by mapping `ontologyClass ?? entityType ?? ''` rather than trusting either field alone, which mirrors the authoritative-vs-inert distinction the record documents at the viewer layer.

## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero corresponding Insight graph nodes, showing manually/human-curated conclusions can exist as documents without ever being anchored into the graph as entities.

### Siblings
- [WaveInsightPersistenceGap](./WaveInsightPersistenceGap.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero corresponding Insight graph nodes were created, showing manual conclusions can exist purely as documents disconnected from the graph.
- [GraphAttributionCategorization](./GraphAttributionCategorization.md) -- [LLM+CGR] `integrations/unified-viewer/src/graph/attribution.test.ts` exercises `categoriseUnattributed` and `rootOf`, both imported from `./attribution` — the module this component's name maps to. The tests pin four mutually exclusive causes for a node having no project root: `recordedParent` (the entity's metadata names a parent that resolves to exactly one rooted entity), `wrongClass` (a Project claims it via a relation type like `has_insight` that `deriveParents` deliberately refuses), `danglingRef` (the entity referenced by an edge doesn't exist in the store), and `unclaimed` (no edge, no recorded name at all). The 'categories are exclusive' test asserts a row with both a recorded parent AND a `has_insight` claim lands in exactly one bucket, confirming the categorization is a priority-ordered decision tree rather than independent flags.


---

*Generated from 10 observations*

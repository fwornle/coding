# GraphDensityBudgetCheck

**Type:** Detail

## What It Is

GraphDensityBudgetCheck is implemented in `integrations/unified-viewer/scripts/assert-graph-density.ts`, a CI/CLI script that enforces a per-project node budget (default 40) on the graph the viewer actually renders. Rather than reimplementing visibility and hierarchy logic, it imports `isEntityVisible` from `@/graph/visibility-predicate` and `deriveParents` from `@/graph/hierarchy-parents` — the same predicates the canvas uses — so its counts match what a user would see. It lives under the parent OnlineLearning grouping, alongside siblings UnattributedEntityCategorization (the `categoriseUnattributed`/`rootOf` classification logic it consumes) and ClientSideNeighborExpansion (the double-click expand feature in SigmaCanvas.tsx, unrelated in mechanism but part of the same viewer surface).

## Architecture and Design

The core architectural decision is golden-source predicate reuse: instead of duplicating an eleven-field visibility rule server-side, the script sits inside the viewer package specifically so it can import the canvas's real modules. This is a direct response to a documented history of silent divergence between the check, the canvas, the footer, and `useGraphVisibility` — duplication previously caused real regressions (see Implementation Details). The script follows a CLI/CI health-check pattern: fetch live data via HTTP, apply pure predicate functions, exit 1 on violation. Budget evaluation is deliberately per-project (worst-case) rather than store-wide, avoiding dilution of one blown project's density into an averaged, less actionable metric. Unrooted nodes are treated as a hierarchy failure, not folded into a pseudo-project or exempted — reflecting a philosophy that a free-floating node is a bug, not noise.

## Implementation Details

`DEFAULT_FILTERS` is a hand-maintained mirror of `viewer-store.ts`'s seeded defaults, including `learningSource: 'combined'` — a literal copy whose enum definition lives only in the unretrieved store file. This mirroring is fragile: comments in the script document two prior regressions caused by exactly this duplication — a `hideArchived`→`hideRolledUp`/`showStale` split that left `hideRolledUp` undefined (falsely reporting Coding 157-over-budget), and a copied empty `selectedClasses` Set that rendered zero nodes, producing a false PASS. Both were caught only by manually diffing script output against the live canvas, underscoring why the predicate-import strategy (rather than filter-mirroring) is the safer half of the design.

The script also imports `PROVENANCE_RELATION_TYPES` from `@/graph/relation-types`, wrapping it in a Set to filter `visibleRelations`, ensuring provenance-only edges are excluded from rendered-edge counts exactly as the canvas excludes them. Unrooted node handling calls `categoriseUnattributed` (from `./attribution`, tested in `attribution.test.ts`) to bucket failures into `recordedParent`, `wrongClass`, `danglingRef`, and `unclaimed` — a categorised-failure reporting pattern rather than a single aggregate count, keeping distinct root causes actionable and directly reusing UnattributedEntityCategorization's exclusive, priority-ordered classification.

## Integration Points

Direct dependencies: `@/graph/visibility-predicate`, `@/graph/hierarchy-parents`, `@/graph/relation-types`, and `./attribution` (shared with sibling UnattributedEntityCategorization). It indirectly depends on `viewer-store.ts` for filter defaults and on `D3GraphCanvas.tsx`'s `isOnlineLearned`/`ONLINE_RING_COLOR` logic, since the `learningSource` filter it exercises also governs rendering there. At the parent level, OnlineLearning's Wave Insight Persistence work illustrates why this check must measure live graph node shape rather than trust document counts: Wave 4 produced 73 insight documents but zero `entityType: 'Insight'` nodes, a gap a document-count-based check would have missed entirely. Relatedly, the entityType-disambiguation fix (threading `entityType` through `queryIncomingRelations`/`storeRelationship`/`findEntityByName`) is exactly the class of upstream graph-correctness bug this per-project budget check is positioned to catch as a side effect, since a same-named cross-type node inheriting edges illegitimately would inflate its project's rendered count.

## Usage Guidelines

Any change to viewer-store.ts's seeded filter defaults must be manually propagated to `DEFAULT_FILTERS` in `assert-graph-density.ts` — this is a known, repeatedly-bitten failure mode, not a hypothetical one. When adding new visibility or hierarchy rules, prefer extending `isEntityVisible`/`deriveParents` (shared modules) over adding logic locally, to preserve the golden-source guarantee. Unrooted nodes should never be treated as acceptable noise or silently dropped; use `categoriseUnattributed` to surface actionable buckets. Because budget checks are per-project, a single high-density project will fail the check even if the store-wide average looks fine — this is intentional and should not be "fixed" toward averaging. Finally, treat any script/canvas count mismatch as a signal to check for reintroduced filter-mirroring drift.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- assert-graph-density.ts imports PROVENANCE_RELATION_TYPES from '@/graph/relation-types' and wraps it in a Set to filter visibleRelations, showing the density check also excludes provenance-only edges from the rendered-edge count, matching whatever edge-hiding logic the canvas itself applies.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Wave Insight Persistence work record shows why a script like this must measure the store's actual current shape rather than an assumption: Wave 4 produced 73 insight documents but zero entityType 'Insight' graph nodes, meaning a density/history check trusting document counts instead of live graph nodes would have silently overcounted or missed the resulting History-sidebar gap entirely.
- The same record's fix — threading entityType through <AWS_SECRET_REDACTED> so findEntityByName disambiguates by (name, type) — is the kind of upstream graph-correctness bug that a per-project node-count budget check is positioned to catch as a side effect, since a same-named cross-type node illegitimately inheriting 24 edges would inflate that node's project's rendered count.

## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- [SESSION] Wave Insight Persistence work record establishes that the History sidebar filters strictly to entityType 'Insight', so a Batch badge for a run's conclusions can only appear if the online pipeline actually writes Insight-typed graph nodes, not just insight documents.

### Siblings
- [UnattributedEntityCategorization](./UnattributedEntityCategorization.md) -- [LLM] attribution.test.ts exercises `categoriseUnattributed` and `rootOf` (imported from './attribution') with fixtures covering four distinct no-project categories — recordedParent, wrongClass, danglingRef, and unclaimed — and explicitly asserts these are mutually exclusive via a 'categories are exclusive' test that sums byCategory lengths to 1 even when a row qualifies for two categories at once, confirming a priority-ordered classification rather than a multi-label one.
- [ClientSideNeighborExpansion](./ClientSideNeighborExpansion.md) -- [LLM] The supplied files (ukb-workflow-modal.tsx, assert-graph-density.ts, D3GraphCanvas.tsx, SigmaCanvas.tsx, attribution.test.ts) contain no function, hook, or handler named or resembling 'ClientSideNeighborExpansion'. SigmaCanvas.tsx's GraphSetup does reference a double-click 'expand-neighbors' concept via `getLoadedRelations: () => relations` passed to `makeEventHandlers`, and a comment explicitly calls this 'The double-click expand's only source, for every backend', but the expansion logic itself lives in `./events` (makeEventHandlers), which is not part of the retrieved code.


---

*Generated from 10 observations*

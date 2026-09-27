# UnattributedEntityCategorization

**Type:** Detail

## What It Is

UnattributedEntityCategorization is implemented in `integrations/unified-viewer/src/graph/attribution.ts`, exposing at least two exported functions — `categoriseUnattributed` and `rootOf` — that are exercised directly in `attribution.test.ts` and consumed by `scripts/assert-graph-density.ts`. It classifies graph entities that fail to resolve to a project root into a fixed, priority-ordered taxonomy: `recordedParent`, `wrongClass`, `danglingRef`, and `unclaimed`. Its purpose is to give both a CI gate and an interactive viewer panel a single, shared answer to "why isn't this entity attributed to a project?" rather than letting each surface guess independently.

## Architecture and Design

The core pattern is shared-predicate/single-source-of-truth: attribution.ts centralizes root/category logic so that the CI density gate (assert-graph-density.ts) and the viewer's Graph quality panel consume identical logic instead of reimplementing an unrooted-node walk. The observations note this explicitly guards against drift — previously, this file, a separate `countUnanchored`, and a hypothetical third implementation produced divergent counts ("the canvas and the footer came to disagree in five different ways"). Categorization is priority-ordered and mutually exclusive by design: the test suite sums `byCategory` lengths to confirm a row landing in two logically-possible categories is still assigned exactly once, favoring a single decisive verdict over multi-label tagging. A related design decision scopes the categorization to what is visible: assert-graph-density.ts feeds `categoriseUnattributed` only `visible` (post-`isEntityVisible`) entities as candidates, while passing the full entity list, raw relations, and `parents` merely as context — tying "unattributed" to what a rendered canvas actually shows rather than the entire store.

## Implementation Details

`categoriseUnattributed` distinguishes cases where an entity has an edge that `deriveParents` (hierarchy-parents.ts:156) deliberately refuses to honor — e.g., a Project→has_insight edge pointing at a non-Insight entity — surfacing this as `wrongClass` rather than silently dropping the row, since the entity is simultaneously "claimed" by an edge and unplaceable in the hierarchy. Another encoded business rule: when a recorded name resolves to two rooted entities (documented as occurring in 40 of 98 live cases as roll-up parent twins), the function must not emit a `suggestedParentId` — an ambiguous match is treated as equivalent to no match, falling into `unclaimed` instead of guessing. This reflects a conservative philosophy: prefer explicit non-attribution over a wrong suggestion. Each category is fixture-tested individually so both counts and category assignment are pinned, not just aggregate totals.

## Integration Points

assert-graph-density.ts imports `rootOf`, `categoriseUnattributed`, and `CATEGORY_LABEL` from `@/graph/attribution`, alongside `isEntityVisible` (from GraphDensityBudgetCheck's dependency `@/graph/visibility-predicate`) and `deriveParents` (`@/graph/hierarchy-parents`), making the CI gate's correctness directly coupled to this module. This creates an explicit import boundary: the CI script and the interactive viewer's quality panel both depend on attribution.ts as their sole source for root/category computation. It is functionally adjacent to sibling GraphDensityBudgetCheck, which uses these same categorizations to enforce a per-project node budget (default 40) and fail when rows are unrooted. It's conceptually distinct from parent OnlineLearning's insight-persistence concerns: the Wave Insight Persistence work found 73 insight documents with zero matching graph nodes — an upstream "never written" failure — versus attribution.ts's concern of entities that are written but hierarchically orphaned (recordedParent/wrongClass/danglingRef/unclaimed). Similarly, the anchor-pass fix threading `entityType` through `queryIncomingRelations`/`storeRelationship` with a `projectAnchorName = 'Coding'` fallback addresses mis-rooting from name-only resolution in `findEntityByName` — a related but separate remediation from the taxonomy attribution.ts encodes.

## Usage Guidelines

Callers should always source root/category logic from `@/graph/attribution` rather than reimplementing traversal — the historical three-implementation divergence is the cautionary precedent. When feeding `categoriseUnattributed`, be deliberate about candidate scoping: pass visible/rendered entities as candidates but the full entity set, relations, and parents as context, mirroring assert-graph-density.ts, if the intent is to reflect what a user sees on canvas. Treat the four categories as mutually exclusive and priority-ordered — do not attempt to multi-label a row. Never surface a `suggestedParentId` for ambiguous name matches; equivalence-to-no-match (`unclaimed`) is the correct, tested behavior for duplicate-named roots. Finally, keep this concern separate from insight-persistence/mis-rooting failures owned elsewhere (OnlineLearning's History sidebar filtering, the anchor-pass entityType threading) — attribution.ts is specifically about entities that exist and are typed correctly but fail hierarchy placement.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- assert-graph-density.ts imports `rootOf` and `categoriseUnattributed` directly from '@/graph/attribution' rather than reimplementing the unrooted-node walk, explicitly citing that this file, `countUnanchored`, and a hypothetical third copy previously produced three divergent counts ('the canvas and the footer came to disagree in five different ways'); this establishes attribution.ts as the single shared module consumed by at least two call sites (the CI density gate and, per its own comment, the viewer's Graph quality panel).

**Other:**
- In assert-graph-density.ts, `categoriseUnattributed` is called with `visible` (post-`isEntityVisible` filtered) entities as candidates but the full `forPredicate` entity list plus raw relations and `parents` as context arguments, showing the categorization deliberately scopes 'findings' to only what a person could see on the rendered canvas rather than auditing the entire store.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Wave Insight Persistence work record shows the History sidebar filters strictly to entityType 'Insight', and Wave 4 produced 73 insight documents with zero matching graph nodes — this is a distinct, upstream failure mode from the unattributed-entity problem attribution.ts addresses: an entity can be correctly typed and rooted yet still invisible to a UI surface because no node was ever written, versus being written but hierarchically orphaned.
- The same work record's anchor-pass fix (threading entityType through `queryIncomingRelations` and `storeRelationship`, plus a fixed `projectAnchorName = 'Coding'` fallback) is a related but separate remediation for mis-rooted entities, caused by name-only resolution in `findEntityByName` rather than the recordedParent/wrongClass/danglingRef/unclaimed taxonomy attribution.ts encodes for the graph-density gate.

## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- [SESSION] Wave Insight Persistence work record establishes that the History sidebar filters strictly to entityType 'Insight', so a Batch badge for a run's conclusions can only appear if the online pipeline actually writes Insight-typed graph nodes, not just insight documents.

### Siblings
- [GraphDensityBudgetCheck](./GraphDensityBudgetCheck.md) -- [LLM] assert-graph-density.ts directly implements the GraphDensityBudgetCheck: it imports isEntityVisible from '@/graph/visibility-predicate' and deriveParents from '@/graph/hierarchy-parents' to replicate exactly what the canvas renders, then checks a per-project budget (default 40 nodes) rather than a store-wide total, exiting 1 when the worst project exceeds BUDGET or any rows are unrooted.
- [ClientSideNeighborExpansion](./ClientSideNeighborExpansion.md) -- [LLM] The supplied files (ukb-workflow-modal.tsx, assert-graph-density.ts, D3GraphCanvas.tsx, SigmaCanvas.tsx, attribution.test.ts) contain no function, hook, or handler named or resembling 'ClientSideNeighborExpansion'. SigmaCanvas.tsx's GraphSetup does reference a double-click 'expand-neighbors' concept via `getLoadedRelations: () => relations` passed to `makeEventHandlers`, and a comment explicitly calls this 'The double-click expand's only source, for every backend', but the expansion logic itself lives in `./events` (makeEventHandlers), which is not part of the retrieved code.


---

*Generated from 10 observations*

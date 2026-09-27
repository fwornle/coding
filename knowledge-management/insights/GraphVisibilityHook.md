# GraphVisibilityHook

**Type:** Detail

## What It Is

The canonical implementation file, `integrations/unified-viewer/src/graph/useGraphVisibility.ts`, is not present in any supplied source. Everything known about GraphVisibilityHook is secondhand, inferred from two consumers: `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, which imports and calls it (`const isVisible = useGraphVisibility()`), and `integrations/unified-viewer/scripts/assert-graph-density.ts`, which deliberately bypasses it in favor of the lower-level `isEntityVisible`/`VisibilityFilters` pair from `@/graph/visibility-predicate` (owned by the parent, GraphVisibilityFiltering) because scripts cannot invoke React hooks. No internal branching, memoization strategy, or exact field list can be asserted from what's supplied — only its external contract and purpose as documented by its callers.

## Architecture and Design

Based on consumer-side evidence, the likely design is a layered one: `isEntityVisible` acts as a pure predicate (owned by parent GraphVisibilityFiltering, described further under sibling VisibilityPredicateContract), and GraphVisibilityHook is a thin React-bound wrapper assembling that predicate's `VisibilityFilters` argument from live Zustand (`useViewerStore`) selectors, memoizing the result. This mirrors the "shared pure-predicate" pattern noted explicitly in observations: one filtering core reused by both a React hook and a non-React script consumer, preventing UI and CI/audit logic from diverging. A sibling hook, `useVisibleEntityIds`, is reported to share the same predicate for id-only consumers (e.g., the LSL timeline strip), suggesting GraphVisibilityHook is the primary, broader wrapper while `useVisibleEntityIds` is a narrower variant.

## Implementation Details

`D3GraphCanvas.tsx` comments describe the hook as centralizing "every filter the FilterRail and the LegendPanel expose" and folding in "eleven store subscriptions" that were previously written inline in that same file. Fields like `selectedNodeIds`, `focalNodeId`, `pathToSelected`, `selectionSource`, and `hiddenRelationTypes` are still read directly adjacent to the hook call, implying the hook itself owns a comparable or larger set of selectors. Separately, `assert-graph-density.ts`'s `DEFAULT_FILTERS` literal enumerates the full 14-field `VisibilityFilters` contract (`searchQueryLowered`, `selectedTeams`, `learningSource`, `selectedLayers`, `hideDocNodes`, `showStale`, `selectedClasses`, `visibleLevels`, `lslFilterEntityIds`, `hiddenNodeTypes`, `expandedComponentIds`, `hierarchyParents`, `hierarchyClassOf`, `showDebugEntityTypes`, `hierarchySpine`), which the hook must assemble equivalently from store state before calling `isEntityVisible`. None of this assembly logic is directly observable — it is inferred from the shape both consumers must satisfy independently.

## Integration Points

GraphVisibilityHook sits under the parent GraphVisibilityFiltering domain alongside siblings VisibilityPredicateContract (the `isEntityVisible`/`VisibilityFilters` contract itself) and GraphDensityAssertion (the renamed `assert-graph-density.ts`, formerly `assert-aggregated-node-budget.ts`, now scoped away from token/cost budgeting per its own header). Its primary integration point is `useViewerStore`, from which it likely draws a large slice of state — a tight coupling flagged as a maintainability risk since any store schema change could silently break the hook. Historically, filter logic was "copied into two other consumers" before being unified into this hook, and a documented divergence note ("the footer diverged from the canvas in five ways, and useGraphVisibility in a sixth") — referenced by two independent files but not reproducible here — implies past drift between canvas, footer, and hook implementations.

## Usage Guidelines

Developers should treat GraphVisibilityHook as the required entry point for any React canvas component needing visibility filtering, rather than reimplementing filter logic inline — that duplication is explicitly what caused prior regressions. Non-React tooling (scripts, CI gates) should follow `assert-graph-density.ts`'s pattern of calling `isEntityVisible`/`VisibilityFilters` directly, but must keep `DEFAULT_FILTERS` synchronized with whatever the hook actually assembles, since this dual-path structure creates a contract-duplication risk noted in both files' comments. Given the unresolved `findEntityByName` disambiguation issue from the Wave Insight Persistence work (name-only matching, not (name, type)), any hierarchy fields the hook supplies — `hierarchyParents`, `hierarchyClassOf`, `hierarchySpine` — should be treated as a possible source of mis-attributed visibility if edges were built pre-fix. Finally, before making further changes, locate and read the in-file note atop `useGraphVisibility.ts` describing the six-way divergence — its content is referenced but not available in current context, and should be retrieved directly rather than re-inferred.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Wave Insight Persistence work record's finding that `findEntityByName` disambiguated only by name (not by (name, type)) is relevant background for any hook that resolves visibility/attribution by walking parent/child edges — if `hierarchyParents`/`hierarchyClassOf` (fields the hook must supply per `assert-graph-density.ts`'s `DEFAULT_FILTERS`) are built from edges written before that fix, a same-named node collision could make the hook mark an unrelated entity's descendants visible under the wrong ancestor, though this is a risk inferred from the fix's scope rather than something demonstrated in the hook's own code.

## Hierarchy Context

### Parent
- [GraphVisibilityFiltering](./GraphVisibilityFiltering.md) -- [LLM] The actual implementation of the visibility predicate — `@/graph/visibility-predicate.ts` (exporting `isEntityVisible` and the `VisibilityFilters` type) and `@/graph/useGraphVisibility.ts` (the hook wrapping it) — is not present in the supplied files. What is present are two CONSUMERS: `integrations/unified-viewer/scripts/assert-graph-density.ts`, which imports `isEntityVisible`/`VisibilityFilters` directly to replay the canvas's filtering offline, and `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, which calls a `useGraphVisibility()` hook. Both treat the predicate as an opaque contract rather than defining it, so any statement about the internal branching logic of the filter would be inference, not observation.

### Siblings
- [VisibilityPredicateContract](./VisibilityPredicateContract.md) -- [LLM] None of the supplied files contain the file the parent context names as the actual implementation — `@/graph/visibility-predicate.ts` (exporting `isEntityVisible` and `VisibilityFilters`) — nor `@/graph/useGraphVisibility.ts`. What is present is exclusively consumer-side evidence: `integrations/unified-viewer/scripts/assert-graph-density.ts` imports `isEntityVisible` and `type VisibilityFilters` and treats them as an external contract it must satisfy by hand-assembling a `DEFAULT_FILTERS` literal, and `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` calls `useGraphVisibility()` and reads its return value as `isVisible` without any visibility into the fourteen-plus fields the hook actually reduces over. Every comment in both files describes the predicate's behavior from the outside (e.g. 'the predicate reads `ontologyClass`', 'the predicate reads `!== 'intent'`'), which is consistent with black-box integration testing rather than with owning the logic.
- [GraphDensityAssertion](./GraphDensityAssertion.md) -- [LLM] `assert-graph-density.ts` in `integrations/unified-viewer/scripts/` IS the GraphDensityAssertion component itself, not a consumer of it — the file's own header explains it was renamed from `assert-aggregated-node-budget.ts` on 2026-09-25 specifically to stop conflating a node-count check with the repo's token/money budgets under Token Usage -> Cost. The env knobs were renamed alongside it (`GRAPH_MAX_NODES_PER_PROJECT`, `GRAPH_DETAIL_LEVEL`), which the file states explicitly rather than leaving as an inferred side effect of the rename.


---

*Generated from 9 observations*

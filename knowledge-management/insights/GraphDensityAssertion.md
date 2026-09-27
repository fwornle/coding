# GraphDensityAssertion

**Type:** Detail

# GraphDensityAssertion — Technical Insight Document

## What It Is

GraphDensityAssertion is implemented as a single script, `integrations/unified-viewer/scripts/assert-graph-density.ts`, located in the viewer package rather than in obs-api. It was renamed from `assert-aggregated-node-budget.ts` specifically to stop conflating a node-count/visibility check with the repo's token/money budgets under Token Usage -> Cost; the env knobs `GRAPH_MAX_NODES_PER_PROJECT` and `GRAPH_DETAIL_LEVEL` were renamed alongside it. Its purpose is to replay, offline and per-project, the same visibility filtering the live canvas applies, then assert that no single project's visible node count exceeds a configured budget — exiting with process code 1 when any project is over budget.

## Architecture and Design

The defining architectural choice is golden-master/characterization testing: rather than modeling visibility rules independently, the script imports `isEntityVisible` and `VisibilityFilters` directly from `@/graph/visibility-predicate` — the same predicate underlying its parent component, GraphVisibilityFiltering, and consumed elsewhere via the sibling GraphVisibilityHook (`useGraphVisibility()` in `D3GraphCanvas.tsx`). By depending on the real predicate instead of a reimplementation, the assertion can only diverge from production behavior if the canvas itself changes.

This "import-the-real-implementation" principle extends beyond filtering logic to rollup/attribution: `rootOf()` and `categoriseUnattributed()` are imported from `@/graph/attribution` rather than reimplemented, after a documented history of three divergent walks (the script's own prior copy, a second copy in `countUnanchored`, and the canonical one) before consolidation. The script also applies worst-case aggregation — gating against the single worst project rather than a store-wide average — deliberately rejecting a store-wide total (diluted across 21 Project nodes) and a synthetic "unrooted" bucket (which previously produced a false "1/202 projects over budget" result when 201 of those "projects" were actually unparented single rows).

## Implementation Details

The script hand-assembles a `DEFAULT_FILTERS` object mirroring the store's seeded defaults (per its own comment referencing `viewer-store.ts` lines ~519-973), then constructs a `forPredicate` mapping that reproduces exactly what `/api/v1` sends the canvas, including the unreconciled dual class vocabulary: `ontologyClass: e.ontologyClass ?? e.entityType ?? ''`. This is a conscious choice to measure what ships today, warts included, rather than a corrected count the canvas never sees.

Two regressions are preserved as inline comments directly above the `DEFAULT_FILTERS` construction: a `hideArchived` → `hideRolledUp`/`showStale` field split that silently broke filtering (reporting Coding at 157 nodes over a budget of 40), and a `selectedClasses` empty-Set copy that inverted sentinel semantics and caused a false PASS against an empty-rendering canvas. Both are attributed to `scripts/` being excluded from `tsconfig`'s `include`, meaning `npm run build`'s `tsc --noEmit 2>/dev/null` swallows the type errors that would otherwise catch these breaks — a documented, load-bearing gap in the type-safety net.

The categorisation logic it depends on, spec'd in `attribution.test.ts`, distinguishes four mutually exclusive buckets — `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed` — rather than a bare unrooted count, since a flat count had previously been misread as "not yet placed" when most rows were actually placed through a field or edge type the hierarchy walk refuses to honor.

## Integration Points

GraphDensityAssertion sits under GraphVisibilityFiltering, alongside siblings VisibilityPredicateContract and GraphVisibilityHook, both of which treat the predicate as an opaque, externally-observed contract. Unlike `D3GraphCanvas.tsx`, which consumes filtering via the `useGraphVisibility()` hook, the script cannot use a React hook and instead calls the lower-level `isEntityVisible`/`VisibilityFilters` pair directly. It fetches raw data straight from obs-api (`/api/v1/entities`, `/api/v1/relations`) rather than through the app's `useGraphData` hook, decoupling the check from React/hook lifecycle while remaining tightly coupled to `@/graph/visibility-predicate`, `@/graph/hierarchy-parents`, `@/graph/attribution`, and `@/store/viewer-store`'s `DETAIL_LEVEL_FLAGS`.

## Usage Guidelines

Because this script's correctness depends entirely on staying in lockstep with `viewer-store.ts`'s seeded defaults and the predicate's field set, any change to `DEFAULT_FILTERS`, `VisibilityFilters`, or the eleven/fourteen-field visibility rule must be manually mirrored here — there is no compiler safety net since `scripts/` falls outside `tsconfig`'s include. Developers should treat divergence between this script and the live predicate as a known failure mode, not an edge case, and should prefer extending shared modules (`@/graph/attribution`, `@/graph/hierarchy-parents`) over adding local logic, given the documented history of drift across three copies of the same walk.


## Hierarchy Context

### Parent
- [GraphVisibilityFiltering](./GraphVisibilityFiltering.md) -- [LLM] The actual implementation of the visibility predicate — `@/graph/visibility-predicate.ts` (exporting `isEntityVisible` and the `VisibilityFilters` type) and `@/graph/useGraphVisibility.ts` (the hook wrapping it) — is not present in the supplied files. What is present are two CONSUMERS: `integrations/unified-viewer/scripts/assert-graph-density.ts`, which imports `isEntityVisible`/`VisibilityFilters` directly to replay the canvas's filtering offline, and `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, which calls a `useGraphVisibility()` hook. Both treat the predicate as an opaque contract rather than defining it, so any statement about the internal branching logic of the filter would be inference, not observation.

### Siblings
- [VisibilityPredicateContract](./VisibilityPredicateContract.md) -- [LLM] None of the supplied files contain the file the parent context names as the actual implementation — `@/graph/visibility-predicate.ts` (exporting `isEntityVisible` and `VisibilityFilters`) — nor `@/graph/useGraphVisibility.ts`. What is present is exclusively consumer-side evidence: `integrations/unified-viewer/scripts/assert-graph-density.ts` imports `isEntityVisible` and `type VisibilityFilters` and treats them as an external contract it must satisfy by hand-assembling a `DEFAULT_FILTERS` literal, and `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` calls `useGraphVisibility()` and reads its return value as `isVisible` without any visibility into the fourteen-plus fields the hook actually reduces over. Every comment in both files describes the predicate's behavior from the outside (e.g. 'the predicate reads `ontologyClass`', 'the predicate reads `!== 'intent'`'), which is consistent with black-box integration testing rather than with owning the logic.
- [GraphVisibilityHook](./GraphVisibilityHook.md) -- [LLM] The file explicitly named by this component — `@/graph/useGraphVisibility.ts` — is not among the supplied code files. What is present are two consumers that treat it as an opaque import: `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, which calls `useGraphVisibility()` and assigns its return value to `isVisible`, and `integrations/unified-viewer/scripts/assert-graph-density.ts`, which bypasses the hook entirely and calls the lower-level `isEntityVisible`/`VisibilityFilters` pair from `@/graph/visibility-predicate` directly (since a script can't call a React hook). Any claim about the hook's internal branching, memoization strategy, or exact field list would be inference dressed as observation, not something grounded in these files.


---

*Generated from 9 observations*

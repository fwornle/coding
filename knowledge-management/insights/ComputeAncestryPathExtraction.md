# ComputeAncestryPathExtraction

**Type:** Detail

# ComputeAncestryPathExtraction — Technical Insight Document

## What It Is

ComputeAncestryPathExtraction refers to the extraction and reconciliation architecture surrounding ancestry-path computation in `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, centered on the function `deriveAncestryFromStorePath()` (its sibling entity `DeriveAncestryFromStorePath`) and the shared module `./ancestry`, which exports `computeAncestryPath()` and the `AncestryPathResult` type. This extraction happened at "Phase 56-04," described in code comments as a bit-identical code-move of `computeAncestryPath` out of D3GraphCanvas.tsx into its own module — a pure refactor, not a behavior change. The purpose of this shared module is to give two independent UI consumers — the main D3 canvas render path and `LslTimelineStrip.onTickClick` — a single BFS ancestry implementation to call, rather than each reimplementing graph traversal from scratch.

## Architecture and Design

The defining architectural feature here is a reconciliation pattern between two independently-computed ancestry sets: the store's authoritative `pathToSelected` (written by every selection writer — graph click, history click, timeline tick) and a local re-run of `computeAncestryPath()`. Rather than treating one as strictly canonical, `deriveAncestryFromStorePath()` implements a "writer's intent wins, but degrade gracefully" policy: store-only nodes get a synthetic `maxDepth` slot so they still render (at the dimmest gradient end) instead of being dropped, while BFS-only nodes are discarded entirely, and `prunedEdges` is filtered to edges whose endpoints both survive.

A fast-path/slow-path optimization guards this reconciliation: when `inline.nodeDepths.size === storePath.size` and every inline key exists in `storePath`, the expensive pruning logic is skipped entirely, since agreement between the two traversals is the common case.

This design was not incidental — it was driven by a documented "state-flow audit b29bdb34c §6.4/§6.6" that identified finding "S3 — duplicated source-of-truth," where this D3 path and the parallel Sigma/WebGL path (`graph-builder.ts:461,487`) could independently compute divergent ancestry traces. The parent entity, GraphViewerHierarchy, frames this whole file as an explicit Redux-to-Zustand port that nonetheless re-derives selection/ancestry logic to keep two rendering engines in sync against one shared state model — `deriveAncestryFromStorePath()` is the clearest evidence of that broader tension.

## Implementation Details

The reconciliation logic tracks a `prunedNodeDepths` map and a running `maxDepth` (the max of `inline.pathLength` and any depth from `inline.nodeDepths.get(id)`). Store-tagged nodes with no BFS reachability are assigned this `maxDepth` value, meaning they become visually indistinguishable from genuinely distant nodes — a disclosed UX compromise ("so it still renders within the trace but doesn't dominate") rather than an accurate distance representation.

Edge pruning relies on an undocumented string-encoding convention: edges are serialized as `"${a}||${b}"` and split via `e.split('||')`. This is an implicit, non-type-checked contract between `deriveAncestryFromStorePath()` and `./ancestry`'s edge-key format — if the delimiter or ordering ever changes, the split silently produces garbage pairs, and `storePath.has(a) && storePath.has(b)` simply evaluates false, dropping edges without error.

The function is deliberately pure — no store reads, no side effects — so it can be invoked from `applySelectionStyling` (which draws "two-tier rings: red focal on `focalNodeId`, lighter-blue halo on every other member of `selectedNodeIds`") without violating the file's viewport-stability contract.

## Integration Points

`deriveAncestryFromStorePath()` has no direct callers visible in the excerpt but is consumed conceptually by `applySelectionStyling` and shares its `./ancestry` import with `LslTimelineStrip.onTickClick`'s "central-trace render" logic. This module boundary exists specifically to prevent the D3 canvas and timeline strip from re-implementing BFS ancestry independently.

Architecturally, this logic must stay outside the main render `useEffect`'s dependency list (Locked Contract #3 — the viewport-stability contract), so `pathToSelected`/`selectionSource` subscriptions don't retrigger the D3 force simulation on every selection change. This keeps expensive layout stable while cheap selection-visuals update freely.

Structurally, this pattern echoes sibling components: DeriveParentsHierarchyReduction's duplicated parent-walking loops in `color-fallback.ts` (`nodeFillColor()`/`nodeShapeFor()`) and HierarchyCycleBreaking's cycle-guarded ancestor walks in the same file solve "derive X from ancestor chain" via fresh per-consumer loops rather than a single generic reducer — the same "parallel implementations, no shared traversal engine" symptom seen here.

## Usage Guidelines

Developers must preserve the "'a||b'" edge-serialization contract between `./ancestry` and `deriveAncestryFromStorePath()`; changing it in one place without the other silently corrupts edge pruning rather than throwing. New store-only nodes should be expected to render at the dimmest depth tier by design, not as a bug. Any modification to this function must keep it pure and outside the main render effect's dependencies to respect the viewport-stability contract, and any change to `computeAncestryPath()` in `./ancestry` must be validated against both D3GraphCanvas.tsx and LslTimelineStrip consumers to avoid re-introducing the S3 duplicated-source-of-truth problem the b29bdb34c audit fixed.


## Hierarchy Context

### Parent
- [GraphViewerHierarchy](./GraphViewerHierarchy.md) -- [LLM] D3GraphCanvas.tsx (integrations/unified-viewer/src/graph/D3GraphCanvas.tsx) is an explicit, well-documented port of a Redux-based component (memory-visualizer's GraphVisualization.tsx) into a Zustand-store-driven architecture, but it does not simply swap state libraries — it re-derives a large amount of selection/ancestry logic to keep two independently-maintained rendering paths (this D3/SVG canvas and a parallel Sigma/WebGL canvas referenced in comments as 'graph-builder.ts') in sync. The `deriveAncestryFromStorePath()` function is the clearest evidence of this: rather than trusting either the store's `pathToSelected` set or its own inline `computeAncestryPath()` BFS in isolation, it runs both and reconciles them with a 'writer's intent wins' rule — nodes the store claims are in-path but the local BFS can't reach get a synthetic max-depth slot so they still render, while nodes the BFS finds but the store doesn't tag are dropped. This reconciliation is a symptom of maintaining two rendering engines against one shared selection model without a shared traversal implementation.

### Siblings
- [DeriveAncestryFromStorePath](./DeriveAncestryFromStorePath.md) -- [CGR] deriveAncestryFromStorePath (function) in D3GraphCanvas.tsx
- [DeriveParentsHierarchyReduction](./DeriveParentsHierarchyReduction.md) -- [LLM] The component's namesake operation is the parent-walking loop implemented twice, nearly identically, in integrations/unified-viewer/src/graph/color-fallback.ts — once in `nodeFillColor()` and once in `nodeShapeFor()`. Both functions take a `className`, a `ReadonlyMap<string, ClassRegistryEntry>` registry, and walk `cur = reg?.parent ?? undefined` in a `while (cur && !seen.has(cur))` loop, checking a registry override first, then a static palette (`BATCH_PALETTE`/`SHAPE_PALETTE`), before ascending to the parent. This is a hierarchy-reduction pattern: an entity's own ontology class is reduced to whichever ancestor is the nearest one carrying an actual color/shape assignment, so `LiveLoggingSystem` (a Component subtype) inherits Component's blue rather than falling through to a generic slate default. The duplication of the walk (two near-identical `while` loops differing only in what table they consult) is a direct structural echo of the reconciliation-duplication pattern already documented for `deriveAncestryFromStorePath()` in D3GraphCanvas.tsx — this codebase repeatedly solves 'derive X from ancestor chain' by writing a fresh loop per consumer rather than a single generic reducer.
- [HierarchyCycleBreaking](./HierarchyCycleBreaking.md) -- [LLM] The component's actual cycle-breaking logic lives in `nodeFillColor` and `nodeShapeFor` in integrations/unified-viewer/src/graph/color-fallback.ts, not in D3GraphCanvas.tsx. Both functions walk a registry parent chain (`cur = reg?.parent`) with an identical guard: `const seen = new Set<string>(); while (cur && !seen.has(cur)) { seen.add(cur); ... }`. Without this guard, a malformed ontology registry entry (e.g. class A declaring parent B, B declaring parent A) would infinite-loop the walk on every single node render using that class — since these are called per-node inside D3GraphCanvas's render path, a cyclic registry would hang the whole canvas, not just misrender one node.
- [LearningSourceClassifier](./LearningSourceClassifier.md) -- [LLM] The 'LearningSourceClassifier' concept is not embodied by a single dedicated file in the evidence provided but is realized as a distributed convention enforced across at least three files: `isOnlineLearned()` imported into D3GraphCanvas.tsx and color-fallback.ts, and referenced implicitly by the 'Learning Source' filter mentioned in useGraphVisibility comments. color-fallback.ts explicitly documents that this classifier replaced an earlier, narrower `source === 'auto'` string check because 'the data stamps ETM/consolidator output as online far more often than auto', meaning the classification logic itself absorbed real-world data drift rather than being fixed at design time.


---

*Generated from 9 observations*

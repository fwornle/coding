# D3GraphCanvas

**Type:** Detail

# D3GraphCanvas: Technical Insight Document

## What It Is

`D3GraphCanvas` is implemented at `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` as a React function component (`D3GraphCanvas`, with props typed via `D3GraphCanvasProps`) that renders the graph view using an SVG canvas driven by `d3.forceSimulation`. Its header comment explicitly frames it as a verbatim port of memory-visualizer's `GraphVisualization.tsx`, retained specifically because the force-directed layout parameters `d3.forceLink(150)` + `d3.forceManyBody(-500)` reproduce an organic clustering look that repeated attempts with sigma + graphology-layout-* could not match. It sits within the parent `UnifiedGraphViewerRendering` module alongside its sibling `SigmaCanvas`, and its test coverage spans `D3GraphCanvas.test.ts` and `D3GraphCanvas.hover.test.tsx`.

## Architecture and Design

The defining architectural fact about `D3GraphCanvas` is that it exists as a deliberate, permanent fork rather than a migration step: `UnifiedGraphViewerRendering` implements two parallel, non-shared renderers — WebGL-based `SigmaCanvas` and SVG-based `D3GraphCanvas` — over the same data layer (`useGraphData`/`useViewerStore`). This is a **dual-backend renderer pattern with a fidelity-driven fallback**: SigmaCanvas's own commentary describes ForceAtlas2 "collapsing the connected component into a tight ball," settling for `graphology-layout-force` as the closest available substitute, while D3GraphCanvas is kept alive precisely because it hits the visual reference that the WebGL path cannot.

Within the component, several other patterns recur. `deriveAncestryFromStorePath` embodies a **store-authoritative reconciliation / prune-not-recompute pattern**: it runs `computeAncestryPath` as an inline BFS to preserve gradient-depth semantics, then prunes that result against the store's `pathToSelected` only when they disagree, assigning unreached-but-store-tagged nodes a synthetic "dimmest end of the gradient" depth rather than recomputing from the store. The store's set is a filter, not a producer — a subtle design choice that avoids flicker when visible relations change out from under the ancestry path.

Visibility logic follows a **shared-predicate extraction pattern**: `useGraphVisibility` collapses an eleven-field `VisibilityFilters` predicate that had previously been copied inline into at least three consumers (this canvas, a footer component, and `assert-graph-density.ts`'s density check). Hierarchy placement, by contrast, remains a **composition of small, independently-evolved modules** — `explicitPlacementEdges` (hierarchy-parents.ts), `buildRehomeEdges` (rehome-edges.ts), and `deriveParents`/`rootOf`/`categoriseUnattributed` (attribution.ts) — rather than one unified resolver, reflecting real ambiguity in production data (per `attribution.test.ts`, 40 of 98 live roll-up parents share their child's name, forcing `categoriseUnattributed` to deliberately withhold a placement suggestion).

Finally, an **effect dependency-list contract** ("Contract #3") is enforced: selection/hover state must never enter the main render effect's dependency array, preventing simulation restarts on click. This constraint is mirrored identically in `SigmaCanvas.tsx`'s `GraphSetup`, making it a cross-file, audit-locked invariant rather than an incidental convention.

## Implementation Details

The component's `D3Node` interface encodes a critical semantic distinction between `ontologyClass` and `entityType`, documented inline with the concrete example that `CollectiveKnowledge` has `ontologyClass=Detail` but `entityType=System`. Fill color is resolved via `nodeFillColor`/`ONLINE_RING_COLOR` (from `color-fallback.ts`) keyed strictly on `ontologyClass` — meaning any code path that colors by `entityType` instead will visually contradict this canvas for the same entity, a named instance of the broader "eleven-field rule" drift problem also called out in `assert-graph-density.ts`.

Layout mechanics rely on `calculateGraphBounds` and `calculateCenterTransform` for framing, and `makeDrag` for interactive node dragging — all direct call-graph dependencies. The component's inline comment trail (dated Phase 56-04, Phase 56.1 Plan 05 D-2, Plan 06 gap-closure Decision 2) documents a reversed decision: a centering/pan-on-selection effect was removed on operator instruction ("Maybe the zoom is not a good idea…"), then a narrower version was reintroduced later, scoped specifically to a Layer 0 → Layer 1 multi-set fit-to-bounds effect, and explicitly kept out of the main render effect's dependencies to preserve Contract #3.

## Integration Points

`D3GraphCanvas` imports heavily from the graph data/color subsystem: `ApiClient`/`system-endpoints.ts` for backend calls, `ancestry.ts`'s `computeAncestryPath` and `AncestryPathResult` for path derivation, and `color-fallback.ts`'s `ClassRegistryEntry`/`nodeFillColor` for styling — plus ten additional unlisted imports. It calls into `useViewerStore` (Zustand) for one-way selection/ancestry state flow, and into `useGraphVisibility` and the `hierarchy-parents.ts`/`attribution.ts` family, the same modules imported verbatim by the offline CI script `assert-graph-density.ts`, guaranteeing the interactive canvas and the density-check gate cannot silently disagree.

## Usage Guidelines

Developers modifying this file must respect Contract #3 — selection and hover state must never be added to the main render/data-rebuild effect's dependency list, or the simulation will restart on every click, a regression the dated comments show was already fought and resolved once. Color logic must be driven by `ontologyClass`, never `entityType`, to stay consistent with the rest of the pipeline. Any new visibility-filtering logic belongs in `useGraphVisibility`, not reimplemented inline, given the documented history of three-way drift. Hierarchy/placement changes should be made in the shared `hierarchy-parents.ts`/`attribution.ts`/`rehome-edges.ts` modules so that both this canvas and `assert-graph-density.ts` remain in agreement, and ambiguous parent-child cases should be routed through `categoriseUnattributed` rather than guessed. Given the deliberate two-backend architecture, changes intended to make `D3GraphCanvas` and `SigmaCanvas` converge should be treated with caution — the separation is a documented, accepted trade-off, not oversight.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- D3GraphCanvas (function) in D3GraphCanvas.tsx
- D3GraphCanvasProps (class) in D3GraphCanvas.tsx

**Relationships:**
- Calls: deriveAncestryFromStorePath, calculateGraphBounds, calculateCenterTransform, makeDrag, explicitPlacementEdges, useGraphVisibility, useViewerStore
- Imports: ApiClient.ts, ApiClient, system-endpoints.ts, System, ancestry.ts, AncestryPathResult, computeAncestryPath, color-fallback.ts, ClassRegistryEntry, nodeFillColor (+10 more)

**Other:**
- D3GraphCanvas.tsx (module) in D3GraphCanvas.tsx
- D3GraphCanvas.hover.test.tsx (module) in D3GraphCanvas.hover.test.tsx
- D3GraphCanvas.test.ts (module) in D3GraphCanvas.test.ts
- Call chain: D3GraphCanvas -> deriveAncestryFromStorePath
- Call chain: D3GraphCanvas -> calculateGraphBounds
- Call chain: D3GraphCanvas -> calculateCenterTransform
- Call chain: D3GraphCanvas -> makeDrag
- Call chain: D3GraphCanvas -> explicitPlacementEdges
- `deriveAncestryFromStorePath` (present in the call graph as a direct dependency of `D3GraphCanvas`) implements the audit-mandated reconciliation described in the parent observations: it first runs `computeAncestryPath` (imported from `ancestry.ts`) as an inline BFS, then — only if that BFS's node set disagrees with the store's `pathToSelected` — prunes the BFS output down to the store's membership, assigning unreached-but-store-tagged nodes a synthetic 'dimmest end of the gradient' depth (`maxDepth`) rather than recomputing anything from the store directly. This is a fairly unusual reconciliation shape: it keeps the BFS as the sole *producer* of visual depth (so the trace gradient survives), while treating the store's set purely as a *filter*, which means a store node absent from the current `visibleRelations` graph still renders (dimly) instead of disappearing, avoiding a flicker described nowhere else in the file but implied by the 'filters may have changed' comment.
- `useGraphVisibility` is called directly by `D3GraphCanvas` and is explicitly framed in-code as a rescue for the divergence documented in `assert-graph-density.ts`'s header ("the footer diverged from the canvas in five different ways, and useGraphVisibility diverged in a sixth"). The comment above the `isVisible` memo states the eleven store subscriptions and the `VisibilityFilters` literal 'used to sit here inline and were copied into two other consumers' — i.e., this hook is a post-hoc extraction to collapse three independent copies of an 11-field predicate into one, and `D3GraphCanvas` is one of at least three call sites (the other being the density-check script and, per the parent context, a footer component) that must now all resolve to the same imported function rather than reimplementing the rule.
- The component pulls in three distinct, independently-versioned hierarchy/placement modules — `explicitPlacementEdges` (from `hierarchy-parents.ts`, in the call graph), `buildRehomeEdges` (from `rehome-edges.ts`), and (per `assert-graph-density.ts`) `deriveParents`/`rootOf`/`categoriseUnattributed` from the same `hierarchy-parents.ts`/`attribution.ts` family — suggesting the canvas's notion of 'where does this node belong in the tree' is assembled from several small, separately-evolved edge-derivation functions rather than one hierarchy resolver. `attribution.test.ts`'s note that '40 of the live 98' roll-up parents share their child's name, and that `categoriseUnattributed` deliberately withholds a placement suggestion in that ambiguous case, is direct evidence that this composition problem is real production data, not a hypothetical edge case — and the density script's 'no suggestion' path exists because guessing wrong here would misfile a node in the very canvas `D3GraphCanvas` renders.


## Hierarchy Context

### Parent
- [UnifiedGraphViewerRendering](./UnifiedGraphViewerRendering.md) -- [LLM] The unified-viewer package implements graph rendering through two parallel, independently-maintained components rather than one: SigmaCanvas.tsx (WebGL via @react-sigma/core, ForceAtlas2-adjacent graphology-layout-force) and D3GraphCanvas.tsx (SVG via d3.forceSimulation). D3GraphCanvas's header comment states it is a direct port of memory-visualizer's GraphVisualization.tsx because 'every attempt to reproduce VKB's force-directed look with sigma + graphology-layout-* drifted further from the reference' — i.e. the SVG renderer exists specifically because the WebGL renderer could not visually match a prior tool's d3.forceLink(150)/d3.forceManyBody(-500) look. This is a deliberate two-backend architecture traded for a fidelity requirement, not a migration-in-progress.

### Siblings
- [SigmaCanvas](./SigmaCanvas.md) -- [CGR] SigmaCanvas (function) in SigmaCanvas.tsx
- [GraphEventHandlers](./GraphEventHandlers.md) -- [LLM] The code files supplied do not contain a component, file, class, or function named "GraphEventHandlers" anywhere. The closest artifact is `makeEventHandlers` in SigmaCanvas.tsx:145-152, which is imported from a sibling module `./events` (i.e. presumably `integrations/unified-viewer/src/graph/events.ts`) but whose implementation is never shown — only its call site inside `GraphSetup`'s data-load `useEffect`. Everything below is therefore inferred from that call site plus the parent observations, not from reading the handler module itself.
- [GraphDensityBudgetGate](./GraphDensityBudgetGate.md) -- [LLM] No code in the supplied files implements or is named 'GraphDensityBudgetGate'. The closest artifact — integrations/unified-viewer/scripts/assert-graph-density.ts — is a standalone CLI health-check script, not a component class, hook, or React module named GraphDensityBudgetGate. Its own header explicitly documents a rename history ('this file used to be called assert-aggregated-node-budget.ts') that never produced a name resembling 'GraphDensityBudgetGate', suggesting the requested entity is either a higher-level wrapper (e.g. a health-check registration, a dashboard-side gate consumer, or a CI job definition) that was not retrieved, or a name coined at the knowledge-graph/documentation layer to describe this script's function rather than a literal identifier in the codebase.


---

*Generated from 21 observations*

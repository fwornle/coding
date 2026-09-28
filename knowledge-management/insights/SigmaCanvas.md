# SigmaCanvas

**Type:** Detail

# SigmaCanvas — Technical Insight Document

## What It Is

SigmaCanvas is implemented in `integrations/unified-viewer/src/graph/SigmaCanvas.tsx`, exporting the `SigmaCanvas` function component and a `SigmaCanvasProps` type. It is one of two parallel graph-rendering backends inside the parent component **UnifiedGraphViewerRendering**, specifically the WebGL-native implementation built on `@react-sigma/core`'s `SigmaContainer`, in contrast to its sibling **D3GraphCanvas** which renders via SVG and `d3.forceSimulation`. Internally, SigmaCanvas mounts an inner orchestrator, `GraphSetup`, as a child of `SigmaContainer` so that it can access sigma's React hooks, plus a `TestHookExposer` component for test instrumentation. Coverage exists in `SigmaCanvas.test.tsx`.

## Architecture and Design

The dominant pattern is a **container/inner-component split**: `SigmaCanvas` mounts `SigmaContainer`, while `GraphSetup` performs all data loading, layout, and event wiring as a child so it can call sigma-specific hooks unavailable at the outer level. Within `GraphSetup`, two `useEffect` calls are deliberately separated by dependency array to enforce what the architecture calls "Contract #3": the main effect (deps: `apiClient, entities, isLoading, loadGraph, ontology, registerEvents, relations, theme`) calls `buildGraph()`, `forceLayout.assign()`, and `loadGraph(graph)` — the expensive, simulation-restarting path — while a second effect (deps: `hoveredNode, setSettings`) only updates `nodeReducer`/`edgeReducer` via `setSettings()`. This guarantees that hover/selection interactions never restart the graph simulation.

A second, subtler instance of this same segregation governs theme reactivity: `theme` is read once as a dependency in the main rebuild effect, and again via a raw `useViewerStore.subscribe()` call inside the reducer effect (rather than a selector hook) so that dark/light label color changes (`slate-200`/`slate-800`) repaint reducers without triggering a rebuild. The dual-path handling of the same store field is flagged as possibly redundant or a subtle timing requirement not documented in the file itself.

At the module-composition level, SigmaCanvas depends on a four-way decomposition: `buildGraph` (graph-builder.ts), `makeEventHandlers` (graph/events.ts), and `makeEdgeReducer`/`makeNodeReducer`/`setReducedMotion`/`SHAPE_NODE_PROGRAMS` (reducers.ts). This keeps `GraphSetup` as a thin orchestrator rather than an implementation site, delegating data construction, event wiring, and visual reduction to dedicated modules — a **reducer pattern** for visual state where selection/hover/theme are read each frame rather than mutated directly onto the graphology graph.

At the architecture level, SigmaCanvas and D3GraphCanvas form an **adapter/port pattern**: D3GraphCanvas exists as a verbatim-behavior port of a legacy tool's visual style specifically because sigma/graphology-layout-force tuning could not reproduce it, per D3GraphCanvas's own header comment. This is a deliberate two-backend architecture traded for visual fidelity, not a migration-in-progress.

## Implementation Details

`buildGraph()` produces a deterministic hierarchical seed graph, on top of which `forceLayout.assign()` runs a constrained "polish pass" (`repulsion:5, attraction:0.001, gravity:0.0, maxIterations:100`). An in-code comment explicitly narrates a prior, unconstrained tuning attempt ("the tenth iteration") that collapsed the connected component into a tight ball at the centroid — the direct motivation for D3GraphCanvas's existence as a parallel implementation.

`TestHookExposer` mounts inside `SigmaContainer` purely to assign `window.__viewerSigma` when `import.<COMPANY_NAME_REDACTED>.env.MODE !== 'production'`, letting Playwright assert on sigma's internal graph state via `page.evaluate(() => window.__viewerSigma?.getGraph()?.order)` without threading test IDs through every node. This is a runtime branch rather than a build-time strip, trading a small amount of production-bundle discipline for external testability.

The `SigmaContainer` settings object is a single large, order-sensitive composition (label density, node-program dispatch, size ratio) carrying a defensive comment about a prior regression: adding `zoomToSizeRatioFunction` reportedly caused TypeScript to silently drop `nodeProgramClasses` at runtime, crashing the canvas with "could not find a suitable program for node type circle." The fix was rollback rather than a type-level guard, so this fragility class currently has no test coverage and relies solely on the comment as a tripwire.

Event handling is delegated to `makeEventHandlers` (a factory closing over the graph and relations) rather than defined inline, decoupling click/hover logic from React's render cycle — consistent with sibling **GraphEventHandlers**, whose closest concrete artifact is this same `makeEventHandlers` call site.

## Integration Points

SigmaCanvas shares `useGraphData.ts` as its sole data-fetching dependency with D3GraphCanvas — the two renderers consume one common data layer but diverge entirely on graph construction, layout, and reducer/event code; no layout or reducer logic is shared between them. Other imports observed include `ApiClient` (`ApiClient.ts`), `IconButton` (`IconButton.tsx`), `TooltipProvider` (`unified-viewer/src/components/ui/tooltip.tsx`), `System` (`system-endpoints.ts`), and `classColor` (`color-fallback.ts`), indicating SigmaCanvas also integrates UI chrome and ontology/system data alongside pure graph rendering.

## Usage Guidelines

Any change to seed-layout logic in `graph-builder.ts` risks re-triggering the "destroys cluster structure" failure mode documented in SigmaCanvas's comments — such changes should be validated against the polish-pass constraints (`repulsion:5, attraction:0.001, gravity:0.0`). Developers must preserve the effect dependency segregation: hover/selection state changes belong exclusively in the `[hoveredNode, setSettings]` effect, never added to the main rebuild effect's dependency list, or Contract #3 (no simulation restart on click) breaks silently. The `SigmaContainer` settings object should be modified cautiously and incrementally, given its documented history of TypeScript silently dropping sibling keys (`nodeProgramClasses`) — any addition should be manually verified at runtime rather than trusted to the type system. `TestHookExposer`'s `window.__viewerSigma` hook should be treated as test-only infrastructure gated on `import.<COMPANY_NAME_REDACTED>.env.MODE`, not a general debugging API. Finally, since D3GraphCanvas exists purely to satisfy visual-fidelity requirements sigma couldn't meet, this is not a candidate for consolidation — the two renderers are intentionally maintained as independent siblings under UnifiedGraphViewerRendering, alongside **GraphDensityBudgetGate**, whose exact relationship to SigmaCanvas's density budget concerns was not resolvable from the retrieved files.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- SigmaCanvas (function) in SigmaCanvas.tsx
- SigmaCanvasProps (class) in SigmaCanvas.tsx

**Relationships:**
- Imports: ApiClient.ts, ApiClient, IconButton.tsx, IconButton, unified-viewer/src/components/ui/tooltip.tsx, TooltipProvider, system-endpoints.ts, System, color-fallback.ts, classColor (+10 more)
- The code graph confirms SigmaCanvas.tsx imports buildGraph from graph-builder.ts, makeEventHandlers from graph/events.ts, and makeEdgeReducer/makeNodeReducer/setReducedMotion/SHAPE_NODE_PROGRAMS from reducers.ts — a four-way decomposition (data building, event wiring, visual reduction, shape dispatch) that keeps GraphSetup itself as an orchestrator rather than an implementation. useGraphData.ts is the sole data-fetching import, matching D3GraphCanvas.tsx's identical dependency on the same hook — the two renderer backends consume one shared data layer but diverge entirely on graph construction and layout.

**Other:**
- SigmaCanvas.tsx (module) in SigmaCanvas.tsx
- SigmaCanvas.test.tsx (module) in SigmaCanvas.test.tsx


## Hierarchy Context

### Parent
- [UnifiedGraphViewerRendering](./UnifiedGraphViewerRendering.md) -- [LLM] The unified-viewer package implements graph rendering through two parallel, independently-maintained components rather than one: SigmaCanvas.tsx (WebGL via @react-sigma/core, ForceAtlas2-adjacent graphology-layout-force) and D3GraphCanvas.tsx (SVG via d3.forceSimulation). D3GraphCanvas's header comment states it is a direct port of memory-visualizer's GraphVisualization.tsx because 'every attempt to reproduce VKB's force-directed look with sigma + graphology-layout-* drifted further from the reference' — i.e. the SVG renderer exists specifically because the WebGL renderer could not visually match a prior tool's d3.forceLink(150)/d3.forceManyBody(-500) look. This is a deliberate two-backend architecture traded for a fidelity requirement, not a migration-in-progress.

### Siblings
- [D3GraphCanvas](./D3GraphCanvas.md) -- [CGR] D3GraphCanvas (function) in D3GraphCanvas.tsx
- [GraphEventHandlers](./GraphEventHandlers.md) -- [LLM] The code files supplied do not contain a component, file, class, or function named "GraphEventHandlers" anywhere. The closest artifact is `makeEventHandlers` in SigmaCanvas.tsx:145-152, which is imported from a sibling module `./events` (i.e. presumably `integrations/unified-viewer/src/graph/events.ts`) but whose implementation is never shown — only its call site inside `GraphSetup`'s data-load `useEffect`. Everything below is therefore inferred from that call site plus the parent observations, not from reading the handler module itself.
- [GraphDensityBudgetGate](./GraphDensityBudgetGate.md) -- [LLM] No code in the supplied files implements or is named 'GraphDensityBudgetGate'. The closest artifact — integrations/unified-viewer/scripts/assert-graph-density.ts — is a standalone CLI health-check script, not a component class, hook, or React module named GraphDensityBudgetGate. Its own header explicitly documents a rename history ('this file used to be called assert-aggregated-node-budget.ts') that never produced a name resembling 'GraphDensityBudgetGate', suggesting the requested entity is either a higher-level wrapper (e.g. a health-check registration, a dashboard-side gate consumer, or a CI job definition) that was not retrieved, or a name coined at the knowledge-graph/documentation layer to describe this script's function rather than a literal identifier in the codebase.


---

*Generated from 14 observations*

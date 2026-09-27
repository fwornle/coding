# SigmaNodeShapeDispatch

**Type:** Detail

## What It Is

SigmaNodeShapeDispatch refers to the mechanism, wired in `integrations/unified-viewer/src/graph/SigmaCanvas.tsx`, by which sigma.js selects a WebGL draw program for each node based on a `type` field carried in the node reducer output. The concrete wiring is a settings block passed to `<SigmaContainer>`: `nodeProgramClasses: SHAPE_NODE_PROGRAMS` and `defaultNodeType: 'circle'`, annotated with a comment referencing "Plan 55-05 (UI-SPEC §14): per-shape node-program dispatch." However, the actual dispatch table (`SHAPE_NODE_PROGRAMS`) and any per-shape branching logic live in `./reducers`, a module imported into SigmaCanvas.tsx (alongside `makeEdgeReducer`, `makeNodeReducer`, `setReducedMotion`) but not present in the supplied files. As such, this component as observed is primarily a wiring/config surface inside its parent, SigmaGraphRenderer, rather than a fully self-contained module.

## Architecture and Design

The intended architecture is a strategy/dispatch-table pattern: a shape string is mapped to a corresponding sigma draw program, letting sigma "dispatch each draw to the right program" per node. In its current (V1) state this pattern is degenerate — an explicit comment states "V1 has all 5 shapes mapped to NodeCircleProgram," meaning every shape resolves to the same circle-rendering implementation rather than distinct diamond/square/triangle/hexagon programs. The comment frames `SHAPE_NODE_PROGRAMS` as "the upgrade path" for later differentiation, indicating the dispatch table exists more as a placeholder/extension point than a working multi-shape system today.

This dispatch design depends on a producer/consumer separation: `graph-builder` (imported as `buildGraph` in SigmaCanvas.tsx) stamps a `shape` attribute onto nodes, which is then consumed downstream as the `type` field read by sigma's `nodeProgramClasses`. Neither `graph-builder.ts` nor `reducers.ts` is included in the supplied files, so this producer/consumer relationship is inferred entirely from comments rather than directly observed code.

Architecturally, this sits alongside a parallel, independent shape-rendering system used by the sibling renderer: `D3GraphCanvas.tsx` imports `renderNodeShape` from `./node-shapes` for SVG-based shape drawing. The two systems are not shared — sigma's WebGL model requires precompiled GPU draw programs selected via a dispatch table, whereas D3 can render arbitrary SVG shapes directly in `node-shapes`. This reflects a broader pattern in the graph module: each renderer backend (SigmaGraphRenderer for WebGL, D3GraphCanvas for SVG) owns its own shape strategy rather than sharing one abstraction.

## Implementation Details

The concrete implementation surface visible in the supplied code is narrow: the settings object literal in SigmaCanvas.tsx containing `nodeProgramClasses` and `defaultNodeType`, passed to `<SigmaContainer>`. This settings object is type-checked as a single unit by @react-sigma, which has architectural consequences described below. The actual per-shape logic — how `SHAPE_NODE_PROGRAMS` maps shape keys to program classes, and how `makeNodeReducer` stamps the `type` field onto reducer output — is delegated to `./reducers`, not shown here.

The upstream data flow begins with `buildGraph` from `graph-builder`, which presumably stamps a `shape` attribute onto each node at graph-construction time; this attribute is expected to propagate through to the reducer's `type` output that sigma reads at draw time. Because none of `graph-builder.ts` or `reducers.ts` is available, the actual transformation logic (shape string → program-table key → sigma `type`) is inferred, not confirmed.

No test coverage exists for this dispatch logic in the supplied file set — the only test file, `attribution.test.ts`, covers unrelated graph-hierarchy/parent-attribution concerns. There is no `reducers.test.ts` or `node-shapes.test.ts` verifying shape-to-program correctness.

## Integration Points

This entity is a subcomponent of SigmaGraphRenderer (most plausibly the SigmaCanvas.tsx / GraphSetup implementation), which builds a graphology `Graph` from `useGraphData()`, runs `graphology-layout-force` as a layout-polish pass over `graph-builder`'s hierarchical seed positions (notably, per sibling ForceAtlas2LayoutPass's findings, sigma's ForceAtlas2 was tried and explicitly rejected — "FA2 collapsed the connected component into a tight ball at the centroid" — in favor of `graphology-layout-force`), and wires interaction handlers via `makeEventHandlers()`. The shape-dispatch mechanism is one piece of this larger rendering pipeline, sitting between graph-builder's attribute-stamping and sigma's rendering settings.

The dispatch table also intersects with the fragility of the `<SigmaContainer>` settings prop: a documented incident shows that adding an unrelated key, `zoomToSizeRatioFunction`, silently broke the type-check on the settings object and crashed the canvas with "could not find a suitable program for node type circle." This demonstrates that `nodeProgramClasses`/`defaultNodeType` are not isolated — they are typed together with all other settings fields as one object, so any additive, seemingly unrelated key change risks invalidating the whole prop for @react-sigma.

No direct dependency exists between SigmaNodeShapeDispatch and its siblings ClientSideNeighborExpand or HierarchyAncestryTrace; those operate on different concerns (double-click neighbor expansion via `handlers.handleDoubleClickNode` and `makeEventHandlers` from `./events`; ancestry computation via `deriveAncestryFromStorePath` and `computeAncestryPath` in `./ancestry`) within the same graph module directory.

## Usage Guidelines

Developers extending shape dispatch should treat `SHAPE_NODE_PROGRAMS` in `./reducers` as the real point of extension, not SigmaCanvas.tsx itself, which merely wires the table into sigma's settings. Since V1 collapses all shapes to `NodeCircleProgram`, adding true visual differentiation (diamond/square/triangle/hexagon) requires implementing new sigma draw programs and registering them in that table — the "upgrade path" the code comments describe.

Any change to the `<SigmaContainer>` settings object should be made cautiously: because @react-sigma type-checks settings as a single object, adding new fields (as the `zoomToSizeRatioFunction` incident shows) can silently break `nodeProgramClasses` and crash rendering with cryptic errors like "could not find a suitable program for node type circle." Test any settings-object changes against actual rendering, since no automated test currently guards this behavior.

Finally, since D3GraphCanvas maintains a wholly separate SVG shape-rendering path via `node-shapes`, any new shape type added to graph-builder's `shape` attribute vocabulary must be independently supported in both systems — there is no shared shape-rendering abstraction between the WebGL (SigmaGraphRenderer) and SVG (D3GraphCanvas) renderers.


## Hierarchy Context

### Parent
- [SigmaGraphRenderer](./SigmaGraphRenderer.md) -- [LLM] SigmaCanvas.tsx implements the actual WebGL graph renderer via <SigmaContainer> and a nested GraphSetup component that builds a graphology Graph from useGraphData() output, runs graphology-layout-force as a polish pass over graph-builder's hierarchical seed positions, and wires click/hover events through makeEventHandlers(). This is the component most plausibly referred to as 'SigmaGraphRenderer' in the parent context, though no file in the supplied set literally bears that name.

### Siblings
- [ForceAtlas2LayoutPass](./ForceAtlas2LayoutPass.md) -- [LLM] No component, file, class, or function named 'ForceAtlas2LayoutPass' appears anywhere in the supplied code. The closest match is the layout-polish logic inside SigmaCanvas.tsx's GraphSetup component, which explicitly does NOT use sigma's ForceAtlas2 algorithm. A code comment (SigmaCanvas.tsx, 'eighth iteration') states that ForceAtlas2 was tried and rejected: 'FA2 collapsed the connected component into a tight ball at the centroid no matter how we tuned it,' after which the implementation switched to `graphology-layout-force` (`forceLayout.assign(graph, {...})`) as 'the closest in-ecosystem port' of VKB's d3.forceSimulation behavior. This is the opposite of a ForceAtlas2 pass — it's a documented abandonment of ForceAtlas2 in favor of a different force library.
- [ClientSideNeighborExpand](./ClientSideNeighborExpand.md) -- [LLM] The strongest textual anchor for 'ClientSideNeighborExpand' in the supplied files is the `doubleClickNode` handler wired inside SigmaCanvas.tsx's `GraphSetup` effect: `doubleClickNode: ({ node }) => { void handlers.handleDoubleClickNode(node) }`, fed by `getLoadedRelations: () => relations`. The inline comment directly above this call states the intent explicitly: 'The double-click expand's only source, for every backend. It used to be the okb branch's workaround for OKM having no neighbors endpoint, while coding was believed to fetch one; no backend mounts that route, so this is now the single path.' That sentence is describing exactly the concept a component named ClientSideNeighborExpand would implement — expanding a node's neighbors from data already resident in the browser rather than issuing a server call — but the expansion logic itself (the code that filters `relations` for edges touching the clicked node and mutates the graphology `Graph`) is not present in SigmaCanvas.tsx; it is delegated to `makeEventHandlers` from `./events`, a module not included in the supplied files.
- [HierarchyAncestryTrace](./HierarchyAncestryTrace.md) -- [LLM] No file or function literally named 'HierarchyAncestryTrace' appears anywhere in the supplied code, and the <code_graph> block supplied for this analysis is empty (no nodes/edges). The nearest concrete artifact is `deriveAncestryFromStorePath` in integrations/unified-viewer/src/graph/D3GraphCanvas.tsx, which is itself a thin reconciliation wrapper around `computeAncestryPath` — a function imported from './ancestry' (integrations/unified-viewer/src/graph/ancestry.ts) whose actual body is not part of the supplied file set. This means the true ancestry-computation logic (the BFS itself) is invisible here; only its consumer is visible.


---

*Generated from 9 observations*

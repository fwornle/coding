# MultiAgentGraphSvg

**Type:** Detail

# MultiAgentGraphSvg — Technical Insight Document

## What It Is

`MultiAgentGraphSvg` refers to the static SVG rendering pipeline implemented in `integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx`, exported as the `MultiAgentGraph` component. It renders the UKB workflow as a fixed-topology pipeline diagram across 11 agents (kg_operators through persistence), driven by module-scope constants — `WAVE_AGENTS`, `KG_OPERATOR_CHILDREN`, and `MULTI_AGENT_EDGES` (the latter imported from `./constants`) — plus a large hard-coded schema, `AGENT_SUBSTEPS`, that describes each agent's internal steps and their `llmUsage` tiers (`'none'|'fast'|'standard'|'premium'`). As a child of the broader `GraphVisualRendering` surface, it represents one of two entirely independent graph renderers in the codebase, the other being the force-directed `D3GraphCanvas.tsx` for the knowledge graph itself.

## Architecture and Design

The component's defining architectural trait is that it is a **hand-authored, static process diagram** rather than a data-driven layout. Where its sibling `ForceDirectedLayout` (`D3GraphCanvas.tsx`) computes positions dynamically via `d3.forceSimulation`, `MultiAgentGraph` encodes topology directly as TypeScript data structures at module scope. This static/dynamic split is described in the parent `GraphVisualRendering` context as a consequence of genuinely different problem domains (fixed pipeline vs. open-ended knowledge graph), not accidental duplication — but it comes at the cost of zero shared rendering abstraction between the two.

A load-bearing performance decision is embedded directly in the code: `WAVE_AGENTS` and `KG_OPERATOR_CHILDREN` are deliberately hoisted to module scope, with an inline comment documenting a prior incident where declaring them inside the component caused rebuild-per-render behavior that "would have defeated" a downstream status `useMemo` entirely. This is a case of a memoization-defeating bug fixed via code convention rather than lint enforcement — meaning the fix is invisible to anyone who doesn't read that specific comment, and a well-intentioned "inline for locality" refactor could silently regress it.

Color handling follows a **centralized resolver pattern**: `useWorkflowColors()` (from `@/lib/colors`) is used explicitly so the SVG can recolor in dark mode without per-hue `.dark .fill-*` CSS overrides. This mirrors — but shares no code with — the sibling `ClassColorFallback` mechanism (`nodeFillColor`/`nodeShapeFor`/`classColor()` in `color-fallback.ts`), which independently arrived at the same "single resolver, walk to determine color" architecture after its own three-way drift across D3 canvas, Sigma's buildGraph, and LegendPanel. Both systems solve theme-aware SVG coloring, but using unrelated models — a hook returning a palette object here versus a parent-walking hex resolver over a `ClassRegistryEntry` map there.

## Implementation Details

`AGENT_SUBSTEPS` is a ~230-line `Record<string, SubStep[]>` acting as a UI-side shadow schema of the backend workflow's internal step composition. Unlike `batchPhaseSteps`/`batchPhaseStepCount` in `ukbSlice.ts`, which are explicitly commented as "Derived from workflow YAML," nothing marks `AGENT_SUBSTEPS` as generated or validated against any backend source. Any backend change to an agent's substep list requires a matching hand-edit here, with no compiler or runtime check to detect drift.

The component consumes Redux state tightly coupled to `ukbSlice.ts` selectors (`selectExecutionStepStatuses`, `selectLLMState`, `selectWorkflowState`), alongside a derived-types layer (`@/shared/workflow-types/derived`, `@/shared/workflow-types/schemas`). This is structurally distinct from `D3GraphCanvas.tsx`'s Zustand-based `useViewerStore` coupling (consolidated via `useGraphVisibility`), reinforcing that the two renderers not only differ in layout strategy but in their entire state-management substrate.

`MultiAgentGraph` is consumed by `ukb-workflow-modal.tsx` under the alias `UKBWorkflowGraph`, imported alongside `AGENT_SUBSTEPS`, `WorkflowLegend`, `TraceModal`, `TIER_COLORS`, `TIER_MODELS`, and `useWorkflowDefinitions` from `./workflow`. Notably, that modal also houses non-rendering ETA-estimation logic (`calculateDynamicEta`, `getStepMedianDuration`, `calculateMedian`) directly alongside the graph import, purely because both consume the same Redux-derived `UKBProcess`/`WorkflowTimingStats` state — an instance of the broader codebase pattern of colocating business logic with its consuming visualization rather than extracting it into hooks.

## Integration Points

`MultiAgentGraphSvg` sits under `GraphVisualRendering` alongside `D3GraphCanvas.tsx`, `ClassColorFallback`, `HierarchyParentDerivation`, and `ForceDirectedLayout` — all part of the same conceptual "graph rendering" surface despite sharing no code. Its primary integration is with the Redux store (`ukbSlice.ts`) for workflow execution status and timing stats, and with `ukb-workflow-modal.tsx` as its principal consumer. Its color logic integrates with `@/lib/colors`'s `useWorkflowColors()`, a dependency point entirely separate from the `color-fallback.ts` resolver used by the unified-viewer side of the system.

## Usage Guidelines

Developers modifying agent workflows on the backend must remember to manually update `AGENT_SUBSTEPS` in `multi-agent-graph.tsx` — there is no automated check tying it to the backend workflow definition, unlike the explicitly-labeled derived state in `ukbSlice.ts`. When editing `multi-agent-graph.tsx`, `WAVE_AGENTS` and `KG_OPERATOR_CHILDREN` must remain at module scope; moving them inline "for locality" will silently reintroduce a memoization-defeating render bug. Any dark-mode or palette adjustment affecting this component must be manually mirrored in `color-fallback.ts` for the unified-viewer, since the two color systems are unrelated in implementation despite solving the same problem — there is currently no shared abstraction to update once and propagate.


## Hierarchy Context

### Parent
- [GraphVisualRendering](./GraphVisualRendering.md) -- [LLM] The GraphVisualRendering surface is split across two independently-evolved implementations that never share code: `integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx` renders the UKB workflow pipeline as a fixed-topology SVG (`WAVE_AGENTS`, `KG_OPERATOR_CHILDREN`, `MULTI_AGENT_EDGES` from `./constants`), while `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` renders the knowledge graph itself as a force-directed D3 simulation (`d3.forceSimulation` + `d3.forceLink(150)` + `d3.forceManyBody(-500)`). The former is a static, hand-authored process diagram; the latter is a dynamic layout engine over live entity/relation data pulled through `useGraphData`. They happen to share the word 'graph' and the general shape of node/edge rendering, but there is no common rendering abstraction, color resolver, or type between them — any visual-consistency fix (e.g. dark-mode palette) has to be applied twice.

### Siblings
- [ForceDirectedLayout](./ForceDirectedLayout.md) -- [LLM] D3GraphCanvas.tsx is documented as a deliberate 'port' of an earlier VKB component (integrations/memory-visualizer/.../GraphVisualization.tsx), preserving d3.forceSimulation + d3.forceLink(150) + d3.forceManyBody(-500) verbatim because prior attempts to reproduce the same look with sigma + graphology-layout drifted from the reference. This means the force-directed layout parameters here are not independently tuned for the unified-viewer's actual data shape — they are pinned to match a visual reference from a different codebase, which could make them brittle if unified-viewer's graphs grow substantially larger or denser than VKB's.
- [ClassColorFallback](./ClassColorFallback.md) -- [LLM] `classColor()` in `integrations/unified-viewer/src/graph/color-fallback.ts` implements a two-palette dispatch keyed on a boolean derived from `isOnlineLearned({ metadata: { source } })` (imported from `./learning-source`), choosing between `BATCH_PALETTE` (teal/blue hierarchy shades: Project #00897b, Component #1565c0, SubComponent #42a5f5, Detail #90caf9, System #00695c) and `ONLINE_PALETTE` (red/pink equivalents). The inline comment explicitly documents a prior bug class: the pre-2026-06-28 code checked `source === 'auto'` literally, which under-matched because 'the data stamps ETM/consolidator output as "online" far more often than "auto"', silently misclassifying most online-learned nodes into the wrong palette. This is a concrete example of a semantic classifier (`isOnlineLearned`) being extracted specifically to eliminate string-literal drift across call sites.
- [HierarchyParentDerivation](./HierarchyParentDerivation.md) -- [LLM] The component's parent context describes a bifurcated rendering architecture where `multi-agent-graph.tsx` is a static, hand-authored SVG diagram driven by module-scope constants (`WAVE_AGENTS`, `KG_OPERATOR_CHILDREN`, `AGENT_SUBSTEPS`), while `D3GraphCanvas.tsx` is a dynamic force-directed simulation over live data (`useGraphData`, `d3.forceSimulation`). This is not an accidental duplication but a consequence of genuinely different problem domains — a fixed pipeline topology vs. an open-ended knowledge graph — yet the total absence of a shared rendering abstraction (no common node/edge type, no shared color resolver) means visual-consistency work like dark-mode theming must be independently re-solved in each: `useWorkflowColors()` in one, `nodeFillColor`/`nodeShapeFor` in `color-fallback.ts` in the other.


---

*Generated from 9 observations*

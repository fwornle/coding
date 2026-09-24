# D3ForceGraphCanvas

**Type:** Detail

## What It Is

D3ForceGraphCanvas is implemented at `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, within the UnifiedViewerGraphRendering subsystem. It is explicitly a deliberate port of memory-visualizer's `GraphVisualization.tsx`, retaining `d3.forceSimulation` with `forceLink(150)` and `forceManyBody(-500)` verbatim. The inline documentation is unusually candid about why: prior attempts to reproduce the force-directed look using sigma + graphology-layout-* "drifted further from the reference," so the component intentionally sacrifices architectural uniformity with the sigma-based canvas elsewhere in the viewer in favor of visual parity with a known-good reference implementation.

## Architecture and Design

The component sits alongside an implied sigma-based canvas within the same unified viewer, producing a mixed-rendering-backend architecture. This is a conscious trade-off: rather than unifying on one rendering technology, the team accepted duplicated rendering logic to preserve a specific visual/behavioral reference. Selection state (`selectedNodeIds`, `focalNodeId`, `pathToSelected`, `selectionSource`) is centralized in `useViewerStore` (Zustand), acting as the single source of truth consumed by both backends — this is what allows D3ForceGraphCanvas to coexist with its sigma sibling without diverging state models.

A key architectural discipline is effect-boundary isolation. The `selectionSource` store subscription (Plan 06, Decision 2) was reintroduced narrowly to drive a fit-to-bounds `useEffect` for Layer 0 → Layer 1 transitions, but is explicitly kept out of the main SVG-rebuilding effect's dependency list to preserve "Locked Contract #3" (clicks must not restart the force simulation). This shows the codebase treats certain invariants as audited contracts that new features must route around rather than through.

The component also embodies store-derived reconciliation via `deriveAncestryFromStorePath`, which follows a fast-path/slow-path pattern: compute ancestry locally via BFS, and only fall back to pruning/repair logic against the store's authoritative `pathToSelected` set when they disagree.

## Implementation Details

`deriveAncestryFromStorePath` runs `computeAncestryPath` (an inline BFS, since extracted into shared module `ancestry.ts` for reuse by `LslTimelineStrip`) and compares the resulting `nodeDepths` set against the store's `pathToSelected` membership. If they match exactly, it returns the fast-path result unchanged. Otherwise, it prunes the BFS output to the store's authoritative set, forces store-only orphan nodes to render at `maxDepth` instead of dropping them, and discards edges whose endpoints aren't both in the store's set — implementing a "writer's intent wins" contract from a referenced state-flow audit (b29bdb34c).

Type definitions `D3Node`/`D3Link` separate `ontologyClass` (drives fill color, matched against legend/registry) from `entityType` (raw type, which can disagree — e.g., CollectiveKnowledge has `ontologyClass=Detail` but `entityType=System`). This decouples visual classification from underlying data typing so the legend stays consistent even when source data is inconsistent.

Historically, a centering/pan-zoom effect (Phase 56-04) was implemented and then retracted after operator feedback favored a static "red circle" selection ring plus ancestry trace over auto-panning — evidence of iterative, feedback-driven refinement rather than upfront design.

## Integration Points

D3ForceGraphCanvas depends on `deriveParents` (in the sibling HierarchyNavigatorDerivation module) for DAG-to-tree reduction, tested independently in `hierarchy-parents.test.ts`. That tie-break chain — `metadata.parentId` over containment edges, then level-adjacency, then edge-type rank, then parent name — determines the tree shape consumed for hierarchy rendering, with cycle-breaking guarantees preventing infinite walk-up-to-root loops. Notably, Insight only became a recognized `HIERARCHY_CLASSES` member at Detail level as of 2026-09-21; before that, `deriveParents` emitted no parent for any of the 975 Insights in the live graph, a structural blind spot now fixed.

The shared `ancestry.ts` module (extracted from this component) is also reused by `LslTimelineStrip`, showing cross-component consolidation. Selection state flows through `useViewerStore`, the shared contract with the sigma-based canvas sibling. Unlike IntentSpineRendering, which models an Intent-specific spine (`aggregates`→Insight) absent from `HIERARCHY_CLASSES`, D3ForceGraphCanvas consumes the general-purpose Hierarchy Navigator's ontology-class hierarchy (System, Project, Component, SubComponent, Detail, Insight).

## Usage Guidelines

Developers must not add dependencies to the main SVG-rebuilding effect that would restart the force simulation on selection changes — this is a "Locked Contract" and any new selection-driven behavior (like fit-to-bounds) must be wired through separate, narrowly-scoped effects. When reconciling local ancestry computation with store state, prefer the "writer's intent wins" pattern already implemented in `deriveAncestryFromStorePath` rather than re-deriving ancestry ad hoc. Any hierarchy-dependent rendering should be validated against `hierarchy-parents.test.ts`'s tie-break and cycle-breaking specification, especially when adding new ontology classes to `HIERARCHY_CLASSES` (as the Insight-at-Detail-level gap demonstrated, omissions here silently break parent derivation for entire entity classes). Finally, resist the urge to unify D3ForceGraphCanvas with the sigma-based canvas purely for architectural tidiness — the mixed-backend approach is a deliberate, documented trade-off for visual fidelity, not an oversight.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- deriveAncestryFromStorePath implements a two-path reconciliation: it first runs computeAncestryPath as an inline BFS, and if the resulting nodeDepths set exactly matches the store's pathToSelected membership, returns it as-is ('fast path'). Otherwise it prunes the BFS result to the store's authoritative set, forcing store-only orphan nodes to render at maxDepth rather than dropping them, and drops edges whose endpoints aren't both in the store's set — implementing a 'writer's intent wins' contract from the referenced state-flow audit b29bdb34c.
- hierarchy-parents.test.ts encodes deriveParents' tie-break chain in explicit test cases: 'prefers the parent exactly one level up over a same-level container' and 'level adjacency beats edge rank' show adjacency dominates edge-type rank (parent-child > contains > includes), which in turn dominates parent name ordering, and metadata.parentId outranks any containment edge (see 'metadata.parentId outranks a containment edge' and 'metadata.parentId places an Insight that has no containment edge'). Cycle-breaking tests for 2-node and 3-node cycles assert the parent map never permits a walk-up-to-root loop, directly protecting whatever hierarchy-rendering consumer walks parents to build a tree.
- The test suite documents that Insight only became a recognized HIERARCHY_CLASSES member at Detail level on 2026-09-21 ('Insight joined the hierarchy on 2026-09-21... deriveParents emitted no parent for any of the 975 Insights in the live graph'), directly corroborating the parent-context observation that Insight-typed entities were a structural blind spot in the graph-rendering hierarchy layer prior to that fix.


## Hierarchy Context

### Parent
- [UnifiedViewerGraphRendering](./UnifiedViewerGraphRendering.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record establishes drill-down from an intent-level entity to underlying code files, surfaced directly in the detail panel

### Siblings
- [HierarchyNavigatorDerivation](./HierarchyNavigatorDerivation.md) -- [LLM] hierarchy-parents.test.ts is the executable specification for `deriveParents`, `HIERARCHY_CLASSES`, and `HIERARCHY_LEVEL` — the actual DAG→tree reduction module (`./hierarchy-parents`) is not included among the supplied code files, only its test suite. The suite pins down a strict, multi-stage tie-break: `metadata.parentId` (if it names a known, non-self id) outranks any containment edge outright ('metadata.parentId outranks a containment edge', 'metadata.parentId places an Insight that has no containment edge'); absent that, candidates are filtered to containment edge types (`parent-child`/`contains`/`includes` — the test 'non-containment edge types are not parent edges' explicitly excludes `related_to`/`has_insight`/`mentions`); then level-adjacency (exactly one HIERARCHY_LEVEL step up) beats edge-type rank, which beats parent name as a final deterministic tie-break ('final tie-break is parent name, so the result is stable across edge order').
- [IntentSpineRendering](./IntentSpineRendering.md) -- [LLM] None of the supplied code files implement or reference an entity named 'IntentSpineRendering'. The closest candidate, `integrations/unified-viewer/src/graph/hierarchy-parents.test.ts`, defines `deriveParents`/`HIERARCHY_CLASSES`/`HIERARCHY_LEVEL` for a DAG→tree reduction over ontology classes (System, Project, Component, SubComponent, Detail, Insight) — this is a general Hierarchy Navigator, not the Intent-specific spine (Intent →`aggregates`→ Insight) described in the parent's session record. The parent context's own tree describes intents and aggregated insights, a taxonomy-driven structure that appears nowhere in `hierarchy-parents.test.ts`'s HIERARCHY_CLASSES set (which lists Insight but never Intent).


---

*Generated from 10 observations*

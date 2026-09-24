# HierarchyNavigatorDerivation

**Type:** Detail

## What It Is

HierarchyNavigatorDerivation refers to the reduction logic behind the Hierarchy Navigator in the Unified Viewer, whose contract is defined by `integrations/unified-viewer/src/graph/hierarchy-parents.test.ts`. Critically, the implementation module itself (`hierarchy-parents.ts`, exporting `deriveParents`, `HIERARCHY_CLASSES`, and `HIERARCHY_LEVEL`) is **not present** in the supplied files — only its executable test specification is observed. This document therefore describes the component as inferred from its test contract, not from direct implementation inspection. As part of UnifiedViewerGraphRendering, it sits alongside siblings IntentSpineRendering and D3ForceGraphCanvas, but is distinct from both: it is not the Intent-specific spine (which siblings' observations note operates over a separate Intent→Insight taxonomy absent from `HIERARCHY_CLASSES`), and it is not the D3-based rendering surface itself.

## Architecture and Design

The core design is a pure reducer: `deriveParents` takes `(Entity[], Relation[])` and produces a single parent-per-node map, with no dependency on live store state, React tree structure, or any specific renderer (D3/SVG or Sigma-based). This presentation-agnostic contract means the same derivation could theoretically feed multiple canvases identically, though the tests give no evidence of which renderer actually invokes it.

The reduction resolves a DAG (arbitrary containment/relation edges) down to a tree via a strict, prioritized tie-break chain: `metadata.parentId` (if valid and non-self) overrides everything; failing that, edges are filtered to containment types (`parent-child`, `contains`, `includes`), explicitly excluding relational types like `related_to`, `has_insight`, `mentions`; among remaining candidates, level-adjacency (exactly one `HIERARCHY_LEVEL` step) outranks edge-type rank, which outranks final tie-break by parent name for determinism regardless of edge ordering.

A second design pillar is defensive cycle-breaking: because input edges are not guaranteed to form a DAG, `deriveParents` must guarantee an acyclic output even from malformed or attacker-adjacent graphs (e.g., mis-anchored containment edges noted at the parent level). Tests explicitly construct two- and multi-node cycles and assert both bounded `parents.size` and non-repeating traversal via a `seen` set during walk-up-to-root.

## Implementation Details

Entities in the test fixtures carry only `id`, `name`, `ontologyClass`, and optional `metadata.parentId` — a minimal shape sufficient for the reduction logic. `HIERARCHY_CLASSES` enumerates the ontology classes eligible for tree membership (System, Project, Component, SubComponent, Detail, Insight), and `HIERARCHY_LEVEL` assigns each a depth. Notably, `HIERARCHY_LEVEL.Insight === HIERARCHY_LEVEL.Detail`, meaning Insight nodes are interleaved at the same tree depth as Detail-typed entities like this one — a modeling decision with no dedicated test covering downstream rendering/ordering consequences.

The test suite also documents a historical regression: Insight was missing from `HIERARCHY_CLASSES` until being added, during which all 975 Insight entities in the live graph were silently parent-less and invisible in the rendered tree despite existing as graph nodes. This illustrates a tight, easily-violated coupling — membership in `HIERARCHY_CLASSES`/`HIERARCHY_LEVEL` is the sole gate for a class's visibility in the navigator, with no independent validation layer catching omissions.

## Integration Points

`deriveParents` is architecturally parallel to, but not integrated with, `deriveAncestryFromStorePath` in `D3GraphCanvas.tsx`. Both address the general problem of keeping a derived hierarchy consistent with a possibly-filtered edge set, and both handle "authoritative-but-locally-unreachable" nodes by forcing them to a sentinel position (dimmest/deepest slot) rather than dropping them — but they solve this independently, without shared code. `deriveAncestryFromStorePath` additionally reconciles a fast-path BFS (`computeAncestryPath`) against the Zustand store's `pathToSelected` set for single-node ancestry tracing with a depth gradient, a renderer-coupled concern that `deriveParents` has no equivalent for, since it carries no store dependency at all.

Within its own hierarchy, HierarchyNavigatorDerivation is a child concern of UnifiedViewerGraphRendering, distinguishable from sibling D3ForceGraphCanvas (a deliberate visual port of memory-visualizer's `GraphVisualization.tsx`, force-simulation tuned via `forceLink(150)`/`forceManyBody(-500)`, explicitly prioritizing visual parity over sigma-based architectural consistency) and from IntentSpineRendering (a distinct Intent→Insight taxonomy not represented in `HIERARCHY_CLASSES`). Observations confirm that `ukbSlice.ts`, `ukb-workflow-modal.tsx`, and `config/knowledge-management.json` are unrelated retrieval noise with no actual link to this derivation layer.

## Usage Guidelines

Any change to `HIERARCHY_CLASSES` or `HIERARCHY_LEVEL` membership must be treated as a visibility-affecting change to the navigator UI — omitting a class silently removes its entire population from the tree, as the Insight regression demonstrated for 975 entities. When adding new ontology classes, verify their `HIERARCHY_LEVEL` placement doesn't unintentionally co-locate them with unrelated classes at the same depth (as currently occurs with Insight and Detail). Edge-type filtering must be kept in sync with the containment vs. relational distinction (`parent-child`/`contains`/`includes` vs. `related_to`/`has_insight`/`mentions`); adding new edge types requires deciding which bucket they belong to. Because the reducer must tolerate cyclic or malformed input, any refactor should preserve the visited-set-based termination guarantee rather than assuming upstream graph data is already a DAG. Finally, since this logic is duplicated in spirit (not code) by `deriveAncestryFromStorePath`, future work unifying hierarchy-derivation logic across the Unified Viewer should consider consolidating these two independently-evolved implementations rather than adding a third parallel variant.


## Hierarchy Context

### Parent
- [UnifiedViewerGraphRendering](./UnifiedViewerGraphRendering.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record establishes drill-down from an intent-level entity to underlying code files, surfaced directly in the detail panel

### Siblings
- [IntentSpineRendering](./IntentSpineRendering.md) -- [LLM] None of the supplied code files implement or reference an entity named 'IntentSpineRendering'. The closest candidate, `integrations/unified-viewer/src/graph/hierarchy-parents.test.ts`, defines `deriveParents`/`HIERARCHY_CLASSES`/`HIERARCHY_LEVEL` for a DAG→tree reduction over ontology classes (System, Project, Component, SubComponent, Detail, Insight) — this is a general Hierarchy Navigator, not the Intent-specific spine (Intent →`aggregates`→ Insight) described in the parent's session record. The parent context's own tree describes intents and aggregated insights, a taxonomy-driven structure that appears nowhere in `hierarchy-parents.test.ts`'s HIERARCHY_CLASSES set (which lists Insight but never Intent).
- [D3ForceGraphCanvas](./D3ForceGraphCanvas.md) -- [LLM] D3GraphCanvas.tsx explicitly frames itself as a deliberate port of memory-visualizer's GraphVisualization.tsx, keeping d3.forceSimulation with forceLink(150) and forceManyBody(-500) verbatim; the inline comment states 'every attempt to reproduce VKB's force-directed look with sigma + graphology-layout-* drifted further from the reference,' documenting visual parity being chosen over architectural consistency with a sigma-based canvas elsewhere in the viewer.


---

*Generated from 9 observations*

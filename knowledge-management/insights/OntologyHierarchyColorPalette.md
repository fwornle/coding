# OntologyHierarchyColorPalette

**Type:** Detail

# OntologyHierarchyColorPalette — Technical Insight Document

## What It Is

OntologyHierarchyColorPalette is implemented in `integrations/unified-viewer/src/graph/color-fallback.ts` and centers on a five-tier ontology hierarchy (System / Project / Component / SubComponent / Detail) rendered through two lookup tables: `BATCH_PALETTE` (teal-to-light-blue, lines 36-43) for batch/manual/migration-imported entities, and `ONLINE_PALETTE` (red-to-pink, lines 49-56) for entities where `isOnlineLearned()` evaluates true based on `metadata.source`. The palette is not a static per-class map alone — it is resolved dynamically via a parent-walk algorithm shared by `nodeFillColor()` and `nodeShapeFor()`, which traverses a `ClassRegistryEntry` registry to find the nearest styled ancestor when a class itself is unregistered. This is the sibling counterpart to HierarchyParentDerivation, which documents that identical walk mechanism in isolation; OntologyHierarchyColorPalette is effectively the data/table layer that HierarchyParentDerivation's algorithm operates against.

As a child concept under KmCoreAdapter, this palette consumes ontology class and registry data that ultimately originates from KmCoreAdapter's graph output, even though the parent notes this rendering layer is architecturally downstream and decoupled from the GraphifyGraph pipeline itself.

## Architecture and Design

The dominant pattern is chain-of-responsibility / parent-walk resolution: `nodeFillColor()` and `nodeShapeFor()` each check (1) the class's own `display.color`/`display.shape`, (2) the static palette table (`BATCH_PALETTE`/`SHAPE_PALETTE`), then (3) walk to `reg.parent` and repeat, guarded by a `seen` Set against cycles. This is paired with a strategy/lookup-table pattern — `BATCH_PALETTE`, `ONLINE_PALETTE`, and `SHAPE_PALETTE` are static `Record` tables selected via a discriminator (`isOnlineLearned()`) rather than per-class conditionals.

A key design decision, documented in a 2026-06-28 comment block, is the "Hybrid" split of provenance vs. hierarchy: fill color is driven purely by ontology-class hue (hierarchy tier), while online-learned provenance is expressed as a ring overlay (`ONLINE_RING_COLOR = '#f472b6'`) rather than swapping the entire palette. This overrides an earlier design still present as dead code — `classColor()` — which conflates hierarchy and provenance into one axis by branching fill color on `isOnlineLearned()` into `BATCH_PALETTE` or `ONLINE_PALETTE`. Both coexist in the file, an explicit "architectural inconsistency between live and legacy code" per the observations, with `classColor()` marked DEPRECATED but retained solely for tests pinning the hierarchy contract via `_classHue()`.

The single-source-of-truth consolidation pattern is also central: `nodeFillColor`/`nodeShapeFor` replace three previously-diverging implementations (D3 keyed off `entityType+source`, `buildGraph` keyed off `ontologyClass+registry`, and the legend using `classColor()`), which had produced visible drift such as "grey circles in the legend I don't see in the graph."

## Implementation Details

`nodeFillColor()` and `nodeShapeFor()` are structurally identical but operate over data-independent tables: fill color falls back through `BATCH_PALETTE` (five hierarchy tiers only), while shape falls back through `SHAPE_PALETTE` (16 classes, including hierarchy tiers plus typed-view/infrastructure classes like Observation, Digest, Insight, LearningArtifact, Pattern, Service, File, Feature, Contract, RuntimeDiagnostics, and Knowledge). Because these walks are independent, a class like 'Insight' resolves its shape directly ('diamond') from `SHAPE_PALETTE` but must walk up to a hierarchy ancestor to resolve fill color — meaning a node's shape and color are not guaranteed to reflect the same conceptual tier.

Terminal fallback is `DEFAULT_BATCH` (#94a3b8, slate) for color and `'circle'` for shape, but the deliberate design goal — called out as a fix for the "grey blob" problem — is that unregistered subclasses (e.g., 'LiveLoggingSystem') should inherit a styled ancestor's appearance rather than hit this default.

Two auxiliary helpers, `borderStyleFallback()` and `pulseRuleFallback()`, accept an intentionally unused `className`/`_className` parameter purely to give all three fallback helpers a uniform signature for their caller in graph-builder.ts. `borderStyleFallback` actually derives its answer from a `hasRelations` boolean computed live by the caller from the graphology Graph, making border style reflect "live filter state rather than a backend snapshot" — the same entity can render with a solid border in one filtered view and a dashed border (orphaned) in another.

## Integration Points

The sole render-path consumer is `D3GraphCanvas.tsx`, which constructs a `registryMap` (`ReadonlyMap<string, ClassRegistryEntry>`) from the `ontology` array returned by `useGraphData()` and passes it directly into `nodeFillColor`. This creates tight, deliberate coupling between D3GraphCanvas.tsx and the exact function signatures of `nodeFillColor`, `nodeShapeFor`, and `ClassRegistryEntry`. The same resolver is also shared with 'SigmaCanvas/buildGraph' and 'LegendPanel', which is the explicit fix for the three-way color-scheme divergence bug mentioned above.

Critically, the `D3Node.ontologyClass` field is explicitly distinct from `entityType` (example given: "CollectiveKnowledge: ontologyClass=Detail, entityType=System"), and the color/shape resolvers key strictly off `ontologyClass`. Any future code substituting `entityType` for `ontologyClass` in a lookup would silently mis-tier the rendered color.

Structurally, color-fallback.ts is decoupled from the ontology data model — palettes are hardcoded module-level constants, and the registry is only consulted as an override layer (`display.color`/`display.shape` take precedence). No dependency injection is used; the module exports pure functions, and callers like D3GraphCanvas thread in registry/theme state externally.

At a philosophical level, this palette is conceptually parallel to sibling normalization efforts elsewhere in the system, such as multi-agent-graph.tsx's `AGENT_SUBSTEPS`/`llmUsage` tiers feeding `TIER_COLORS`/`TIER_MODELS` in ukb-workflow-modal.tsx — both collapse a large, arbitrary space (ontology classes; LLM usage patterns) into a small fixed palette for tractable rendering.

## Usage Guidelines

Developers extending the render path should call `nodeFillColor`/`nodeShapeFor` exclusively — never resolve color via `classColor()` in production code, since it's DEPRECATED and retained only for regression tests pinning the hierarchy contract; reintroducing it into live rendering would resurrect the batch/online conflation problem the Hybrid design deliberately fixed. When adding new ontology classes, register `display.color`/`display.shape` or a `parent` in the `ClassRegistryEntry` map rather than hardcoding fallback entries, so the parent-walk can resolve appearance without hitting `DEFAULT_BATCH`. Always key hierarchy-tier lookups off `ontologyClass`, not `entityType` — the two can diverge for the same entity. Be aware that shape and fill color are computed via separate, non-synchronized tables (`SHAPE_PALETTE` vs `BATCH_PALETTE`), so consistency across the two properties for a given class is not automatically guaranteed and should be verified when adding new classes to either table. Finally, any UI element consuming border/pulse state via `borderStyleFallback`/`pulseRuleFallback` should preserve the live-filter-state semantics (`hasRelations` computed by the caller) rather than reverting to a cached/snapshot-based determination.


## Hierarchy Context

### Parent
- [KmCoreAdapter](./KmCoreAdapter.md) -- [LLM] The provided code files (ukb-workflow-modal.tsx, multi-agent-graph.tsx, ukbSlice.ts, D3GraphCanvas.tsx, color-fallback.ts) belong to system-health-dashboard and unified-viewer, not directly to the KmCoreAdapter/GraphifyGraph pipeline described in the parent observations. This suggests KmCoreAdapter's output (graph.json, entity types, relationship taxonomy) is consumed downstream by visualization layers like D3GraphCanvas and the AGENT_SUBSTEPS 'code_graph' definitions in multi-agent-graph.tsx, which explicitly reference 'Cypher queries on Memgraph' as a techNote — a stale artifact from before the GraphifyGraph migration described in the parent context, meaning the UI's descriptive text has not been updated to reflect the Memgraph-to-graphify strangler-fig migration.

### Siblings
- [HierarchyParentDerivation](./HierarchyParentDerivation.md) -- [LLM] `nodeFillColor` and `nodeShapeFor` in integrations/unified-viewer/src/graph/color-fallback.ts implement an identical two-function parent-walk pattern: each takes a `className`, a `registry: ReadonlyMap<string, ClassRegistryEntry>`, walks `cur = reg?.parent` in a `while (cur && !seen.has(cur))` loop with a `seen` Set guarding against cycles, and resolves through three tiers in strict order — explicit `display.color`/`display.shape` on the class or an ancestor, then the static `BATCH_PALETTE`/`SHAPE_PALETTE` table on the class or an ancestor, then a hardcoded terminal fallback (`DEFAULT_BATCH` slate / `'circle'`). This is a textbook 'HierarchyParentDerivation' component: it resolves a node's effective visual attribute not from its own declaration but by walking an inheritance chain defined externally in `ClassRegistryEntry.parent`, and the two functions are close enough in structure that a future refactor could trivially collapse them into one generic `resolveViaParentWalk(className, registry, extractor, palette, fallback)` higher-order function.


---

*Generated from 10 observations*

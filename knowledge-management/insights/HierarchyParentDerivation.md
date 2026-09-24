# HierarchyParentDerivation

**Type:** Detail

## What It Is

HierarchyParentDerivation refers to the `deriveParents` function that lives in `integrations/unified-viewer/src/graph/hierarchy-parents.ts`. That implementation file itself was not included in this retrieval — only its test suite, `integrations/unified-viewer/src/graph/hierarchy-parents.test.ts`, was available. All structural claims below are therefore reconstructed from observed test behavior rather than read directly from source, and this document should be treated accordingly.

`deriveParents` takes an `Entity[]` and `Relation[]` and returns a `Map<childId, parentId>`, reducing a DAG (the live graph reportedly has ~129 nodes with more than one candidate parent) down to a single-parent tree consumed by the Hierarchy Navigator UI. It sits within the KmCoreMigration lineage of work concerned with keeping entity hierarchy/parent metadata correct across the live store, and shares its test file/subject matter with the sibling component InsightHierarchyPlacement, which documents the specific regression around Insight entities joining the hierarchy.

## Architecture and Design

Three architectural patterns are evident:

1. **Deterministic tie-break chain** — when multiple parent candidates exist for a node, `deriveParents` resolves them via an ordered policy: explicit `metadata.parentId` override → level adjacency (exactly one `HIERARCHY_LEVEL` step up) → edge-type rank (`parent-child` > `contains` > `includes`) → parent name as a final deterministic tiebreaker. This produces edge-order-independent, stable output.
2. **Allowlist/gate pattern** — `HIERARCHY_CLASSES` and `HIERARCHY_LEVEL` restrict which ontology classes and edge types participate at all; edges touching non-hierarchy classes, or of non-containment types (`related_to`, `has_insight`, `mentions`), are ignored outright.
3. **Defensive cycle-breaking** — parent-chain walks over cyclic relation sets (`a→b→c→a`) are guaranteed to terminate without revisiting nodes, protecting downstream consumers from hangs.

Architecturally, `deriveParents` is a pure function with no dependency on `useViewerStore` or `ApiClient`, despite living alongside `D3GraphCanvas.tsx` in the same directory — a deliberate decoupling that keeps hierarchy-shape logic independent of rendering/store concerns even though it exists purely to feed that rendering pipeline.

## Implementation Details

The tie-break chain is layered defensively: an explicit `metadata.parentId` normally wins outright, but if that id is a ghost (unknown or self-referential), it's silently ignored rather than treated as fatal — favoring graceful degradation over hard failure. Absent an override, level adjacency (computed via `HIERARCHY_LEVEL`) takes precedence over edge type, and only when levels tie does edge-type ranking (`parent-child` > `contains` > `includes`) decide, with parent name as the last-resort deterministic tiebreaker.

The class/edge-type filtering does double duty: it's simultaneously a hierarchy-shape reducer and an implicit entity-type allowlist. Only relations of type `parent-child`, `contains`, or `includes` are considered parent-candidate edges, and both endpoints must belong to `HIERARCHY_CLASSES` or the edge is dropped entirely (demonstrated using an Observation-typed entity as a negative case).

Cycle-safety is explicitly tested via two-node and longer-cycle scenarios, confirming the parent-walk logic terminates rather than looping — a guarantee that is load-bearing given the function sits upstream of `D3GraphCanvas.tsx`'s `useGraphData`/force-simulation pipeline in the same `graph` directory.

## Integration Points

`deriveParents` is a pure transformation over already-resolved `Entity[]`/`Relation[]` arrays supplied by the caller; it does no store access, API calls, or name-based entity resolution itself. This distinguishes it clearly from `km-core-adapter.ts`'s relationship-write path, where a separate `findEntityByName` "oldest wins" bug caused duplicate-name entities to silently inherit unrelated edges — that issue belongs to a different subsystem and is unrelated to `deriveParents`'s behavior, since this function never performs name lookups.

Its primary consumer is the Hierarchy Navigator's tree view, which depends entirely on `HIERARCHY_CLASSES`/`HIERARCHY_LEVEL` staying synchronized with the live ontology. As a sibling relationship, InsightHierarchyPlacement documents exactly this dependency in action: Insight was previously excluded from `HIERARCHY_CLASSES`, causing all ~975 live Insight entities to receive no derived parent and vanish from the tree view silently.

## Usage Guidelines

Any new ontology class must be added to `HIERARCHY_CLASSES`/`HIERARCHY_LEVEL` in `hierarchy-parents.ts`, or it becomes invisible in the Navigator with no error surfaced — there is no retrieved runtime check that flags a class missing from this allowlist, so this is a manual, easily-forgotten step. When introducing new relation types intended to express containment, ensure they are added to the accepted set (`parent-child`/`contains`/`includes`); otherwise they'll be silently filtered out. Given the demonstrated regression risk (the 975-Insight-entity dropout), any change to class or edge-type allowlists should be paired with a "no orphaned entities" style regression test, following the pattern already established in `hierarchy-parents.test.ts`. Finally, because cycle-breaking is load-bearing for UI stability, any modification to the parent-walk logic should preserve termination guarantees against cyclic input.


## Hierarchy Context

### Parent
- [KmCoreMigration](./KmCoreMigration.md) -- [SESSION] UKB Backfill and Metadata Repair Pipeline work record describes a dry-run-then-production migration pattern against the live entity store to repair parent-metadata clobbering

### Siblings
- [InsightHierarchyPlacement](./InsightHierarchyPlacement.md) -- [LLM] The InsightHierarchyPlacement component is not directly present in any retrieved code file. The closest match is hierarchy-parents.test.ts, which tests deriveParents and explicitly documents that 'Insight joined the hierarchy on 2026-09-21' and 'an Insight is a hierarchy class at Detail level' — this is almost certainly the actual test coverage for the placement logic the parent component describes, but the deriveParents implementation itself (in hierarchy-parents.ts) was not retrieved.


---

*Generated from 9 observations*

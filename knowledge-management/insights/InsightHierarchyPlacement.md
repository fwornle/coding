# InsightHierarchyPlacement

**Type:** Detail

## What It Is

InsightHierarchyPlacement refers to the specific behavior — documented in `integrations/unified-viewer/src/graph/hierarchy-parents.test.ts` — that governs how Insight-typed entities are positioned within the hierarchy navigator's derived tree. The actual implementation file, `hierarchy-parents.ts`, was not retrieved in these observations; only its test suite was available. That test suite explicitly asserts that "an Insight is a hierarchy class at Detail level" and documents that "Insight joined the hierarchy on 2026-09-21," confirming this is a narrowly-scoped placement rule layered onto the broader `deriveParents` function rather than a standalone system.

## Architecture and Design

The evidence points to a test-driven specification style: precedence rules for resolving a node's parent are captured as explicit assertions rather than prose documentation — `metadata.parentId` outranks containment edges, and `has_insight` edges are deliberately excluded because they signal ownership rather than positional placement. This reflects a deliberate design choice to treat hierarchy placement as a deterministic, pure-function reduction of a DAG down to a tree, with cycle-breaking and name-based tie-break guarantees enforced by tests covering two-node and longer cycles.

Architecturally, this places Insight hierarchy placement as a client-side concern within the unified-viewer, decoupled from the graph-persistence layer. It sits alongside its sibling, HierarchyParentDerivation, which is the general-purpose mechanism (`deriveParents`, `HIERARCHY_CLASSES`, `HIERARCHY_LEVEL`) that InsightHierarchyPlacement specializes for the Insight entity type.

## Implementation Details

Per the observations, `deriveParents` accepts `Entity[]` and `Relation[]` and returns a `Map` from child id to a single resolved parent id. For Insight entities specifically, `HIERARCHY_LEVEL.Insight` is asserted equal to `HIERARCHY_LEVEL.Detail`, meaning Insights are classified into the hierarchy's Detail tier alongside other Detail-level classes in `HIERARCHY_CLASSES`. The precedence chain resolves ambiguity when multiple candidate parents exist — reportedly relevant to real data, since the sibling notes reference "the live graph has ~129 nodes with more than one candidate parent." For Insights, `has_insight` relations are excluded from consideration since they encode ownership, not tree position; instead `metadata.parentId` or containment/parent-child edges determine placement.

## Integration Points

InsightHierarchyPlacement is consumed by the Hierarchy Navigator UI within the unified-viewer, operating purely in-memory on already-fetched Entity/Relation data. Observations indicate it has no dependency on `km-core-adapter.ts`'s entityType-aware `queryIncomingRelations` fix, making it a separate computation layer sitting atop whatever graph data was already retrieved. It is contained within both WaveInsightPersistence and KmCoreMigration in the broader hierarchy, and conceptually parallels — but is distinct from — the parent KmCoreMigration's Wave 4 provenance-graph gap, where 73 Insight documents lacked corresponding graph nodes. Both issues stem from Insight-typed entities being incompletely wired into downstream consumers, but hierarchy derivation and graph persistence are separate subsystems.

## Usage Guidelines

Developers should treat `has_insight` edges strictly as ownership signals, never as positional/parent signals, when reasoning about or extending hierarchy placement logic. Any new entity type added to the hierarchy should have explicit `HIERARCHY_LEVEL` and `HIERARCHY_CLASSES` mappings plus corresponding test coverage for precedence and cycle-breaking, following the pattern established for Insight. Because the real implementation file was not available in these observations, changes affecting `hierarchy-parents.ts` should be verified against `hierarchy-parents.test.ts` directly rather than assumed from this document alone.


## Hierarchy Context

### Parent
- [KmCoreMigration](./KmCoreMigration.md) -- [SESSION] UKB Backfill and Metadata Repair Pipeline work record describes a dry-run-then-production migration pattern against the live entity store to repair parent-metadata clobbering

### Siblings
- [HierarchyParentDerivation](./HierarchyParentDerivation.md) -- [LLM] The only file among those retrieved that actually implements or contracts against 'HierarchyParentDerivation' is integrations/unified-viewer/src/graph/hierarchy-parents.test.ts, which imports `deriveParents`, `HIERARCHY_CLASSES`, and `HIERARCHY_LEVEL` from './hierarchy-parents' — i.e. a sibling implementation file (hierarchy-parents.ts) that was NOT included in this code retrieval. The test suite is nonetheless detailed enough to reconstruct the component's contract: deriveParents takes an Entity[] and Relation[] and returns a Map from child id to a single resolved parent id, reducing what is acknowledged to be a DAG (the file's header comment states 'the live graph has ~129 nodes with more than one candidate parent') down to a tree for the Hierarchy Navigator UI.


---

*Generated from 9 observations*

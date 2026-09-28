# GraphAttributionAudit

**Type:** SubComponent

## What It Is

GraphAttributionAudit is the composite subsystem, under KnowledgeManagement, responsible for determining why graph rows fail to attribute to a Project or System root, and for enforcing that attribution as a CI gate. It lives concretely in two files: `integrations/unified-viewer/scripts/assert-graph-density.ts` (the executable gate) and `integrations/unified-viewer/src/graph/attribution.ts` (the categorization module, exercised by `attribution.test.ts` and imported via `@/graph/attribution`). It is composed of two children that represent its two real halves: UnattributedRowCategoriser (the actual `categoriseUnattributed` function plus `rootOf` and `CATEGORY_LABEL`) and GraphDensityGate (the `assert-graph-density.ts` script itself, with its `BUDGET` and `overBudget` logic).

![GraphAttributionAudit — Architecture](images/graph-attribution-audit-architecture.png)

## Architecture and Design

The core architectural decision is separating *classification* from *enforcement*. `rootOf` and `categoriseUnattributed` live in `@/graph/attribution`, a rendering-independent module, while `assert-graph-density.ts` consumes them to produce a pass/fail boolean for CI. This shared-predicate pattern means the CI gate and the viewer's Graph quality panel compute attribution identically by construction — there is no second, drifted copy of the walk. The gate itself deliberately imports the viewer's own `isEntityVisible` and `deriveParents` rather than reimplementing an eleven-field visibility rule that, per the Architecture Notes, has already drifted once across footer/canvas/`useGraphVisibility`.

Categorization follows a four-bucket, mutually-exclusive classification pattern: `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`. Precedence is explicit — a row matching both `recordedParent` and a `has_insight` claim counts once, as `recordedParent`, per the exclusivity test in `attribution.test.ts`. A defensive non-suggestion pattern governs ambiguous cases: when a recorded parent name resolves to two rooted entities of the same name, the audit refuses to guess and falls back to `unclaimed`, sacrificing suggestion completeness for correctness — notably relevant given that 40 of 98 live roll-up parents share their child's name.

Finally, the audit is an executable-audit-as-CI-gate: `assert-graph-density.ts` exits 1 on regression, turning what was previously a screenshot-level observation into a checkable number.

## Implementation Details

`rootOf` walks a node's parent chain to its root, and is explicitly cycle-safe: a map with `a -> b -> a` returns `null` instead of looping, and it distinguishes "chain runs out" (`null`) from "already a root" (returns the node itself). This graceful degradation means a malformed parent-derivation elsewhere in the pipeline shows up as an `unrooted` count rather than hanging the check.

`categoriseUnattributed` produces `{ total, findings, byCategory }`, keyed by the four categories. `wrongClass` specifically covers the case where a Project claims a row via a `has_insight` edge that `deriveParents` refuses per `hierarchy-parents.ts:156`; `danglingRef` covers edges pointing at container ids absent from the store; `unclaimed` covers rows with neither an edge nor a recorded name.

GraphDensityGate wraps this in `assert-graph-density.ts`: `BUDGET = Number(process.env.GRAPH_MAX_NODES_PER_PROJECT ?? 40)`, `perProject` is a `Map<string,number>` keyed by resolved root id, and `worst` is the max entry — the gate evaluates the worst project, not the average, per its own comment ("one blown project is a failure even when the average is fine"). The full predicate is `overBudget = worst.nodes > BUDGET || unrooted > 0`, treating any unrooted node as a hard failure rather than an exemption, a direct response to a historical bug where "1/202 projects over budget" actually meant 201 single unparented rows misreported as projects. The `unrootedByCategory` field surfaces the four-category breakdown per run.

## Integration Points

GraphAttributionAudit sits inside KnowledgeManagement alongside WaveInsightPersistence, OnlineLearning, and UnifiedGraphViewerRendering. It shares a thematic failure mode with WaveInsightPersistence: the Viewer Data Contract Repair record's `docsOnly`/`edgesOnly`/`noSource` three-way split is the same incompleteness shape that the four attribution categories formalize, and the Wave Insight Persistence record's `findEntityByName` "oldest wins" duplicate-name bug is the same collision hazard that `recordedParent`'s ambiguity refusal defends against — but here addressed in the audit rather than in entity resolution itself.

![GraphAttributionAudit — Relationship](images/graph-attribution-audit-relationship.png)

It also depends on UnifiedGraphViewerRendering's visibility and hierarchy machinery (`isEntityVisible`, `deriveParents`), reusing rather than duplicating it. Internally it decomposes into UnattributedRowCategoriser (pure classification) and GraphDensityGate (enforcement using that classification), and the gate's `DEFAULT_FILTERS` interact with viewer filter state (`hideRolledUp`, `showStale`).

## Usage Guidelines

Treat `unrooted > 0` as a genuine hierarchy failure, not noise — the historical "1/202 projects" incident shows how easily unparented rows masquerade as false positives if folded into project counts. When extending `recordedParent` logic, preserve the refusal to suggest ambiguous parents; picking one candidate would silently reintroduce the exact wrong-entity-attachment bug seen in Wave Insight Persistence.

Be aware that `scripts/` is excluded from tsconfig's `include`, so `tsc --noEmit` will not catch breakage in `assert-graph-density.ts` — this already caused a silent failure when `hideArchived` was split into `hideRolledUp`/`showStale` and broke `DEFAULT_FILTERS` undetected. Any change to viewer filter shape must be manually checked against this script. Finally, keep classification logic centralized in `@/graph/attribution` — any future consumer (CLI, viewer panel, or otherwise) should import it rather than recompute the walk, preserving the guarantee that the CI gate and UI agree by construction.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Viewer Data Contract Repair work record establishes that entity source enrichment previously left rows split across 'docsOnly', 'edgesOnly', and 'noSource' buckets that were inconsistently handled between CLI tooling and the viewer's evidence preview panel — the same three-way incompleteness shape (attributed one way but not another) that attribution.test.ts's four categories now formalize for graph placement rather than source evidence, and that assert-graph-density.ts's `unrootedByCategory` report surfaces per audit run.
- The Wave Insight Persistence work record establishes that `findEntityByName` previously resolved duplicate entity names 'oldest wins' with no type filter, causing a new Detail-typed entity to inherit 24 edges belonging to an unrelated older SubComponent of the same name; attribution.test.ts's refusal to suggest a parent when a recorded name resolves to two rooted entities is the same failure mode (name collision silently picking a wrong target) addressed defensively in the attribution audit rather than in entity resolution itself.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero Insight graph nodes, because the History sidebar filters strictly to entityType 'Insight' — documents alone are invisible to graph queries

### Children
- [UnattributedRowCategoriser](./UnattributedRowCategoriser.md) -- [LLM] The component's actual name in the codebase is `categoriseUnattributed`, not `UnattributedRowCategoriser` — the retrieved files never use the latter string. `attribution.test.ts` imports it directly from `./attribution` alongside `rootOf`, and its describe block treats the function as producing a `{ total, findings, byCategory }` report keyed by exactly four category names: `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`. No implementation file (`attribution.ts`) was retrieved, so every behavior below is inferred from the test's assertions and from `assert-graph-density.ts`'s consumption of the same import, not from reading the categoriser's own source.
- [GraphDensityGate](./GraphDensityGate.md) -- [LLM] assert-graph-density.ts is the actual GraphDensityGate: `BUDGET = Number(process.env.GRAPH_MAX_NODES_PER_PROJECT ?? 40)` sets the per-project ceiling, and the gate's pass/fail predicate is the single line `const overBudget = worst.nodes > BUDGET || unrooted > 0`. `worst` is computed by sorting `perProject` (a `Map<string, number>` keyed by resolved root id) descending and taking the first entry, so the gate evaluates the WORST project rather than an average — the file's own comment states the rationale: 'one blown project is a failure even when the average is fine.' The script exits 1 on `overBudget` (implied by 'Exits 1 when over budget' in the header) so CI and a health check can consume it as a boolean gate rather than a report a human has to read.

### Siblings
- [WaveInsightPersistence](./WaveInsightPersistence.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero Insight graph nodes, because the History sidebar filters strictly to entityType 'Insight' — documents alone are invisible to graph queries.
- [OnlineLearning](./OnlineLearning.md) -- [LLM] The supplied files (ukb-workflow-modal.tsx, assert-graph-density.ts, D3GraphCanvas.tsx, SigmaCanvas.tsx, attribution.test.ts) belong to viewer/dashboard infrastructure and testing scaffolding, not to any 'OnlineLearning' component. None of the classes/functions define online/incremental learning logic, learning-rate parameters, model updates, or training loops.
- [UnifiedGraphViewerRendering](./UnifiedGraphViewerRendering.md) -- [LLM] The unified-viewer package implements graph rendering through two parallel, independently-maintained components rather than one: SigmaCanvas.tsx (WebGL via @react-sigma/core, ForceAtlas2-adjacent graphology-layout-force) and D3GraphCanvas.tsx (SVG via d3.forceSimulation). D3GraphCanvas's header comment states it is a direct port of memory-visualizer's GraphVisualization.tsx because 'every attempt to reproduce VKB's force-directed look with sigma + graphology-layout-* drifted further from the reference' — i.e. the SVG renderer exists specifically because the WebGL renderer could not visually match a prior tool's d3.forceLink(150)/d3.forceManyBody(-500) look. This is a deliberate two-backend architecture traded for a fidelity requirement, not a migration-in-progress.


---

*Generated from 10 observations*

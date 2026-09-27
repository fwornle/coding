# GraphAttributionCategorization

**Type:** Detail

## What It Is

GraphAttributionCategorization is implemented in `integrations/unified-viewer/src/graph/attribution.ts`, with its behavior specified through `integrations/unified-viewer/src/graph/attribution.test.ts`. The module exports two key functions, `categoriseUnattributed` and `rootOf`, plus a `CATEGORY_LABEL` mapping, and is responsible for explaining *why* a given graph node has no resolvable project root. Rather than treating "unrooted" as a single undifferentiated failure state, it classifies each such node into one of four mutually exclusive categories: `recordedParent` (an unambiguous named-parent resolution), `wrongClass` (claimed via a relation type that `deriveParents` intentionally does not honor, e.g. `has_insight`), `danglingRef` (an edge pointing at a non-existent entity), and `unclaimed` (no claim at all, or an ambiguous/unsafe one). As a sibling of `GraphDensityBudgetAssertion` and `WaveInsightPersistenceGap` under the `ManualLearning` parent, it supplies the diagnostic vocabulary that turns a raw node count into an explainable report.

## Architecture and Design

The core architectural pattern is a **priority-ordered decision tree**: the "categories are exclusive" test in `attribution.test.ts` confirms that a node satisfying multiple conditions (e.g., having both a recorded parent name and a `has_insight` claim) is still routed to exactly one bucket, meaning categorization order encodes precedence rather than independent boolean flags.

A second, equally important pattern is **shared-module extraction to eliminate logic drift**. The header comment in `assert-graph-density.ts` explicitly documents that an earlier version duplicated the ancestor-walk logic across the CI script, `countUnanchored`, and a would-be quality panel — causing the canvas and footer to disagree "in five different ways." Consolidating `rootOf`, `categoriseUnattributed`, and `CATEGORY_LABEL` into `@/graph/attribution` and having `assert-graph-density.ts` import rather than reimplement them is a direct architectural response to that failure mode, and is called out again in the Architecture Notes as preventing three-way drift between canvas, footer, and `useGraphVisibility`.

Third, the module follows a **dependency-injection-via-plain-data** design: `categoriseUnattributed` accepts `candidates`, `all` entities, `edges`, a prebuilt `parents` Map, and a `classOf(id)` callback, owning no store or API access itself. This decoupling is what lets `assert-graph-density.ts` (an HTTP-backed CI script hitting `/api/v1/entities`) and `attribution.test.ts` (in-memory fixtures built on a shared `SPINE`/`SPINE_EDGES`/`SPINE_PARENTS` baseline) exercise identical logic without mocking a Zustand store or network layer.

Finally, a **conservative-suggestion pattern** governs ambiguous cases: the function only emits `suggestedParentId`/`suggestedParentName` when a `parentEntityName` resolves to exactly one rooted entity.

## Implementation Details

`rootOf` performs the ancestor walk up a `parents` map and is explicitly hardened against malformed data: its test suite covers cycle-safety (a `parents` map like `d1 -> comp -> d1` returns `null` instead of looping), returns `null` when the chain runs out, and returns the node itself when it already is a root. This defensiveness is deliberate because `assert-graph-density.ts` runs this walk over every visible node on every CI invocation — an infinite loop here would manifest indistinguishably from a slow test.

`categoriseUnattributed` implements the classification logic described above. `wrongClass` detection depends on `deriveParents` deliberately refusing certain relation types (e.g. `has_insight`) as a basis for hierarchy placement, even though the edge exists in the graph — an operational instance of the authoritative-vs-inert field distinction documented in the Timeline Strip and History Sidebar Data Sourcing work record. The `recordedParent` path is intentionally conservative: per the test suite, a `parentEntityName` resolving to two rooted entities (documented as occurring for 40 of 98 live roll-up parents sharing a child's name) is *not* treated as a suggestion and falls through to `unclaimed`; the same applies when the name resolves to no entity at all.

## Integration Points

The primary consumer is `assert-graph-density.ts`, which imports `rootOf`, `categoriseUnattributed`, and `CATEGORY_LABEL` and calls them against the exact set of `visible` (post-filter) nodes rather than the whole store — ensuring the CI report matches what a person looking at the canvas would actually see. That script builds `report.unrootedByCategory` and a "why they have no project" console section from the categorization output, so the same computation feeds both an automated CI exit-code gate (`overBudget`, as detailed in sibling `GraphDensityBudgetAssertion`) and a human-readable diagnostic.

Upstream, the twin-name ambiguity handled by `recordedParent` mirrors a hazard fixed at the entity-persistence layer: the Wave Insight Persistence work record describes `findEntityByName` originally resolving by name only, causing a Detail-type node to inherit 24 incoming edges from an unrelated same-named SubComponent, later fixed by threading `entityType` through `queryIncomingRelations`/`storeRelationship`. The twin-name test in `attribution.test.ts` encodes the read-time half of this same hazard class, treating a same-named twin as `unclaimed` rather than silently attributing it.

## Usage Guidelines

Categorization order matters and is treated as intentional precedence, not incidental sequencing — new categories or reordered checks should preserve mutual exclusivity as verified by the "categories are exclusive" test. Any new consumer needing root/attribution logic should import from `@/graph/attribution` rather than reimplementing the ancestor walk or claim-checking, per the explicit lesson recorded in `assert-graph-density.ts`'s header comment. When extending `classOf` or `parents`-building logic, keep them as plain data/callback inputs rather than embedding store- or API-shape assumptions, preserving the ability to test with in-memory `SPINE` fixtures alongside real HTTP-backed runs. Finally, prefer degrading to `unclaimed` over guessing whenever resolution is ambiguous — the conservative-suggestion principle is a hard requirement, not a heuristic, since a coin-flip attribution is explicitly judged worse than an honest "no suggestion."


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- `assert-graph-density.ts` imports `rootOf, categoriseUnattributed, CATEGORY_LABEL from '@/graph/attribution'` rather than reimplementing the ancestor walk, and its own header comment explains why: an earlier version carried its own copy of the walk while `countUnanchored` carried a second and the quality panel would have made a third, which is how the canvas and the footer 'came to disagree in five different ways.' The script feeds `categoriseUnattributed` the exact set of `visible` nodes (post-filter), not the whole store, because the script measures what the canvas actually draws, so its explanation of unrooted rows has to match what a person looking at the canvas would see.

**Other:**
- `integrations/unified-viewer/src/graph/attribution.test.ts` exercises `categoriseUnattributed` and `rootOf`, both imported from `./attribution` — the module this component's name maps to. The tests pin four mutually exclusive causes for a node having no project root: `recordedParent` (the entity's metadata names a parent that resolves to exactly one rooted entity), `wrongClass` (a Project claims it via a relation type like `has_insight` that `deriveParents` deliberately refuses), `danglingRef` (the entity referenced by an edge doesn't exist in the store), and `unclaimed` (no edge, no recorded name at all). The 'categories are exclusive' test asserts a row with both a recorded parent AND a `has_insight` claim lands in exactly one bucket, confirming the categorization is a priority-ordered decision tree rather than independent flags.
- The `recordedParent` category in `attribution.test.ts` is deliberately conservative: the test 'a recorded name that resolves to TWO rooted entities is NOT a suggestion' shows that when a `parentEntityName` string matches two different rooted entities (documented as happening for 40 of 98 live roll-up parents that share a child's name), `categoriseUnattributed` refuses to guess and routes the row to `unclaimed` instead. Likewise 'a recorded name pointing at a NONEXISTENT entity is not a suggestion either' — the function only emits `suggestedParentId`/`suggestedParentName` when the name resolves unambiguously to one candidate.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Unified Viewer — Timeline Strip and History Sidebar Data Sourcing work record establishes which fields the viewer treats as authoritative versus inert/legacy for deriving graph hierarchy and ordering the history sidebar. This is the same distinction `attribution.ts`'s categorization has to make operationally — `recordedParent` only fires off a specific metadata field (`parentEntityName`), and `wrongClass` exists specifically because a relation type can 'claim' a node without that claim being honored by the hierarchy-building code (`deriveParents`), i.e. some edges are legacy/inert for placement purposes even though they exist in the graph.

## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero corresponding Insight graph nodes, showing manually/human-curated conclusions can exist as documents without ever being anchored into the graph as entities.

### Siblings
- [WaveInsightPersistenceGap](./WaveInsightPersistenceGap.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero corresponding Insight graph nodes were created, showing manual conclusions can exist purely as documents disconnected from the graph.
- [GraphDensityBudgetAssertion](./GraphDensityBudgetAssertion.md) -- [LLM] The component is directly implemented in `integrations/unified-viewer/scripts/assert-graph-density.ts`, whose header comment records that it was renamed from `assert-aggregated-node-budget.ts` on 2026-09-25 specifically to stop conflating this check with the repo's real token/money budgets (tracked under Token Usage -> Cost). The renamed env knobs `GRAPH_MAX_NODES_PER_PROJECT` and `GRAPH_DETAIL_LEVEL` (read via `process.env.GRAPH_MAX_NODES_PER_PROJECT ?? 40` and `process.env.GRAPH_DETAIL_LEVEL ?? 'overview'`) make explicit that the 'budget' is a node-count-on-screen ceiling (<=40 in an aggregated project view), not a cost ceiling — the assertion targets rendering density, and the script exits 1 when `overBudget` is true so CI and the health check can gate on it.


---

*Generated from 10 observations*

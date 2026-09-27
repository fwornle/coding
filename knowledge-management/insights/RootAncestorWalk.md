# RootAncestorWalk

**Type:** Detail

## What It Is

RootAncestorWalk refers to the `rootOf` function, part of the `GraphAttributionAudit` system, whose implementation lives in `integrations/unified-viewer/src/graph/attribution.ts`. Critically, that implementation file is **not present** among the supplied Code Files — only its test suite (`integrations/unified-viewer/src/graph/attribution.test.ts`) and one consumer (`integrations/unified-viewer/scripts/assert-graph-density.ts`) are available. This document therefore describes `rootOf`'s behavioral contract and consumption pattern as inferable from those two artifacts, not its internal code, which remains unseen.

## Architecture and Design

`rootOf` performs a parent-chain (ancestor) walk over a child→parent `Map`, climbing edges until it reaches a node classified as a rooted Project/System (via a `classOf` callback), returns `null` if the chain terminates without hitting a root, or returns the starting id itself if it is already a root. Per the parent-context observations tied to `GraphAttributionAudit`, this walk was previously duplicated across three call sites — this script, a `countUnanchored` helper, and the viewer's quality panel — before being consolidated into the shared `attribution` module. This consolidation exemplifies a single-source-of-truth extraction pattern, though the three original duplicated sites are not visible here, only the resulting shared call.

The function is designed as a pure function: it accepts only a starting id, a `Map`, and a `classOf` lookup callback, with no I/O — enabling isolated unit testing independent of any graph-loading infrastructure.

## Implementation Details

The behavioral contract is pinned entirely by the `describe('rootOf', ...)` block in `attribution.test.ts`, covering four cases: returning the Project above a row, returning `null` when the chain runs out, returning the node itself when it is already a root, and — critically — being cycle-safe. The cycle-safety test constructs a two-node cycle (`new Map([['d1','comp'],['comp','d1']])`) and asserts `null` is returned rather than an infinite loop or stack overflow. This implies the real implementation tracks visited ids during ascent, though that guard logic itself isn't visible in any supplied file — it's an inferred requirement, not observed code.

## Integration Points

The only visible real-world consumer is `assert-graph-density.ts`, which imports `rootOf` alongside `categoriseUnattributed` and `CATEGORY_LABEL` from `@/graph/attribution`, and wraps it in a locally-scoped closure: `const rootOfNode = (id: string): string | null => rootOf(id, parents, (nodeId) => classOf.get(nodeId))`. This closure binds script-local `parents` and `classOf` structures and is invoked once per visible node to bucket results into `perProject` counts or an `unrooted` counter.

This script runs synchronously via `npx vite-node scripts/assert-graph-density.ts` and exits 1 when over budget — meaning it acts as a CI-blocking gate. A hang inside the walk (e.g., an unguarded cycle) would stall CI entirely rather than cleanly fail a budget check, which is the explicit motivation for the cycle-safety test. This cross-file coupling between test guarantee and CI consumer requirement is only visible by reading both files together.

Within `GraphAttributionAudit`, RootAncestorWalk complements its sibling `AttributionCategorization` (implementing `categoriseUnattributed`): the walk determines *whether* a node reaches a root, while categorization determines *why* a node failed to attribute (`recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`).

## Usage Guidelines

Callers must supply a `classOf` lookup and a child→parent `Map`; the function itself performs no data loading. Given its use in a CI-blocking script, any modification to `rootOf` must preserve cycle-safety — the test suite in `attribution.test.ts` is the authoritative, and currently only visible, specification of correctness. Since the implementation file itself wasn't available for this analysis, any future work should retrieve `graph/attribution.ts` directly rather than relying on inference from consumer/test code alone.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- [LLM] The `<code_graph>` block supplied for this analysis is empty — no nodes, edges, or call/import relationships are present to ground any [LLM+CGR] observation. Every observation above is therefore derived from reading the literal text of `attribution.test.ts` and `assert-graph-density.ts`, not from structural graph evidence, despite the parent context's own [LLM+CGR]-tagged observations (which presumably came from a prior pass that did have graph data for `graph/attribution`).


## Hierarchy Context

### Parent
- [GraphAttributionAudit](./GraphAttributionAudit.md) -- [LLM+CGR] `categoriseUnattributed` (imported by `integrations/unified-viewer/scripts/assert-graph-density.ts` and exercised in `integrations/unified-viewer/src/graph/attribution.test.ts`) splits unrooted graph nodes into four mutually exclusive categories — `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed` — instead of one generic 'unattributed' bucket. The test `'a recorded name that resolves to TWO rooted entities is NOT a suggestion'` shows why: when a `parentEntityName` string matches two same-named rooted entities (the comment notes 40 of 98 live roll-up parents share their child's name), the function refuses to guess and falls back to `unclaimed` rather than emitting a `suggestedParentId` that would be a coin flip presented as an answer.

### Siblings
- [AttributionCategorization](./AttributionCategorization.md) -- [LLM+CGR] `attribution.test.ts` is the authoritative specification for `categoriseUnattributed`'s four-bucket contract, and the `'categories are exclusive'` test is the only place the priority ordering among `recordedParent`, `wrongClass`, `danglingRef`, and `unclaimed` is pinned: a fixture row is given BOTH a `parentEntityName` metadata field AND a conflicting `has_insight` edge from `proj`, and the assertion requires it land only in `recordedParent` with a summed bucket length of exactly 1. Nothing in the visible source exposes this precedence as a constant or comment — a caller who wants to know 'which category wins when two conditions both match' has to read this specific test, not an API surface, which is itself a documentation gap the observation is pointing at rather than a design flaw.


---

*Generated from 9 observations*

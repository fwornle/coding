# AttributionCategorization

**Type:** Detail

## What It Is

AttributionCategorization refers to the `categoriseUnattributed` function (and its companion `rootOf` parent-chain walker) implemented in `integrations/unified-viewer/src/graph/attribution.ts`, tested exhaustively in `integrations/unified-viewer/src/graph/attribution.test.ts`, and consumed by `integrations/unified-viewer/scripts/assert-graph-density.ts`. It is the concrete mechanism behind its parent component, GraphAttributionAudit: rather than lumping unrooted graph nodes into a single "unattributed" bucket, it sorts them into four mutually exclusive categories — `recordedParent`, `wrongClass`, `danglingRef`, and `unclaimed` — each carrying an explanation of *why* a node has no project ancestor. The actual implementation file was not among the supplied code artifacts, so this document is grounded in its test suite and call sites rather than direct inspection of the function bodies.

## Architecture and Design

The design follows a single-source-of-truth extraction pattern: `rootOf` and `categoriseUnattributed` were pulled out of three previously drifting implementations — the density script, a `countUnanchored` helper, and the unified viewer's quality panel — into one shared module now imported directly (`import { rootOf, categoriseUnattributed, CATEGORY_LABEL } from '@/graph/attribution'`). This consolidation is explicitly called out in `assert-graph-density.ts`'s header comment, which recalls the script "used to carry its own copy of the walk."

The four categories form a closed enumeration with an implicit priority order that is *not* documented as a constant anywhere in the visible source — it is pinned only by the `'categories are exclusive'` test, which forces a row to satisfy both `recordedParent` and `wrongClass` conditions simultaneously and asserts it lands solely in `recordedParent`. This is a notable maintainability gap: the precedence rule is enforced by test assertion, not by an inspectable API surface.

A second core design decision is fail-safe-to-conservative disambiguation. When a `parentEntityName` resolves to two same-named rooted entities (a real condition affecting 40 of 98 live roll-up parents per test comments), the function declines to guess and drops the row to `unclaimed` rather than emitting a coin-flip `suggestedParentId`.

## Implementation Details

`rootOf` performs a cycle-safe walk up a `parents` map, called as `rootOfNode = (id) => rootOf(id, parents, (nodeId) => classOf.get(nodeId))`. Its cycle-safety is load-bearing rather than defensive: the `'is cycle-safe'` test constructs a two-node cycle (`d1 -> comp -> d1`) and asserts `null` instead of a hang, because `rootOf` runs synchronously inside `assert-graph-density.ts`, a CI-gating script (exit code 1 on budget failure) — an infinite loop here would stall the pipeline, not just misreport.

`categoriseUnattributed` builds on this walk plus `deriveParents` from `graph/hierarchy-parents.ts`. The `wrongClass` bucket specifically detects gaps left when `deriveParents` refuses to place a claimed node (e.g., a Project claiming a node via `has_insight` when it isn't an Insight — a rule pinned at `hierarchy-parents.ts:156`). This means the two modules' policies are coupled by construction, not by a shared enforced contract.

The test harness itself is architecturally informative: fixtures (`ent`, `edge`, `SPINE`/`SPINE_EDGES`/`SPINE_PARENTS`, `run()`) are built atop a fixed, correctly-rooted `Project -> Component` spine, with `classOf` derived via `all.find((e) => e.id === id)?.ontologyClass`. Every categorization test therefore probes how one additional candidate interacts with an already-valid graph — behavior on a malformed or missing spine is untested.

## Integration Points

`assert-graph-density.ts` is the primary consumer, feeding `categoriseUnattributed` the `visible` node set produced by `isEntityVisible`/`DEFAULT_FILTERS` rather than the full store — a deliberate choice justified in-code as "this script measures what the canvas draws." This couples the attribution report's scope to render-time filters: a node hidden by something like `hideDocNodes` will never appear as `unclaimed` even if truly unrooted.

The script's budget calculation (`overBudget = worst.nodes > BUDGET || unrooted > 0`) treats any unrooted node as an automatic failure, and iterates the four category keys against `CATEGORY_LABEL[key].title`/`.cause` to render human-readable "why they have no project" output. A recalled regression — a level-keyed collapse reporting PASS with 43 rows rendered under no project — underscores why raw counts were insufficient and categorized attribution became necessary.

Its sibling, RootAncestorWalk, is the conceptual name given to `rootOf` itself in the component hierarchy, though the actual walk implementation isn't inspectable from supplied files — only its test suite and the `assert-graph-density.ts` call site are visible.

## Usage Guidelines

Developers should treat `attribution.test.ts` as the authoritative specification for category precedence — no code comment or constant currently documents it. Any new caller needing to know which category wins under overlapping conditions must read the `'categories are exclusive'` test.

When adding new consumers, follow the established pattern of importing `rootOf`/`categoriseUnattributed`/`CATEGORY_LABEL` from `@/graph/attribution` rather than reimplementing the walk, per the consolidation rationale in `assert-graph-density.ts`. Any change to `deriveParents` in `hierarchy-parents.ts` must be checked against `wrongClass` semantics, since the coupling is conventional, not enforced. Finally, remember categorization is filtered-scope by design — reports reflect the visible canvas, not the full store, so absence from `unclaimed` doesn't guarantee a node is truly rooted in the underlying data.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- `attribution.test.ts` is the authoritative specification for `categoriseUnattributed`'s four-bucket contract, and the `'categories are exclusive'` test is the only place the priority ordering among `recordedParent`, `wrongClass`, `danglingRef`, and `unclaimed` is pinned: a fixture row is given BOTH a `parentEntityName` metadata field AND a conflicting `has_insight` edge from `proj`, and the assertion requires it land only in `recordedParent` with a summed bucket length of exactly 1. Nothing in the visible source exposes this precedence as a constant or comment — a caller who wants to know 'which category wins when two conditions both match' has to read this specific test, not an API surface, which is itself a documentation gap the observation is pointing at rather than a design flaw.
- The `recordedParent` category is deliberately conservative about disambiguation, and two adjacent tests in `attribution.test.ts` bound it from opposite directions: `'recordedParent — the writer named a rooted entity, so suggest it'` shows the happy path resolving `parentEntityName: 'KnowledgeManagement'` to `suggestedParentId: 'comp'`, while `'a recorded name that resolves to TWO rooted entities is NOT a suggestion'` adds a same-named twin (`comp2`, also rooted under `proj`) and asserts the exact same row now falls through to `unclaimed` with zero `recordedParent` entries. The test comment states this reflects a real-world density — 40 of 98 live roll-up parents share their child's name — so the function is refusing to average away genuine ambiguity in the data rather than a hypothetical edge case.
- `rootOf`'s cycle-safety is load-bearing specifically because of where it is called from: `assert-graph-density.ts` invokes it synchronously, once per visible node, inside `rootOfNode` (built as `(id) => rootOf(id, parents, (nodeId) => classOf.get(nodeId))`), which itself runs inside a CI gate script (`npx vite-node scripts/assert-graph-density.ts`, exit code 1 on budget failure). The `'is cycle-safe'` test in `attribution.test.ts` constructs a two-node parent cycle (`d1 -> comp -> d1` via `rootOf('d1', new Map([['d1','comp'],['comp','d1']]), classOf)`) and asserts `null` rather than a hang — without that guard, a single malformed `hierarchyParents` entry in production data would stall the CI process the density check runs inside, not just return a wrong answer.
- `assert-graph-density.ts` is written as a consumer that explicitly refuses to duplicate the walk it depends on — its header comment states the file 'used to carry its own copy of the walk while `countUnanchored` carried a second one and the panel would have made a third,' and the import line `import { rootOf, categoriseUnattributed, CATEGORY_LABEL } from '@/graph/attribution'` is the fix. The script then feeds `categoriseUnattributed` the exact `visible` set produced by `isEntityVisible`/`DEFAULT_FILTERS` (not the full store), reasoning in its own comment that 'this script measures what the canvas draws, so it must explain the rows a person would actually see, not every row in the store' — meaning the attribution categories are computed post-filter, so a node hidden by e.g. `hideDocNodes` never shows up as `unclaimed` even if it truly is unrooted in the data.
- The `wrongClass` category is exercised by a single targeted fixture in `attribution.test.ts` — `'wrongClass — a Project claims it via has_insight but it is not an Insight'` — which adds only `edge('proj', 'd1', 'has_insight')` with no other relation, and asserts `r.byCategory.wrongClass` has length 1 with `suggestedParentId` undefined. The comment ties this to a specific external rule ('deriveParents refuses this pair on purpose (hierarchy-parents.ts:156)'), meaning `categoriseUnattributed` doesn't independently decide what counts as a class mismatch — it detects the gap left when `deriveParents` (from `graph/hierarchy-parents`, also imported directly by `assert-graph-density.ts`) declines to place a claimed node, making the two modules' policies coupled by construction rather than by a shared constant.
- `assert-graph-density.ts` treats unrooted nodes as first-class budget failures rather than an exemption, and ties this directly to `categoriseUnattributed`'s output: the script's `overBudget` calculation is `worst.nodes > BUDGET || unrooted > 0`, and a code comment recounts a specific regression where 'the first run of the level-keyed collapse reported PASS, Coding at 11 while 43 rows rendered under no project at all' because an Insight's placement heuristic silently dropped it from every project's total. The four-way categorization is what turns that raw `unrooted` count into an actionable report — the script's non-JSON output path iterates `['recordedParent','wrongClass','danglingRef','unclaimed']` against `CATEGORY_LABEL[key].title`/`.cause` to print 'why they have no project' rather than just a number.


## Hierarchy Context

### Parent
- [GraphAttributionAudit](./GraphAttributionAudit.md) -- [LLM+CGR] `categoriseUnattributed` (imported by `integrations/unified-viewer/scripts/assert-graph-density.ts` and exercised in `integrations/unified-viewer/src/graph/attribution.test.ts`) splits unrooted graph nodes into four mutually exclusive categories — `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed` — instead of one generic 'unattributed' bucket. The test `'a recorded name that resolves to TWO rooted entities is NOT a suggestion'` shows why: when a `parentEntityName` string matches two same-named rooted entities (the comment notes 40 of 98 live roll-up parents share their child's name), the function refuses to guess and falls back to `unclaimed` rather than emitting a `suggestedParentId` that would be a coin flip presented as an answer.

### Siblings
- [RootAncestorWalk](./RootAncestorWalk.md) -- [LLM] No file among those supplied is named or contains a component literally called 'RootAncestorWalk'. The parent-context observations describe a 'parent-chain walk' function named `rootOf` living in `graph/attribution.ts`, and that name is the closest conceptual match — but `graph/attribution.ts` itself is not among the Code Files provided here. Only two artifacts that reference `rootOf` are visible: its test suite (`integrations/unified-viewer/src/graph/attribution.test.ts`) and one call site (`integrations/unified-viewer/scripts/assert-graph-density.ts`). The actual walk implementation — the loop or recursion that climbs the `parents` map — cannot be inspected from what's given.


---

*Generated from 10 observations*

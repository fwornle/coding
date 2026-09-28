# UnattributedRowCategoriser

**Type:** Detail

## What It Is

"UnattributedRowCategoriser" is documented under a name that does not appear in the retrieved codebase; its actual implementation identifier is `categoriseUnattributed`, a function living in `integrations/unified-viewer/src/graph/attribution.ts` (path inferred from the import path `./attribution` used by `attribution.test.ts` and `@/graph/attribution` used by `assert-graph-density.ts`). No implementation file was retrieved — only `attribution.test.ts` and one consumer (`assert-graph-density.ts`) — so everything below describing internal mechanics is inferred from test assertions and consumption patterns, not from reading the source directly. The function produces a report shaped `{ total, findings, byCategory }`, where `byCategory` is keyed by exactly four mutually exclusive category names: `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`.

## Architecture and Design

The categoriser embodies a **precedence-based classification** pattern: categories are mutually exclusive and resolved by an explicit winner rule rather than by first-match iteration or double-counting. The 'categories are exclusive' test in `attribution.test.ts` proves this directly — a row deliberately constructed to be double-eligible (both a `metadata.parentEntityName` match and a `has_insight` edge suggesting `wrongClass`) is asserted to land only in `recordedParent`, with the sum across `byCategory` equal to exactly 1.

A second pattern is **fail-safe suggestion withholding**: ambiguous evidence causes the categoriser to fall back to a non-actionable bucket rather than guess. This is proven by the twin-entity test, where a row's recorded name (`KnowledgeManagement`) resolves to two distinct rooted entities (`comp` and `comp2`), and the row is pushed into `unclaimed` with zero suggested parents rather than picking either candidate arbitrarily.

The categoriser shares a **cycle-safe graph walk**, `rootOf`, with its parent component GraphAttributionAudit's executable form, `assert-graph-density.ts`. `rootOf` is proven to return `null` on a cyclic parent map (`{a→b, b→a}`) rather than looping, which is load-bearing for the CI-facing density gate (sibling GraphDensityGate) rather than just a defensive nicety.

Finally, it acts as a **diagnostic overlay**: `assert-graph-density.ts` deliberately calls `categoriseUnattributed` only over the `visible` node set (post `isEntityVisible` filtering), not the full store, because the script measures "what the canvas draws" — aligning the audit with what a user actually sees.

## Implementation Details

Though `attribution.ts` itself wasn't retrieved, its externally observable contract is well-pinned by tests. `categoriseUnattributed` accepts `AttributionEntity` and `AttributionEdge` typed inputs and returns a report with a `findings` list and a `byCategory` tally across the four fixed keys. The `recordedParent` bucket requires not just a `metadata.parentEntityName` string match but a uniqueness constraint — the name must resolve to exactly one ROOTED candidate entity, checked before `suggestedParentId` is emitted; two rooted matches for the same name causes fallthrough to `unclaimed`.

`rootOf`, tested in its own describe block, takes a parent map and a class-resolution callback and walks the parent chain to a root, returning `null` on cycle or exhaustion. `assert-graph-density.ts` wraps it as `rootOfNode = (id) => rootOf(id, parents, (nodeId) => classOf.get(nodeId))`, applying it per visible node so malformed or cyclic entries collapse into an `unrooted` counter rather than hanging the script.

## Integration Points

The categoriser and `rootOf` are exported together as a shared module (`@/graph/attribution`), consumed identically by the test suite and by `assert-graph-density.ts`, which also imports `CATEGORY_LABEL`. This avoids the triple-implementation drift the codebase previously suffered, where canvas, footer, and panel each walked parent chains independently.

Its output feeds directly into GraphAttributionAudit's CI-facing JSON/text report: `attribution.byCategory` counts surface verbatim as `report.unrootedByCategory`, and `CATEGORY_LABEL[key].title`/`.cause` populate the human-readable "why they have no project" section. Through GraphAttributionAudit, the categoriser's `unclaimed`/`unrooted` signal ultimately feeds sibling GraphDensityGate's binary pass/fail predicate (`unrooted > 0` triggers `overBudget`), making the categoriser's correctness a hard CI gating concern, not merely diagnostic text.

Notably, the same name-collision defense in the categoriser mirrors a previously-fixed bug in `findEntityByName`, which used to resolve duplicate names "oldest wins" with no type filter, causing cross-type edge inheritance. The categoriser's refusal to suggest a parent under name ambiguity handles this failure mode defensively at the audit layer rather than at the entity-resolution layer where it originated.

## Usage Guidelines

Developers should treat the four category keys (`recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`) as a fixed, externally-consumed taxonomy — changes to these names or their exclusivity guarantee will break both `assert-graph-density.ts`'s reporting and the CI gate downstream. Any new eligibility rule added to the categoriser must preserve exclusivity and be tested with deliberately double-eligible fixtures, per the existing precedent. When resolving parent-name suggestions, always verify uniqueness among rooted candidates before emitting `suggestedParentId` — never on raw name match alone. Because `scripts/` is excluded from tsconfig's `include`, type errors in `assert-graph-density.ts` (as happened with the `hideArchived` split) go uncaught by `tsc --noEmit`; changes touching this consumer should be verified by running the script, not just by compilation. Finally, since implementation source for `attribution.ts` remains unverified, any future work should prioritize retrieving and confirming the actual module structure before making assumptions about its internal organization.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- `assert-graph-density.ts` calls `categoriseUnattributed` on the `visible` set specifically (rows that pass `isEntityVisible`), not the full entity list from the store — the comment above the call states '`visible` is the right candidate set: this script measures what the canvas draws, so it must explain the rows a person would actually see, not every row in the store.' This scopes the categoriser as a diagnostic over rendered rows, and its `attribution.byCategory` counts are surfaced verbatim in the script's JSON `report.unrootedByCategory` and in its human-readable 'why they have no project' section via `CATEGORY_LABEL[key].title` / `.cause`.

**Other:**
- `attribution.test.ts`'s 'categories are exclusive' test pins the precedence rule directly: a row constructed with BOTH `metadata.parentEntityName: 'KnowledgeManagement'` and a `has_insight` edge from `proj` is asserted to land only in `byCategory.recordedParent`, with `Object.values(r.byCategory).reduce(...)` summing to exactly 1. This is a hand-written tie-break, not an artifact of iteration order — the fixture is deliberately built to be double-eligible (recordedParent AND wrongClass) to force the test to prove only one bucket receives it.
- The 'a recorded name that resolves to TWO rooted entities is NOT a suggestion' test in `attribution.test.ts` constructs a twin Component (`comp2`) with the same name (`KnowledgeManagement`) as the spine's `comp`, wires it to a second rooted parent via `edge('proj', 'comp2', 'contains')`, and asserts the row falls through to `unclaimed` with zero `recordedParent` suggestions. This means `categoriseUnattributed` must perform a name-uniqueness check among ROOTED candidates before emitting `suggestedParentId` — a row's recorded name alone is not sufficient; it must resolve to exactly one rooted match.
- `rootOf` (tested separately in `attribution.test.ts`'s own describe block, and re-exported/consumed by `assert-graph-density.ts` as `rootOfNode`) is proven cycle-safe: a parent map `{a→b, b→a}` returns `null` rather than looping. `assert-graph-density.ts` builds a per-node closure `rootOfNode = (id) => rootOf(id, parents, (nodeId) => classOf.get(nodeId))` and walks every visible node through it, meaning any cyclical or malformed entry in `deriveParents`'s output degrades into the `unrooted` counter instead of hanging the density script — the categoriser's cycle-safety is load-bearing for a CI gate, not just a test nicety.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Wave Insight Persistence work record establishes that `findEntityByName` previously resolved duplicate entity names 'oldest wins' with no type filter, causing a new Detail-typed entity to inherit 24 edges from an unrelated older SubComponent sharing its name. `attribution.test.ts`'s refusal to suggest a `recordedParent` when a name resolves to two rooted entities (the `comp2` twin fixture) is the same name-collision failure mode, but handled defensively at the categoriser rather than fixed at the entity-resolution layer that originally caused it.
- The assert-graph-density.ts header comments (also echoed in the parent context) document that the file was renamed from `assert-aggregated-node-budget.ts` on 2026-09-25, and that the same date's split of `hideArchived` into `hideRolledUp` + `showStale` silently broke `DEFAULT_FILTERS` because `scripts/` is excluded from tsconfig's `include` — `tsc --noEmit` never caught the resulting undefined filter key. This establishes that the categoriser's consumer (the density gate) shares a live blind spot in its own type-checking coverage, independent of the categoriser's own correctness.

## Hierarchy Context

### Parent
- [GraphAttributionAudit](./GraphAttributionAudit.md) -- [LLM] assert-graph-density.ts (integrations/unified-viewer/scripts/assert-graph-density.ts) is the executable form of the graph attribution audit: it imports `rootOf`, `categoriseUnattributed`, and `CATEGORY_LABEL` from '@/graph/attribution' and walks every currently-visible node's parent chain to determine which Project or System it lands under, tallying nodes that resolve to no root separately (`unrooted`) rather than folding them into a pseudo-project. The script's own comments record that an earlier version of this walk reported '1/202 projects over budget' when 201 of those 'projects' were actually single unparented rows — the unrooted count is checked as `unrooted > 0` in `overBudget`, treating any free-floating node as a hard failure of the hierarchy rather than an exemption from the per-project node budget.

### Siblings
- [GraphDensityGate](./GraphDensityGate.md) -- [LLM] assert-graph-density.ts is the actual GraphDensityGate: `BUDGET = Number(process.env.GRAPH_MAX_NODES_PER_PROJECT ?? 40)` sets the per-project ceiling, and the gate's pass/fail predicate is the single line `const overBudget = worst.nodes > BUDGET || unrooted > 0`. `worst` is computed by sorting `perProject` (a `Map<string, number>` keyed by resolved root id) descending and taking the first entry, so the gate evaluates the WORST project rather than an average — the file's own comment states the rationale: 'one blown project is a failure even when the average is fine.' The script exits 1 on `overBudget` (implied by 'Exits 1 when over budget' in the header) so CI and a health check can consume it as a boolean gate rather than a report a human has to read.


---

*Generated from 10 observations*

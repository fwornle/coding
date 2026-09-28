# GraphDensityGate

**Type:** Detail

## What It Is

GraphDensityGate is implemented in `integrations/unified-viewer/scripts/assert-graph-density.ts`. It is the executable form of what its parent component, GraphAttributionAudit, conceptually represents: a CI-consumable script that walks every currently-visible node in the graph, resolves it to its Project/System root, tallies per-project node counts, and fails when either the worst single project exceeds a budget or any node is unrooted. It was renamed from `assert-aggregated-node-budget.ts` on 2026-09-25, a rename the file's own header comment documents alongside the rationale for its current design.

## Architecture and Design

The gate embodies a "gate/threshold" pattern: a single boolean, `overBudget`, is derived from a worst-case aggregate rather than an average — `const overBudget = worst.nodes > BUDGET || unrooted > 0` — and that boolean is surfaced both as a human-readable/JSON report and as a process exit code, letting CI and health checks consume it without a human reading prose. The design explicitly rejects averaging: the file's comment states "one blown project is a failure even when the average is fine," so `worst` is computed by sorting a `Map<string, number>` (`perProject`, keyed by resolved root id) descending and taking the top entry.

A second key decision is treating unrooted nodes as a wholly separate hard-failure branch rather than folding them into per-project arithmetic. An earlier version that lumped null-root nodes into a pseudo-project produced a nonsensical "1/202 projects over budget" reading, since 201 of those "projects" were single orphaned rows. The current code instead does `if (root === null) { unrooted += 1; continue }`, keeping "a project is too dense" and "the hierarchy has orphans" as two distinct findings in the same report object.

Architecturally, the script deliberately avoids reimplementing logic that exists elsewhere: it imports `isEntityVisible` from `@/graph/visibility-predicate`, `deriveParents` from `@/graph/hierarchy-parents`, and `rootOf`/`categoriseUnattributed`/`CATEGORY_LABEL` from `@/graph/attribution`. This closes a previously documented three-way drift where the footer, the canvas, and `useGraphVisibility` disagreed with each other — the same drift `D3GraphCanvas.tsx` describes in its own header comments as the reason the shared hook was extracted. As a result, the gate can only diverge from what the canvas actually renders if the canvas's own predicate changes, not through independent reimplementation drift.

## Implementation Details

The categorisation of unrooted nodes is delegated to the sibling function `categoriseUnattributed` (publicly referred to by the placeholder name UnattributedRowCategoriser, though that string doesn't appear in the codebase). It produces four mutually exclusive buckets — `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed` — locked in by `attribution.test.ts`. The gate script consumes but does not implement this policy: its human-readable output loop, `for (const key of ['recordedParent','wrongClass','danglingRef','unclaimed'])`, simply reads `CATEGORY_LABEL[key].title`/`.cause` to print labels, keeping the two components decoupled. Notably, the underlying suggestion policy is conservative — a `recordedParent` match is withheld (falling back to `unclaimed`) when a recorded name resolves to two rooted entities, and `wrongClass` findings (e.g., a Project claiming a row via `has_insight`, refused per `hierarchy-parents.ts:156`) never carry a `suggestedParentId`.

`DEFAULT_FILTERS` in the gate script is a hand-copied mirror of the viewer store's seeded defaults (`viewer-store.ts` ~lines 519–973), and this duplication has already produced two concrete, documented failures. First, when `hideArchived` was split into `hideRolledUp`+`showStale`, the gate kept setting the old key, leaving `hideRolledUp` undefined and causing a false "Coding 157 over budget" report. Second, `selectedClasses` was copied as the store's seeded empty `Set`, but the visibility predicate interprets an empty Set as "nothing visible" rather than the "empty means all" sentinel used elsewhere — this silently made the script report 0 rendered nodes and falsely PASS a budget of 40 for a canvas nobody could actually see.

## Integration Points

The gate lives inside the viewer package specifically so it can import the viewer's own `isEntityVisible`/`deriveParents`/attribution modules directly, rather than duplicating an eleven-field visibility rule inside a separate service like obs-api. It sits beneath GraphAttributionAudit as the concrete script form of that audit concept, and it consumes its sibling `categoriseUnattributed` (UnattributedRowCategoriser) purely through its public output shape (`unrootedNodeCount`, `unrootedByCategory`), never touching its internal suggestion logic. That internal logic is independently unit-tested in `attribution.test.ts`, keeping the gate and the categoriser loosely coupled and separately verifiable.

## Usage Guidelines

Both documented DEFAULT_FILTERS incidents were able to ship silently because `scripts/` is excluded from the project's `tsconfig` `include`, so `tsc --noEmit` (run via `npm run build`, with stderr suppressed) never type-checks this file — this is a known, documented blind spot, and any changes to viewer store defaults or predicate semantics (e.g., empty-Set sentinels) must be manually cross-checked against `assert-graph-density.ts`'s copied filters rather than relying on the build to catch drift. When modifying visibility or ancestry logic, prefer extending the shared `@/graph/visibility-predicate` and `@/graph/hierarchy-parents` modules rather than touching gate-local logic, since the gate's entire value proposition is that it cannot drift from the canvas as long as it imports rather than reimplements. Finally, treat `unrooted > 0` as a structural-integrity failure distinct from density — don't fold orphan counts back into per-project budgets, as that reintroduces the "1/202 projects over budget" distortion this design was built to avoid.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Viewer Data Contract Repair work record establishes that entity source enrichment previously split rows across 'docsOnly', 'edgesOnly', and 'noSource' buckets handled inconsistently between CLI tooling and the viewer's evidence preview panel; this is the same three-way-incompleteness shape that `attribution.test.ts`'s four categories (`recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`) now formalize for graph placement, and that `assert-graph-density.ts`'s `unrootedByCategory` field in its JSON report surfaces per run.

## Hierarchy Context

### Parent
- [GraphAttributionAudit](./GraphAttributionAudit.md) -- [LLM] assert-graph-density.ts (integrations/unified-viewer/scripts/assert-graph-density.ts) is the executable form of the graph attribution audit: it imports `rootOf`, `categoriseUnattributed`, and `CATEGORY_LABEL` from '@/graph/attribution' and walks every currently-visible node's parent chain to determine which Project or System it lands under, tallying nodes that resolve to no root separately (`unrooted`) rather than folding them into a pseudo-project. The script's own comments record that an earlier version of this walk reported '1/202 projects over budget' when 201 of those 'projects' were actually single unparented rows — the unrooted count is checked as `unrooted > 0` in `overBudget`, treating any free-floating node as a hard failure of the hierarchy rather than an exemption from the per-project node budget.

### Siblings
- [UnattributedRowCategoriser](./UnattributedRowCategoriser.md) -- [LLM] The component's actual name in the codebase is `categoriseUnattributed`, not `UnattributedRowCategoriser` — the retrieved files never use the latter string. `attribution.test.ts` imports it directly from `./attribution` alongside `rootOf`, and its describe block treats the function as producing a `{ total, findings, byCategory }` report keyed by exactly four category names: `recordedParent`, `wrongClass`, `danglingRef`, `unclaimed`. No implementation file (`attribution.ts`) was retrieved, so every behavior below is inferred from the test's assertions and from `assert-graph-density.ts`'s consumption of the same import, not from reading the categoriser's own source.


---

*Generated from 9 observations*

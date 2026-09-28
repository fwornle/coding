# SyntheticRowFiltering

**Type:** Detail

# SyntheticRowFiltering — Technical Insight Document

## What It Is

SyntheticRowFiltering is implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts` as the `isSynthetic(r: CostRow): boolean` predicate, backed by two exclusion sets, `SYNTHETIC_MODELS` (`'synthetic'`, `'<synthetic>'`, `'fake-model'`) and `SYNTHETIC_PROVIDERS` (`'fake-peer'`). Its purpose is to identify and exclude demo/probe rows — data written into the same `token_usage`-derived table as production traffic by some upstream test harness — before they can pollute operator-facing €/$ cost figures. As a child of CostModel, it is a narrow, single-purpose piece of the broader "pure cost/budget logic" the file implements (per the file's own header comment, "No React here"), sitting alongside siblings BudgetHistory and PriceResolution as one of CostModel's internal concerns.

## Architecture and Design

The dominant pattern is **predicate-gate filtering**: a pure boolean function used as an early-exit guard (`if (isSynthetic(r)) continue`) inside the aggregation loop of `monthlySeries`, rather than as a separate pre-filtering pipeline stage. This is a deliberate architectural choice — filtering happens centrally at the point of aggregation, not at the data-fetch/API layer, meaning any future consumer of raw `CostRow[]` would need to re-invoke `isSynthetic` itself since it isn't baked into a shared row-loading utility.

Matching logic is a **hybrid of exact Set-membership and prefix heuristics**: `SYNTHETIC_MODELS`/`SYNTHETIC_PROVIDERS` give precise, cheap lookups for known naming conventions, while a `startsWith('fake') || startsWith('demo')` fallback catches an open-ended set of probe-model names (e.g., `demo-run-3`) that can't be fully enumerated ahead of time. This trades a small, accepted false-positive risk — a legitimately named model starting with "fake" or "demo" would be silently excluded from cost totals — for broader coverage against sloppy or evolving test-data naming.

Structurally, `isSynthetic` is deliberately isolated: it has no dependency on `priceForModel`, `modelFamily`, `budgetProvider`, or `isOpenAIWireProvider` — the machinery underpinning sibling PriceResolution — and nothing else in the file depends on it except `monthlySeries`. This is a tight, single-direction coupling that keeps the component's surface area minimal and easy to reason about independently of pricing/budget logic.

## Implementation Details

The function normalizes both matched fields before comparison: `const m = (r.model || '').toLowerCase()`, with an analogous lowercase-and-guard treatment for `provider`. The `|| ''` fallback protects against `undefined`/`null` fields on malformed `CostRow` objects, letting a row with missing data degrade to empty-string comparison rather than throwing inside the `monthlySeries` loop. This defensive style mirrors other boundary-safety patterns in the same file, such as `budgetForMonth`'s use of `Object.prototype.hasOwnProperty.call` to distinguish an explicit `null` cap from an absent key (a distinction CostModel, the parent, must preserve to avoid conflating "no cap this month" with "not recorded, use standing cap").

The single call site is the first statement inside `monthlySeries`'s aggregation loop: `if (isSynthetic(r)) continue`. Because it fires before any per-row computation, synthetic rows never reach `cellCostUsd`, `usdToEur`, or the `dimKey` pivot logic, and therefore cannot influence `MonthTotal.costEur`, `MonthTotal.byKey`, budget verdicts (`budgetForMonth`), burn-rate calculations, or any downstream per-provider/model/process breakdown. There is no flag, scope parameter, or opt-in bypass — this is a one-way, unconditional filter by design.

## Integration Points

SyntheticRowFiltering's only structural dependency is on the shared `CostRow` shape (`model`, `provider` fields) common to all of CostModel's functions — it does not touch the fallback-chain logic that PriceResolution's `priceForModel` implements, nor the month-scoped cap resolution in `budgetForMonth`. Its sole point of integration with the rest of the system is the `monthlySeries` call site: everything downstream of aggregation (budget checks, burn rate, dimensional breakdowns) inherits its filtering effect indirectly, without any of those functions needing awareness of synthetic-row concerns themselves.

## Usage Guidelines

Because filtering is enforced only inside `monthlySeries` rather than at a shared data-loading layer, any new code path that consumes raw `CostRow[]` directly must explicitly call `isSynthetic` itself — there is no guarantee of automatic exclusion elsewhere in the file. Maintainers extending the naming heuristics should be cautious: adding new prefixes or exact-match entries is straightforward, but the current prefix check (`fake`/`demo`) has no visible regression test — the supplied test suite (`tests/features/copilot-model-ids.test.mjs`) covers an unrelated concern (Copilot model-id drift) — so a new synthetic-data convention (e.g., a `test-` or `mock-` prefix) would silently slip through cost aggregation until noticed by an operator. Given the intentional false-positive trade-off already baked into the prefix heuristic, teams naming real models should avoid `fake-` or `demo-` prefixes to prevent accidental exclusion from cost totals.


## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts:budgetForMonth implements month-scoped budget resolution where an explicit null in monthlyEurByMonth is distinguished from an absent key via Object.prototype.hasOwnProperty.call, meaning 'no cap this month' and 'not recorded, use standing cap' are two different states the function must not conflate — a subtle correctness detail visible only by reading the hasOwnProperty guard.

### Siblings
- [BudgetHistory](./BudgetHistory.md) -- [LLM] None of the supplied files define a component, file, or export named `BudgetHistory`. The only material that speaks to 'budget history' as a concept is the `BudgetConfig` interface and `budgetForMonth` function in integrations/system-health-dashboard/src/components/cost/cost-model.ts — and those are pure data-model helpers (month → cap resolution), not a rendering component. This looks like a case where retrieval surfaced the parent's cost-model.ts because it is thematically adjacent to a 'BudgetHistory' Detail node in the intent graph, not because it contains that node's actual implementation.
- [PriceResolution](./PriceResolution.md) -- [LLM] The core of PriceResolution is `priceForModel` in cost-model.ts, which implements a four-stage ordered fallback: exact key match against `prices[normalized]`, then a fast-mode suffix strip via `FAST_MODE_SUFFIX = '-fast'` and `scalePrice(resolved.price, FAST_MODE_MULTIPLIER)` (multiplier = 2), then family-representative lookup via `FAMILY_REPRESENTATIVE[fam]`, then any same-family key found by scanning `Object.keys(prices)` with `modelFamily(k) === fam`, and finally a zero-priced `{priced: false, source: 'none'}` sentinel. The ordering is deliberate and documented in-line: fast-mode is checked before family fallback so a hand-added `<model>-fast` row can still win via the exact-match recursive call, but after the exact match so the suffix-stripping logic never shadows a literal price-table entry — a three-way ordering constraint that would silently regress if a maintainer reordered the `if` blocks for readability.


---

*Generated from 9 observations*

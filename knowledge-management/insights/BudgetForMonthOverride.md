# BudgetForMonthOverride

**Type:** Detail

# BudgetForMonthOverride: Technical Insight Document

## What It Is

BudgetForMonthOverride is realized as the `budgetForMonth()` function in `integrations/system-health-dashboard/src/components/cost/cost-model.ts` (lines 64-69). It resolves the effective spending cap for a given provider/month pair by checking a month-scoped override map (`monthlyEurByMonth`) before falling back to a standing cap (`monthlyEur`) defined on `BudgetConfig` (lines 43-58). As a child concept within the AgentProviderSplicing parent component, it operates alongside the pricing-resolution machinery (`priceForModel()`) but addresses an entirely orthogonal question: not "what does this cost" but "what cap applies this month."

## Architecture and Design

The defining architectural decision is the use of an **append-only temporal override map** rather than in-place mutation of a single `monthlyEur` value. This choice is explicitly justified in the `BudgetConfig` doc comment, which records the concrete historical fact that the copilot cap moved 300 → 600 → 1000 during 2026-08 — a forensic code comment pattern also seen in `freshInputTokens()`'s note about removed cache-token compensation. Rather than overwriting a single field (which would erase the history of what cap applied when), the design preserves each month's value as an immutable entry in `monthlyEurByMonth`.

This mirrors a broader architectural analogy drawn at the parent level to `setGlobalLLMMode()`'s dual-write concern: both are "temporal/versioning integrity" problems where naive mutation would corrupt other readers' historical interpretation. Notably, the project applies different mechanical solutions depending on the value's nature — an append-only override map here, versus dual-write for a continuously-read runtime flag — suggesting a deliberate, context-sensitive rather than one-size-fits-all approach to temporal correctness.

The function is also a **pure function with zero coupling** to `CostRow`, `priceForModel()`, or `cellCostUsd()`. Cap resolution and cost computation are fully independent pipelines that only converge at the UI/reporting layer, cleanly separating "what cap applies" from "what did this actually cost" (the latter governed by sibling logic PriceForModelResolution and ModelFamilyFallback).

## Implementation Details

The core mechanic is a three-way semantic lookup using `Object.prototype.hasOwnProperty.call(byMonth, month)` rather than a simpler `byMonth?.[month] ?? b.monthlyEur` expression. This distinguishes three states:
- **Present-and-null**: an explicit override recorded as "no cap that month"
- **Present-and-set**: an explicit override with a specific numeric cap
- **Absent**: no override recorded, so the standing `monthlyEur` cap applies

The `hasOwnProperty` guard exists specifically to prevent a subtle bug: a naive nullish-coalescing chain would silently collapse an intentional `null` override back to the standing cap, defeating the purpose of recording "no cap" as a deliberate month-specific decision.

`DEFAULT_COST_CONFIG.budgets` (lines 71-77) seeds a live example of this asymmetry: `copilot` carries `{ monthlyEur: 300, monthlyEurByMonth: { '2026-08': 1000 } }`, while `claude-max` is configured as `{ monthlyEur: null, enforce: false }` — deliberately uncapped and notional, reflecting its "flat subscription" framing. Both buckets are classified by `budgetProvider()` (lines 169-171) and routed through the same `budgetForMonth()` function despite having intentionally different shapes.

The design explicitly excludes in-month change modeling: a mid-month raise is recorded by setting that month's entry to the new value, meaning `budgetForMonth()` always reflects the cap in force at month-end rather than a time-weighted or prorated figure. This granularity choice aligns with `monthlySeries()`'s bucketing by `r.month`, fixing the unit of temporal resolution at the calendar month.

## Integration Points

`budgetForMonth()` sits downstream of `budgetProvider()`, which classifies cost rows into provider buckets (copilot vs. claude-max) before the override logic is applied. It has no dependency on the pricing pipeline — `priceForModel()`, `scalePrice()`, `cellCostUsd()` — despite sharing the same file and ultimately feeding the same cost-tab UI. This decoupling means budget-cap resolution can be unit-tested in isolation without constructing token rows or pricing tables, unlike the sibling `PriceForModelResolution` and `ModelFamilyFallback` logic, which is deeply intertwined with `FAMILY_REPRESENTATIVE` and recursive fast-mode stripping.

Any UI or alerting logic layered on top must account for the asymmetric semantics across `BudgetProvider` buckets — not every provider returns a meaningful numeric cap, and consumers must handle `null` as a legitimate business state rather than an error condition.

## Usage Guidelines

Developers extending or consuming `budgetForMonth()` should preserve the `hasOwnProperty`-based three-way check; simplifying it to a nullish-coalescing expression reintroduces the exact bug the guard was written to prevent. New monthly cap changes should be added as new entries in `monthlyEurByMonth` rather than mutating `monthlyEur` in place, preserving the append-only historical record the doc comments rely on for justification.

Consumers requiring sub-month or time-weighted budget tracking (e.g., burn-rate against a cap raised mid-month) should recognize this function does not support that use case and would need a different data model — this is a deliberate simplification, not an oversight. Finally, when building on top of `budgetProvider()`'s classification, treat `null`/uncapped buckets like `claude-max` as first-class, intentional states rather than edge cases to special-case away.


## Hierarchy Context

### Parent
- [AgentProviderSplicing](./AgentProviderSplicing.md) -- [LLM] The cost-model.ts module in the dashboard's cost tab implements a layered price-resolution strategy in priceForModel(): exact model key match, then fast-mode suffix stripping with a 2x multiplier via scalePrice(), then family-based fallback through FAMILY_REPRESENTATIVE. This mirrors the same 'tiered precedence resolution' philosophy seen elsewhere in the LLM subsystem (e.g. getLLMMode()'s three-tier fallback), suggesting a project-wide convention of building explicit precedence chains rather than single flat lookups whenever provider/model identity is ambiguous or evolving.

### Siblings
- [PriceForModelResolution](./PriceForModelResolution.md) -- [LLM] priceForModel() in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements a three-tier resolution ladder with an explicit `ResolvedPrice.source` discriminant ('exact' | 'family' | 'fast' | 'none') rather than a boolean 'found' flag. This is a deliberate observability choice: the function doesn't just answer 'what price', it answers 'which rule fired', which lets any caller (e.g. cellCostUsd) or a future debugging UI distinguish a confidently-priced exact match from a family-fallback guess without re-deriving the logic. The recursive call `priceForModel(base, prices)` for the fast-mode strip-and-retry means the 'exact' and 'family' branches are reused rather than duplicated for the fast path — the recursion, not a second copy of the lookup table, is what keeps 'fast' honest.
- [ModelFamilyFallback](./ModelFamilyFallback.md) -- [LLM] priceForModel() in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements the ModelFamilyFallback logic as a three-tier resolution chain: exact key match against `prices[normalized]`, then a fast-mode branch that strips the `-fast` suffix (FAST_MODE_SUFFIX) and recurses into priceForModel() on the base model before applying FAST_MODE_MULTIPLIER via scalePrice(), and only then the family fallback that walks FAMILY_REPRESENTATIVE[modelFamily(model)] before falling back further to `Object.keys(prices).find(k => modelFamily(k) === fam)`. The ordering is deliberate and load-bearing: fast-mode is checked before the family fallback specifically so an explicit `<model>-fast` row in modelPrices can still override the multiplier rule via the exact-match path on the recursive call, and the comments explicitly document that reversing this order would let the family fallback silently mis-price fast-mode rows at the standard rate with no warning (`priced: true` either way).


---

*Generated from 9 observations*

# BudgetForMonthResolver

**Type:** Detail

## What It Is

`BudgetForMonthResolver` corresponds to the `budgetForMonth()` function implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`. It resolves the effective budget cap for a given cost bucket (e.g. `copilot`, `claude-max`) in a given calendar month, given a `BudgetConfig | undefined` and a `month` string ('YYYY-MM'). It sits alongside its parent `CostModel` module's other pure functions (`priceForModel()`, `monthlySeries()`, `cellCostUsd()`), and is one of three sibling concerns identified in that file — the others being `FastModePricingRule` and `ModelFamilyFallback`, both part of `priceForModel()`'s pricing resolution rather than budget resolution.

## Architecture and Design

The core pattern is **explicit-override-over-standing-default resolution**: a per-month lookup table (`monthlyEurByMonth`) is checked first, falling back to a base value (`monthlyEur`) only when no month-specific entry exists. This mirrors, at a structural level, the tiered-fallback philosophy seen in the parent `CostModel`'s `priceForModel()` (exact match → fast-mode suffix → family fallback), though the mechanics and purpose differ: here the tiers exist to preserve historical truth rather than to approximate an unknown price.

A second, more subtle pattern is the **sentinel-value-with-`hasOwnProperty`-guard**: the function uses `Object.prototype.hasOwnProperty.call(byMonth, month)` rather than `byMonth?.[month]`, specifically because a truthiness/optional-chaining check would collapse "explicitly recorded null override" and "no entry at all" into the same behavior. This is a deliberate defense against a real ambiguity in the data model, not defensive boilerplate.

The third defining decision is **temporal/historical configuration**: `monthlyEurByMonth` acts as an append-only record of budget decisions keyed by month, so that resolving July's cap after August's cap is raised doesn't retroactively make July "look" over budget. The docstring explicitly rejects the simpler alternative of a single mutable `monthlyEur` number, citing this exact failure mode.

## Implementation Details

Mechanically, `budgetForMonth(b, month)` performs a two-step lookup: check `byMonth[month]` via `hasOwnProperty`, and if present, return it (which may itself be `null`, meaning "no cap this month"); otherwise fall back to `monthlyEur ?? null`. The return type is `number | null` throughout, with `null` overloaded to mean "no cap in force" regardless of which path produced it.

The granularity is strictly month-level and end-of-month semantic: the docstring states that a mid-month raise is recorded by setting that month's entry to the new value, meaning the resolver has no concept of a partial-month cap — only the cap "in force at month end." This matches the aggregation granularity of `monthlySeries()`, which produces calendar-month totals, so the resolver's expressiveness is intentionally capped at what the UI actually renders rather than modeling approval-date-level precision.

The concrete input shape is illustrated by `DEFAULT_COST_CONFIG.budgets`: `copilot` has `monthlyEur: 300` with an override `{ '2026-08': 1000 }` and `enforce: true`; `claude-max` has `monthlyEur: null` and `enforce: false`. These fixtures make the two collapse states (standing null vs. overridden null) concrete and testable.

## Integration Points

`budgetForMonth()` is explicitly scoped to answer only "what was the cap" — it does not compute spend, burn rate, or comparisons, and has no knowledge of the `enforce` flag on `BudgetConfig`. Enforcement decisions and spend aggregation are left to downstream callers and to other exports in the same `cost-model.ts` module (`monthlySeries()`, `cellCostUsd()`), preserving a clean separation between cap resolution, spend calculation, and enforcement logic — each living as independently testable, side-effect-free exports.

Because the function returns `number | null` without distinguishing *why* the cap is null, any caller (e.g. a budget-vs-actual UI component) that needs to differentiate "bucket has no cap at all" from "this month's override was explicitly nulled out" must inspect `BudgetConfig` directly rather than relying on the resolver's return value.

Configuration flows in from an external, operator-editable source (`GET /api/llm/settings`, per the file header), with `DEFAULT_COST_CONFIG` providing the fallback/default shape used both in production defaults and as test fixtures.

## Usage Guidelines

Developers extending or calling this resolver should preserve the `hasOwnProperty` check rather than simplifying it to optional chaining — that guard is load-bearing for distinguishing override-null from absent-entry. Any caller needing to render *why* a budget is null (standing vs. overridden) must consult `BudgetConfig` directly, since the function's return value alone doesn't carry that distinction, by design. Enforcement UI/logic must separately read the `enforce` flag; treating a resolved cap as automatically enforceable is incorrect. Finally, because the resolver is pure and side-effect-free (per the file's "Pure cost/budget logic ... No React here" header), it should remain unit-testable against `BudgetConfig` fixtures alone, without requiring token-usage or spend data — this separation should not be eroded by future changes that blend cap-resolution and spend-comparison logic together.


## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts implements priceForModel() with a three-tier resolution order — exact model key, then fast-mode suffix stripping via FAST_MODE_MULTIPLIER, then family fallback via modelFamily()/FAMILY_REPRESENTATIVE — and explicitly documents that a missing fast-mode twin would silently fall through to family pricing at the standard rate with priced:true and no warning, which is why the multiplier rule exists as a computed relationship rather than hand-maintained duplicate rows.

### Siblings
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The fast-mode pricing rule lives entirely inside `priceForModel()` in integrations/system-health-dashboard/src/components/cost/cost-model.ts, implemented as a suffix-detection branch rather than a data table: `FAST_MODE_SUFFIX = '-fast'` and `FAST_MODE_MULTIPLIER = 2` are module-level constants, and the check `normalized.toLowerCase().endsWith(FAST_MODE_SUFFIX)` fires after the exact-match lookup (`prices[normalized]`) fails but before the family fallback runs. This ordering is deliberate and documented in the surrounding comment block: an exact `<model>-fast` row in `modelPrices` would still win outright, so the rule only ever fires for the common case where no hand-written fast-mode row exists.
- [ModelFamilyFallback](./ModelFamilyFallback.md) -- [LLM] `modelFamily()` in cost-model.ts (integrations/system-health-dashboard/src/components/cost/cost-model.ts) reduces a model id to one of eight coarse buckets ('haiku'|'sonnet'|'opus'|'fable'|'gpt-4o-mini'|'gpt-4o'|'gpt-5'|'other') via ordered `.includes()` substring checks on the lowercased id. The ordering matters for correctness: 'gpt-4o-mini' is checked before the bare 'gpt-4o'/'4o' test, because 'gpt-4o-mini' would otherwise satisfy the looser 'gpt-4o' substring first and be misclassified as the non-mini family. This is a hand-written precedence rule rather than a data-driven longest-match algorithm, which is fragile if a ninth family is ever added without re-checking substring overlap.


---

*Generated from 9 observations*

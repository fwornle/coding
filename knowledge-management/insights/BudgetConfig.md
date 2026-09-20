# BudgetConfig

**Type:** Detail

[LLM+CGR] BudgetConfig (defined in cost-model.ts) is a plain data interface, not a class with methods — its three fields (`monthlyEur`, `monthlyEurByMonth`, `enforce`, `budgetBasis`) are pure configuration, and all behavior over it lives in the free function `budgetForMonth(b: BudgetConfig | undefined, month: string)`. This separation means BudgetConfig itself carries zero validation or invariants at the type level; the three-state semantics (explicit override value / explicit null override / no override) are enforced entirely by the caller's use of `Object.prototype.hasOwnProperty.call(byMonth, month)` rather than by the shape of BudgetConfig, so a future consumer that destructures `monthlyEurByMonth[month]` directly (bypassing budgetForMonth) would silently collapse 'explicit null' and 'absent' into the same `undefined` result.

## What It Is

`BudgetConfig` is a plain data interface defined in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, part of the `DashboardCostModel` module. It declares four fields — `monthlyEur: number | null`, `monthlyEurByMonth?: Record<string, number | null>`, `enforce: boolean`, and `budgetBasis: string` — and carries no methods, validation, or invariants of its own. It is a configuration shape, not a behavioral class: all logic that interprets it lives in the co-located free function `budgetForMonth(b: BudgetConfig | undefined, month: string): number | null`, also exported from the same file. The only populated instance in the codebase is `DEFAULT_COST_CONFIG.budgets`, which hardcodes two entries — `copilot` and `claude-max` — matching the return type of the sibling function `budgetProvider()`.

## Architecture and Design

`BudgetConfig`'s defining architectural trait is its inertness: it is a value object deliberately decoupled from its interpreter, `budgetForMonth`, preserving the file's stated boundary of "no React, no hooks, no I/O." This mirrors the pattern established by sibling `PriceForModel`/`ModelFamilyFallback`, where `priceForModel()` similarly separates static pricing data from a pure cascading-resolution function.

Three architectural patterns recur here: (1) a three-state override resolution — explicit value, explicit null, or absence — enforced not by `BudgetConfig`'s shape but by the caller's use of `Object.prototype.hasOwnProperty.call(byMonth, month)` inside `budgetForMonth`; (2) bucket normalization, where the open string space of arbitrary provider names is funneled through `budgetProvider()` into the closed `BudgetProvider` enum before being used as a lookup key into the `budgets` record; and (3) a time-keyed override map (`monthlyEurByMonth`) layered atop a standing default (`monthlyEur`), giving temporally-scoped configuration (e.g., a raised August cap) without altering the base contract.

## Implementation Details

The concrete data in `DEFAULT_COST_CONFIG.budgets` illustrates the design directly: the `copilot` bucket has `monthlyEur: 300`, `enforce: true`, `budgetBasis: 'gross'`, and a `monthlyEurByMonth` override of `{ '2026-08': 1000 }` — a committed example of the history-preserving, per-month design the docstring argues for. `budgetForMonth()` must be invoked per row-month (as `cellCostUsd`/`monthlySeries` presumably do) rather than once per session, or the raised August cap would leak into July/September comparisons. The `claude-max` bucket, by contrast, sets `monthlyEur: null` and `enforce: false` with no `monthlyEurByMonth` at all — a genuinely uncapped, unenforced "notional flat subscription" distinguished from copilot's usage-based ceiling.

`budgetForMonth`'s fallback logic uses `b.monthlyEur ?? null`, consistent with its `hasOwnProperty`-based per-month resolution — both paths use nullish coalescing rather than falsy coalescing, so a legitimate `monthlyEur: 0` is preserved as a real zero-euro cap rather than collapsing into "uncapped." This is a subtle but load-bearing detail: a naive refactor to `||` would silently convert "no budget left" into "unlimited."

Notably, `enforce` and `budgetBasis` are declared and populated (`'gross'` for both buckets) but never read by any function in `cost-model.ts` — not `budgetForMonth`, `cellCostUsd`, nor `monthlySeries`. This implies `BudgetConfig` is a superset interface shared with a downstream consumer, likely a settings/cost dashboard UI, that reads these fields to gate actions or render warning banners.

## Integration Points

`BudgetConfig` is looked up via `budgetProvider(provider: string): BudgetProvider`, whose normalization logic (`p.includes('copilot') || p === 'github'`, defaulting to `'claude-max'`) determines which bucket's config governs a given cost row. This coupling is implicit and unenforced by the type system: `Record<string, BudgetConfig>` is really intended as `Record<BudgetProvider, BudgetConfig>`, but nothing prevents a third key being added to `budgets` that `budgetProvider()` can never route to (dead configuration), or `budgetProvider()` being extended to return a bucket absent from `budgets` — in which case `budgetForMonth`'s `if (!b) return null` guard silently reads as "uncapped" rather than "misconfigured." Any unrecognized provider string is silently charged against `claude-max`'s config, meaning a genuinely new subscription would be invisible to budget tracking rather than merely mislabeled.

As part of `DashboardCostModel`, `BudgetConfig` fits the broader pattern shared with `PriceForModel`: `DEFAULT_COST_CONFIG.budgets` acts as seed/fallback data, with live values presumably arriving via `GET /api/llm/settings` per the module header — `cost-model.ts` itself performs no fetch.

## Usage Guidelines

Consumers should always resolve budgets through `budgetForMonth()` rather than destructuring `monthlyEurByMonth[month]` directly, since bypassing it collapses "explicit null override" and "absent override" into the same `undefined` result, losing the three-state semantics. Any new provider/subscription bucket must be added consistently to both `budgetProvider()`'s recognized set and `DEFAULT_COST_CONFIG.budgets`'s keys — since the type system won't catch a mismatch. Developers modifying enforcement behavior should look downstream (settings UI or a budget-alert component), since `enforce`/`budgetBasis` are not interpreted in `cost-model.ts`. Finally, any refactor of nullish-coalescing logic in `budgetForMonth` must preserve `??` semantics to avoid conflating a legitimate zero-euro cap with an unset budget.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- BudgetConfig (class) in cost-model.ts

**Other:**
- BudgetConfig (defined in cost-model.ts) is a plain data interface, not a class with methods — its three fields (`monthlyEur`, `monthlyEurByMonth`, `enforce`, `budgetBasis`) are pure configuration, and all behavior over it lives in the free function `budgetForMonth(b: BudgetConfig | undefined, month: string)`. This separation means BudgetConfig itself carries zero validation or invariants at the type level; the three-state semantics (explicit override value / explicit null override / no override) are enforced entirely by the caller's use of `Object.prototype.hasOwnProperty.call(byMonth, month)` rather than by the shape of BudgetConfig, so a future consumer that destructures `monthlyEurByMonth[month]` directly (bypassing budgetForMonth) would silently collapse 'explicit null' and 'absent' into the same `undefined` result.
- The only populated instance of BudgetConfig in the codebase is DEFAULT_COST_CONFIG.budgets, which hardcodes exactly two keys ('copilot' and 'claude-max') matching the BudgetProvider union type returned by budgetProvider(). This creates an implicit but unenforced contract: BudgetConfig records are looked up by budgetProvider()'s output, so `Record<string, BudgetConfig>` is really `Record<BudgetProvider, BudgetConfig>` typed too loosely — nothing in the type system stops a third key from being added to `budgets` that budgetProvider() can never route to (dead configuration) or budgetProvider() being extended to return a bucket name absent from `budgets` (budgetForMonth then silently returns null via its `if (!b) return null` guard, reading as 'uncapped' rather than 'misconfigured').
- The 2026-08 entry in DEFAULT_COST_CONFIG (`monthlyEurByMonth: { '2026-08': 1000 }` for the 'copilot' BudgetConfig) is a concrete, committed example of the history-preserving design the docstring above the interface argues for: the standing cap is 300 but August was raised to 1000, and budgetForMonth() must be called per-row-month (as cellCostUsd/monthlySeries consumers presumably do) rather than once per session, or the raised cap would leak into July/September comparisons. The 'claude-max' BudgetConfig, by contrast, has no monthlyEurByMonth at all and `monthlyEur: null` with `enforce: false` — a genuinely uncapped, unenforced bucket by default, distinguishing 'notional flat subscription' from 'usage-based budget with a real ceiling'.


## Hierarchy Context

### Parent
- [DashboardCostModel](./DashboardCostModel.md) -- [LLM] cost-model.ts is deliberately framed as "pure cost/budget logic... No React here" — every exported function (budgetForMonth, priceForModel, cellCostUsd, monthlySeries) is a pure function of CostRow[]/CostConfig inputs with no hooks, fetch calls, or component state. This is a sharp architectural boundary against sibling files like use-classifier-judge.ts and offload-decision.tsx, which interleave data-fetching, polling, and dirty-state tracking directly inside hooks and components. The payoff is testability (pure functions can be unit-tested without a DOM or mock fetch) and the ability to reuse the same pricing math in both the live dashboard tab and, presumably, offline reporting scripts — at the cost of pushing all I/O (GET /api/token-usage/cost, GET /api/llm/settings) to callers this file doesn't show.

### Siblings
- [PriceForModel](./PriceForModel.md) -- [CGR] priceForModel (function) in cost-model.ts
- [ModelFamilyFallback](./ModelFamilyFallback.md) -- [LLM] priceForModel() in cost-model.ts implements a three-tier resolution cascade — exact match, fast-mode suffix stripping (recursive call), then family fallback via FAMILY_REPRESENTATIVE — and the ordering is load-bearing, not incidental. The fast-mode check runs AFTER the exact-match check specifically so a hand-written `<model>-fast` row can override the multiplicative rule, but BEFORE the family fallback so that stripping the `-fast` suffix and recursing into priceForModel(base, prices) can itself hit either an exact match or a family fallback for the base model. This means a model like `claude-opus-4.8-fast` with no exact row resolves through two fallback layers in sequence: suffix-strip → family-fallback-for-opus → 2x multiplier — and a bug in either layer silently degrades pricing accuracy rather than erroring, which is the exact failure mode the source comment for FAST_MODE_MULTIPLIER warns about (mispricing at the standard rate, `priced: true`, no warning).


---

*Generated from 10 observations*

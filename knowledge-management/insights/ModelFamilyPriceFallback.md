# ModelFamilyPriceFallback

**Type:** Detail

## What It Is

`ModelFamilyPriceFallback` is the family-level pricing fallback logic embedded within `priceForModel()` in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`. It is the stage of the pricing cascade that activates once exact-match and fast-mode-suffix resolution both fail, attempting to price an unrecognized model string by classifying it into a family (via `modelFamily()`) and finding a priced representative of that family in the caller-supplied `prices` map. It is a sub-mechanism of the broader `CostModel` component, sitting alongside the sibling `FastModePricingRule` (the `-fast` multiplier stage) inside the same function.

## Architecture and Design

The core pattern is a cascading fallback / chain-of-responsibility: exact match → fast-mode multiplier → family representative → family substring → none. The family-fallback stage itself is two-tiered: it first walks the hardcoded, ordered `FAMILY_REPRESENTATIVE[fam]` list looking for the first key present in `prices`, and only if none match does it fall back to a looser `Object.keys(prices).find(k => modelFamily(k) === fam)` scan that accepts any same-family priced model. This means `FAMILY_REPRESENTATIVE` is a preference order, not an exhaustive gate — an operator-added custom model sharing a family substring can still be matched without ever being registered.

Classification underneath this is purely substring-based (`modelFamily()`), deliberately avoiding version-number parsing so that future model versions resolve into existing families without code changes — the "version-tolerant" design explicitly called out in the module's own comments. This buys forward-compatibility at the cost of collision risk: any string containing "sonnet" is priced identically regardless of actual variant identity.

## Implementation Details

`priceForModel()` returns on the *first* matching representative key, not the best or most recent one — an implicit priority rule. Currently this is cosmetic because `DEFAULT_COST_CONFIG.modelPrices` prices `claude-opus-5` and `claude-opus-4.8` identically, but the ordering becomes consequential the moment those prices diverge, with no comment marking that as a decision point.

The result is carried in `ResolvedPrice.source` (`'exact' | 'family' | 'fast' | 'none'`), the only signal that a price was inferred. `priced: false` only fires when `modelFamily()` returns `'other'` with no substring match at all — meaning the fallback almost never fails once any recognizable token is present; a typo'd family string prices at $0 silently.

The sibling `FastModePricingRule` interacts directly with this fallback: its recursive call into `priceForModel(base, prices)` means an unmatched `-fast` model chains family inference with the 2x multiplier (`FAST_MODE_MULTIPLIER`), compounding two unverified assumptions — the comment on `claude-opus-4.8`'s multiplier explicitly flags it as "assumed, not independently verified."

## Integration Points

`priceForModel()` is a pure function taking the price table as a parameter, keeping `cost-model.ts` React-free and testable independent of UI. Its only visible consumer, `cellCostUsd()`, destructures solely `{ price }`, discarding `priced` and `source` entirely — so `monthlySeries()` and any pivot built atop it cannot distinguish confidently-priced spend from family-guessed or unpriced spend. The provenance information is computed but architecturally severed from the reporting layer.

Within `CostModel`, this fallback complements `BudgetHistoryModel`'s `budgetForMonth()` (the month-keyed budget-cap resolver) — both are pure-lookup design patterns in the same file, but budget resolution honors an explicit `null`-as-no-cap override, whereas price fallback silently infers rather than explicitly declaring absence.

## Usage Guidelines

Developers extending `FAMILY_REPRESENTATIVE` should treat list order as a real priority decision, not cosmetic sequencing, especially as representative prices diverge. Any code needing to distinguish exact vs. inferred pricing must consume `ResolvedPrice.source` directly, since `cellCostUsd()` does not surface it. New family substrings should be chosen carefully to avoid collisions with renamed or unrelated models, and multipliers layered on top of family-inferred fast-mode prices should be flagged as doubly uncertain in any cost-confidence reporting.


## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts's `budgetForMonth()` resolves a budget cap through a two-tier lookup: an explicit per-month override in `monthlyEurByMonth` (keyed 'YYYY-MM') takes precedence over the standing `monthlyEur` value, and a stored `null` override is honoured as 'no cap that month' rather than treated as absent. The `DEFAULT_COST_CONFIG.budgets.copilot` entry encodes a real history of this — the cap moved 300 → 600 → 1000 during 2026-08 as extensions were approved — and the comment above `BudgetConfig` explains why this is not modelled as a single mutable number: doing so would retroactively re-judge past months (e.g. flagging July as 'over' against a cap that did not exist yet). The design deliberately does not model in-month changes either; the unit is the calendar month and the value that matters is the cap in force at month end.

### Siblings
- [BudgetHistoryModel](./BudgetHistoryModel.md) -- [LLM] No file, class, or exported symbol named `BudgetHistoryModel` appears anywhere in the supplied code (cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx, or the copilot-model-ids test). The nearest conceptual match is the `BudgetConfig` interface and its `budgetForMonth()` resolver in `integrations/system-health-dashboard/src/components/cost/cost-model.ts:44-60`, which is what the parent's observations describe almost verbatim (the two-tier `monthlyEurByMonth` override over `monthlyEur`, the honored-`null`-means-no-cap semantics, and the 300→600→1000 2026-08 history baked into `DEFAULT_COST_CONFIG.budgets.copilot`). That interface is a plain data shape plus one pure lookup function, not a named 'model' class — so retrieval appears to have surfaced the parent Detail's own file under a different, invented component label.
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The fast-mode rule is implemented as a recursive branch inside `priceForModel()` (integrations/system-health-dashboard/src/components/cost/cost-model.ts) rather than as a standalone lookup: when the exact-match check against `prices[normalized]` misses and the model string ends in `FAST_MODE_SUFFIX` ('-fast'), the function strips the suffix and calls itself with the base model name, then wraps the recursive result through `scalePrice(resolved.price, FAST_MODE_MULTIPLIER)` if — and only if — the base model resolved to `priced: true`. This means a `-fast` model whose base model is itself unpriced correctly falls through to `priced: false` rather than being scaled from a zeroed price object, since the `if (resolved.priced)` guard sits between the recursive call and the multiplication.


---

*Generated from 9 observations*

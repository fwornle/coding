# ModelFamilyFallback

**Type:** Detail

## What It Is

ModelFamilyFallback is the family-classification and family-level pricing fallback mechanism implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, consisting of two core pieces: `modelFamily()`, which reduces a model id string to one of eight coarse buckets (`'haiku'|'sonnet'|'opus'|'fable'|'gpt-4o-mini'|'gpt-4o'|'gpt-5'|'other'`), and `FAMILY_REPRESENTATIVE`, a `Record<ModelFamily, string[]>` curating which `modelPrices` keys should stand in for a family when an exact model id isn't priced. Together they form the third and last tier of `priceForModel()`'s resolution order, which is owned by the parent component CostModel.

## Architecture and Design

The governing pattern is a tiered/waterfall resolution: exact key lookup, then fast-mode suffix-stripped recursion, then family-level approximate match. ModelFamilyFallback implements only the final tier, but it is architecturally load-bearing — it's the fallback-of-last-resort that FastModePricingRule's recursive `priceForModel()` call silently relies on when a model's fast-mode "twin" is unpriced. Within its own tier there's a nested pattern: a curated allow-list (`FAMILY_REPRESENTATIVE`) is tried first, and only if none of its listed keys exist in `modelPrices` does the code fall through to a generic `Object.keys(prices).find(k => modelFamily(k) === fam)` scan. This gives curators explicit control over which row "represents" a family while still guaranteeing some match is found for any priced model in that family. The whole module follows a pure-function, side-effect-free design ("Pure cost/budget logic... No React here"), making it independently unit-testable, consistent with sibling BudgetForMonthResolver's similarly self-contained `budgetForMonth()`.

## Implementation Details

`modelFamily()` classifies via ordered, lowercased `.includes()` substring checks rather than a data-driven longest-match algorithm — notably, `'gpt-4o-mini'` must be checked before the looser `'gpt-4o'` test to avoid misclassification, a hand-written precedence rule that is fragile if a ninth family is added without re-auditing substring overlaps. `FAMILY_REPRESENTATIVE` entries like `opus: ['claude-opus-5', 'claude-opus-4.8', 'claude-opus-4.6']` give an ordered list of keys to try per family. Inside `priceForModel()`, both fallback tiers (representative-list hit and generic scan hit) return `priced: true` with `source: 'family'` — there is no field distinguishing a curated hit from an arbitrary scan hit. This ambiguity compounds with FastModePricingRule: since the `-fast` suffix branch recursively calls `priceForModel(base, prices)` rather than a direct lookup, an unpriced base model falls through to family fallback and the outer call then multiplies that family price by `FAST_MODE_MULTIPLIER` (2x) — stacking two approximations while `ResolvedPrice.source` still just says `'family'`, never signaling the compounded fast-mode adjustment.

## Integration Points

ModelFamilyFallback is a dependency, not a standalone feature: it's invoked from within CostModel's `priceForModel()`, and it is transitively depended on by FastModePricingRule's recursive fallthrough. It operates solely on the static `DEFAULT_COST_CONFIG.modelPrices` map and model id strings — no network, no React state. This creates a notable asymmetry with the rest of CostModel's data: `modelPrices` entries are potentially operator-editable via `GET /api/llm/settings`, but `modelFamily()` and `FAMILY_REPRESENTATIVE` are compile-time constants baked into the bundle, so adding a new model *family* (not just a new id) requires a code change and redeploy.

## Usage Guidelines

Developers extending `modelFamily()` must preserve substring-check ordering carefully (e.g., mini-variants before their broader parent strings) since the classifier is precedence-based, not longest-match. When adding models to `FAMILY_REPRESENTATIVE`, remember it's an allow-list optimization, not the only path to a family match — unlisted priced models remain reachable via the generic scan. Because `source: 'family'` conflates curated and scanned matches, and can also mask a stacked fast-mode multiplier, any UI work (e.g. `cellCostUsd()`, `monthlySeries()`) intending to flag approximate costs should not rely on `priced` alone and should treat `source === 'family'` as the only (currently coarse) approximation signal, pending a possible future split of that field.


## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts implements priceForModel() with a three-tier resolution order — exact model key, then fast-mode suffix stripping via FAST_MODE_MULTIPLIER, then family fallback via modelFamily()/FAMILY_REPRESENTATIVE — and explicitly documents that a missing fast-mode twin would silently fall through to family pricing at the standard rate with priced:true and no warning, which is why the multiplier rule exists as a computed relationship rather than hand-maintained duplicate rows.

### Siblings
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The fast-mode pricing rule lives entirely inside `priceForModel()` in integrations/system-health-dashboard/src/components/cost/cost-model.ts, implemented as a suffix-detection branch rather than a data table: `FAST_MODE_SUFFIX = '-fast'` and `FAST_MODE_MULTIPLIER = 2` are module-level constants, and the check `normalized.toLowerCase().endsWith(FAST_MODE_SUFFIX)` fires after the exact-match lookup (`prices[normalized]`) fails but before the family fallback runs. This ordering is deliberate and documented in the surrounding comment block: an exact `<model>-fast` row in `modelPrices` would still win outright, so the rule only ever fires for the common case where no hand-written fast-mode row exists.
- [BudgetForMonthResolver](./BudgetForMonthResolver.md) -- [LLM] The `budgetForMonth()` function in integrations/system-health-dashboard/src/components/cost/cost-model.ts is the concrete implementation matching this component: it takes a `BudgetConfig | undefined` and a `month` string and resolves the cap in force for that month via a two-step lookup — first checking `monthlyEurByMonth` with `Object.prototype.hasOwnProperty.call(byMonth, month)`, falling back to `monthlyEur ?? null` only if the month has no override entry. The explicit `hasOwnProperty` check (rather than `byMonth?.[month]`) is what lets the function distinguish a recorded `null` override (meaning 'no cap this month') from an absent key (meaning 'use the standing cap') — a truthiness check would collapse those two states.


---

*Generated from 9 observations*

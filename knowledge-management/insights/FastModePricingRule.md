# FastModePricingRule

**Type:** Detail

## What It Is

FastModePricingRule is not a standalone class but a logic branch embedded within `priceForModel()` in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`. It handles pricing for model identifiers ending in the `FAST_MODE_SUFFIX` ('-fast'), representing "the SAME model at up to 2.5x output throughput and premium pricing." Rather than maintaining duplicate price rows for fast-mode variants, the rule computes fast-mode prices dynamically by recursing on the base model name and applying a multiplier.

## Architecture and Design

The rule sits as the middle tier in a three-stage recursive fallback cascade inside `priceForModel()`: exact match against `prices[normalized]` first, fast-mode suffix-stripping second, and family fallback (implemented by sibling ModelFamilyPriceFallback via `modelFamily()`/`FAMILY_REPRESENTATIVE`) last. This ordering is deliberate — it lets operators override the 2x multiplier for specific models simply by adding a literal `<model>-fast` row to `modelPrices`, which the exact-match check intercepts before the fast-mode branch ever executes. No special-casing is needed in the fast-mode code itself.

A core design decision is favoring a multiplicative rule over a base value instead of duplicated data rows, explicitly to avoid silent drift between paired entries (e.g., a hand-maintained `-fast` row disagreeing with a computed 2x price). This trades verification effort — only `claude-opus-5`'s 2x figure is empirically confirmed against `claude-opus-4.8` — for guaranteed coverage of all future fast-capable models without additional data entry.

The rule also employs provenance tagging via `ResolvedPrice.source`, distinguishing `'fast'` from `'exact'` and `'family'` so downstream consumers like `cellCostUsd()` can trace confidence levels rather than treating all `priced: true` results as equivalent.

## Implementation Details

The recursive branch: when the exact-match check misses and the model string ends in `-fast`, the function strips the suffix and calls itself with the base model name. The recursive result is wrapped through `scalePrice(resolved.price, FAST_MODE_MULTIPLIER)` only if `resolved.priced === true` — the `if (resolved.priced)` guard sits between the recursive call and the multiplication, so a `-fast` model whose base is itself unpriced correctly falls through to `priced: false` instead of scaling a zeroed price object.

`scalePrice()` is a small pure helper, used only by this branch, that multiplies all four price fields (`in`, `out`, `cacheRead`, `cacheWrite`) by a single factor — encoding the assumption that fast mode's premium applies uniformly across input, output, and cache pricing rather than modeling throughput and price as separate axes.

`FAST_MODE_MULTIPLIER = 2` is a single shared constant applied uniformly to every fast-capable model. The code performs no runtime divergence detection — there's no assertion comparing a hand-added `-fast` row against the computed 2x value. The documented recovery path if the 2x assumption breaks for a given model is to add an explicit override row, not adjust the shared constant, which would silently affect all other fast-mode models.

`priceForModel()` is a pure function with no I/O, and its self-call is bounded to a recursion depth of exactly 1 (suffix stripped once), not general recursion.

## Integration Points

FastModePricingRule is a child concept under CostModel, sharing `cost-model.ts` with parent-level logic like `budgetForMonth()` and sibling ModelFamilyPriceFallback. It interacts with `cellCostUsd()`, which multiplies the fast-mode-adjusted price by `cfg.providerScale[budgetProvider(r.provider)]` — a two-layer scaling (base price → fast multiplier → provider scale) that is architecturally independent from provider scaling. This interaction is currently dormant since `providerScale` defaults to `1.0` for both buckets in `DEFAULT_COST_CONFIG`, but would activate once an operator sets a non-1.0 scale.

The rule depends on `DEFAULT_COST_CONFIG.modelPrices` containing entries like `claude-opus-5` and `claude-opus-4.8`, whose identical standard-tier pricing underpins the assumption that the 2x multiplier generalizes across both.

## Usage Guidelines

Developers adding new fast-capable models need not add explicit `-fast` rows — coverage is automatic via the shared multiplier. Overrides for models whose fast-mode pricing diverges from 2x should be added as literal `<model>-fast` rows in `modelPrices`, which the exact-match check will honor ahead of the general rule. Do not adjust `FAST_MODE_MULTIPLIER` to fix a single model's discrepancy, as this silently affects every other fast-mode model. When consuming `priceForModel()` results, check `ResolvedPrice.source` to distinguish fast-mode-derived figures from exact or family-fallback prices, especially in UI or reporting contexts where confidence level matters. Be aware that cache pricing is scaled by the same flat multiplier as input/output — if actual billing prices cache operations differently under fast mode, this simplification will need revisiting.


## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts's `budgetForMonth()` resolves a budget cap through a two-tier lookup: an explicit per-month override in `monthlyEurByMonth` (keyed 'YYYY-MM') takes precedence over the standing `monthlyEur` value, and a stored `null` override is honoured as 'no cap that month' rather than treated as absent. The `DEFAULT_COST_CONFIG.budgets.copilot` entry encodes a real history of this — the cap moved 300 → 600 → 1000 during 2026-08 as extensions were approved — and the comment above `BudgetConfig` explains why this is not modelled as a single mutable number: doing so would retroactively re-judge past months (e.g. flagging July as 'over' against a cap that did not exist yet). The design deliberately does not model in-month changes either; the unit is the calendar month and the value that matters is the cap in force at month end.

### Siblings
- [BudgetHistoryModel](./BudgetHistoryModel.md) -- [LLM] No file, class, or exported symbol named `BudgetHistoryModel` appears anywhere in the supplied code (cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx, or the copilot-model-ids test). The nearest conceptual match is the `BudgetConfig` interface and its `budgetForMonth()` resolver in `integrations/system-health-dashboard/src/components/cost/cost-model.ts:44-60`, which is what the parent's observations describe almost verbatim (the two-tier `monthlyEurByMonth` override over `monthlyEur`, the honored-`null`-means-no-cap semantics, and the 300→600→1000 2026-08 history baked into `DEFAULT_COST_CONFIG.budgets.copilot`). That interface is a plain data shape plus one pure lookup function, not a named 'model' class — so retrieval appears to have surfaced the parent Detail's own file under a different, invented component label.
- [ModelFamilyPriceFallback](./ModelFamilyPriceFallback.md) -- [LLM] `priceForModel()` in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements the family-fallback path directly: after the exact-match check on `prices[normalized]` fails and the `-fast` suffix check also fails to resolve, it calls `modelFamily(model)` and walks `FAMILY_REPRESENTATIVE[fam]` looking for the first key that exists in the caller-supplied `prices` map. Only if none of the representative keys are found does it fall through to a second, looser pass — `Object.keys(prices).find(k => modelFamily(k) === fam)` — which accepts ANY priced model in the same family, not just the curated representatives. This two-pass structure means the representative list is a preference order, not an exhaustive gate: an operator-added custom model sharing a family substring (e.g. anything containing 'opus') can still be matched even if it was never added to `FAMILY_REPRESENTATIVE`.


---

*Generated from 9 observations*

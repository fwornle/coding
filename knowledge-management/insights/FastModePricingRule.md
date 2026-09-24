# FastModePricingRule

**Type:** Detail

## What It Is

FastModePricingRule is a branch within `priceForModel()` in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, not a standalone class or module. It is defined by two module-level constants — `FAST_MODE_SUFFIX = '-fast'` and `FAST_MODE_MULTIPLIER = 2` — and a suffix-detection check (`normalized.toLowerCase().endsWith(FAST_MODE_SUFFIX)`) that sits between the exact-match price lookup and the family-fallback path. Its purpose is to price `<model>-fast` variants (e.g., a hypothetical `claude-opus-5-fast`) at a multiple of the base model's price without requiring a hand-maintained duplicate row in `modelPrices` for every fast-mode variant.

## Architecture and Design

The rule embodies a "decorator over data" pattern: rather than storing a second price table entry for each fast-mode model, it derives the fast price computationally by recursing into `priceForModel(base, prices)` on the suffix-stripped name and then scaling the result via `scalePrice()`. This is explicitly called out as an architectural pattern — decorator/rule-based derivation instead of duplicated data rows — and it composes cleanly with whatever resolution tier (exact or family) the base model would have used, tagging the result with `source: 'fast'` in `ResolvedPrice` to distinguish it from `'exact'` or `'family'`.

The broader `priceForModel()` implements a tiered fallback chain: exact match → fast-mode suffix rule → family representative (`modelFamily()`/`FAMILY_REPRESENTATIVE`, owned by sibling ModelFamilyFallback) → family substring scan → unpriced zero. Precedence is enforced purely by branch sequencing in source, and an exact `<model>-fast` row in `modelPrices` will still win outright over the computed rule — the rule only fires when no explicit fast-mode entry exists. This ordering is documented in-line as a self-documenting risk comment rather than external documentation, consistent with the parent CostModel's stated rationale that the multiplier rule exists specifically to prevent a fast-mode model from silently falling through to standard family pricing.

## Implementation Details

The mechanics hinge on three pieces working together. First, `FAST_MODE_SUFFIX`/`FAST_MODE_MULTIPLIER` define the trigger and factor. Second, the recursive call `priceForModel(base, prices)` reuses the full resolution logic (including `modelFamily()` from sibling ModelFamilyFallback) rather than duplicating lookup code; only if that call returns `priced: true` does the fast-mode branch proceed to call `scalePrice(resolved.price, FAST_MODE_MULTIPLIER)`. Third, `scalePrice()` uniformly multiplies all four `ModelPrice` fields — `in`, `out`, `cacheRead`, `cacheWrite` — by the same factor, an assumption the in-code comment flags as verified only for Claude Opus 5 ($10/$50) and merely assumed for Opus 4.8, the only other fast-mode model, since it "carries identical standard pricing."

A documented failure mode exists at the seam between this rule and ModelFamilyFallback: if the recursive base lookup itself fails (`priced: false`), execution falls through to the family-fallback loop using the *original*, still-suffixed model string via `modelFamily()`. Because `modelFamily()` matches by substring, a string like `claude-opus-5-fast` would still match `'opus'` and silently return an unscaled family price with `priced: true` — the exact silent-fallthrough scenario the parent CostModel's documentation warns about. This is a tight coupling between the fast-mode rule's ordering and the family fallback's substring matching that is not guarded against in the file.

## Integration Points

`priceForModel()` is a pure function with no I/O, which keeps the fast-mode branch unit-testable independent of the fetch/aggregation layer. Its sole production consumer is `cellCostUsd()` in the same file, which destructures only `{ price }` from the returned `ResolvedPrice` — discarding `priced` and `source` entirely. This means the `'fast'` tag that distinguishes a correctly-multiplied price from a silently-wrong family fallback is computed but never surfaced downstream. `cellCostUsd()` feeds `monthlySeries()` aggregation, which in turn underlies the budget/burn-rate figures resolved by sibling BudgetForMonthResolver's `budgetForMonth()` — so any defect in the fast-mode multiplier propagates directly into billing and budget-tracking output with no intermediate validation step.

Notably, the rule is scoped strictly to price-tier selection and is orthogonal to token counting: `cellCostUsd()` still reads `freshInputTokens(r)` and raw `output_tokens`/`cache_read_tokens`/`cache_write_tokens` fields regardless of fast-mode status. The multiplier changes which `ModelPrice` object is applied, not which token fields are consumed, making it independent of the OpenAI-wire token-semantics concerns documented elsewhere in the same file.

## Usage Guidelines

Developers adding a new fast-mode model should verify whether the uniform 2x assumption in `scalePrice()` actually holds for that model's pricing structure — the code treats Opus 5's ratio as verified and Opus 4.8's as an unverified extrapolation, and any model with asymmetric input/output/cache pricing changes could break the "scale everything by the same factor" assumption silently. If a fast-mode model's true pricing diverges from the multiplier, the documented escape hatch is to add an explicit `<model>-fast` row to `modelPrices`, which takes precedence via the exact-match branch.

Because `cellCostUsd()` discards `priced`/`source`, anyone debugging suspicious billing numbers for a `-fast` model should not trust `cellCostUsd` output alone to reveal whether the fast-mode rule actually fired — a silently-wrong family-fallback price is indistinguishable from a correctly-priced one at that call site. Diagnosis requires calling `priceForModel()` directly and inspecting `source`. Any future change to `modelFamily()`'s substring rules (owned by ModelFamilyFallback) should be checked against this rule's fallback path, since an untagged, unresolvable `-fast` model will fall through to family matching using the still-suffixed string.


## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts implements priceForModel() with a three-tier resolution order — exact model key, then fast-mode suffix stripping via FAST_MODE_MULTIPLIER, then family fallback via modelFamily()/FAMILY_REPRESENTATIVE — and explicitly documents that a missing fast-mode twin would silently fall through to family pricing at the standard rate with priced:true and no warning, which is why the multiplier rule exists as a computed relationship rather than hand-maintained duplicate rows.

### Siblings
- [ModelFamilyFallback](./ModelFamilyFallback.md) -- [LLM] `modelFamily()` in cost-model.ts (integrations/system-health-dashboard/src/components/cost/cost-model.ts) reduces a model id to one of eight coarse buckets ('haiku'|'sonnet'|'opus'|'fable'|'gpt-4o-mini'|'gpt-4o'|'gpt-5'|'other') via ordered `.includes()` substring checks on the lowercased id. The ordering matters for correctness: 'gpt-4o-mini' is checked before the bare 'gpt-4o'/'4o' test, because 'gpt-4o-mini' would otherwise satisfy the looser 'gpt-4o' substring first and be misclassified as the non-mini family. This is a hand-written precedence rule rather than a data-driven longest-match algorithm, which is fragile if a ninth family is ever added without re-checking substring overlap.
- [BudgetForMonthResolver](./BudgetForMonthResolver.md) -- [LLM] The `budgetForMonth()` function in integrations/system-health-dashboard/src/components/cost/cost-model.ts is the concrete implementation matching this component: it takes a `BudgetConfig | undefined` and a `month` string and resolves the cap in force for that month via a two-step lookup — first checking `monthlyEurByMonth` with `Object.prototype.hasOwnProperty.call(byMonth, month)`, falling back to `monthlyEur ?? null` only if the month has no override entry. The explicit `hasOwnProperty` check (rather than `byMonth?.[month]`) is what lets the function distinguish a recorded `null` override (meaning 'no cap this month') from an absent key (meaning 'use the standing cap') — a truthiness check would collapse those two states.


---

*Generated from 9 observations*

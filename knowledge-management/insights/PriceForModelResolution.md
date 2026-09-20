# PriceForModelResolution

**Type:** Detail

[Code References] integrations/system-health-dashboard/src/components/cost/cost-model.ts:150-179 — priceForModel(): exact match, fast-mode suffix recursion, family fallback ladder; integrations/system-health-dashboard/src/components/cost/cost-model.ts:127-137 — scalePrice() and FAST_MODE_SUFFIX/FAST_MODE_MULTIPLIER constants; integrations/system-health-dashboard/src/components/cost/cost-model.ts:96-108 — FAMILY_REPRESENTATIVE map used by the family-fallback branch; integrations/system-health-dashboard/src/components/cost/cost-model.ts:83-94 — modelFamily() classification feeding both fast-mode and family fallback; integrations/system-health-dashboard/src/components/cost/cost-model.ts:216-230 — freshInputTokens(): retained identity function with historical-defect warning comment; integrations/system-health-dashboard/src/components/cost/cost-model.ts:236-249 — cellCostUsd(): composes priceForModel, budgetProvider, and providerScale; integrations/system-health-dashboard/src/components/cost/cost-model.ts:56-62 — budgetForMonth(): hasOwnProperty check distinguishing explicit null override from absent month key; integrations/system-health-dashboard/src/components/cost/cost-model.ts:69-77 — isSynthetic(): upstream filter that priceForModel() implicitly depends on

# PriceForModelResolution

## What It Is

`PriceForModelResolution` is realized by the `priceForModel()` function in `integrations/system-health-dashboard/src/components/cost/cost-model.ts:150-179`, the core pricing lookup for the dashboard's cost tab. Given a model identifier and a `prices` map, it resolves a `ResolvedPrice` — a discriminated result carrying not just a numeric price but a `source` field (`'exact' | 'family' | 'fast' | 'none'`) that records *which resolution rule fired*. As the parent component AgentProviderSplicing summarizes, this is one instance of a broader "layered price-resolution strategy" applied across the cost-model module, and it directly implements the sibling entity ModelFamilyFallback's fallback ladder as one of its tiers.

## Architecture and Design

The function is structured as an explicit chain-of-responsibility: exact match against `prices[normalized]`, then a fast-mode branch (`FAST_MODE_SUFFIX`, `FAST_MODE_MULTIPLIER`, `scalePrice()` at lines 127-137), then a family-based fallback via `FAMILY_REPRESENTATIVE` (lines 96-108) driven by `modelFamily()` (lines 83-94). Critically, the fast-mode branch does not duplicate lookup logic — it strips the `-fast` suffix and recurses into `priceForModel(base, prices)`, so the recursive call itself passes through the exact and family branches. This means "fast" pricing is only ever as correct as the underlying resolution for the base model, with no parallel code path to drift out of sync.

The ordering — fast-mode checked strictly before family fallback — is load-bearing and deliberately documented in-line: it lets an explicit `<model>-fast` row in `modelPrices` override the multiplier entirely via the exact-match path on the recursive call, while guaranteeing every fast-capable model still gets correctly doubled pricing without a hand-maintained twin row. Reversing this order would let the family fallback silently mis-price fast-mode rows at the standard rate, with `priced: true` and no warning — exactly the defect class the sibling ModelFamilyFallback observation calls out.

The `ResolvedPrice.source` discriminant is itself a design decision worth isolating: rather than a boolean `found` flag, it exposes resolution provenance to every caller, letting `cellCostUsd()` or a future debugging UI distinguish a confident exact match from a family-fallback guess without re-deriving the logic.

## Implementation Details

`modelFamily()` and `FAMILY_REPRESENTATIVE` implement a two-staged, version-tolerant fallback: first an ordered list of representative keys per family (e.g., opus tries `claude-opus-5`, then `-4.8`, then `-4.6`), and only if none exist in the live `prices` map, an arbitrary match via `Object.keys(prices).find(k => modelFamily(k) === fam)`. This lets not-yet-added model versions still resolve to a plausible family price without code changes, at the cost of accepting a `source: 'family'` guess that could be materially wrong if pricing has diverged across versions within a family.

`freshInputTokens()` (lines 216-230) is a notable non-pattern: an "identity function with history" that now trivially returns `r.input_tokens` but previously subtracted `cache_read_tokens` for OpenAI-wire providers. It is intentionally retained rather than inlined at its single call site in `cellCostUsd()`, with an inline comment warning that reintroducing the subtraction would corrupt already-fixed rows. This is dead-looking code kept deliberately as a named regression guardrail.

`cellCostUsd()` (lines 236-249) composes three independently fallback-capable subsystems — `priceForModel()`, `budgetProvider()`, and `providerScale` — in a single expression, with none aware of the others.

## Integration Points

`priceForModel()` is a pure function fully decoupled from provider/billing context; provider-specific scaling is composed at the `cellCostUsd()` call site rather than inside price resolution, meaning it resolves identically for a copilot-billed and a claude-max-billed call of the same model. This separation ensures a pricing bug and a provider-scaling bug cannot mask each other, though nothing validates that the three composed values (price, budget bucket, scale) are mutually consistent — an unrecognized provider's scale can silently default to 1 via `?? 1`.

Upstream, `isSynthetic()` (lines 69-77) filters test rows out of `monthlySeries` and other aggregation paths before they ever reach `priceForModel()`. The function itself has no synthetic-awareness — this is a caller-enforced invariant, not a type-level guarantee, so any new aggregation path skipping the `isSynthetic()` check would silently price synthetic rows into real totals.

Sibling entity BudgetForMonthOverride, implemented as `budgetForMonth()` (lines 56-62), shares the same architectural philosophy: `hasOwnProperty` is used to distinguish an explicit `null` override from an absent key, preserving append-only historical semantics analogous to how `priceForModel` preserves version-tolerant family fallback rather than mutating pricing rules in place.

## Usage Guidelines

Developers extending this system should preserve the tier ordering (exact → fast → family → none) and never bypass `priceForModel()`'s recursion by adding a parallel fast-mode lookup. New aggregation paths must apply `isSynthetic()` before calling into pricing, since the function performs no filtering of its own. `FAMILY_REPRESENTATIVE` and `modelPrices` are configuration-as-data (plain objects), not a rules engine — adding new family-matching heuristics requires code changes, not just config edits. Finally, do not remove `freshInputTokens()` or "simplify" `budgetForMonth()`'s hasOwnProperty check to a `??` chain; both are comment-documented guardrails against previously-fixed defects reintroducing themselves.


## Hierarchy Context

### Parent
- [AgentProviderSplicing](./AgentProviderSplicing.md) -- [LLM] The cost-model.ts module in the dashboard's cost tab implements a layered price-resolution strategy in priceForModel(): exact model key match, then fast-mode suffix stripping with a 2x multiplier via scalePrice(), then family-based fallback through FAMILY_REPRESENTATIVE. This mirrors the same 'tiered precedence resolution' philosophy seen elsewhere in the LLM subsystem (e.g. getLLMMode()'s three-tier fallback), suggesting a project-wide convention of building explicit precedence chains rather than single flat lookups whenever provider/model identity is ambiguous or evolving.

### Siblings
- [ModelFamilyFallback](./ModelFamilyFallback.md) -- [LLM] priceForModel() in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements the ModelFamilyFallback logic as a three-tier resolution chain: exact key match against `prices[normalized]`, then a fast-mode branch that strips the `-fast` suffix (FAST_MODE_SUFFIX) and recurses into priceForModel() on the base model before applying FAST_MODE_MULTIPLIER via scalePrice(), and only then the family fallback that walks FAMILY_REPRESENTATIVE[modelFamily(model)] before falling back further to `Object.keys(prices).find(k => modelFamily(k) === fam)`. The ordering is deliberate and load-bearing: fast-mode is checked before the family fallback specifically so an explicit `<model>-fast` row in modelPrices can still override the multiplier rule via the exact-match path on the recursive call, and the comments explicitly document that reversing this order would let the family fallback silently mis-price fast-mode rows at the standard rate with no warning (`priced: true` either way).
- [BudgetForMonthOverride](./BudgetForMonthOverride.md) -- [LLM] BudgetForMonthOverride, realized as budgetForMonth() in integrations/system-health-dashboard/src/components/cost/cost-model.ts, implements month-scoped precedence over a standing cap: it checks Object.prototype.hasOwnProperty.call(byMonth, month) before falling back to b.monthlyEur, and explicitly distinguishes an override key that maps to null ('no cap that month') from a key that is simply absent ('use the standing cap'). This three-way semantic (present-and-null vs present-and-set vs absent) is easy to collapse accidentally with a simpler `byMonth?.[month] ?? b.monthlyEur` expression, which is exactly the bug the hasOwnProperty guard exists to prevent — a naive `??` chain would silently promote an intentional null override back to the standing cap.


---

*Generated from 10 observations*

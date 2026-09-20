# ModelFamilyFallback

**Type:** Detail

# ModelFamilyFallback — Technical Insight Document

## What It Is

ModelFamilyFallback is the model-pricing resolution logic implemented in `priceForModel()` within `integrations/system-health-dashboard/src/components/cost/cost-model.ts` (lines 153-179). It resolves an arbitrary LLM model identifier to a `ResolvedPrice` by walking a three-tier chain: exact key match against `prices[normalized]`, a fast-mode branch that strips the `-fast` suffix (`FAST_MODE_SUFFIX`) and recursively resolves the base model before scaling via `scalePrice()` (lines 145-151), and finally a family-based fallback that consults the `FAMILY_REPRESENTATIVE` table (lines 118-128) before doing a last-resort scan of `prices` for any key sharing the same family. Supporting this chain is `modelFamily()` (lines 100-116), a substring-classification function that assigns any model string to a `ModelFamily` bucket used by both the family fallback and the representative table.

As a child of DashboardCostModel and a member of the AgentProviderSplicing component group, ModelFamilyFallback exists specifically to ensure the cost tab in the system-health-dashboard never fails to produce a price, even for unrecognized or newly-released model names.

## Architecture and Design

The defining pattern here is **chain-of-responsibility / tiered precedence resolution**, matching the same philosophy the parent AgentProviderSplicing describes for `getLLMMode()` elsewhere in the LLM subsystem: rather than a flat lookup table, the system builds an explicit, ordered list of increasingly approximate resolution strategies. The ordering is not incidental — it is load-bearing. Fast-mode stripping is deliberately checked *before* the family fallback specifically so that an explicit `<model>-fast` row can still win via the exact-match path on the recursive call; reversing this order would let the family fallback silently mis-price fast-mode rows at the standard rate, with no error surfaced (`priced: true` in both cases).

A second core pattern is **fail-soft degradation with explicit provenance tagging**. Rather than collapsing the resolution outcome into a boolean "found," `ResolvedPrice.source` records which rule fired (`'exact' | 'family' | 'fast' | 'none'`). This is architecturally identical to the sibling PriceForModelResolution's stated design goal — answering "which rule fired," not just "what price" — and is explicitly compared to `use-classifier-judge.ts`'s separation of `enabled` from `reachable`: both refuse to compress multi-state resolution into a single flag, because doing so would make a billing drift invisible.

Sibling component BudgetForMonthOverride demonstrates a related but distinct discipline — using `hasOwnProperty` to preserve the difference between "absent" and "present-but-null" — reflecting a shared house style in cost-model.ts of resisting the temptation to over-simplify multi-state logic into terse expressions (`??` chains, plain booleans) that quietly discard information.

## Implementation Details

`modelFamily()` classifies via case-insensitive `includes()` checks in a fixed if-chain order, with only one explicit guard: 'gpt-4o-mini' is checked before 'gpt-4o' to prevent the broader substring from shadowing the narrower one. Other families ('sonnet', 'opus', 'haiku', 'fable') have no such guards, meaning a hypothetical model name matching multiple substrings resolves according to if-chain order rather than any precision rule. This is accepted brittleness in service of a stated design goal: adding a new model variant should never require a hand-maintained twin entry.

`FAMILY_REPRESENTATIVE` stores an *ordered preference list* per family, not an exhaustive membership list — e.g., `opus: ['claude-opus-5', 'claude-opus-4.8', 'claude-opus-4.6']`, where `'claude-opus-4.6'` doesn't even exist in `DEFAULT_COST_CONFIG.modelPrices`. `priceForModel()` iterates this list and returns on first hit, silently skipping missing keys — the list functions as "most canonical pricing to inherit from," with stale/forward-compatible entries tolerated.

`scalePrice()` is a small pure helper applying `FAST_MODE_MULTIPLIER` (2), documented as verified for exactly one model (Opus 5) and assumed by analogy for a second (Opus 4.8). The code explicitly documents its own escape hatch: if tiers diverge, add an explicit `<model>-fast` row, which wins via the exact-match path — the same "restate then allow explicit override" shape seen in `offload-gates.ts`.

The worst case — `fam === 'other'` with no match anywhere — returns a fully-formed `ResolvedPrice` with a zeroed `ModelPrice` and `priced: false`, never a thrown exception, mirroring the same never-throw convention independently used by `model-limits.cjs`'s `deriveLimits()` and DMR's `checkDMRAvailability()`.

## Integration Points

`priceForModel()` is a pure function with explicit "No React here" scoping in cost-model.ts, keeping the fallback policy testable independent of the UI layer. Its recursive self-call (fast-mode branch calling `priceForModel(base, prices)`) reuses rather than duplicates the exact-match and family-fallback logic — an implementation efficiency that comes at the cost of requiring careful reading to understand evaluation order.

The primary consumer is `cellCostUsd()` (lines 207-221), which multiplies token counts by `priceForModel().price`. Critically, this is also the weakest integration point: `cellCostUsd()` discards both `priced` and `source`, meaning an unrecognized model silently costs €0.00 rather than surfacing as a flagged/unpriced row in `monthlySeries()` or pivot aggregations. The rich three-way provenance signal is computed but currently only a UI-only affordance, not an accounting safeguard threaded through to consumers.

`modelFamily()` and `FAMILY_REPRESENTATIVE` are two decoupled tables keyed by the same `ModelFamily` union type — adding a new family requires updating both in sync, with no compiler-enforced link beyond the shared type.

## Usage Guidelines

Developers extending model coverage should add new pricing rows to `modelPrices` rather than special-casing `priceForModel()`; the rule-over-enumeration design (fast-mode multiplier as an orthogonal rule vs. per-model duplicate rows) exists precisely to avoid that maintenance burden. When two pricing tiers diverge from the assumed `FAST_MODE_MULTIPLIER`, add an explicit `<model>-fast` row rather than modifying the multiplier — this is the documented override path.

Anyone modifying the evaluation order in `priceForModel()` must preserve fast-mode-before-family-fallback ordering; this is explicitly documented as load-bearing. When adding a new `ModelFamily`, update both `modelFamily()`'s substring chain and `FAMILY_REPRESENTATIVE` together, being mindful of substring-shadowing (as with `gpt-4o-mini`/`gpt-4o`).

Most importantly, any future work on cost accounting accuracy should prioritize threading `ResolvedPrice.source` through `cellCostUsd()` and into `monthlySeries()`/pivot aggregations, since this is the identified gap where a rich fail-soft signal currently goes unused, allowing unpriced models to silently appear as zero-cost rather than flagged for operator review.


## Hierarchy Context

### Parent
- [AgentProviderSplicing](./AgentProviderSplicing.md) -- [LLM] The cost-model.ts module in the dashboard's cost tab implements a layered price-resolution strategy in priceForModel(): exact model key match, then fast-mode suffix stripping with a 2x multiplier via scalePrice(), then family-based fallback through FAMILY_REPRESENTATIVE. This mirrors the same 'tiered precedence resolution' philosophy seen elsewhere in the LLM subsystem (e.g. getLLMMode()'s three-tier fallback), suggesting a project-wide convention of building explicit precedence chains rather than single flat lookups whenever provider/model identity is ambiguous or evolving.

### Siblings
- [PriceForModelResolution](./PriceForModelResolution.md) -- [LLM] priceForModel() in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements a three-tier resolution ladder with an explicit `ResolvedPrice.source` discriminant ('exact' | 'family' | 'fast' | 'none') rather than a boolean 'found' flag. This is a deliberate observability choice: the function doesn't just answer 'what price', it answers 'which rule fired', which lets any caller (e.g. cellCostUsd) or a future debugging UI distinguish a confidently-priced exact match from a family-fallback guess without re-deriving the logic. The recursive call `priceForModel(base, prices)` for the fast-mode strip-and-retry means the 'exact' and 'family' branches are reused rather than duplicated for the fast path — the recursion, not a second copy of the lookup table, is what keeps 'fast' honest.
- [BudgetForMonthOverride](./BudgetForMonthOverride.md) -- [LLM] BudgetForMonthOverride, realized as budgetForMonth() in integrations/system-health-dashboard/src/components/cost/cost-model.ts, implements month-scoped precedence over a standing cap: it checks Object.prototype.hasOwnProperty.call(byMonth, month) before falling back to b.monthlyEur, and explicitly distinguishes an override key that maps to null ('no cap that month') from a key that is simply absent ('use the standing cap'). This three-way semantic (present-and-null vs present-and-set vs absent) is easy to collapse accidentally with a simpler `byMonth?.[month] ?? b.monthlyEur` expression, which is exactly the bug the hasOwnProperty guard exists to prevent — a naive `??` chain would silently promote an intentional null override back to the standing cap.


---

*Generated from 10 observations*

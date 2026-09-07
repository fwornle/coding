# ModelFamilyPriceResolution

**Type:** Detail

If no representative key is present, priceForModel() falls back further by scanning Object.keys(prices) for any key whose own modelFamily() matches, returning source:'family'; if nothing matches it returns a zeroed ModelPrice with priced:false, source:'none'.

# ModelFamilyPriceResolution — Technical Insight Document

## What It Is

ModelFamilyPriceResolution is implemented in `cost-model.ts`, centered around the `priceForModel()` function and its supporting classification logic `modelFamily()`. It is a fallback-cascading price lookup mechanism that resolves a cost per model string by progressively degrading from exact key matches to family-level approximations, and finally to an explicit "unpriced" state. As a child concept under the parent component **ModelNormalization**, it consumes model identifiers that are nominally "normalized" and maps them against `CostConfig.modelPrices` keys to produce a `ModelPrice` result annotated with a `source` field describing how confidently the price was resolved.

## Architecture and Design

The design follows a tiered resolution strategy: exact match → family representative → family scan → zeroed default. `priceForModel()` first attempts `prices[normalized]`, tagging the result `source: 'exact'`. Notably, the observations reveal that "normalized" is something of a misnomer here — the value used is the raw, unaltered model string, meaning no actual canonicalization (case folding, alias resolution, etc.) occurs before this lookup. This is an important architectural gap: the naming implies normalization happens upstream in ModelNormalization, but the actual behavior in this function is a pass-through.

When the exact key is absent, the system falls back to `FAMILY_REPRESENTATIVE`, a static map from each `ModelFamily` bucket to one or two canonical `modelPrices` keys (e.g., `opus -> ['claude-opus-4.8', 'claude-opus-4.6']`). This is a curated lookup table trading precision for availability — rather than failing, it substitutes a "representative" price for the family. If even that representative key isn't present in `prices`, the function performs a broader scan of `Object.keys(prices)`, classifying each existing key via `modelFamily()` and returning the first match with `source: 'family'`. This scan-based fallback is more expensive (O(n) over price keys) but provides resilience against partial or evolving price configs. If nothing matches at any tier, the function returns a zeroed `ModelPrice` with `priced: false, source: 'none'` — an explicit sentinel rather than throwing or returning undefined.

## Implementation Details

The classification engine, `modelFamily()`, buckets model strings using simple substring checks (`m.includes('haiku')`, `m.includes('gpt-5') || m.includes('gpt5')`, etc.) into a fixed enum-like set: `'haiku'`, `'sonnet'`, `'opus'`, `'fable'`, `'gpt-4o-mini'`, `'gpt-4o'`, `'gpt-5'`, `'other'`. This is a heuristic, order-sensitive classifier — likely sensitive to check ordering (e.g., `gpt-4o-mini` must be checked before `gpt-4o` to avoid misclassification, though the exact ordering guarantees aren't detailed in observations).

The `FAMILY_REPRESENTATIVE` table is the linchpin of the fallback tier, hardcoding known-good price keys per family so that even unseen or newly-released model strings (e.g., a new Opus variant) can still resolve to a sane price via family membership. The final fallback — scanning `Object.keys(prices)` and re-running `modelFamily()` against each — reuses the same classification function bidirectionally: once to classify the input model, and once to classify each candidate price key, checking for equality of bucket.

The `source` field (`'exact' | 'family' | 'none'`) is the primary observability mechanism, letting callers distinguish precise pricing from approximated or missing pricing without inspecting the underlying keys.

## Integration Points

ModelFamilyPriceResolution sits directly beneath **ModelNormalization**, which nominally normalizes model identifiers before they reach `CostConfig.modelPrices` keys consumed by `priceForModel()`. However, since the "normalized" value in practice is unmodified, the actual normalization contract between these two components is weaker than the naming suggests — a point worth flagging for future maintenance.

Its sibling component, **BudgetProviderMapping** (`budgetProvider()` in the same `cost-model.ts` file), shares the same file and general "classify-by-substring-then-fallback-to-default" philosophy: `budgetProvider()` checks for `'copilot'` or `'github'` substrings and otherwise defaults to `'claude-max'`. Both components follow a pattern of lightweight string-based heuristics rather than structured metadata lookups, suggesting a consistent (if informal) convention within `cost-model.ts` for resolving categorical properties from free-form identifier strings.

## Usage Guidelines

Developers extending `modelFamily()` should be careful about substring check ordering, since overlapping tokens (like `gpt-4o` vs `gpt-4o-mini`) can produce misclassification if checked in the wrong sequence. When adding new models to `CostConfig.modelPrices`, populating an exact key is preferable to relying on `FAMILY_REPRESENTATIVE` fallback, since the family-representative and family-scan paths introduce approximation risk (`source: 'family'`) rather than guaranteed pricing accuracy. Callers of `priceForModel()` should always check the `source` field before trusting the returned price for billing-sensitive logic, treating `'none'` results as requiring explicit handling (e.g., alerting or defaulting) rather than silent zero-cost assumptions. Finally, given that "normalization" is currently a no-op pass-through, any future work should not assume case-insensitivity or alias resolution happens automatically before price lookup — this should be verified or implemented explicitly if needed.


## Hierarchy Context

### Parent
- [ModelNormalization](./ModelNormalization.md) -- Model identifiers normalized here feed directly into CostConfig.modelPrices keys consumed by priceForModel() in cost-model.ts

### Siblings
- [BudgetProviderMapping](./BudgetProviderMapping.md) -- budgetProvider() in cost-model.ts returns 'copilot' when the lowercased provider includes 'copilot' or equals 'github', otherwise defaults to 'claude-max' for anthropic/claude-code/max-oauth-passthrough.


---

*Generated from 4 observations*

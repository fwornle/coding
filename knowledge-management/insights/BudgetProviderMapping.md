# BudgetProviderMapping

**Type:** Detail

isOpenAIWireProvider() is a related classification distinguishing OpenAI-wire providers (copilot, gh-copilot equivalents, opencode) from Anthropic-wire ones, kept for historical wire-semantics reference even though freshInputTokens() no longer needs it.

# BudgetProviderMapping — Technical Insight Document

## What It Is

BudgetProviderMapping is implemented via the `budgetProvider()` function in `cost-model.ts`. It is a classification utility that collapses the full space of provider identifiers used throughout the system into exactly two budget categories: `'copilot'` and `'claude-max'`. The function applies simple string-matching logic: any provider string whose lowercased form includes `'copilot'` or equals `'github'` maps to `'copilot'`; everything else (covering `anthropic`, `claude-code`, `max-oauth-passthrough`, and other Anthropic-family identifiers) defaults to `'claude-max'`. This binary mapping is the bridge between the diverse, free-form provider naming conventions used elsewhere in the codebase and the fixed two-key budget configuration structure.

## Architecture and Design

The design reflects a deliberate simplification strategy: rather than maintaining budget tracking per individual provider or model, the system collapses providers into two coarse-grained buckets tied to billing/cost semantics (subscription-style Copilot usage vs. Claude-max/Anthropic usage). This is a classic "many-to-few" normalization pattern, similar in spirit to its sibling ModelFamilyPriceResolution, though notably simpler — ModelFamilyPriceResolution actually performs no real canonicalization (the "normalized" value is just the raw model string), whereas BudgetProviderMapping does perform genuine reduction of the input space into two semantic categories.

As a child of ModelNormalization, this component participates in the broader normalization pipeline that feeds into `CostConfig.modelPrices` and, by extension, `priceForModel()`. However, its output feeds a different consumer than the model-price path: it directly drives `DEFAULT_COST_CONFIG.budgets`, which stores `BudgetConfig` entries keyed exactly to `'copilot'` and `'claude-max'`. This creates a clear separation of concerns — model identifiers are normalized for price lookup, while provider identifiers are separately normalized for budget-bucket assignment, even though both flow through the same conceptual "normalization" layer under ModelNormalization.

## Implementation Details

The core mechanism is a lowercase substring/equality check with no external configuration or lookup table — the mapping rules are hardcoded in `budgetProvider()`. This is intentionally lightweight: no enum, no registry, just conditional string logic. The two possible outputs directly correspond to keys in `DEFAULT_COST_CONFIG.budgets`, where each `BudgetConfig` entry defines `monthlyEur` (a baseline monthly budget in euros), an optional `monthlyEurByMonth` map for per-month overrides, an `enforce` flag controlling whether the budget is a hard limit, and a `budgetBasis` field describing what the budget is measured against.

A related but distinct function, `isOpenAIWireProvider()`, performs a different classification along the axis of wire-protocol semantics rather than budget semantics — distinguishing OpenAI-wire providers (copilot, gh-copilot equivalents, opencode) from Anthropic-wire providers. Notably, this function is now largely vestigial: `freshInputTokens()` no longer depends on it, but it is retained in the codebase as a historical/reference artifact for wire-format classification logic, illustrating that not all classification functions in this area are actively load-bearing.

## Integration Points

The primary integration point is `DEFAULT_COST_CONFIG.budgets`, which is structurally dependent on `budgetProvider()` producing exactly the two keys `'copilot'` and `'claude-max'` — any change to the mapping logic that produced a third value would break this configuration's key structure. Upstream, the function's input is any provider string in use across the system (anthropic, claude-code, max-oauth-passthrough, github, copilot variants), meaning it interacts implicitly with wherever provider strings are generated or passed through the pipeline.

Within the parent ModelNormalization component, BudgetProviderMapping operates in parallel with, but independently of, the model-identifier normalization that feeds `priceForModel()`. The sibling ModelFamilyPriceResolution consumes normalized model strings (functionally raw/unchanged) for exact-match price lookups with `source: 'exact'`, while BudgetProviderMapping consumes provider strings for budget-bucket assignment — the two normalization paths do not share logic despite both living under the same parent.

## Usage Guidelines

Developers extending provider support should be aware that `budgetProvider()` uses a default-to-`'claude-max'` fallback strategy — any new or unrecognized provider string that doesn't match the copilot patterns will silently be budgeted under `'claude-max'`. This is a safe default for Anthropic-family providers but could misclassify genuinely new provider types if not updated deliberately. When adding new budget categories, both `budgetProvider()` and the `DEFAULT_COST_CONFIG.budgets` key set must be updated in tandem, since the mapping function's output space is the direct input to that configuration.

`isOpenAIWireProvider()` should not be assumed to be part of any active budget or token-counting logic — it is preserved for historical wire-semantics reference, and its classification (copilot, gh-copilot, opencode as OpenAI-wire) should not be conflated with the budget mapping's copilot/claude-max split, even though both involve similar provider name substrings. Developers should treat these as two independent classification schemes serving different purposes (budgeting vs. wire protocol), despite their overlapping vocabulary.


## Hierarchy Context

### Parent
- [ModelNormalization](./ModelNormalization.md) -- Model identifiers normalized here feed directly into CostConfig.modelPrices keys consumed by priceForModel() in cost-model.ts

### Siblings
- [ModelFamilyPriceResolution](./ModelFamilyPriceResolution.md) -- priceForModel() in cost-model.ts first checks prices[normalized] for an exact hit, setting source: 'exact'; the 'normalized' value is actually just the raw model string unchanged, so no real canonicalization occurs before lookup.


---

*Generated from 3 observations*

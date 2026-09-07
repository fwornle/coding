# ModelFamilyPricing

**Type:** Detail

modelFamily() in cost-model.ts maps model substrings like 'haiku', 'sonnet', 'opus', 'fable', 'gpt-4o-mini', 'gpt-4o', 'gpt-5' to a ModelFamily enum, defaulting to 'other'

# ModelFamilyPricing — Technical Insight Document

## What It Is

ModelFamilyPricing is a resolution strategy implemented in `cost-model.ts`, centered on two cooperating functions: `modelFamily()` and `priceForModel()`. `modelFamily()` classifies a raw model identifier by scanning for known substrings ('haiku', 'sonnet', 'opus', 'fable', 'gpt-4o-mini', 'gpt-4o', 'gpt-5') and mapping them to a `ModelFamily` enum value, falling back to `'other'` when no substring matches. This classification underpins `priceForModel()`, which is the pricing lookup entry point used by its parent, CostModelEngine. Together these functions provide a tiered fallback mechanism so that pricing can be resolved even for model identifiers that don't have an exact price entry.

## Architecture and Design

The design follows a three-tier resolution pattern, explicitly implemented in `priceForModel()`:

1. **Exact match** — the function first checks for the literal model key in the `prices` map, returning a result tagged `source:'exact'`.
2. **Family-representative fallback** — if no exact match exists, it consults `FAMILY_REPRESENTATIVE`, a mapping from each `ModelFamily` to an ordered list of "canonical" model keys likely to exist in `modelPrices` (e.g., `opus -> ['claude-opus-4.8','claude-opus-4.6']`). This tier attempts to find pricing for a known-good representative of the family before resorting to broader search.
3. **Generic family scan** — if no representative key hits, the function scans all `Object.keys(prices)`, computing `modelFamily()` for each key and returning the first one whose family matches, tagged `source:'family'`.

If all three tiers fail, `priceForModel()` returns a zero-priced `ModelPrice` object with `priced:false` and `source:'none'`, rather than throwing an exception. This is a deliberate fail-soft design: pricing resolution failures degrade gracefully into a well-typed "unknown cost" result rather than halting the calling code path.

The `source` field (`'exact' | 'family' | 'none'`) acts as a provenance tag, letting callers and downstream reporting distinguish precise pricing from approximated or missing pricing — an important trait for cost auditing and debugging.

## Implementation Details

- `modelFamily(modelId)`: performs substring matching against known model name fragments and returns a `ModelFamily` enum member, defaulting to `'other'` for unrecognized identifiers. This is a pure, stateless classifier reused by both the representative and generic-scan tiers.
- `FAMILY_REPRESENTATIVE`: a static lookup table mapping each family to an ordered array of specific price-table keys, effectively encoding "best guess" defaults per family (e.g., preferring `claude-opus-4.8` over `claude-opus-4.6` for the opus family).
- `priceForModel(modelId, prices)`: orchestrates the three tiers in sequence — exact lookup, representative lookup, generic scan — short-circuiting at the first successful match.
- Failure path: constructs a zero-priced `ModelPrice` with explicit `priced:false` / `source:'none'` flags instead of throwing, making the "unknown model" case a first-class, typed outcome rather than an exceptional control-flow path.

## Integration Points

ModelFamilyPricing is a direct component of **CostModelEngine**, which implements the full `priceForModel()` resolution logic as its defining behavior. It sits alongside two sibling resolution strategies within the same engine:

- **BudgetResolution**, whose `budgetForMonth()` similarly implements a fallback pattern (own-property month-key match before falling back to `b.monthlyEur`), suggesting a consistent engine-wide idiom of "specific match first, generic default second."
- **WireProtocolTokenSemantics**, whose `isOpenAIWireProvider()` classifies providers (copilot/github/opencode) by wire protocol (OpenAI vs Anthropic), a categorization step that — like `modelFamily()` — precedes pricing/semantics decisions elsewhere in the engine.

Both siblings and ModelFamilyPricing share the same design idiom of tiered/fallback classification within `cost-model.ts`, reinforcing that CostModelEngine's overall architecture favors layered resolution over rigid exact-match-only lookups.

## Usage Guidelines

- Treat the `source` field on the returned `ModelPrice` as significant metadata — code consuming pricing results should check whether pricing was `'exact'`, `'family'`, or `'none'` before treating costs as authoritative, especially for billing-sensitive contexts.
- When adding new models, prefer adding an exact key to `prices` and, where appropriate, updating `FAMILY_REPRESENTATIVE` for the relevant family — this keeps the fallback path predictable and prioritizes known-good representative prices over an unordered generic scan.
- New model substrings should be added carefully to `modelFamily()`'s matching logic to avoid inadvertently reclassifying unrelated model IDs (e.g., ensure new substrings don't overlap existing ones like 'gpt-4o' vs 'gpt-4o-mini').
- Because unresolved models return `priced:false` silently rather than throwing, downstream consumers must explicitly check `priced`/`source` rather than assuming any non-null return implies valid pricing.


## Hierarchy Context

### Parent
- [CostModelEngine](./CostModelEngine.md) -- priceForModel() implements a three-tier resolution: exact model key match, family-representative fallback via FAMILY_REPRESENTATIVE, then generic family match, defaulting to a zero-priced 'none' source

### Siblings
- [BudgetResolution](./BudgetResolution.md) -- budgetForMonth() in cost-model.ts checks b.monthlyEurByMonth for an own-property match on the 'YYYY-MM' key before falling back to b.monthlyEur
- [WireProtocolTokenSemantics](./WireProtocolTokenSemantics.md) -- isOpenAIWireProvider() in cost-model.ts flags copilot/github/opencode providers as speaking the OpenAI wire versus Anthropic wire


---

*Generated from 5 observations*

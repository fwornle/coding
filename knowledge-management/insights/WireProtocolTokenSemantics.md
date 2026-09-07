# WireProtocolTokenSemantics

**Type:** Detail

freshInputTokens() is now the identity function on r.input_tokens, per its docstring, since the proxy now subtracts cache reads at the parse boundary (openAIFreshInputTokens)

# WireProtocolTokenSemantics

## What It Is

WireProtocolTokenSemantics is a conceptual detail within `cost-model.ts` that governs how token accounting differs depending on which wire protocol a model provider speaks. It is anchored by two key functions: `isOpenAIWireProvider()`, which classifies `copilot`, `github`, and `opencode` providers as OpenAI-wire speakers (as opposed to Anthropic-wire), and `freshInputTokens()`, which computes the "fresh" (non-cached) input token count for cost calculations. This entity captures the semantic distinction between wire formats and how that distinction determines the correct token-counting logic — a foundational concern for the parent CostModelEngine, since accurate cost computation depends entirely on correct token attribution.

## Architecture and Design

The design centers on a boundary-shifting pattern: rather than having downstream cost logic perform protocol-specific adjustments, the system pushes cache-token normalization upstream to the parse boundary. `freshInputTokens()` is now simply the identity function on `r.input_tokens` — all the complexity of subtracting cache reads has been relocated into `openAIFreshInputTokens`, which operates earlier in the pipeline when OpenAI-wire responses are first parsed. This reflects a deliberate architectural decision to normalize heterogeneous wire formats as early as possible, so that once data reaches `freshInputTokens()`, it is already uniform regardless of whether it originated from an OpenAI-wire or Anthropic-wire provider.

This is a single-responsibility split: `isOpenAIWireProvider()` handles protocol classification, while the actual arithmetic normalization happens elsewhere (`openAIFreshInputTokens`), keeping `freshInputTokens()` deliberately trivial. The trade-off is an implicit dependency — `freshInputTokens()`'s correctness relies entirely on upstream code having already done the subtraction, which is not locally visible from the function itself and is only documented via its docstring.

## Implementation Details

`isOpenAIWireProvider()` acts as a classification gate, checking provider identifiers against a known set (copilot, github, opencode) to determine wire semantics. This classification presumably feeds into decisions elsewhere in `cost-model.ts` about which parsing/normalization path a given response should take.

`freshInputTokens()` itself contains no branching logic anymore — it directly returns `r.input_tokens`. Its docstring is the load-bearing artifact here: it explicitly documents the historical reasoning (why subtraction was once needed) and explicitly warns against reintroducing `cache_read_tokens` subtraction at this layer. This is a "scar tissue" comment pattern — encoding institutional knowledge about a past bug/migration directly in the code to prevent regression.

The migration correctness is backed by `scripts/backfill-openai-wire-cache-split.mjs`, a one-time backfill script that corrected historical rows that were computed under the old (subtracting) semantics. This implies a data migration was necessary when the semantic boundary moved — historical records needed reprocessing to remain consistent with the new invariant that `input_tokens` is always already "fresh."

## Integration Points

WireProtocolTokenSemantics is a child concern of CostModelEngine, feeding into its `priceForModel()` three-tier resolution (exact match → family representative → generic family match) indirectly: correct token counts are a prerequisite input to any pricing computation, though pricing tier resolution itself is model-family-based rather than wire-protocol-based.

It sits alongside sibling concerns ModelFamilyPricing (`modelFamily()`, mapping model substrings to a `ModelFamily` enum) and BudgetResolution (`budgetForMonth()`). While ModelFamilyPricing addresses "which model" and BudgetResolution addresses "which time period's budget," WireProtocolTokenSemantics addresses "which wire format, and therefore which token-counting rule." These three concerns compose to form the full cost-calculation context within `cost-model.ts`.

The critical external integration point is `openAIFreshInputTokens`, which now owns the cache-read subtraction logic previously embedded in `freshInputTokens()`. This function operates at the parse boundary, before data reaches the cost-model layer described here.

## Usage Guidelines

Developers must not reintroduce `cache_read_tokens` subtraction inside `freshInputTokens()` — this is explicitly warned against in its docstring, since doing so would double-subtract cache reads already handled by `openAIFreshInputTokens` at parse time. Any change to token semantics for OpenAI-wire providers should be made in `openAIFreshInputTokens`, not in the cost-model layer.

If new OpenAI-wire providers are added, they must be registered in `isOpenAIWireProvider()` so that they are routed through the correct parse-time normalization. Because `freshInputTokens()` is now trivial, any bugs in fresh-token computation should be diagnosed upstream at the parse boundary rather than in `cost-model.ts`. Finally, any future changes to the wire-semantics boundary should consider whether a backfill script (analogous to `scripts/backfill-openai-wire-cache-split.mjs`) is needed to correct historical data under the old semantics.


## Hierarchy Context

### Parent
- [CostModelEngine](./CostModelEngine.md) -- priceForModel() implements a three-tier resolution: exact model key match, family-representative fallback via FAMILY_REPRESENTATIVE, then generic family match, defaulting to a zero-priced 'none' source

### Siblings
- [ModelFamilyPricing](./ModelFamilyPricing.md) -- modelFamily() in cost-model.ts maps model substrings like 'haiku', 'sonnet', 'opus', 'fable', 'gpt-4o-mini', 'gpt-4o', 'gpt-5' to a ModelFamily enum, defaulting to 'other'
- [BudgetResolution](./BudgetResolution.md) -- budgetForMonth() in cost-model.ts checks b.monthlyEurByMonth for an own-property match on the 'YYYY-MM' key before falling back to b.monthlyEur


---

*Generated from 3 observations*

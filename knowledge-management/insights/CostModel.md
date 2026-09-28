# CostModel

**Type:** SubComponent

## What It Is

CostModel is implemented in a single pure-logic module, `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, within the LLMAbstraction subsystem of the system-health-dashboard. It is explicitly documented as containing "No React here" — the module consumes server-provided `CostRow` and `CostConfig` shapes and performs budget resolution, price resolution, and synthetic-data filtering without any rendering concerns. It is the pricing and cost-accounting counterpart to the routing/tier-selection logic that lives elsewhere under LLMAbstraction.

![CostModel — Architecture](images/cost-model-architecture.png)

## Architecture and Design

CostModel is organized as three cooperating concerns, each realized as a child component: BudgetHistory (month-scoped budget resolution via `budgetForMonth`), PriceResolution (the ordered fallback pricing chain in `priceForModel`), and SyntheticRowFiltering (the `isSynthetic` guard). Each is a function-level responsibility within the same file rather than a separate module, reflecting a design choice to keep cost logic centralized and dependency-free.

The dominant pattern is the **ordered fallback/resolution chain**, seen most clearly in `priceForModel`: exact model key match, then fast-mode suffix strip-and-multiply (`FAST_MODE_SUFFIX = '-fast'`, `FAST_MODE_MULTIPLIER = 2` via `scalePrice`), then `FAMILY_REPRESENTATIVE` lookup, then any same-family key, finally a zero-priced `{priced: false, source: 'none'}` sentinel. The ordering is deliberate and fragile-by-intent: fast-mode checks run after exact match (so literal `<model>-fast` rows aren't shadowed) but before family fallback (so the multiplier rule doesn't get bypassed by a coarser lookup) — a three-way constraint that would silently regress if reordered for "readability." This pricing-side fallback chain is the structural sibling of the routing-side tier-priority logic described in the parent LLMAbstraction's session records ("LLM Routing Tier Priority"), where max-subscription providers must be tried before demotion to lower tiers — both encode the same "most-specific-first, most-generic-last" resolution philosophy.

A second pattern is **config override-by-exception**: `budgetForMonth` uses `Object.prototype.hasOwnProperty.call` on `monthlyEurByMonth` to distinguish an explicit `null` (no cap this month) from an absent key (fall back to standing cap) — two states that a naive truthy check would conflate.

A third pattern is **documentation-as-code via retained-but-unused functions**: `freshInputTokens` is now a pure identity function, and `isOpenAIWireProvider` is preserved purely to document the Anthropic-vs-OpenAI wire-protocol distinction in cache-token accounting, even though pricing no longer depends on it directly.

## Implementation Details

`budgetForMonth` resolves a per-month budget cap, treating an explicit `null` entry in `monthlyEurByMonth` as "no cap this month" versus an absent key meaning "use the standing cap" — a subtlety visible only in the `hasOwnProperty` guard.

`priceForModel` executes the four-stage fallback described above, scanning `Object.keys(prices)` with `modelFamily(k) === fam` when no family representative exists.

`freshInputTokens` used to subtract `cache_read_tokens` for OpenAI-wire providers, but that logic moved upstream to the proxy's parse boundary (`openAIFreshInputTokens`), with historical rows corrected by `scripts/backfill-openai-wire-cache-split.mjs`. Retaining the old subtraction here would double-compensate on already-corrected rows (e.g., input=135, cache_read=23264 would wrongly compute `max(0,135-23264)=0`).

`isSynthetic` filters rows tagged with `SYNTHETIC_PROVIDERS` (`fake-peer`) or `SYNTHETIC_MODELS` (`synthetic`, `<synthetic>`, `fake-model`), plus a prefix catch-all (`startsWith('fake')`/`startsWith('demo')`) to guard against unenumerated probe/demo naming — trading a small false-positive risk for open-ended coverage — before rows enter `monthlySeries` aggregation.

`cellCostUsd` prices `cache_read_tokens` and `cache_write_tokens` as distinct line items rather than folding them into input tokens, directly reflecting the AI SDK requirement (per the Usage Token Accounting session record) that prompt and cached tokens be reported separately so dashboards don't undercount cache consumption.

`budgetProvider()` collapses many underlying providers into two canonical subscription buckets, `copilot` and `claude-max`, simplifying downstream budget aggregation at the cost of per-provider granularity.

![CostModel — Relationship](images/cost-model-relationship.png)

## Integration Points

CostModel sits under LLMAbstraction alongside siblings LLMMockService, DMRProvider, ParseLlmJson, LLMWithProcessClient, OffloadRoutingUI, AgentModelConfigSplice, and ModelContextLimits, though observations confirm no direct code coupling to most of these — several (DMRProvider, ParseLlmJson) were explicitly ruled out as retrieval noise from filename-proximity rather than genuine relationships. Its most substantive external coupling is historical/documentary: pricing logic references rapid-llm-proxy's wire-protocol semantics (Anthropic vs OpenAI cache accounting, `usage-cache.ts`) even though `isOpenAIWireProvider` and `freshInputTokens` no longer act on that distinction directly — the actual subtraction now happens in the proxy's `openAIFreshInputTokens`. Internally, CostModel delegates its three responsibilities to BudgetHistory, PriceResolution, and SyntheticRowFiltering, all implemented as functions within the same `cost-model.ts` file rather than as separate modules.

## Usage Guidelines

Maintainers must preserve the `hasOwnProperty` distinction in `budgetForMonth`; collapsing it to a truthy/falsy check would silently merge "no cap" and "use standing cap" semantics. The three-stage ordering in `priceForModel` (exact → fast → family → none) must not be reordered without re-verifying the exact-match-then-fast-mode-then-family invariant. `freshInputTokens` and `isOpenAIWireProvider` should remain as documentary artifacts rather than be deleted as "dead code" — they encode a fact about wire-protocol cache accounting that would otherwise need re-derivation from provider name strings; conversely, they must not be reactivated to re-subtract cache tokens, since that logic has already moved upstream and backfilled historically. New synthetic/test naming conventions should be checked against `isSynthetic`'s prefix rules (`fake*`, `demo*`) before assuming a model name is safe from filtering — and conversely, legitimate model names should avoid those prefixes to prevent being silently excluded from cost totals.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'API Model Field and Token Count Reliability' and 'LLM Routing Tier Priority' session records both describe the same underlying tier-ordering defect — the routing/tier-selection logic was demoting to lower-tier providers as primary instead of preserving max-subscription-first fallback order — which is the routing-side counterpart to the pricing-side family/fast-mode fallback chain implemented in cost-model.ts's priceForModel.
- The 'Rapid-LLM-Proxy — Usage Token Accounting (cached_tokens split)' record establishes that usage responses must report prompt and cached tokens separately per the AI SDK spec so cost/usage dashboards don't undercount cached-token consumption — directly explaining why cost-model.ts's cellCostUsd prices cache_read_tokens and cache_write_tokens as distinct line items rather than folding them into input_tokens.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as a last resort — rather than demoting to lower-tier providers as primary

### Children
- [BudgetHistory](./BudgetHistory.md) -- [LLM] None of the supplied files define a component, file, or export named `BudgetHistory`. The only material that speaks to 'budget history' as a concept is the `BudgetConfig` interface and `budgetForMonth` function in integrations/system-health-dashboard/src/components/cost/cost-model.ts — and those are pure data-model helpers (month → cap resolution), not a rendering component. This looks like a case where retrieval surfaced the parent's cost-model.ts because it is thematically adjacent to a 'BudgetHistory' Detail node in the intent graph, not because it contains that node's actual implementation.
- [PriceResolution](./PriceResolution.md) -- [LLM] The core of PriceResolution is `priceForModel` in cost-model.ts, which implements a four-stage ordered fallback: exact key match against `prices[normalized]`, then a fast-mode suffix strip via `FAST_MODE_SUFFIX = '-fast'` and `scalePrice(resolved.price, FAST_MODE_MULTIPLIER)` (multiplier = 2), then family-representative lookup via `FAMILY_REPRESENTATIVE[fam]`, then any same-family key found by scanning `Object.keys(prices)` with `modelFamily(k) === fam`, and finally a zero-priced `{priced: false, source: 'none'}` sentinel. The ordering is deliberate and documented in-line: fast-mode is checked before family fallback so a hand-added `<model>-fast` row can still win via the exact-match recursive call, but after the exact match so the suffix-stripping logic never shadows a literal price-table entry — a three-way ordering constraint that would silently regress if a maintainer reordered the `if` blocks for readability.
- [SyntheticRowFiltering](./SyntheticRowFiltering.md) -- [LLM] The `SyntheticRowFiltering` component is concretely implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts` as the `isSynthetic(r: CostRow): boolean` function together with its two backing sets, `SYNTHETIC_MODELS` (`'synthetic'`, `'<synthetic>'`, `'fake-model'`) and `SYNTHETIC_PROVIDERS` (`'fake-peer'`). The function also catches anything not in the explicit sets via a prefix check — `m.startsWith('fake') || m.startsWith('demo')` — so a probe row using an unlisted model name like `demo-run-3` is still excluded, trading a small false-positive risk (a legitimately named model starting with 'fake' or 'demo' would be silently dropped from cost totals) for coverage against an open-ended set of test/demo naming conventions the author can't fully enumerate up front.

### Siblings
- [LLMMockService](./LLMMockService.md) -- [SESSION] PlantUML Diagram Generation — Wave 4 Syntax Failures ties LLMMockService to diagnostic work on syntax failures and truncation in generated .puml files produced during mocked/simulated runs.
- [DMRProvider](./DMRProvider.md) -- [LLM] None of the five retrieved code files reference DMRProvider, dmr-provider.ts, dmr-config.yaml, Docker Model Runner, or any OpenAI-compatible local-endpoint client. The retrieved set is `tests/features/copilot-model-ids.test.mjs`, `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, `.../llm-routing/offload-decision.tsx`, `.../llm-routing/use-classifier-judge.ts`, and `.../store/provider.tsx` — a drift-guard test, a pricing module, a routing-visualization component, a classifier-health hook, and a Redux provider wrapper, respectively. These are dashboard/observability and CI-guard code, not provider-client code, and share no function, class, import, or config key with the DMRProvider described in the parent context.
- [ParseLlmJson](./ParseLlmJson.md) -- [LLM] None of the supplied code files implement or reference the ParseLlmJson component. The five files retrieved — tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, .../llm-routing/offload-decision.tsx, .../llm-routing/use-classifier-judge.ts, and .../store/provider.tsx — are drift-guard tests, cost-accounting logic, an offload-policy UI card, a classifier-judge polling hook, and a Redux provider wrapper respectively. None contain a JSON-repair pipeline, a function named escapeControlCharsInStrings or truncateToLastCompleteElement, or any parsing of LLM completion text. This is retrieval-by-filename noise: these files sit near LLM-routing infrastructure but are not parse-llm-json.ts.
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] RapidLlmProxy — Universal Agent Routing, Worker Pool, Semantic Dispatch establishes that rapid-llm-proxy is the mandatory shared routing proxy all clients must go through, which this wrapper directly targets via /api/complete.
- [OffloadRoutingUI](./OffloadRoutingUI.md) -- [SESSION] Rapid-LLM-Proxy — Universal Agent Routing establishes rapid-llm-proxy as the mandatory routing authority these UI components mirror and must never silently diverge from.
- [AgentModelConfigSplice](./AgentModelConfigSplice.md) -- [LLM] tests/features/copilot-model-ids.test.mjs is a drift guard, not a routing implementation: it hardcodes a RETIRED list (currently ['claude-sonnet-4.6', 'claude-opus-4.6']) and asserts that integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs rewrites every one of them to a non-retired successor. The test explicitly checks that the Dockerfile invokes the alignment script AFTER the last `npm install` for semantic-analysis (via `findLastIndex`), because an npm install re-vendors @rapid/llm-proxy's dist and would silently undo the rewrite if the script ran first. This encodes a real incident (2026-09-20) where the vendored SDK named a retired model, Copilot returned 400, and Wave 3 fell through to `[llm] All providers failed`, writing a ~600-char stub instead of a ~4400-char analysis, with nothing in the logs naming the model.
- [ModelContextLimits](./ModelContextLimits.md) -- [LLM] None of the supplied files define, import, or reference an entity named 'ModelContextLimits', nor any construct for per-model context-window/token-ceiling limits (e.g. a max-tokens-per-model table, a truncation-by-context-size guard, or a 'does this prompt fit' check). The five files retrieved — cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx, and copilot-model-ids.test.mjs — were surfaced by filename/topic proximity to the parent LLM-routing area, not because they implement this component.


---

*Generated from 10 observations*

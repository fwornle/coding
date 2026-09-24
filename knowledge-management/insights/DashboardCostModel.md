# DashboardCostModel

**Type:** SubComponent

## What It Is

DashboardCostModel is implemented entirely in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`. It is a pure, side-effect-free TypeScript module that computes per-row and aggregate LLM usage costs for the system-health dashboard's Token Usage → Cost tab. It contains no React code; it exposes plain functions (`cellCostUsd`, `monthlySeries`, `budgetForMonth`, `priceForModel`, `freshInputTokens`) operating on plain interfaces (`CostRow`, `CostConfig`, `ModelPrice`, `ResolvedPrice`). As a child of the `LLMAbstraction` parent, it specializes that parent's broader LLM-catalogue concerns into a narrow, deterministic cost/budget arithmetic problem, and it directly contains `BudgetConfig`, the structure that encodes per-provider spending caps.

![DashboardCostModel — Architecture](images/dashboard-cost-model-architecture.png)

## Architecture and Design

The module's central pattern is separation of pure computation from rendering: all cost math lives in cost-model.ts and is consumed by dashboard components that fetch data externally. Data arrives pre-shaped as `CostRow[]` from `GET /api/token-usage/cost` and `CostConfig` from `GET /api/llm/settings` — the module itself performs no fetching.

Pricing resolution follows a precedence-chain pattern: `priceForModel()` walks exact key match → fast-mode strip-and-multiply → family-representative fallback (via `modelFamily()`/`FAMILY_REPRESENTATIVE`) → unpriced, each result tagged with a `ResolvedPrice.source` so callers know how confident a price is. Fast-mode variants are handled via a rule-over-duplication design: rather than hand-maintaining `<model>-fast` rows, `scalePrice()` applies `FAST_MODE_MULTIPLIER = 2` to whatever the base model resolves to — chosen specifically because a missing manual twin would silently fall through to family pricing at standard rate with `priced: true` and no warning.

`BudgetConfig` embodies a config-with-time-scoped-overrides pattern: `monthlyEurByMonth` overlays a standing `monthlyEur` default per calendar month via `budgetForMonth()`, using `hasOwnProperty` checks so an explicit `null` override is honored as "no cap" rather than falling through to the default — preserving historical budget judgments against retroactive changes.

## Implementation Details

`budgetForMonth()` (lines 60-66) resolves a month's cap by checking `monthlyEurByMonth` first; `DEFAULT_COST_CONFIG.budgets.copilot` (lines 76-89) is the concrete instance, recording a cap that moved 300→600→1000 EUR across August 2026 as extensions were approved, without rewriting the base 300 default.

`priceForModel()` (lines 130-176) implements the precedence chain described above. The 2x fast-mode multiplier is verified only for `claude-opus-5`; `claude-opus-4.8` is assumed identical rather than measured, a documented approximation.

`freshInputTokens()` (lines 200-222) is now a one-line identity (`return r.input_tokens`), but its docstring preserves the history of a removed bug: it used to subtract `cache_read_tokens` for OpenAI-wire providers to correct `prompt_tokens` inflation, but this became a double-correction once the upstream proxy began correcting the same value at parse time via `openAIFreshInputTokens`, producing exactly-zero fresh input on already-corrected rows. `isOpenAIWireProvider()` is retained anyway, purely because the wire-format distinction remains real and worth not re-deriving.

`budgetProvider()` (lines 97-108 area) normalizes every raw provider string into exactly two buckets — `copilot` and `claude-max` — via `BUDGET_PROVIDER_LABEL`, while `isSynthetic()` filters demo/probe rows (`SYNTHETIC_MODELS`, `SYNTHETIC_PROVIDERS`, `fake`/`demo` prefixes) inside `monthlySeries()`, at the aggregation boundary rather than ingestion.

`cellCostUsd()` (lines 225-241) is the single per-row cost function: it composes `freshInputTokens(r)`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` against a `priceForModel()` result, applies a `providerScale` multiplier keyed by `budgetProvider()`, and converts via `usdToEur()`. Every aggregate, including `monthlySeries()` and pivot logic, is built from this one function, so config changes propagate uniformly.

## Integration Points

![DashboardCostModel — Relationship](images/dashboard-cost-model-relationship.png)

Upstream, the `GET /api/token-usage/cost` endpoint is fed by `proxy-bridge/server.mjs`, the persistent launchd service (`com.coding.llm-cli-proxy`) described in the LLMServiceProvider work record; outages or restarts there are a plausible source of gaps or provider-mix anomalies, not defects in this module's aggregation. The removed double-subtraction bug in `freshInputTokens()` was resolved upstream too — the BudgetTracker work record establishes that proxy shims now split prompt/cached tokens per the AI SDK spec at parse time, making this module's former client-side compensation redundant.

Within the sibling set, DashboardCostModel shares its dashboard/proxy-consumer territory with OffloadRoutingDashboard and others, though several sibling lookups (DMRProvider, LLMJsonRepairUtility, ProxyClientWrapper) were retrieval misses against this same file set — cost-model.ts is not their implementation. Its only structural child is `BudgetConfig`.

## Usage Guidelines

Treat `cellCostUsd()` as the single source of truth for row-level cost; any new aggregate should compose it rather than recomputing pricing independently. When adjusting `modelPrices` or `providerScale` in `DEFAULT_COST_CONFIG`, expect the change to propagate to every dashboard view automatically. Budget edits should use `monthlyEurByMonth` overrides rather than mutating the standing cap, to avoid retroactively re-judging past months. Do not reintroduce cache-token compensation in `freshInputTokens()` without confirming the proxy's parse-time correction status, since duplicating it produces zero-value rows. Synthetic/demo rows are only filtered inside `monthlySeries()` — raw `CostRow[]` still contains them, so any new consumer of raw rows must apply `isSynthetic()` itself.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'Rapid-LLM-Proxy — Usage Token Accounting (cached_tokens split)' (about BudgetTracker) establishes that proxy shims must report prompt tokens and cached tokens separately per the AI SDK usage spec so downstream cost/usage dashboards don't undercount cached-token consumption — this is the upstream decision that cost-model.ts's `freshInputTokens()` docstring describes from the consumer side: the proxy's own parse-time split (`openAIFreshInputTokens`) is what made this dashboard's earlier client-side compensation redundant and then wrong.
- The work record 'LLM CLI Proxy — Provider Architecture and Restart Behavior' (about LLMServiceProvider) establishes that `proxy-bridge/server.mjs` runs as a persistent launchd service (`com.coding.llm-cli-proxy`) implementing tiered, network-mode-aware provider fallback. This is the upstream service whose usage logs feed `GET /api/token-usage/cost`, the endpoint cost-model.ts's `CostRow` interface is shaped to consume — a restart or outage of that service is a plausible source of gaps or provider-mix anomalies in the dashboard's monthly series, not a defect in the aggregation logic itself.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which API surface (Responses API vs /chat/completions), since some models are gated per-endpoint and mismatched combinations must be rejected rather than silently allowed

### Children
- [BudgetConfig](./BudgetConfig.md) -- [CGR] BudgetConfig (class) in cost-model.ts

### Siblings
- [LLMMockService](./LLMMockService.md) -- [SESSION] 'PlantUML Source Files (.puml) Versioning Policy' work record is filed under LLMMockService, indicating the component's manifest also absorbs unrelated documentation-versioning decisions rather than only LLM mode state.
- [DMRProvider](./DMRProvider.md) -- [LLM] None of the five retrieved files implement, import, or reference DMRProvider, dmrClient, checkDMRAvailability, or Docker Model Runner in any form. The files returned for this component — tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, .../llm-routing/offload-decision.tsx, .../llm-routing/use-classifier-judge.ts, and .../store/provider.tsx — belong to the rapid-llm-proxy routing/cost dashboard and its Redux shell, a different subsystem from the local Docker Model Runner inference tier the parent SubComponent description attributes to dmr-provider.ts. This is a filename-substring retrieval miss ('provider', 'model') rather than evidence that DMRProvider was folded into these files.
- [LLMJsonRepairUtility](./LLMJsonRepairUtility.md) -- [LLM] None of the retrieved code files implement or reference an 'LLMJsonRepairUtility' component. The five files supplied — tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx, integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts, and integrations/system-health-dashboard/src/store/provider.tsx — cover copilot model-id drift testing, cost/budget arithmetic, offload routing UI, classifier-judge health state, and a Redux provider wrapper respectively. None contains string-repair, control-character-escaping, or truncation logic. The only description of JSON-repair behaviour (escapeControlCharsInStrings, truncateToLastCompleteElement in parse-llm-json.ts) comes from the parent entity's own observations, not from any file body shown here, so it cannot be re-grounded as evidence for this SubComponent.
- [ProxyClientWrapper](./ProxyClientWrapper.md) -- [LLM] None of the retrieved files define or import a class, module, or export named `ProxyClientWrapper`. The five files present — `tests/features/copilot-model-ids.test.mjs`, `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`, and `integrations/system-health-dashboard/src/store/provider.tsx` — are dashboard-side consumers and test guards that read from or configure `rapid-llm-proxy` over HTTP; none of them wrap or instantiate a proxy HTTP client themselves. This looks like filename-substring retrieval surfacing the parent's ('LLMServiceProvider'/'LLMProxyClient') general neighbourhood rather than the `ProxyClientWrapper` SubComponent's own implementation file.
- [CopilotModelIdAlignment](./CopilotModelIdAlignment.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that mismatched model/endpoint combinations must be rejected rather than silently allowed, which is the same failure class this alignment script guards against for retired Copilot ids.
- [OffloadRoutingDashboard](./OffloadRoutingDashboard.md) -- [LLM] No file in the supplied set defines, exports, or references a component literally named "OffloadRoutingDashboard." The closest thematic match is `OffloadDecision` in `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, which is a dashboard card for offload routing — it toggles between 'config' and 'recorded' modes, renders a gate ladder (`GATES`, `RUNG_OFFLOADED`), and surfaces disagreements between the UI's own policy evaluation and the proxy's live resolution. This is very likely the entity the retrieval was trying to surface, but under a different code identifier, so any claim that 'OffloadRoutingDashboard is implemented at line X' would be fabricated rather than observed.
- [ModelContextLimitsCatalogue](./ModelContextLimitsCatalogue.md) -- [LLM] None of the five retrieved files implement or reference a model-context-limits catalogue (i.e. per-model max-token/context-window bookkeeping). tests/features/copilot-model-ids.test.mjs guards against retired Copilot model IDs causing 400s, integrations/system-health-dashboard/src/components/cost/cost-model.ts prices tokens already consumed, offload-decision.tsx and use-classifier-judge.ts route/classify calls by complexity band, and store/provider.tsx is a generic Redux bootstrap component unrelated to LLM models at all. No file defines a context-window ceiling, a 'maxTokens'/'contextLimit' field, or per-model capacity table that a 'ModelContextLimitsCatalogue' component would own.


---

*Generated from 10 observations*

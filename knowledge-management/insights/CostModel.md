# CostModel

**Type:** Detail

## What It Is

CostModel is implemented at `integrations/system-health-dashboard/src/components/cost/cost-model.ts` as a deliberately React-free module of pure functions over plain data types (`CostRow`, `CostConfig`, `BudgetConfig`). Its exports — `budgetForMonth`, `priceForModel`, `cellCostUsd`, `monthlySeries`, `isSynthetic`, `budgetProvider` — together implement pricing resolution, per-row USD cost aggregation, budget-cap lookup, and provider/synthetic-data classification for the system-health dashboard's cost tab. Unlike its dashboard neighbors, it contains zero fetch/useState/useEffect logic; all data acquisition (`GET /api/token-usage/cost`, `GET /api/llm/settings`) is left to an unseen caller.

## Architecture and Design

The defining architectural choice is strict separation of pure domain logic from React state and data fetching — a pattern not found elsewhere in the supplied set, where `offload-decision.tsx` and `use-classifier-judge.ts` (ClassifierJudgeHook) both mix fetch/useState directly into their logic. This keeps CostModel's pricing math independently testable and reusable outside any component tree.

Several smaller patterns reinforce this design: a historical-override map (`BudgetConfig.monthlyEurByMonth`) instead of a single mutable budget scalar, so past months are judged against the cap actually in force at the time rather than today's number; an ordered fallback ladder in `priceForModel()` (exact → fast-suffix → family) with an explicit `source` tag for traceability; and provider-string normalization (`budgetProvider()`) collapsing many raw identities into a small fixed billing-bucket set. All of these favor auditability and correctness-by-construction over minimal code.

## Implementation Details

`budgetForMonth()` looks up an exact month key in `monthlyEurByMonth` (honoring explicit `null` as "no cap that month") before falling back to `monthlyEur`, directly encoding the documented copilot budget history (300→600→1000).

`priceForModel()` resolves prices in a load-bearing order: exact match, then a fast-mode check stripping `-fast` and recursing before applying `FAST_MODE_MULTIPLIER` (2x), and only then family fallback via `modelFamily()`/`FAMILY_REPRESENTATIVE`. This ordering lets an explicit `<model>-fast` row override the multiplier and structurally prevents the failure mode of a missing fast-mode twin silently pricing at standard rate.

`freshInputTokens(r: CostRow)` is now a one-line identity function, but its docstring preserves the history of a deleted compensation: it used to subtract `cache_read_tokens` for OpenAI-wire rows, which became wrong once the proxy's `openAIFreshInputTokens()` began doing that subtraction at the parse boundary (plus a backfill script fixing historical rows). Leaving the old logic in place would have re-zeroed already-corrected rows (example: input=135, cache_read=23264 → old code wrongly returned 0).

`cellCostUsd()` is where this all cashes out into dollars — pricing fresh input, output, cache-read, and cache-write tokens separately against `ModelPrice`, then scaling by `cfg.providerScale[budgetProvider(r.provider)]`. `isSynthetic()` and `budgetProvider()` both bias toward under-counting real spend: excluding fake/demo rows, and collapsing non-copilot/github providers into a notional flat `'claude-max'` bucket.

## Integration Points

CostModel has no structural coupling to React or fetching — it expects a caller (outside this file) to supply `CostRow[]` and `CostConfig` already retrieved from `/api/token-usage/cost` and `/api/llm/settings`. Its documented dependency on the proxy's Anthropic-vs-OpenAI wire distinction is now entirely upstream: `freshInputTokens` trusts `r.input_tokens` unconditionally, meaning any regression in the proxy's cache-token accounting would silently mis-bill with no local defense.

Within the dashboard, CostModel sits alongside but is not called by `offload-decision.tsx` or ClassifierJudgeHook (`use-classifier-judge.ts`) — no import or call relationship exists despite shared directory proximity and overlapping proxy usage data. The parent entity "OffloadRoutingDashboard" has no concrete implementation in the supplied files; the closest thematic match is `OffloadDecision`, but this is a naming/retrieval mismatch rather than a structural relationship, so no genuine parent-child coupling should be assumed.

## Usage Guidelines

Any change to token-cost semantics should first ask whether the fix belongs upstream at the proxy's parse boundary rather than in `cellCostUsd()`, following the precedent set by `freshInputTokens`'s documented history — compensations must be deleted in lockstep with the defect they compensated for, not silently. When adjusting budgets, add entries to `monthlyEurByMonth` rather than overwriting `monthlyEur`, to preserve historical auditability. When adding model prices, respect the exact→fast→family resolution order in `priceForModel()`, since reordering it reintroduces the silent-mispricing failure mode it was built to eliminate. Finally, do not assume shared-directory files (`offload-decision.tsx`, `store/provider.tsx`, `copilot-model-ids.test.mjs`) are collaborators of CostModel merely due to proximity — this file set shows no such coupling.


## Hierarchy Context

### Parent
- [OffloadRoutingDashboard](./OffloadRoutingDashboard.md) -- [LLM] No file in the supplied set defines, exports, or references a component literally named "OffloadRoutingDashboard." The closest thematic match is `OffloadDecision` in `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, which is a dashboard card for offload routing — it toggles between 'config' and 'recorded' modes, renders a gate ladder (`GATES`, `RUNG_OFFLOADED`), and surfaces disagreements between the UI's own policy evaluation and the proxy's live resolution. This is very likely the entity the retrieval was trying to surface, but under a different code identifier, so any claim that 'OffloadRoutingDashboard is implemented at line X' would be fabricated rather than observed.

### Siblings
- [ClassifierJudgeHook](./ClassifierJudgeHook.md) -- [LLM] The component named "ClassifierJudgeHook" is concretely implemented as `useClassifierJudge(proxyBase, pollMs = 30_000)` in `integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts`. It fetches `GET ${proxyBase}/api/llm/classifier`, unwraps `d.judge`, and merges it into local state with default `knn` sub-fields spread first so a partial payload from an older proxy still produces a well-formed `Judge` object rather than `undefined` sub-properties. This is a genuine implementation match, not a thematic neighbor — the file's own header comment explicitly frames it as 'the judge — who decides how hard a request is, and whether they are answering,' which is exactly the ClassifierJudgeHook responsibility.


---

*Generated from 10 observations*

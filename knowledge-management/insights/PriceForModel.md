# PriceForModel

**Type:** Detail

[Code References] integrations/system-health-dashboard/src/components/cost/cost-model.ts - priceForModel(model, prices): three-tier resolution cascade (exact/fast/family); integrations/system-health-dashboard/src/components/cost/cost-model.ts - scalePrice(p, factor): pure multiplicative price transform, sole code-graph edge from priceForModel; integrations/system-health-dashboard/src/components/cost/cost-model.ts - FAST_MODE_SUFFIX / FAST_MODE_MULTIPLIER: constants governing the fast-mode rule branch; integrations/system-health-dashboard/src/components/cost/cost-model.ts - cellCostUsd(r, cfg): consumer of priceForModel's .price field, ignores .priced/.source; integrations/system-health-dashboard/src/components/cost/cost-model.ts - FAMILY_REPRESENTATIVE / modelFamily(): family-fallback data and classifier used in the third resolution tier

# PriceForModel — Technical Insight Document

## What It Is

`priceForModel` is a function implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, part of the broader `DashboardCostModel` parent component. It is the core price-resolution routine of the cost model: given a model identifier and a `prices` table, it returns a `ResolvedPrice` object (`{ price, priced, source }`) describing what per-token rate applies. As a member of `DashboardCostModel`, it inherits that file's strict framing as "pure cost/budget logic" — no React, no I/O, no hooks — placing it alongside sibling functions like `budgetForMonth`, `cellCostUsd`, and `monthlySeries`, and structurally related to sibling entities `BudgetConfig` and `ModelFamilyFallback` (the latter effectively documents the same cascade behavior from the family-fallback perspective).

## Architecture and Design

The function implements a three-tier cascading resolution strategy — a chain-of-responsibility pattern executed entirely within one pure function rather than across objects: (1) exact match on `prices[normalized]`, (2) fast-mode suffix stripping combined with a recursive self-call and multiplicative scaling via `scalePrice`, and (3) family-based fallback using `FAMILY_REPRESENTATIVE` and `modelFamily()` scanning `Object.keys(prices)`. This ordering is explicitly load-bearing: fast-mode checks run after exact-match (so a hand-authored `<model>-fast` row can override the 2x rule) but before family fallback (so an unrecognized fast variant doesn't silently inherit non-premium family pricing).

Notably, the code graph captures only a single edge, `PriceForModel -> scalePrice`, but this understates the true dependency surface. The function also recurses into itself (`priceForModel(base, prices)` after suffix stripping) and calls `modelFamily()` for the fallback tier — dependencies invisible to the depth-2 call-graph traversal because they are same-module/self-referential edges. This is a documented limitation of the call-graph reconstruction (CGR) tooling used here, not a property of the code itself.

## Implementation Details

The fast-mode branch is implemented as a decorator-style multiplicative rule rather than duplicated static data: `scalePrice(p, factor)` is a small pure transform scaling `{in, out, cacheRead, cacheWrite}` by `FAST_MODE_MULTIPLIER = 2`. Because `priceForModel` recurses on the base model name *before* invoking `scalePrice`, the scaling function stays fully decoupled from model identity or resolution source — it composes uniformly over whatever `ResolvedPrice` the recursive call yields, whether tagged `exact` or `family`. This keeps the fast-mode multiplier as a single point of truth instead of requiring per-path variants.

The return type `ResolvedPrice` carries a `source: 'exact' | 'family' | 'fast' | 'none'` tag and a `priced: boolean` flag alongside the numeric price. Currently these diagnostic fields are computed but unconsumed — `cellCostUsd()` destructures only `.price`. This is a dormant capability, likely intended for surfacing pricing confidence/provenance in a UI (e.g., flagging family-fallback-derived costs), but not yet wired up anywhere in this file.

Failure handling is fail-soft: when none of the three tiers resolve, the function returns a zeroed price with `priced: false, source: 'none'` rather than throwing. `cellCostUsd()` performs no check on `priced`, so unresolved models silently contribute $0 to cost aggregation — a pattern consistent with this module's broader defensive-but-silent style (compare `isSynthetic()`'s hard `continue` in `monthlySeries()`), though here silence risks understating real spend rather than merely excluding noise.

## Integration Points

`priceForModel` is invoked by `cellCostUsd(r, cfg)`, which multiplies token counts by the resolved `.price` field, ignoring `.priced`/`.source`. It depends on module-level constants `FAST_MODE_SUFFIX` and `FAST_MODE_MULTIPLIER`, and on `FAMILY_REPRESENTATIVE`/`modelFamily()` for its third tier — dependencies documented separately in sibling entity `ModelFamilyFallback`. As part of `DashboardCostModel`, its purity (no fetch calls, no component state) means all I/O — such as `GET /api/token-usage/cost` and `GET /api/llm/settings` — is pushed to callers outside this file, preserving a sharp boundary against sibling files like `use-classifier-judge.ts` that interleave fetching and state directly.

## Usage Guidelines

Developers modifying this cascade must preserve tier ordering — reordering exact-match, fast-mode, and family-fallback checks reintroduces the exact silent-mispricing failure mode the source comments warn against. When fast-tier pricing for a specific model diverges from the uniform `FAST_MODE_MULTIPLIER = 2` (as flagged for `claude-opus-4.8`, an assumed rather than verified rate, versus the verified `claude-opus-5` $10/$50 rate), the documented escape hatch is adding an explicit `<model>-fast` row to `modelPrices`, which the exact-match branch will correctly prefer. Any future consumer wanting to surface pricing confidence in the UI should leverage the already-computed `source`/`priced` fields rather than re-deriving resolution provenance. Finally, engineers relying on call-graph tooling (CGR) should be aware it under-reports this function's true dependencies — recursive self-calls and `modelFamily()` usage must be verified by reading the source directly rather than trusting the single `scalePrice` edge shown in the graph.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- priceForModel (function) in cost-model.ts

**Relationships:**
- Calls: scalePrice
- The code graph identifies exactly one edge from PriceForModel: `priceForModel -> scalePrice`. This single edge understates the function's actual fan-in/fan-out: `priceForModel` also calls itself recursively (`priceForModel(base, prices)` after stripping the `-fast` suffix) and calls `modelFamily()` for the family-fallback path. The graph's depth-2 traversal appears to have captured only the terminal, non-recursive call (`scalePrice`) and missed the self-referential edge and the `modelFamily` dependency — a reminder that call-graph tooling can under-report recursive or same-module dependencies that don't show up as a distinct traversal step.

**Other:**
- Call chain: PriceForModel -> scalePrice
- `scalePrice()`, the sole downstream function in the code graph, is a small pure transform (`{in, out, cacheRead, cacheWrite}` scaled by a factor) called with a hardcoded `FAST_MODE_MULTIPLIER = 2`. Its simplicity is deliberate: because `priceForModel` recurses on the *base* model name before scaling, `scalePrice` never needs to know about model identity, family, or resolution source — it's a pure arithmetic leaf that composes with whatever `ResolvedPrice` the recursive call produced (`exact` or `family`). This keeps the 2x fast-mode multiplier as a single point of truth rather than requiring `scalePrice` variants per resolution path.


## Hierarchy Context

### Parent
- [DashboardCostModel](./DashboardCostModel.md) -- [LLM] cost-model.ts is deliberately framed as "pure cost/budget logic... No React here" — every exported function (budgetForMonth, priceForModel, cellCostUsd, monthlySeries) is a pure function of CostRow[]/CostConfig inputs with no hooks, fetch calls, or component state. This is a sharp architectural boundary against sibling files like use-classifier-judge.ts and offload-decision.tsx, which interleave data-fetching, polling, and dirty-state tracking directly inside hooks and components. The payoff is testability (pure functions can be unit-tested without a DOM or mock fetch) and the ability to reuse the same pricing math in both the live dashboard tab and, presumably, offline reporting scripts — at the cost of pushing all I/O (GET /api/token-usage/cost, GET /api/llm/settings) to callers this file doesn't show.

### Siblings
- [BudgetConfig](./BudgetConfig.md) -- [CGR] BudgetConfig (class) in cost-model.ts
- [ModelFamilyFallback](./ModelFamilyFallback.md) -- [LLM] priceForModel() in cost-model.ts implements a three-tier resolution cascade — exact match, fast-mode suffix stripping (recursive call), then family fallback via FAMILY_REPRESENTATIVE — and the ordering is load-bearing, not incidental. The fast-mode check runs AFTER the exact-match check specifically so a hand-written `<model>-fast` row can override the multiplicative rule, but BEFORE the family fallback so that stripping the `-fast` suffix and recursing into priceForModel(base, prices) can itself hit either an exact match or a family fallback for the base model. This means a model like `claude-opus-4.8-fast` with no exact row resolves through two fallback layers in sequence: suffix-strip → family-fallback-for-opus → 2x multiplier — and a bug in either layer silently degrades pricing accuracy rather than erroring, which is the exact failure mode the source comment for FAST_MODE_MULTIPLIER warns about (mispricing at the standard rate, `priced: true`, no warning).


---

*Generated from 12 observations*

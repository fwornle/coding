# FastModePricingRule

**Type:** Detail

[Code References] integrations/system-health-dashboard/src/components/cost/cost-model.ts:130-133 - FAST_MODE_SUFFIX and FAST_MODE_MULTIPLIER constants with rationale comment; integrations/system-health-dashboard/src/components/cost/cost-model.ts:136-142 - scalePrice() applies the multiplier uniformly across in/out/cacheRead/cacheWrite; integrations/system-health-dashboard/src/components/cost/cost-model.ts:144-166 - priceForModel() resolution order: exact match, fast-mode suffix recursion, family fallback, none; integrations/system-health-dashboard/src/components/cost/cost-model.ts:189-204 - cellCostUsd() consumes priceForModel()'s resolved price without any fast-mode-specific branching; integrations/system-health-dashboard/src/components/cost/cost-model.ts:38-41 - DEFAULT_COST_CONFIG.modelPrices holds only base model rows, no explicit -fast rows, confirming the multiplier is the sole source of fast-mode prices

# FastModePricingRule — Technical Insight Document

## What It Is

FastModePricingRule is implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, specifically as the constants `FAST_MODE_SUFFIX` and `FAST_MODE_MULTIPLIER = 2` (lines 130-133), the `scalePrice()` function (lines 136-142), and the fast-mode branch within `priceForModel()` (lines 144-166). Rather than existing as static configuration, it is a runtime rule: when a model id ends in the `-fast` suffix, the system strips the suffix, recursively resolves the base model's price, and doubles all four price components (`in`, `out`, `cacheRead`, `cacheWrite`) via `scalePrice()`. `DEFAULT_COST_CONFIG.modelPrices` (lines 38-41) deliberately holds only base model rows — confirming that the multiplier is the *sole* source of fast-mode pricing, with no hand-maintained `-fast` twins.

As a child of ModelContextLimits and a sibling of ModelFamilyPriceFallback and UserConfigOverride, it participates in the same broader cost/limits resolution subsystem, sharing design philosophy but operating on price rather than context-window limits.

## Architecture and Design

The core architectural decision is **rule-over-data**: fast-mode pricing is expressed as a multiplicative transform applied at read time rather than as additional static rows. The rationale is explicit in the code's comments — hand-maintained `<model>-fast` entries would silently drift out of sync as new fast-capable models are added, and the failure mode is dangerous: a missing twin would still resolve via family fallback at the *standard* rate, silently under-billing a 2x-throughput call with no UI warning.

This pairs with a **recursive/delegating resolution** pattern: `priceForModel()` strips the suffix and recurses into itself, reusing the exact-match and family-fallback logic rather than duplicating it. The four-tier resolution order — exact match, fast-mode suffix, family fallback, `priced: false` — is load-bearing, not incidental, and constitutes an **escape-hatch precedence** design: because exact match is checked first, an operator can add an explicit `<model>-fast` row to `modelPrices` to override the automatic 2x rule entirely, without touching code. This is the documented workaround for the one known case where the multiplier is wrong — divergence between Opus 5 and Opus 4.8 fast-tier pricing.

The whole scheme also reflects the **fail-soft, no-throw** philosophy shared with `lib/statusline/model-limits.cjs` (ModelContextLimits' home) — unresolvable models return `priced: false` with a zero-cost object instead of throwing, and a typo'd exact-match key silently falls through to auto-doubling instead of raising an error.

## Implementation Details

`scalePrice()` applies `FAST_MODE_MULTIPLIER` uniformly across all four price fields of a `ModelPrice` object. `priceForModel()` checks `normalized.toLowerCase().endsWith(FAST_MODE_SUFFIX)` to detect fast-mode models, and this check is trusted unconditionally — there is no validation that a `-fast`-suffixed model id genuinely originated from fast-mode billing versus, say, a coincidentally named custom provider model. The correctness of the entire rule thus depends on an implicit string-format contract with the proxy's usage recorder (a separate, unshown service) rather than a shared type.

Confidence in the multiplier's correctness is asymmetric and only comment-encoded: the $10/$50 fast-mode price for Claude Opus 5 is empirically "verified," while the identical 2x treatment for Opus 4.8 is explicitly flagged as an assumption. Since `scalePrice` treats both models identically, this asymmetry lives only in a source comment — not in any test, config flag, or runtime-visible signal — so a future price divergence would only be caught by manual code review.

The `ResolvedPrice.source` field distinguishes `'fast'` from `'exact'` and `'family'`, providing provenance for debugging, but nothing in the current code shows this field being consumed downstream in `monthlySeries` or `PivotCell` aggregation — the signal is produced but not yet surfaced to operators.

## Integration Points

`cellCostUsd()` composes `priceForModel()`'s output with `freshInputTokens()` and `budgetProvider()`-scoped `providerScale`. Because `priceForModel()` returns an already-doubled `ModelPrice`, the fast-mode multiplier is fully absorbed at price-resolution time — `cellCostUsd()` performs its per-token multiplication (`freshInputTokens(r)/1e6 * price.in`, etc.) obliviously to whether the row is fast-mode, keeping token-counting logic (including the separate OpenAI-wire cache-token correction in `freshInputTokens`) cleanly separated from pricing-strategy logic.

`cost-model.ts` is a pure, React-free module by design, meaning the fast-mode rule has no UI dependency and can be unit tested standalone. Its sibling, ModelFamilyPriceFallback, shares the same `priceForModel()` function and resolution cascade — the fast-mode branch is one of three tiers within the same three-tier cascade, checked after exact match and before family fallback.

## Usage Guidelines

Developers adding new fast-capable models should rely on the automatic 2x rule rather than adding `-fast` config rows — the rule exists precisely to prevent staleness. The one sanctioned exception is adding an explicit exact-match `<model>-fast` entry when the 2x multiplier is *known* to be wrong (as with the Opus 4.8 assumption), since exact match takes precedence over the automatic rule.

Anyone modifying the proxy's usage recorder or the `-fast` suffix convention must preserve the string contract exactly, since it is not type-checked across the repo boundary. When surfacing cost data in UI, consider consuming the `ResolvedPrice.source` field to flag fast-mode-priced rows for operator visibility, since this provenance is currently computed but unused. Finally, any change to the Opus 4.8 fast-tier price should be verified empirically and the comment updated — or better, promoted into a runtime-checkable confidence flag — since the current design has no automated way to detect the assumed-vs-verified distinction going stale.


## Hierarchy Context

### Parent
- [ModelContextLimits](./ModelContextLimits.md) -- [LLM] The module in lib/statusline/model-limits.cjs implements a two-tier caching strategy specifically because it runs in a fresh process every 5 seconds per status-line pane (documented in the file's header comment). The in-process memo (`_memo`, `_userMemo`) only helps within a single tick's multiple calls to catalogueContextWindow(); the real cross-tick optimization is the on-disk derived cache at catalogueCachePath() (.logs/model-context-limits.json), which avoids re-parsing opencode's 4.5MB/213-provider models.json (a documented 33ms cost) on every single tick across every open pane. This is a deliberate departure from typical in-memory caching because the process boundary itself defeats memoization.

### Siblings
- [UserConfigOverride](./UserConfigOverride.md) -- [LLM] userConfigContextWindow() in lib/statusline/model-limits.cjs implements the actual 'UserConfigOverride' behavior: it reads process.env.OPENCODE_CONFIG (or defaults to ~/.config/opencode/opencode.json) and looks up provider[provider].models[model].limit.context. This value is checked FIRST in catalogueContextWindow(), before the public catalogue's byPair/byModel indexes are even consulted — an early return on any truthy `declared` value means a user override is not merely a tiebreaker but an outright veto over what models.dev says about the same model id.
- [ModelFamilyPriceFallback](./ModelFamilyPriceFallback.md) -- [LLM] priceForModel() in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements a three-tier resolution cascade — exact key match, then fast-mode suffix stripping/recursion, then family fallback — and the ORDER is load-bearing, not incidental. The exact match is checked first specifically so that an explicit `<model>-fast` row in modelPrices can override the automatic 2x multiplier rule; only when no exact key exists does the code fall into the FAST_MODE_SUFFIX branch, which recursively calls priceForModel() on the de-suffixed base name and then calls scalePrice() with FAST_MODE_MULTIPLIER. This means a single hardcoded model gets three possible price sources without three hardcoded prices, but it also means a bug in the exact-match key naming (e.g. a typo in a `-fast` row) silently falls through to auto-doubling instead of raising an error — consistent with the fail-soft philosophy also seen in lib/statusline/model-limits.cjs's null-not-throw contract.


---

*Generated from 9 observations*

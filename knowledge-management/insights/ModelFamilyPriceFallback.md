# ModelFamilyPriceFallback

**Type:** Detail

[Architecture Notes] Tight coupling between model-naming conventions and correctness: modelFamily()'s substring matching and priceForModel()'s FAST_MODE_SUFFIX string convention both assume model ids follow an unenforced lexical pattern (family name as substring, '-fast' suffix) with no schema/type-level guarantee; Single-direction data flow: cellCostUsd() consumes only `.price` from ResolvedPrice, discarding the `.priced`/`.source` fields that would let a caller distinguish confident vs. guessed pricing — an architectural seam where cost-model.ts computes more information than its current caller uses; Config-driven fallback ordering: FAMILY_REPRESENTATIVE is a hardcoded priority list co-located with, but structurally separate from, the DEFAULT_COST_CONFIG.modelPrices map it queries against — the two must be kept in sync by hand when new model generations are added; Convergent design philosophy across modules: both cost-model.ts's family-fallback and model-limits.cjs's byModel voting index solve the same underlying problem (resolve an id that doesn't have an exact catalogue/price entry) with independently-implemented but philosophically similar fallback+tie-break strategies, suggesting this is a recurring pattern in the codebase worth extracting if a third instance appears

# ModelFamilyPriceFallback — Technical Insight Document

## What It Is

ModelFamilyPriceFallback is the fallback-resolution mechanism embedded in `priceForModel()` at `integrations/system-health-dashboard/src/components/cost/cost-model.ts:141-166`. It is the second and third tiers of a three-tier cascade responsible for resolving a per-cell model cost when the exact model key is not present in `DEFAULT_COST_CONFIG.modelPrices`. As a Detail component, it sits under the parent ModelContextLimits (implemented in `lib/statusline/model-limits.cjs`), sharing that parent's overarching concern with resolving an arbitrary model identifier against an incomplete or evolving catalogue. Its siblings — UserConfigOverride and FastModePricingRule — represent the other two resolution strategies operating in this same problem space: one for context-window limits, the other for the fast-mode multiplier that this entity's recursive call path also invokes.

## Architecture and Design

The core pattern is chain-of-responsibility / cascading fallback resolution: exact key match → fast-mode-recursive lookup → curated family list → unordered family scan. The ordering is explicitly load-bearing rather than incidental — exact match is checked first so an explicit `<model>-fast` row can override the automatic `FAST_MODE_MULTIPLIER` doubling, and only absence of that key triggers the `FAST_MODE_SUFFIX` branch, which recurses into `priceForModel()` on the de-suffixed name before calling `scalePrice()`.

Within the family-fallback branch specifically, there are two nested stages: a curated preference list (`FAMILY_REPRESENTATIVE[fam]`, lines 130-139) tried in generation order (e.g., opus tries claude-opus-5, then 4.8, then 4.6), followed only if none match by an unordered `Object.keys(prices).find(k => modelFamily(k) === fam)` scan. This mirrors the two-index resolution structure in the parent's `deriveLimits()` (byPair/byModel), but notably lacks deriveLimits()'s explicit, documented tie-break rationale — the scan's result is dependent on object-key insertion order, undocumented as such.

The system embodies fail-soft/never-throw degradation: unresolvable prices degrade to a zeroed `ModelPrice` with `priced: false`, consistent with the null-not-throw contract in `lib/statusline/model-limits.cjs`. This is a deliberate, recurring philosophy across the codebase rather than a local choice.

## Implementation Details

`modelFamily()` (lines 117-127) is a pure substring-matching classifier. It has a documented ordering hazard: the `gpt-4o-mini` check must run before the `gpt-4o` check, since `'gpt-4o-mini'.includes('gpt-4o')` is true. This ordering dependency is fragile — inserting a new family check between these lines, or adding a family whose name is a substring of another (e.g., a hypothetical `sonnet-pro`), would silently miscategorize traffic since `priceForModel()` never emits a warning for `source: 'family'` resolutions, only a boolean `priced: true`.

The `ResolvedPrice.source` field (`'exact' | 'family' | 'fast' | 'none'`) is the sole confidence signal produced by this cascade, but `cellCostUsd()` (lines 186-198) discards everything except `.price`. This means a family-fallback-guessed price is structurally indistinguishable, downstream, from an exact match once it reaches cost aggregation.

The fast-mode branch compounds this uncertainty: because it recursively calls `priceForModel()` on the base model name before scaling, a base price that itself was family-fallback-resolved produces a doubly-uncertain fast price — family-sourced and then 2x-scaled — with no propagated warning. `FAST_MODE_MULTIPLIER = 2` is verified only for claude-opus-5 and assumed by analogy for claude-opus-4.8, per inline comment.

## Integration Points

This entity is tightly coupled to `FastModePricingRule` (sibling), since the `FAST_MODE_SUFFIX` recursion inside `priceForModel()` is the mechanism that invokes the multiplicative scaling rule — the family fallback and the fast-mode rule are not independent, they compose. It's also structurally analogous to `UserConfigOverride` and the parent ModelContextLimits' `deriveLimits()`, both solving "resolve an unmatched model id" via layered indexes with a fallback tie-break — though `UserConfigOverride`'s veto-first design (checking `declared` before any catalogue lookup) contrasts with this entity's exact-match-first ordering.

The dependency between `FAMILY_REPRESENTATIVE` and `DEFAULT_COST_CONFIG.modelPrices` is a hand-maintained, structurally separate coupling: both must be kept in sync manually as new model generations are added, with no schema enforcement tying model-id naming conventions (family substrings, `-fast` suffixes) to correctness.

## Usage Guidelines

Developers modifying `modelFamily()` must preserve check ordering (mini before base variants) and consider substring-collision risk for any new family name. Anyone adding a new model generation should update `FAMILY_REPRESENTATIVE` in tandem with `modelPrices`, since the two are not automatically synchronized. Because `source`/`priced` provenance is computed but not surfaced in aggregation or UI, this is a known observability gap — any consumer needing to distinguish confident vs. guessed costs must be built against `ResolvedPrice` directly rather than `cellCostUsd()`'s current output. Finally, adding new fast-capable models requires either an explicit `-fast` row or acceptance that the 2x assumption may silently misprice throughput-doubled usage at the standard rate.


## Hierarchy Context

### Parent
- [ModelContextLimits](./ModelContextLimits.md) -- [LLM] The module in lib/statusline/model-limits.cjs implements a two-tier caching strategy specifically because it runs in a fresh process every 5 seconds per status-line pane (documented in the file's header comment). The in-process memo (`_memo`, `_userMemo`) only helps within a single tick's multiple calls to catalogueContextWindow(); the real cross-tick optimization is the on-disk derived cache at catalogueCachePath() (.logs/model-context-limits.json), which avoids re-parsing opencode's 4.5MB/213-provider models.json (a documented 33ms cost) on every single tick across every open pane. This is a deliberate departure from typical in-memory caching because the process boundary itself defeats memoization.

### Siblings
- [UserConfigOverride](./UserConfigOverride.md) -- [LLM] userConfigContextWindow() in lib/statusline/model-limits.cjs implements the actual 'UserConfigOverride' behavior: it reads process.env.OPENCODE_CONFIG (or defaults to ~/.config/opencode/opencode.json) and looks up provider[provider].models[model].limit.context. This value is checked FIRST in catalogueContextWindow(), before the public catalogue's byPair/byModel indexes are even consulted — an early return on any truthy `declared` value means a user override is not merely a tiebreaker but an outright veto over what models.dev says about the same model id.
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The fast-mode pricing rule in integrations/system-health-dashboard/src/components/cost/cost-model.ts is implemented as a multiplicative transform (`scalePrice`, `FAST_MODE_MULTIPLIER = 2`) applied to a recursively-resolved base price inside `priceForModel()`, rather than as extra rows in `DEFAULT_COST_CONFIG.modelPrices`. The design rationale is stated explicitly in the comment block above `FAST_MODE_SUFFIX`: a hand-maintained `<model>-fast` twin for every priced model would silently drift out of sync whenever a new fast-capable model is added, and the failure mode of a missing twin is dangerous because `priceForModel()` would still return `priced: true` via the family fallback at the *standard* rate — under-billing a 2x-throughput call with no warning surfaced anywhere in the UI.


---

*Generated from 9 observations*

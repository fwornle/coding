# UserConfigOverride

**Type:** Detail

# UserConfigOverride — Technical Insight Document

## What It Is

`UserConfigOverride` is implemented as `userConfigContextWindow(model, provider)` in `lib/statusline/model-limits.cjs`, a component of the parent `ModelContextLimits` module. It resolves a user-declared context-window size by reading `process.env.OPENCODE_CONFIG` (or defaulting to `~/.config/opencode/opencode.json`, via `userConfigPath()`) and walking the nested path `provider[provider].models[model].limit.context`. This value is consulted as the *first* tier of authority inside `catalogueContextWindow()`, ahead of the public catalogue's `byPair` and `byModel` indexes — an early, truthy return means the user's declared value is a veto, not merely a tiebreaker, over anything `models.dev` claims about the same model id.

## Architecture and Design

The defining architectural pattern here is **override-wins-over-derived-index**: a small, authoritative, per-call source of truth short-circuits a larger, cached, statistically-derived index rather than being merged or averaged with it. `catalogueContextWindow()` sequences three tiers strictly: user override → exact `byPair` match → `byModel` fallback vote → `null`. This is a deliberate hierarchy of trust, not a symmetric blend.

The design encodes **asymmetric-risk reasoning**. The header comment's canonical scenario — `qwen-laptop`, a llama.cpp endpoint truly limited to 32K context but sharing a model id with a 262K-context entry in the public catalogue — illustrates why trusting the catalogue here would be dangerous: it would under-report occupancy 8x and show a green gauge while opencode silently compacts the session. This inverts the tie-breaking philosophy used elsewhere in the same module: `deriveLimits()` favors the *larger* number on catalogue ties to avoid a false red (premature compaction warning), while `UserConfigOverride` favors trusting the *smaller*, user-declared number to avoid a false green (silent overrun). Both rules optimize for the same underlying value — never let the status line under-warn — via opposite arithmetic.

## Implementation Details

Structurally, `userConfigContextWindow()` guards immediately on `provider` being truthy (`if (!provider) return null;`), which architecturally partitions its responsibility from `deriveLimits()`'s `byModel` fallback. The `byModel` index solves "no provider is known, or the named provider doesn't declare the model" (e.g., `rapid-proxy`); the override solves the opposite problem — "the provider IS named, and its real capacity contradicts the public catalogue." These two "unknown provider" mechanisms are cleanly non-overlapping by construction.

Caching is deliberately shallow: the override is read fresh via `readJson(userConfigPath())` on every call, memoized only within a single tick via module-level `_userMemo`. Unlike the derived catalogue cache at `catalogueCachePath()` (`.logs/model-context-limits.json`), which is invalidated by `mtimeMs+size` against the 4.5MB `models.json`, the override has no persisted cache and no invalidation strategy at all — because tying its freshness to catalogue file changes would be semantically wrong: an edited `opencode.json` has no relationship to `models.json`'s mtime, and folding the two together would cause stale overrides to survive until an unrelated file happened to change.

Failure handling reuses the module's fail-soft contract: missing files, unparseable JSON, or absent config paths resolve to `undefined` through `readJson()`'s try/catch and optional chaining, which the shared `positiveInt()` guard converts to `null` (never `0`, never a thrown error). This matters because the override sits on the hottest, first-checked branch of `catalogueContextWindow()` — a malformed config degrades silently to "no override" rather than crashing the status line.

Because the value is never cached to disk, there is also no temp-file-plus-rename write discipline analogous to `limits()`'s handling of `catalogueCachePath()` — there's simply no on-disk artifact to race on.

## Integration Points

`UserConfigOverride` is a direct child concern of `ModelContextLimits`, which itself exists because the status line runs as a fresh process every 5 seconds per pane — a constraint that shapes the override's single-tick-only memoization (`_userMemo`) just as it shapes the parent's cross-tick derived cache. Test isolation ties the two caches together at the module boundary: `_resetForTests()` clears `_memo` and `_userMemo` in one call, treating architecturally distinct caching strategies as a single testing surface. `positiveInt()` is shared infrastructure, used identically by both the override path and `deriveLimits()`, ensuring consistent null-not-throw semantics across the whole module.

Sibling entities `FastModePricingRule` and `ModelFamilyPriceFallback` (in `cost-model.ts`) don't interact directly with `UserConfigOverride`, but share its fail-soft design philosophy — `priceForModel()`'s silent fallback-to-family-rate on a missing `-fast` twin mirrors the null-on-failure contract here, though `UserConfigOverride`'s designer arguably treats the risk direction with more care by explicitly favoring false alarms over silent under-reporting.

## Usage Guidelines

Developers configuring `opencode.json` should understand that any declared `limit.context` for a named provider/model pair takes absolute precedence over the public catalogue — there is no blending, so an incorrect override value will silently misreport in the opposite direction (falsely small/large) with no catalogue cross-check. Because the override is re-read every call, changes to `opencode.json` take effect immediately without needing to touch or invalidate any cache file — this is a designed convenience, not an oversight. The override only applies when `provider` is supplied; omit it and the system falls through to `byModel` fallback logic instead. Finally, since failures degrade silently to `null`, a broken or malformed config file will not raise visible errors — it simply reverts to catalogue-derived behavior, consistent with the module-wide principle that "a status line must never be the thing that breaks."


## Hierarchy Context

### Parent
- [ModelContextLimits](./ModelContextLimits.md) -- [LLM] The module in lib/statusline/model-limits.cjs implements a two-tier caching strategy specifically because it runs in a fresh process every 5 seconds per status-line pane (documented in the file's header comment). The in-process memo (`_memo`, `_userMemo`) only helps within a single tick's multiple calls to catalogueContextWindow(); the real cross-tick optimization is the on-disk derived cache at catalogueCachePath() (.logs/model-context-limits.json), which avoids re-parsing opencode's 4.5MB/213-provider models.json (a documented 33ms cost) on every single tick across every open pane. This is a deliberate departure from typical in-memory caching because the process boundary itself defeats memoization.

### Siblings
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The fast-mode pricing rule in integrations/system-health-dashboard/src/components/cost/cost-model.ts is implemented as a multiplicative transform (`scalePrice`, `FAST_MODE_MULTIPLIER = 2`) applied to a recursively-resolved base price inside `priceForModel()`, rather than as extra rows in `DEFAULT_COST_CONFIG.modelPrices`. The design rationale is stated explicitly in the comment block above `FAST_MODE_SUFFIX`: a hand-maintained `<model>-fast` twin for every priced model would silently drift out of sync whenever a new fast-capable model is added, and the failure mode of a missing twin is dangerous because `priceForModel()` would still return `priced: true` via the family fallback at the *standard* rate — under-billing a 2x-throughput call with no warning surfaced anywhere in the UI.
- [ModelFamilyPriceFallback](./ModelFamilyPriceFallback.md) -- [LLM] priceForModel() in integrations/system-health-dashboard/src/components/cost/cost-model.ts implements a three-tier resolution cascade — exact key match, then fast-mode suffix stripping/recursion, then family fallback — and the ORDER is load-bearing, not incidental. The exact match is checked first specifically so that an explicit `<model>-fast` row in modelPrices can override the automatic 2x multiplier rule; only when no exact key exists does the code fall into the FAST_MODE_SUFFIX branch, which recursively calls priceForModel() on the de-suffixed base name and then calls scalePrice() with FAST_MODE_MULTIPLIER. This means a single hardcoded model gets three possible price sources without three hardcoded prices, but it also means a bug in the exact-match key naming (e.g. a typo in a `-fast` row) silently falls through to auto-doubling instead of raising an error — consistent with the fail-soft philosophy also seen in lib/statusline/model-limits.cjs's null-not-throw contract.


---

*Generated from 9 observations*

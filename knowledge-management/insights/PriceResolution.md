# PriceResolution

**Type:** Detail

## What It Is

PriceResolution is implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, centered on the function `priceForModel`. It is the mechanism by which a model identifier (potentially unpriced, versioned, or "fast"-suffixed) is resolved to a concrete `ModelPrice`. It is a Detail component within the parent CostModel, sitting alongside sibling details `BudgetHistory` (largely unmaterialized as a distinct implementation — see below) and `SyntheticRowFiltering` (`isSynthetic`).

## Architecture and Design

The core architectural pattern is an **ordered fallback chain / chain-of-responsibility**: exact key match → fast-mode suffix strip (`FAST_MODE_SUFFIX = '-fast'`, `scalePrice` with `FAST_MODE_MULTIPLIER = 2`) → family-representative lookup (`FAMILY_REPRESENTATIVE[fam]`) → any same-family key (via `modelFamily` substring classification) → `{priced: false, source: 'none'}` sentinel. This ordering is load-bearing and intentionally documented in-line, because reordering the checks would let a coarser rule (family price) silently shadow a more specific one (exact price) — the same defect shape observed on the routing side ('LLM Routing Tier Priority'), where lower-tier providers could shadow a preferred subscription tier. The fast-mode branch is implemented recursively (`priceForModel(base, prices)` rather than a flat lookup), a deliberate reuse of the whole fallback chain so a single multiplier rule covers any current or future fast-capable model without hand-maintained twin rows.

Structurally parallel to this is `budgetForMonth`, which resolves a month's budget cap using an explicit `hasOwnProperty` guard to distinguish a `null` override ("no cap this month") from an absent key ("fall through to `monthlyEur`"). Both functions embody the same principle — never let a missing entry silently collapse into a wrong default — but the codebase does not unify them behind a shared "resolve-with-fallback" abstraction; each re-implements its own precedence logic independently.

## Implementation Details

`modelFamily` classifies model ids by substring match on the lowercased string (`haiku`, `sonnet`, `opus`, `fable`, `gpt-4o-mini`, `gpt-4o`, `gpt-5`, else `other`). `FAMILY_REPRESENTATIVE` maps each family to an ordered list of concrete keys to try (e.g., opus tries `claude-opus-5`, then `-4.8`, then the retired `-4.6`) before falling back to any priced key in that family — trading pricing precision for availability so new model ids don't collapse to `source: 'none'`. `scalePrice` multiplies all four `ModelPrice` fields by `FAST_MODE_MULTIPLIER`.

`cellCostUsd` composes `priceForModel` with `freshInputTokens`, `budgetProvider`, and `cfg.providerScale`, pricing four token categories (`input`, `output`, `cache_read`, `cache_write`) independently and applying a provider-level scale factor. Notably, `freshInputTokens` is now a pure identity function, but `cellCostUsd`'s inline comment still describes the old OpenAI-wire cache-subtraction rationale — documentation debt where two comments now disagree about where cache-nesting compensation actually lives (it moved upstream to the proxy).

## Integration Points

PriceResolution depends on upstream filtering: `isSynthetic` (the `SyntheticRowFiltering` sibling) removes rows via `SYNTHETIC_MODELS`, `SYNTHETIC_PROVIDERS`, and prefix checks (`fake*`, `demo*`) before `monthlySeries` ever calls `cellCostUsd`/`priceForModel`. `isOpenAIWireProvider` is a related classifier explicitly retained with no live pricing caller, kept purely as documentation of a real wire-protocol distinction — an intentional case of dead-for-computation code justified in three separate comment blocks. Within CostModel, `budgetForMonth` is the sibling resolution axis (time vs. model identity) that shares design philosophy but no code.

## Usage Guidelines

The module is explicitly pure and framework-free ("No React here"), so `priceForModel` and `budgetForMonth` are independently unit-testable without mocking React or fetch. Maintainers must not reorder the exact/fast/family/none checks without preserving the documented precedence rationale, must keep `freshInputTokens`-related comments in `cellCostUsd` in sync with actual upstream behavior, and should treat `isOpenAIWireProvider` as intentionally-retained documentation rather than removable dead code. Any change to `priceForModel`'s or `budgetForMonth`'s contract requires re-auditing `cellCostUsd`, since it tightly couples all three resolution concerns into one arithmetic expression.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The parent's linked session records ('API Model Field and Token Count Reliability' and 'LLM Routing Tier Priority') describe a tier-ordering defect on the routing side where lower-tier providers were being selected ahead of a max-subscription-first fallback order — the routing-side analogue of `priceForModel`'s own fallback ordering bug class (exact → fast → family → none). Both defect families share a root cause shape: an ordered fallback chain where a later, coarser rule (family price, or lower-tier route) can shadow an earlier, more specific one (exact price, or preferred subscription) if the chain's order is disturbed, which is why `priceForModel`'s in-line comments are unusually insistent about *why* each check precedes the next.

## Hierarchy Context

### Parent
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts:budgetForMonth implements month-scoped budget resolution where an explicit null in monthlyEurByMonth is distinguished from an absent key via Object.prototype.hasOwnProperty.call, meaning 'no cap this month' and 'not recorded, use standing cap' are two different states the function must not conflate — a subtle correctness detail visible only by reading the hasOwnProperty guard.

### Siblings
- [BudgetHistory](./BudgetHistory.md) -- [LLM] None of the supplied files define a component, file, or export named `BudgetHistory`. The only material that speaks to 'budget history' as a concept is the `BudgetConfig` interface and `budgetForMonth` function in integrations/system-health-dashboard/src/components/cost/cost-model.ts — and those are pure data-model helpers (month → cap resolution), not a rendering component. This looks like a case where retrieval surfaced the parent's cost-model.ts because it is thematically adjacent to a 'BudgetHistory' Detail node in the intent graph, not because it contains that node's actual implementation.
- [SyntheticRowFiltering](./SyntheticRowFiltering.md) -- [LLM] The `SyntheticRowFiltering` component is concretely implemented in `integrations/system-health-dashboard/src/components/cost/cost-model.ts` as the `isSynthetic(r: CostRow): boolean` function together with its two backing sets, `SYNTHETIC_MODELS` (`'synthetic'`, `'<synthetic>'`, `'fake-model'`) and `SYNTHETIC_PROVIDERS` (`'fake-peer'`). The function also catches anything not in the explicit sets via a prefix check — `m.startsWith('fake') || m.startsWith('demo')` — so a probe row using an unlisted model name like `demo-run-3` is still excluded, trading a small false-positive risk (a legitimately named model starting with 'fake' or 'demo' would be silently dropped from cost totals) for coverage against an open-ended set of test/demo naming conventions the author can't fully enumerate up front.


---

*Generated from 10 observations*

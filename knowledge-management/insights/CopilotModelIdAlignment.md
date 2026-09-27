# CopilotModelIdAlignment

**Type:** Detail

## What It Is

CopilotModelIdAlignment refers to a postinstall-time correction script, `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`, which rewrites retired Copilot model IDs in the vendored `@rapid/llm-proxy` dependency. Critically, the script's own source is not present in the supplied evidence — the only file actually available is its drift-guard test, `tests/features/copilot-model-ids.test.mjs` (modeled here as the child component CopilotModelIdDriftGuardTest). This mirrors a pattern noted in the parent LLMWithProcessClient's own file (`llm-with-process.ts`): a named component resolving to a file that documents/tests the logic rather than containing it. Everything below is therefore derived from the test's assertions and its embedded docstring — a documentation surrogate for the missing implementation.

## Architecture and Design

The core design decision is that alignment is a **scripted, postinstall-time rewrite** rather than a vendored patch file. The rationale, encoded directly in the test's comment block, is that `@rapid/llm-proxy` is installed from a GitHub release tarball rather than the npm registry, so `patch-package` has no clean baseline to diff against; an attempted patch spanned 148KB across 25 unrelated files. Scripting the correction sidesteps that diff-baseline problem entirely.

A second architectural feature is the **dual invocation path** with different failure semantics per site: `docker/Dockerfile.coding-services` must invoke the script explicitly *after* `npm install` (verified via `lines.findLastIndex`/`findIndex` ordering checks) because the in-image install runs with `--ignore-scripts` and would otherwise silently skip a postinstall hook. `package.json`'s `postinstall` entry is the parallel path for host installs where scripts aren't suppressed. This is a case of covering two distinct installation environments with the same idempotent correction rather than relying on a single hook.

The test suite itself exemplifies **contract testing against effects** rather than unit-testing the script directly: it asserts facts about RETIRED id lists, replacement-mapping safety, and invocation ordering, without exercising the script's internal logic.

## Implementation Details

The visible contract centers on a `RETIRED` constant, currently `['claude-sonnet-4.6', 'claude-opus-4.6']`, which the script rewrites throughout the vendored proxy. The test enforces an invariant on replacements: no RHS of any replacement pair may itself appear in `RETIRED` — guarding against swapping one dead model id for another dead one, which would reproduce the same silent-failure class.

Ordering is enforced structurally in the test via `lines.findLastIndex`/`findIndex` against Dockerfile content, confirming the alignment RUN step follows `npm install`. The test also gates most assertions on an `SA_CHECKED_OUT` flag, since CI runs with `submodules: false` and `integrations/semantic-analysis` (where the real script lives) may be entirely absent at test time — avoiding false failures when the submodule isn't checked out.

## Integration Points

CopilotModelIdAlignment sits under LLMWithProcessClient within LLMAbstraction, aligning with the parent's role (per the session record 'CLI/UKB Run Timeout and Provider Error Diagnostics') of distinguishing proxy-layer timeouts from provider-specific failures. The 2026-09-20 Wave 3 incident referenced in the observations — where a retired model id produced a silent 400 and `'[llm] All providers failed'` — ties directly to the sibling 'LLM Routing Tier Priority' record, which frames Copilot-tier fallback as a product-level ordering any client must respect; a retired id silently breaking that chain is treated as a correctness bug, not acceptable degradation.

No coupling exists between this component and dashboard siblings like FastModePricingRule (`cost-model.ts`) or ClassifierJudgeReachability (`use-classifier-judge.ts`) beyond incidental string overlap — `cost-model.ts`'s `FAMILY_REPRESENTATIVE.opus` table happens to include `'claude-opus-4.6'` as a pricing fallback key, unrelated to retirement status. Its actual child, CopilotModelIdDriftGuardTest, is the sole enforcement mechanism keeping the alignment script wired into both install paths.

## Usage Guidelines

Any change to the Dockerfile's install/RUN ordering, to `package.json`'s postinstall entry, or to the RETIRED list must be validated against `tests/features/copilot-model-ids.test.mjs`, since it is the only guard against silent drift. New replacement mappings must never target another retired id. Because the real script lives outside this evidence set and CI may run without the semantic-analysis submodule checked out, changes to the script itself should be verified locally with the submodule present, not solely through CI where `SA_CHECKED_OUT`-gated assertions are skipped.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- [LLM] Because no code-graph evidence was supplied for this component, no [LLM+CGR] observations could be produced; all findings here derive from reading the test file's assertions and its embedded docstring, which is itself a documentation surrogate for the missing implementation.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The parent's 'LLM Routing Tier Priority' record frames fallback ordering (max-subscription, then Copilot-tier, then Groq) as a product decision any client must respect — consistent with why a retired Copilot-tier model id silently falling through to '[llm] All providers failed' (as this test's docstring describes for 2026-09-20) is treated as a correctness bug in the fallback chain rather than an acceptable degradation.

## Hierarchy Context

### Parent
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] 'CLI/UKB Run Timeout and Provider Error Diagnostics' documents this layer's role in distinguishing proxy-layer timeouts from provider-specific failures further down the call chain

### Children
- [CopilotModelIdDriftGuardTest](./CopilotModelIdDriftGuardTest.md) -- [LLM] tests/features/copilot-model-ids.test.mjs is the actual implementation of the drift guard the parent describes, and its own file header is unusually load-bearing documentation rather than boilerplate: it explains that `@rapid/llm-proxy` is installed from a GitHub release tarball with no npm-registry baseline, so `patch-package` was tried and rejected after producing a 148KB diff spanning 25 unrelated files. That failed attempt is the reason `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs` exists as a standalone post-install script instead of a vendored patch, and this test file is the only thing in the repo that enforces the script stays wired up.

### Siblings
- [ClassifierJudgeReachability](./ClassifierJudgeReachability.md) -- [LLM] `use-classifier-judge.ts` is the concrete implementation of classifier-judge reachability: its `Judge` interface carries `configError` (config-level) alongside a per-backend `reachable: boolean | null` on `JudgeBackend`, explicitly separated from the config-level `enabled: boolean`. The file's own header comment documents why this split exists — on 2026-09-02 every classified turn silently fell back to gh-copilot/claude-sonnet-5 because the judge's model endpoint had been down for about a day, yet `enabled` stayed `true` and the offload policy looked correct; nothing on any dashboard distinguished 'switched off' from 'not answering' until `reachable` was added as its own field, with `null` meaning 'never asked on this network' rather than 'down'.
- [FastModePricingRule](./FastModePricingRule.md) -- [LLM] The component named 'FastModePricingRule' is concretely implemented in integrations/system-health-dashboard/src/components/cost/cost-model.ts under the 'Fast mode' section: `FAST_MODE_SUFFIX = '-fast'`, `FAST_MODE_MULTIPLIER = 2`, the `scalePrice()` helper, and the fast-mode branch inside `priceForModel()`. The design encodes fast mode as a multiplicative RULE applied to a model's base price rather than as hand-maintained duplicate price rows (e.g. a separate `claude-opus-5-fast` entry in `DEFAULT_COST_CONFIG.modelPrices`). The comment block directly above `FAST_MODE_SUFFIX` explains the rationale: a per-model twin entry 'fails SILENTLY' because the family fallback in the same function would happily price an untracked `-fast` suffix at the standard (non-premium) rate with `priced: true` and no warning, silently underbilling every fast-mode call.
- [ModelContextLimitsCache](./ModelContextLimitsCache.md) -- [LLM] None of the five supplied files (tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx, integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts, integrations/system-health-dashboard/src/store/provider.tsx) define, import, or reference a class, function, hook, or module named 'ModelContextLimitsCache'. There is no cache keyed on model context-window sizes, no TTL/eviction logic, and no lookup table mapping model ids to token-limit ceilings anywhere in this evidence set — the closest adjacent concept is cost-model.ts's modelPrices/FAMILY_REPRESENTATIVE tables, which price tokens rather than cap them.


---

*Generated from 10 observations*

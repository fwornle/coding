# CopilotModelIdAlignment

**Type:** Detail

## What It Is

`CopilotModelIdAlignment` refers to `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`, a build/install-time correction script for a vendored dependency, `@rapid/llm-proxy`. Critically, this script itself is **not present** in the retrieved evidence — only its drift-guard test, `tests/features/copilot-model-ids.test.mjs`, was retrieved. Everything below about the script's mechanics is inferred from what the test asserts, not from direct inspection of the implementation. This document should be treated as a test-driven reconstruction, not a verified read of the source.

The component exists as a child of `LLMWithProcessClient`, which wraps calls to the mandatory shared routing proxy (rapid-llm-proxy) via `/api/complete`. The alignment script addresses a defect at that boundary: the vendored proxy package shipped a hardcoded default that named retired Copilot model ids (`claude-sonnet-4.6`, `claude-opus-4.6`).

## Architecture and Design

The core pattern is a **build-time monkey-patch of a vendored dependency**, installed from a GitHub release tarball rather than the npm registry. Because there was no clean npm-registry baseline, a `patch-package` diff was rejected as a strategy — it produced a 148KB patch across 25 unrelated files. Instead, the fix is applied procedurally via `align-copilot-model-ids.mjs`, invoked from **two independent trigger points**: a Dockerfile `RUN` step (for image builds, where `--ignore-scripts` on `npm install` suppresses default script-running) and `package.json`'s `postinstall` hook (for host installs, where npm's default script behavior applies). This dual-invocation is deliberate redundancy to cover divergent install-time behaviors, and the test suite explicitly guards against the two paths ever falling out of sync.

A second pattern is **drift-guard testing**: rather than unit-testing the script's internal logic, `copilot-model-ids.test.mjs` asserts external properties — that the script exists, that its replacement table never maps a retired id onto another retired id (via regex-parsing the source: `/\["'([^']+)'",\s*"'([^']+)'"\]/g`), that the Dockerfile invocation contains no `|| true` or `2>/dev/null` (fail-loud build gate), and that the Dockerfile's alignment `RUN` line executes strictly after the last `npm install` (via `findLastIndex`/`findIndex` comparison of Dockerfile lines).

## Implementation Details

The test file's header (lines 1-25) documents the originating incident directly: on 2026-09-20, `semantic_analysis`'s mapping to the `standard` tier resolved to a retired model id, causing every Wave 3 call to fall through to `[llm] All providers failed`, silently producing a ~600-char stub entity instead of a ~4400-char analysis — with no model name surfacing in logs. This is the exact silent-failure class the parent `LLMWithProcessClient` and the `RapidLlmProxy`/"LLM Routing Tier Priority" session records warn about: a tier-selection/model-id defect disguised as a generic provider failure.

Lines 33-40 define the `RETIRED` id list and the `SA_CHECKED_OUT` gate, which conditions four of seven tests on the presence of `integrations/semantic-analysis/package.json` on disk — because CI's `.github/workflows/tests.yml` checks out with `submodules: false` and the submodule is private/unreachable. Gating on the submodule's manifest, rather than per-file existence, ensures that genuine drift (e.g., the script being renamed while the submodule is present) still fails, rather than passing silently once the submodule vanishes.

## Integration Points

The component's only verified integration is through its test's assertions against two artifacts: the Dockerfile and `package.json`'s `postinstall` entry, both presumably living in the `integrations/semantic-analysis` submodule. Its functional integration point is `@rapid/llm-proxy`, the vendored dependency whose hardcoded default it corrects, which in turn is the routing layer the parent `LLMWithProcessClient` depends on for `/api/complete`. Sibling entities `CostModelPricingEngine`, `OffloadDecisionResolver`, `ClassifierJudgeHook`, and `ModelContextLimitCatalogue` were all confirmed as unrelated or only thematically adjacent (filename/keyword matches on "cost", "offload", "classifier", "Model") — none structurally connect to the alignment mechanism. Similarly, `cost-model.ts`'s `budgetProvider()` (lines 171-175) and `offload-decision.tsx`'s `CLASSIFIER_IMPLS` surfaced in retrieval only via keyword adjacency, not genuine coupling.

## Usage Guidelines

Both the Dockerfile invocation and the `postinstall` hook must be preserved together — removing either reopens the silent-failure window the script was built to close. The alignment step must never be made to fail silently (no `|| true`, no stderr suppression), and it must always run after the final `npm install` step, since running it earlier would let the install overwrite the correction. When retiring or renaming model ids, the replacement table must never map one retired id onto another retired id. Because the actual script wasn't available in this retrieval, any future work on `align-copilot-model-ids.mjs` should re-fetch it directly rather than relying solely on this test-derived summary.


## Hierarchy Context

### Parent
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] RapidLlmProxy — Universal Agent Routing, Worker Pool, Semantic Dispatch establishes that rapid-llm-proxy is the mandatory shared routing proxy all clients must go through, which this wrapper directly targets via /api/complete.

### Siblings
- [CostModelPricingEngine](./CostModelPricingEngine.md) -- [LLM] No entity named `CostModelPricingEngine` appears anywhere in the supplied code. The nearest thematic match is `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, which exposes a set of standalone pure functions (`priceForModel`, `cellCostUsd`, `budgetForMonth`, `freshInputTokens`, `monthlySeries`) rather than a class or object called `CostModelPricingEngine`. There is no constructor, no stateful engine object, and no file whose name or exported symbol resembles the requested component — the retrieval appears to have surfaced the parent's general neighborhood (cost/pricing logic) rather than this specific entity.
- [OffloadDecisionResolver](./OffloadDecisionResolver.md) -- [LLM] No file in this bundle defines, exports, imports, or even mentions an identifier called `OffloadDecisionResolver`. The nearest thematic match is `integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx`, which exports a React component `OffloadDecision` (not `OffloadDecisionResolver`) that visualizes routing decisions, and which itself imports the actual decision logic — `GATES`, `RUNG_OFFLOADED`, `describeTargets`, `evaluateOffload`, `jobClassOf`, `rungOfReason` — from a sibling module `./offload-gates` that was not retrieved into this evidence set. If `OffloadDecisionResolver` exists, it most likely lives in that unretrieved `offload-gates.ts`/`offload-gates.mjs` file (or in rapid-llm-proxy's own routing source), not in any file shown here.
- [ClassifierJudgeHook](./ClassifierJudgeHook.md) -- [LLM] The component in question is directly implemented as `useClassifierJudge` in integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts — a React hook (not the offload-policy hook) that fetches `GET ${proxyBase}/api/llm/classifier`, normalizes the response into a `Judge` shape (defaulting `strategy: 'llm'` and a stub `knn` block when absent), and exposes both server state (`judge`, `judgeError`, `judgeUrl`) and local draft-edit state (`draftRubric`, `draftStrategy`, per-backend `draftEnabled`) to the consuming component.
- [ModelContextLimitCatalogue](./ModelContextLimitCatalogue.md) -- [LLM] None of the retrieved files implement, import, or define an entity named `ModelContextLimitCatalogue`. The five files handed to this analysis — `tests/features/copilot-model-ids.test.mjs`, `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, `.../llm-routing/offload-decision.tsx`, `.../llm-routing/use-classifier-judge.ts`, and `.../store/provider.tsx` — were almost certainly surfaced by a filename/keyword substring match on 'Model' (as in `ModelPrice`, `ModelFamily`, `modelFamily()`, `priceForModel()` in cost-model.ts) rather than because any of them catalogue per-model context-window token limits.


---

*Generated from 9 observations*

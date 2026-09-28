# CopilotModelIdDriftGuard

**Type:** Detail

## What It Is

CopilotModelIdDriftGuard is implemented entirely in `tests/features/copilot-model-ids.test.mjs`. It is not a runtime feature but a regression/drift guard test suite: it hardcodes a `RETIRED` list (`RETIRED = ['claude-sonnet-4.6', 'claude-opus-4.6']`, defined at line 15) and runs six assertions verifying that a related alignment script and its invocation points continue to neutralize these retired Copilot model ids. It is a child (Detail-level) component under its parent, AgentModelConfigSplice, which is described as encoding the actual incident this guard permanently protects against — a 2026-09-20 outage where a vendored SDK named a retired model, Copilot returned 400, and Wave 3 degraded silently. CopilotModelIdDriftGuard is the concrete test artifact that operationalizes that postmortem into an executable invariant.

## Architecture and Design

The suite's architecture centers on static inspection rather than execution. Instead of importing and running `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`, the replacement-mapping test (lines 70-76) parses its source text with a regex to extract mapping pairs, treating the script as data. This avoids executing untrusted or side-effectful JS just to validate a table, at the cost of fragility — a reformatted array literal would silently produce zero matches, caught only by a `pairs.length >= RETIRED.length` sanity check.

Build-order correctness is similarly enforced through text inspection: the Dockerfile ordering check (lines 87-96) uses `Array.prototype.findLastIndex` to find the *last* `npm install` matching a prefix, deliberately guarding against multi-stage or duplicated install stanzas where only the final install's vendored dist survives into the image. This reflects a broader design note that the guard spans two artifacts — the Dockerfile RUN step and package.json's postinstall wiring — corresponding to two distinct install paths (image build vs. host install), each tested independently.

Environment sensitivity is centralized rather than distributed: a single `SA_CHECKED_OUT` boolean (lines 34-38, via `existsSync` on the submodule's package.json) gates most tests, rather than per-test file checks. This inversion of the typical skip pattern ensures that a genuinely broken alignment script inside a checked-out submodule cannot be silently skipped test-by-test — the whole suite's sensitivity to CI's `submodules: false` setting lives in one place.

## Implementation Details

Six assertions compose the guard: script existence, coverage of all retired ids, replacement-mapping safety (no retired id maps to another retired id), Dockerfile invocation of the script, Dockerfile ordering relative to npm install, and package.json postinstall wiring. The regex used for mapping extraction (`/\["'([^']+)'",\s*"'([^']+)'"\]/g`) couples the test to the alignment script by source-text convention rather than an exported/importable contract — there is no shared interface, only shape agreement.

The final test, verifying the installed package carries no retired id (lines 104-112), is unique in inspecting `node_modules` directly instead of source files, and carries its own independent `t.skip`, distinct from the shared `SA_CHECKED_OUT` gate — its precondition (an installed dist artifact) is strictly narrower than submodule checkout.

## Integration Points

CopilotModelIdDriftGuard sits beneath AgentModelConfigSplice and is grouped under LLMMockService per the entity hierarchy, tying it into the broader mock/model-routing test surface. It has no functional relationship to sibling components PiModelsJsonMerge or OpencodeAnthropicNativeSplice, despite thematic proximity in the code graph (both are flagged as unrelated, likely due to filename/keyword overlap around "copilot"/model config). Similarly, sibling files like cost-model.ts, offload-decision.tsx, and use-classifier-judge.ts are confirmed unrelated — captured only by neighborhood retrieval, not functional coupling. The guard's real integration points are external artifacts: the Dockerfile RUN step, package.json's postinstall hook, and the semantic-analysis submodule's alignment script and vendored `@rapid/llm-proxy` dist.

## Usage Guidelines

Developers modifying the alignment script's replacement-mapping array must preserve its quoted, single-line array-literal shape, since the guard's regex-based parsing has no tolerance for reformatting. Any new `npm install` stanzas added to the Dockerfile for the semantic-analysis path must still leave the alignment script as the last step before image finalization — the `findLastIndex`-based check treats only the final install as authoritative. When working without the private submodule checked out, expect the majority of tests to no-op via `SA_CHECKED_OUT`; this is intentional and not a sign of a broken suite. The `node_modules`-inspecting test is the exception, gated separately, and should not be conflated with the submodule-checkout precondition when debugging skip behavior.


## Hierarchy Context

### Parent
- [AgentModelConfigSplice](./AgentModelConfigSplice.md) -- [LLM] tests/features/copilot-model-ids.test.mjs is a drift guard, not a routing implementation: it hardcodes a RETIRED list (currently ['claude-sonnet-4.6', 'claude-opus-4.6']) and asserts that integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs rewrites every one of them to a non-retired successor. The test explicitly checks that the Dockerfile invokes the alignment script AFTER the last `npm install` for semantic-analysis (via `findLastIndex`), because an npm install re-vendors @rapid/llm-proxy's dist and would silently undo the rewrite if the script ran first. This encodes a real incident (2026-09-20) where the vendored SDK named a retired model, Copilot returned 400, and Wave 3 fell through to `[llm] All providers failed`, writing a ~600-char stub instead of a ~4400-char analysis, with nothing in the logs naming the model.

### Siblings
- [PiModelsJsonMerge](./PiModelsJsonMerge.md) -- [LLM] None of the supplied code files implement or name a 'PiModelsJsonMerge' component. The closest thematically-related file is tests/features/copilot-model-ids.test.mjs, which guards against retired Copilot model ids being vendored into @rapid/llm-proxy's dist, but this is a drift-guard test for a Dockerfile/postinstall alignment script (align-copilot-model-ids.mjs), not a mechanism for merging pi's models.json.
- [OpencodeAnthropicNativeSplice](./OpencodeAnthropicNativeSplice.md) -- [LLM] None of the supplied files implement, name, or reference anything called 'OpencodeAnthropicNativeSplice.' The nearest thematic neighbor is cost-model.ts's `isOpenAIWireProvider()`, which classifies `opencode` as an OpenAI-wire provider (`p === 'opencode'`) for the purposes of `freshInputTokens()`/`cellCostUsd()` cache-token accounting — this is about billing semantics for opencode traffic that already passes through the proxy as OpenAI-shaped JSON, not about splicing Anthropic-native protocol behavior into opencode's transport. A component named around an 'Anthropic-native splice' for opencode would live in the proxy's provider-adapter code (something translating or merging Anthropic wire semantics into opencode's request/response path), and no such adapter, translator, or splice function appears anywhere in the retrieved files.


---

*Generated from 9 observations*

# LLMMockService

**Type:** SubComponent

## What It Is

LLMMockService is documented to live in `llm-mock-service.ts`, but no observation set in this pass actually retrieved that file. The five code files supplied for this analysis (`tests/features/copilot-model-ids.test.mjs`, `cost-model.ts`, `offload-decision.tsx`, `use-classifier-judge.ts`, `store/provider.tsx`) are confirmed by the observations themselves to be unrelated dashboard/cost/routing/test components pulled in via an "LLM" filename substring match rather than any implementation of the mock-mode resolver. The one substantive claim about its internals — that `getLLMMode()` layers per-agent overrides, global mode, a legacy boolean, and a hardcoded default — is explicitly flagged as carried forward from a prior distillation of the parent entity, unverified against source in this pass.

## Architecture and Design

Only weak, indirect signal exists here. Two session records (PlantUML diagram-generation failures, and an inference-locality GPU proposal) mention LLMMockService by name but describe surrounding concerns rather than its internal design. The 'LLM Routing Tier Priority' record establishes a fallback-order constraint (max-subscription → Copilot-tier → Groq Llama-70B as last resort) at the parent (LLMAbstraction) level, which the observations speculate — but do not confirm — might inform how a mock resolver orders its own branches.

## Implementation Details

No verified implementation detail can be given. The four-branch cascade in `getLLMMode()` is repeated across observations but is consistently caveated as unverified parent-context carryover, not something confirmed against retrieved source in this analysis pass.

## Integration Points

Structurally, LLMMockService sits under LLMAbstraction alongside siblings DMRProvider, LLMWithProcessClient, LlmJsonParser, CopilotModelIdAlignment, CostModel, OffloadRoutingDashboard, and ModelContextLimits, and contains children CopilotModelIdDriftGuard and ModelContextCatalogueCache. Notably, both children suffer the identical retrieval failure as the parent: CopilotModelIdDriftGuard's only visible surface is the test file `copilot-model-ids.test.mjs` (which itself documents a real, separate mechanism — `align-copilot-model-ids.mjs` — rather than LLMMockService logic), and ModelContextCatalogueCache has no matching code at all in this file set.

![LLMMockService — Relationship](images/llmmock-service-relationship.png)

## Usage Guidelines

Given the state of evidence, the only responsible guidance is procedural: future retrieval for LLMMockService should target `llm-mock-service.ts` directly rather than relying on substring search, which reliably surfaces sibling dashboard/routing/cost files instead.

![LLMMockService — Architecture](images/llmmock-service-architecture.png)

INSUFFICIENT_EVIDENCE: the retrieved code files are unrelated dashboard/routing/cost/test components, and no observation confirms the actual contents of llm-mock-service.ts in this pass.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- 'PlantUML Diagram Generation — Wave 4 Syntax Failures' ties LLMMockService to diagnosing syntax failures/truncation in generated .puml files during mocked runs
- 'Inference-Locality GPU Integration Proposal (a2a-xpr)' references LLMMockService in the context of removing prescriptive framing about where agentic inference executes relative to corporate networks
- The 'LLM Routing Tier Priority' work record establishes that LLM request routing must enforce a fixed fallback order — max-subscription models first, then work/GH Copilot-tier models, then Groq Llama-70B strictly as last resort — because routing logic had regressed to treating lower-tier providers as primary rather than true fallbacks; this is a product/cost decision, not something recoverable from provider-selection code alone, and would bear on how any mock-mode resolver should order its own fallback branches if it mirrors live routing tiers.
- The 'CLI/UKB Run Timeout and Provider Error Diagnostics' work record establishes that rapid-llm-proxy was explicitly ruled out as the source of short-duration CLI timeouts affecting UKB runs based on log evidence, narrowing the search for any timeout-adjacent behavior (including mock-vs-live mode misresolution masquerading as a timeout) to provider-specific failures further down the call chain rather than the proxy's own request handling.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as last resort — rather than demoting to lower tiers as primary

### Children
- [CopilotModelIdDriftGuard](./CopilotModelIdDriftGuard.md) -- [LLM] tests/features/copilot-model-ids.test.mjs is the actual implementation surface of CopilotModelIdDriftGuard: it is not a source module but an executable guard, structured around the fact that `@rapid/llm-proxy` hardcodes copilot-tier model ids in a constructor default and is vendored from a GitHub release tarball rather than npm, so `patch-package` cannot diff it cleanly (the docstring records a 148KB patch spanning 25 unrelated files as the rejected alternative). The correction lives instead in `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`, and this test file's entire job is to assert that script still exists, still rewrites every id in the `RETIRED` array, and is still wired into both invocation paths — it does not test the proxy or the model ids directly, it tests that the repair mechanism has not silently rotted.
- [ModelContextCatalogueCache](./ModelContextCatalogueCache.md) -- [LLM] None of the four supplied code files — tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx, integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts, and store/provider.tsx — implement, import, or reference anything named ModelContextCatalogueCache. The retrieval set matches the parent entity's earlier finding (LLMMockService pulled the same sibling routing/dashboard/cost files by an 'LLM' filename substring); the same substring-matching failure mode recurs here, this time presumably matched on 'Model'/'Context'/'Catalogue'-adjacent tokens rather than any actual implementation of a model-context caching layer.

### Siblings
- [DMRProvider](./DMRProvider.md) -- [LLM] The parent context describes dmr-provider.ts's loadDMRConfig() as searching three candidate filesystem paths (cwd/config/dmr-config.yaml, cwd/integrations/semantic-analysis/config/dmr-config.yaml, and a __dirname-relative path) before falling back to an in-code DEFAULT_CONFIG. None of the supplied code files contain this file or function — the retrieved files (cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx, copilot-model-ids.test.mjs) are all part of the rapid-llm-proxy dashboard and test surface, not the DMR provider module itself.
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- [SESSION] 'CLI/UKB Run Timeout and Provider Error Diagnostics' documents this layer's role in distinguishing proxy-layer timeouts from provider-specific failures further down the call chain
- [LlmJsonParser](./LlmJsonParser.md) -- [LLM] None of the supplied code files (copilot-model-ids.test.mjs, cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, provider.tsx) implement or import parseLlmJson or any JSON-repair logic described in the parent context for LlmJsonParser. The parent observation about parseLlmJson()'s inString state machine and control-character escaping in parse-llm-json.ts is not reachable from this file set.
- [CopilotModelIdAlignment](./CopilotModelIdAlignment.md) -- [LLM] tests/features/copilot-model-ids.test.mjs is the entire visible implementation of CopilotModelIdAlignment: it is a drift-guard test suite, not the alignment logic itself, and its own file-header comment explains why the correction exists as a standalone post-install script (`integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`) rather than a patch-package diff — attempting patch-package against the vendored `@rapid/llm-proxy` tarball produced a 148KB patch spanning 25 unrelated files, because the package is installed from a GitHub release tarball with no clean npm-registry baseline to diff against.
- [CostModel](./CostModel.md) -- [LLM] cost-model.ts's `budgetForMonth()` resolves a budget cap through a two-tier lookup: an explicit per-month override in `monthlyEurByMonth` (keyed 'YYYY-MM') takes precedence over the standing `monthlyEur` value, and a stored `null` override is honoured as 'no cap that month' rather than treated as absent. The `DEFAULT_COST_CONFIG.budgets.copilot` entry encodes a real history of this — the cap moved 300 → 600 → 1000 during 2026-08 as extensions were approved — and the comment above `BudgetConfig` explains why this is not modelled as a single mutable number: doing so would retroactively re-judge past months (e.g. flagging July as 'over' against a cap that did not exist yet). The design deliberately does not model in-month changes either; the unit is the calendar month and the value that matters is the cap in force at month end.
- [OffloadRoutingDashboard](./OffloadRoutingDashboard.md) -- [SESSION] 'LLM Routing Tier Priority' establishes the fallback tier order (max-subscription first, then work/Copilot, then Groq Llama-70B last resort) that this dashboard's rung ladder is built to visualize and verify
- [ModelContextLimits](./ModelContextLimits.md) -- [LLM] None of the five retrieved files define, reference, or import anything called `ModelContextLimits`, and none contain logic that maps a model id to a context-window size (e.g. a token-count ceiling used to decide whether a prompt fits). The closest thematic neighbor is `integrations/system-health-dashboard/src/components/cost/cost-model.ts`, but its `modelPrices` table and `priceForModel()`/`cellCostUsd()` functions price tokens in dollars — they never bound how many tokens a model can accept. A component named ModelContextLimits would need its own file (or a section of a routing config) that this retrieval did not surface.


---

*Generated from 11 observations*

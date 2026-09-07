# DMRProvider

**Type:** SubComponent

DMRProvider is documented alongside env vars like QWEN_LOCAL_API_KEY and QWEN_LAPTOP_API_BASE_URL, indicating it targets locally hosted Qwen-family models

# DMRProvider: Technical Insight Document

## What It Is

DMRProvider is a provider implementation within the LLMAbstraction component that wraps Docker Model Runner's OpenAI-compatible API surface. It exists specifically to support locally hosted inference, targeting the Qwen-family of models as evidenced by its documentation alongside environment variables such as `QWEN_LOCAL_API_KEY` and `QWEN_LAPTOP_API_BASE_URL`. Rather than introducing a bespoke request/response protocol, DMRProvider deliberately conforms to the OpenAI-style client shape, allowing existing code paths built for OpenAI-compatible clients to be reused without modification when talking to a locally running model runner.

![DMRProvider — Architecture](images/dmrprovider-architecture.png)

## Architecture and Design

The defining architectural decision behind DMRProvider is its adapter-style relationship to the OpenAI API contract: by exposing the same request/response shape as OpenAI, it lets the rest of the LLMAbstraction layer treat local inference as a drop-in alternative to remote/public providers, rather than requiring provider-aware branching throughout the codebase. This mirrors a broader pattern in the parent LLMAbstraction component, which centralizes dispatch logic in a mode-resolution hierarchy rather than scattering provider-selection logic across callers.

Selection of DMRProvider is entirely gated by LLMMockService's mode-resolution chain — DMRProvider is only invoked when `getLLMMode()` resolves to `'local'` for a given agent. This resolution follows the strict precedence order documented for the parent component: per-agent override, then global mode, then the legacy `mockLLM` boolean, and finally the `'public'` default. DMRProvider itself has no awareness of this precedence logic; it simply becomes the active implementation when the upstream decision lands on `'local'`. This separation of concerns is intentional — the provider isolates local-inference-specific error handling and quirks so that they do not leak back into the mode-resolution layer, keeping LLMMockService generic and provider-agnostic.

## Implementation Details

At its core, DMRProvider's implementation responsibility is translating calls into Docker Model Runner's OpenAI-compatible endpoints. Because it reuses the OpenAI request/response shape, the provider likely does minimal transformation work relative to providers that must reformat requests for a divergent API — its main technical burden is instead configuration-driven: resolving the correct local endpoint and credentials from environment variables like `QWEN_LOCAL_API_KEY` and `QWEN_LAPTOP_API_BASE_URL` rather than reshaping payloads.

Error handling is a notable implementation concern called out explicitly in the observations: provider-specific failure modes (e.g., local runner unavailability, model-loading issues) are handled within DMRProvider itself rather than being propagated in a way that would force LLMMockService or the mode-resolution logic to understand DMR-specific failure semantics. This containment strategy keeps the provider swappable and the orchestration layer simple.

## Integration Points

![DMRProvider — Relationship](images/dmrprovider-relationship.png)

DMRProvider is contained within LLMAbstraction, alongside sibling components LLMMockService, LLMWithProcessClient, CostModel, and ProxyURLResolver. Its most direct integration point is with LLMMockService, whose `getLLMMode()` function in `llm-mock-service.ts` acts as the gatekeeper determining whether DMRProvider is invoked at all for a given agent call. Unlike LLMWithProcessClient, which bypasses higher-level SDK abstractions with a direct `fetch()` call to `/api/complete` on rapid-llm-proxy, DMRProvider instead relies on the OpenAI-compatible client abstraction to reach Docker Model Runner — a contrasting integration style within the same sibling set that reflects the different target backends (remote proxy vs. local runner).

While no direct observation ties DMRProvider to CostModel or ProxyURLResolver, its position as a peer within LLMAbstraction suggests it operates independently of the proxy-URL-resolution concerns (relevant to remote/public providers) and of cost-modeling concerns (which map token counts to pricing tables) — local inference via Docker Model Runner does not carry the same per-token billing considerations as hosted providers.

## Usage Guidelines

Developers seeking to route an agent to local inference should ensure the mode-resolution chain actually resolves to `'local'` for that agent — since per-agent overrides silently win over global settings, simply expecting DMRProvider to activate based on a global mode change may not be sufficient, and the four-level precedence (per-agent, global, legacy `mockLLM`, default `'public'`) must be checked to diagnose unexpected routing behavior.

Configuration of DMRProvider should be done through the documented Qwen-oriented environment variables (`QWEN_LOCAL_API_KEY`, `QWEN_LAPTOP_API_BASE_URL`), and developers should expect Docker Model Runner to be running locally and exposing an OpenAI-compatible endpoint. Because DMRProvider absorbs its own provider-specific error handling, failures surfaced from this path should be treated as local-environment issues (e.g., runner not started, model not loaded) rather than issues with the mode-resolution logic itself — troubleshooting should start with the DMR/runner setup before suspecting LLMMockService's dispatch logic.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component implements a mode-resolution hierarchy that is critical for understanding how any given agent call is actually dispatched. getLLMMode() in llm-mock-service.ts checks, in strict order: a per-agent override (allowing individual agents to be pinned to mock/local/public independently of global state), then a global mode setting, then a legacy mockLLM boolean flag (retained for backward compatibility with older config schemas), and finally falls back to 'public' as the safe default. This layered precedence means a developer debugging unexpected LLM behavior for a specific agent must check all four levels rather than assuming the global setting applies uniformly—per-agent overrides silently win even if the global mode says otherwise, which is a common source of confusion during multi-agent experiments.

### Siblings
- [LLMMockService](./LLMMockService.md) -- getLLMMode() in llm-mock-service.ts implements a strict precedence chain: per-agent override, then global mode, then legacy mockLLM boolean, then 'public' default
- [LLMWithProcessClient](./LLMWithProcessClient.md) -- LLMWithProcessClient bypasses higher-level SDK abstractions in favor of a direct fetch() call to /api/complete on rapid-llm-proxy
- [CostModel](./CostModel.md) -- CostModel contains pure functions mapping token counts to €/$ costs based on per-provider pricing tables
- [ProxyURLResolver](./ProxyURLResolver.md) -- ProxyURLResolver reads environment variables such as RAPID_LLM_PROXY_URL and LLM_CLI_PROXY_URL to decide which endpoint to use


---

*Generated from 4 observations*

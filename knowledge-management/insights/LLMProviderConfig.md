# LLMProviderConfig

**Type:** SubComponent

Each provider block in `config/llm-providers.yaml` declares a `models` list with explicit `context_window` and `max_tokens` fields, allowing the `LLMProviderConfig` loader to enforce token-limit validation before dispatching calls to the underlying provider client.

## What It Is

LLMProviderConfig is a sub-component of LLMAbstraction responsible for declaring and loading provider/model configurations from `config/llm-providers.yaml`. It defines available models per provider with their capabilities (`context_window`, `max_tokens`) and organizes them into tiers (e.g., `premium`, `standard`).

## Architecture and Design

The configuration uses a tiered YAML structure where each provider block contains a `models` list with explicit capacity fields. This declarative approach separates model metadata from runtime routing logic — LLMProviderConfig owns the data, while sibling TierRouter consumes it to make routing decisions.

![LLMProviderConfig — Architecture](images/llmprovider-config-architecture.png)

The tier annotations (`tier: premium`, `tier: standard`) feed directly into the child component TieredModelSelection, which represents the formalized strategy for selecting models based on cost/capability tradeoffs.

## Implementation Details

The LLMProviderConfig loader reads `config/llm-providers.yaml` and enforces token-limit validation (comparing `context_window` and `max_tokens` constraints) before any call is dispatched to a provider client. This pre-validation prevents wasted API calls that would exceed model limits.

![LLMProviderConfig — Relationship](images/llmprovider-config-relationship.png)

## Integration Points

- **Parent (LLMAbstraction):** Provides the normalized model metadata that the abstraction layer needs regardless of active mode (mock/local/public)
- **Sibling (TierRouter):** Consumes tier classifications to route requests by cost/capability
- **Sibling (PublicProviderAdapter):** Uses the per-model token limits for request shaping
- **Child (TieredModelSelection):** Implements the selection logic atop the tier data declared here

## Usage Guidelines

When adding a new model, declare it in `config/llm-providers.yaml` with explicit `context_window`, `max_tokens`, and `tier` fields. Never hardcode model limits in application code — always rely on the config loader's validated output.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] **Three-Tier Mode System and Runtime Switchability**

The `LLMAbstraction` component defines a `LLMMode` type (`'mock' | 'local' | 'public'`) in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` that maps to three fundamentally different execution paths: deterministic mock responses (zero-cost, no network), local Docker Model Runner inference (offline-capable, GPU-optional), and cloud API calls to Anthropic/OpenAI/Groq. These are not environment-level flags but a first-class runtime concept — the mode can be changed mid-session without restarting any process.

This design directly solves a pain point common in LLM-integrated systems: the inability to cheaply validate agent orchestration logic without burning API tokens or requiring network access. By making 'mock' a first-class mode rather than a test-only stub, developers can run full multi-agent workflows during CI, iterate on prompt logic locally, and only graduate to 'public' when cloud validation is needed. The architectural implication is that every agent must be mode-agnostic — none may directly instantiate an LLM client; all must go through the abstraction layer's `getLLMMode()` query and receive a normalized response structure regardless of provider.

### Children
- [TieredModelSelection](./TieredModelSelection.md) -- The existence of integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal') as a dedicated architecture document signals that tier-based provider selection is a first-class, explicitly designed concern within the LLM abstraction layer rather than an ad-hoc runtime decision.

### Siblings
- [TierRouter](./TierRouter.md) -- TierRouter is a sub-component of LLMAbstraction
- [PublicProviderAdapter](./PublicProviderAdapter.md) -- PublicProviderAdapter is a sub-component of LLMAbstraction


---

*Generated from 3 observations*

# PublicProviderAdapter

**Type:** SubComponent

The adapter directory structure referenced in integrations/mcp-server-semantic-analysis/docs/architecture/README.md implies a common interface that all public provider adapters implement

# PublicProviderAdapter — Technical Insight Document

## What It Is

PublicProviderAdapter is a SubComponent of the `LLMAbstraction` layer, implemented under `integrations/mcp-server-semantic-analysis/src/providers/`. The directory hosts one adapter per cloud LLM provider — Anthropic, OpenAI, and Groq — as declared in `config/llm-providers.yaml`. Each adapter is a concrete realization of a shared provider interface, responsible for translating the abstraction layer's normalized LLM calls into provider-specific API requests when the system is operating in `'public'` mode.

The adapter exists as one of three peer modes within `LLMAbstraction` (alongside mock and local), and it is selected at runtime by `LLMStateManager`, which reads `.data/workflow-progress.json` to resolve the active mode. Crucially, PublicProviderAdapter is only instantiated and invoked when the resolved mode is `'public'`, meaning call sites remain decoupled from any knowledge of which cloud provider — or whether any cloud provider at all — is currently in use.

![PublicProviderAdapter — Architecture](images/public-provider-adapter-architecture.png)

## Architecture and Design

The architectural approach follows the **Adapter pattern** at its core: each cloud provider (Anthropic, OpenAI, Groq) is wrapped behind a uniform interface that the parent `LLMAbstraction` can invoke without provider-specific branching. The directory structure under `integrations/mcp-server-semantic-analysis/src/providers/` — referenced in `integrations/mcp-server-semantic-analysis/docs/architecture/README.md` — implies a common interface contract that all public provider adapters implement, enabling polymorphic dispatch from the parent layer.

A second pattern at play is **configuration-driven plugin registration**. The set of supported public providers is not hard-coded into the routing logic; instead, `config/llm-providers.yaml` serves as the authoritative declaration of which adapters are available and how they should be initialized. This configuration contract is owned by the child entity `ProviderConfig`, which centralizes per-provider secrets and model identifiers, making the YAML file the primary integration seam between adapter code and the deployment environment.

The third architectural concern handled at this layer is **tiered model selection**, factored out into the `TieredModelSelection` child component. As documented in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`, the proposal distinguishes model tiers by task complexity so that lightweight tasks avoid expensive frontier models. By treating tier selection as a first-class concern within PublicProviderAdapter — rather than letting each adapter make ad-hoc decisions — the design ensures consistent cost-aware routing across providers. This responsibility is shared conceptually with the sibling `TierRouter`, but PublicProviderAdapter applies tier decisions at the point of provider invocation.

The separation of `LLMStateManager` (mode resolution), `TierRouter` (tier dispatch), and PublicProviderAdapter (provider-specific API calls) reflects a clean **separation of concerns** across three orthogonal axes: *when* to use public mode, *which tier* to use, and *how* to talk to a specific cloud provider.

## Implementation Details

Each adapter lives as a discrete module under `integrations/mcp-server-semantic-analysis/src/providers/`, with one file per provider. At initialization, an adapter reads its provider-specific configuration keys — documented in `integrations/mcp-server-semantic-analysis/docs/configuration.md` — to obtain API credentials, base URLs, model identifiers, and tier-to-model mappings. The configuration keys are consumed exclusively at construction time, allowing the adapter to fail fast if required credentials are missing.

The adapter's invocation pathway begins with the parent `LLMAbstraction` consulting `LLMStateManager.getLLMState()` (implemented in `llm-mock-service.ts`) to read `.data/workflow-progress.json`. Only when that call returns `'public'` does the PublicProviderAdapter come into play. This lazy, mode-gated instantiation pattern means that workflows running in mock or local mode never pay the cost of cloud SDK initialization or credential validation.

Within the adapter, the `TieredModelSelection` logic maps the incoming request's complexity classification to a concrete model identifier from the provider's configured tier table. The selected model is then passed to the provider's native SDK call. Because each adapter is responsible for its own provider's request/response normalization, the parent abstraction receives a uniform result regardless of which cloud service handled the call.

![PublicProviderAdapter — Relationship](images/public-provider-adapter-relationship.png)

## Integration Points

PublicProviderAdapter integrates with the broader system through four primary seams. First, it is **contained by** `LLMAbstraction`, which acts as its only legitimate caller — direct invocation from elsewhere in the codebase would bypass the mode-resolution logic and break the abstraction's three-mode guarantee. Second, it **depends on** `LLMStateManager` indirectly: although the adapter does not call the state manager itself, its very instantiation is conditional on the state manager's verdict.

Third, the adapter integrates with `config/llm-providers.yaml` through its `ProviderConfig` child, which is the canonical source for per-provider settings. This file functions as the deployment-environment contract — changes to supported providers, model lists, or credentials are made here without touching adapter code. Fourth, the `TieredModelSelection` child binds the adapter to the tiering strategy described in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`, ensuring tier-aware routing decisions are applied uniformly across Anthropic, OpenAI, and Groq adapters.

The sibling `TierRouter` operates at a complementary level: while `TierRouter` may decide which tier a request belongs to in the broader pipeline, the adapter's internal `TieredModelSelection` resolves that tier to a concrete provider-specific model. This division keeps tier *policy* separate from tier *implementation*.

## Usage Guidelines

Developers extending or maintaining PublicProviderAdapter should observe several conventions. **Add new providers via configuration first**: any new public provider must be declared in `config/llm-providers.yaml` before its adapter is implemented, and the adapter file should be placed under `integrations/mcp-server-semantic-analysis/src/providers/` alongside the existing three. The adapter must implement the common provider interface implied by the directory structure to participate in polymorphic dispatch from `LLMAbstraction`.

**Never call adapters directly from application code.** All LLM invocations must go through `LLMAbstraction`, which guarantees that `LLMStateManager`'s mode resolution is respected. Bypassing the abstraction would defeat the runtime mode-switching capability that allows the system to flip between mock, local, and public without service restarts.

**Tier-to-model mappings belong in configuration, not code.** Because `TieredModelSelection` is a first-class design concern (per `TIERED-MODEL-PROPOSAL.md`), any decisions about which model serves which task complexity should be expressible through `ProviderConfig` rather than hard-coded conditionals within an adapter. This keeps cost-tuning a deployment concern rather than a development one.

Finally, **respect the initialization contract**: provider-specific configuration keys documented in `integrations/mcp-server-semantic-analysis/docs/configuration.md` are consumed at adapter construction. Missing or malformed configuration should cause loud, early failures rather than silent fallbacks — the parent `LLMAbstraction` already provides a fallback hierarchy (per-agent override → global mode → `'public'` default), and adding silent failure modes within an adapter would undermine that explicit priority chain.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-modal provider abstraction layer that routes LLM calls across three operational modes—mock, local, and public—without requiring callers to be aware of the underlying provider. The mode selection follows a strict priority hierarchy: per-agent overrides take precedence over a global mode, which itself overrides a fallback default of 'public'. This state is persisted in `.data/workflow-progress.json` and read at invocation time, enabling runtime mode switching without service restarts. The component also maintains backward compatibility with a legacy boolean `mockLLM` flag in the same file, ensuring older clients continue to function correctly.

### Children
- [ProviderConfig](./ProviderConfig.md) -- The parent component analysis explicitly identifies config/llm-providers.yaml as the central configuration artifact for public provider adapters, storing per-provider secrets and model identifiers — making it the primary integration seam between adapter code and deployment environment.
- [TieredModelSelection](./TieredModelSelection.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal') is an explicitly listed architecture document dedicated to model tier selection, confirming this is a first-class design concern for the public provider layer rather than an ad-hoc per-adapter decision.

### Siblings
- [LLMStateManager](./LLMStateManager.md) -- getLLMState() in llm-mock-service.ts reads .data/workflow-progress.json at invocation time, enabling runtime mode switching without service restarts
- [TierRouter](./TierRouter.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md defines the tiered model selection strategy, distinguishing tiers by task complexity so that lightweight tasks avoid expensive frontier models


---

*Generated from 5 observations*

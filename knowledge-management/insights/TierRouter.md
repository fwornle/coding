# TierRouter

**Type:** SubComponent

The mode control flow documented in docs/puml/llm-mode-control.puml shows that TierRouter evaluates environment or configuration flags to gate transitions between tiers, preventing unintended escalation to public LLM providers during local or test execution.

# TierRouter — Technical Insight Document

## What It Is

`TierRouter` is a sub-component of `LLMAbstraction` whose responsibility is to resolve which LLM backend handles a given request at routing time. It operates against the three-tier provider hierarchy (`mock` / `local` / `public`) formalized in `docs/puml/llm-tier-routing.puml`, and it enforces the mode transition rules captured in `docs/puml/llm-mode-control.puml`. In other words, TierRouter is the decision point that maps an incoming agent request — together with its surrounding context (agent identity, environment flags, configuration) — onto a concrete provider tier inside the broader `LLMAbstraction` layer.

![TierRouter — Architecture](images/tier-router-architecture.png)

Because the parent `LLMAbstraction` exposes a `LLMMode` type (`'mock' | 'local' | 'public'`) defined in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` and treats mode as a first-class runtime concept rather than a deploy-time switch, TierRouter is the runtime mechanism that makes that switchability real. It is the component that takes a `getLLMMode()` result (or a per-request override) and converts it into a binding to the appropriate adapter — most notably the sibling `PublicProviderAdapter` when the resolved tier is `public`, and the corresponding mock or local execution paths for the other two tiers.

## Architecture and Design

TierRouter implements a **tiered router / strategy-selection pattern** layered on top of the explicit provider hierarchy documented in `docs/puml/llm-tier-routing.puml`. Three tiers — `mock`, `local`, and `public` — are arranged from cheapest/safest to most expensive/most-capable, and TierRouter is responsible for selecting among them rather than for executing the call itself. Execution is delegated downstream to the appropriate adapter (e.g., `PublicProviderAdapter` for cloud calls), keeping TierRouter focused on policy and dispatch.

The design separates two concerns that are easy to conflate in LLM systems: **selection** (which tier should serve this request?) and **gating** (is the system currently allowed to use that tier?). The `docs/puml/llm-mode-control.puml` diagram documents the latter explicitly: TierRouter inspects environment or configuration flags to gate transitions between tiers, with a particular emphasis on preventing unintended escalation to `public` providers during local development or test execution. This guard-rail design encodes a safety-by-default posture in which higher-cost or externally-visible tiers must be affirmatively unlocked rather than passively reachable.

TierRouter also collaborates with its child component, `TieredModelSelectionPolicy`, which encapsulates the *criteria* used to choose among tiers and models. The selection criteria for that policy are formally proposed in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. This composition — a router that consults a pluggable policy — is a deliberate separation of mechanism (TierRouter's dispatch and gating) from policy (the tier/model selection rules), allowing the rules to evolve without re-architecting the routing surface.

## Implementation Details

The routing flow can be understood as a small pipeline: (1) the request arrives with an agent identity and request context; (2) TierRouter consults `TieredModelSelectionPolicy` to determine the preferred tier and model for that combination; (3) TierRouter applies the mode-control gating rules from `docs/puml/llm-mode-control.puml` to validate that the preferred tier is permitted under current environment/configuration flags; and (4) it binds the request to the corresponding provider path — falling through to a downgraded tier (or rejecting) when gating denies the preferred selection.

The `LLMMode` type lives alongside the mock implementation in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`, which means the mock path is co-located with the canonical mode definition. For TierRouter this implies that resolving to `mock` is the closest-to-default behavior: deterministic, network-free, and zero-cost. Resolving to `local` engages the local Docker Model Runner inference path described by the parent component, while resolving to `public` hands off to the sibling `PublicProviderAdapter`, which encapsulates Anthropic/OpenAI/Groq API calls.

![TierRouter — Relationship](images/tier-router-relationship.png)

Although no concrete code symbols were indexed for TierRouter directly, the structural contract is constrained by the surrounding components: it must consume the `LLMMode` enumeration, it must produce a normalized handle that the abstraction layer's response-shaping code can use uniformly, and it must defer model-level decisions to `TieredModelSelectionPolicy`. The PlantUML artifacts (`llm-tier-routing.puml` and `llm-mode-control.puml`) and the proposal document (`TIERED-MODEL-PROPOSAL.md`) together constitute the authoritative implementation specification.

## Integration Points

Upstream, TierRouter is invoked by `LLMAbstraction`, which owns the public surface that agents call. Because the parent enforces that "every agent must be mode-agnostic — none may directly instantiate an LLM client," TierRouter is effectively the only path through which mode resolution occurs. Agents never see it directly; they see the normalized response returned by the abstraction layer after TierRouter has chosen and dispatched to a backend.

Laterally, TierRouter coordinates with its siblings inside `LLMAbstraction`. `LLMProviderConfig` supplies the configuration surface — credentials, endpoints, feature flags — that TierRouter reads when applying mode-control gating. `PublicProviderAdapter` is the downstream consumer when the router resolves to the `public` tier, encapsulating the actual cloud provider integrations so that TierRouter does not need provider-specific knowledge.

Downstream, TierRouter delegates the *what-to-pick* question to its child, `TieredModelSelectionPolicy`. This is the integration point that determines, for a given agent identity and request context, which model within a tier is appropriate, and how the policy proposal in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` is realized at runtime. The two components together form a router-plus-policy pair, with TierRouter responsible for dispatch and gating and `TieredModelSelectionPolicy` responsible for the selection rules themselves.

## Usage Guidelines

Developers extending or invoking this subsystem should treat TierRouter as the single resolution point for tier selection — do not bypass it by reading `LLMMode` directly and instantiating providers inline. The parent `LLMAbstraction` contract requires agents to be mode-agnostic, and TierRouter's gating logic (per `docs/puml/llm-mode-control.puml`) is what enforces the "no unintended escalation to public" safety property. Skipping it forfeits that guarantee and risks accidental cloud API calls during CI or local iteration.

When changing tier selection behavior, modify `TieredModelSelectionPolicy` and update `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` to keep the documented design in sync with the implementation. TierRouter itself should remain focused on dispatch and gating; introducing selection heuristics into the router would blur the mechanism/policy boundary that the current design deliberately maintains.

When adding new providers, prefer extending an existing tier (typically `public` via `PublicProviderAdapter`) and surfacing any new configuration through `LLMProviderConfig`, rather than introducing a fourth tier. The three-tier model (`mock` / `local` / `public`) is intentionally coarse — it represents three fundamentally different execution regimes (deterministic, offline-capable, cloud) — and broadening it would dilute the safety semantics that the mode-control flow depends on. Finally, when working in CI or local development, leave mode resolution to default to `mock` so that workflows are exercised end-to-end without consuming tokens or requiring network access; `local` and `public` should be opted into explicitly via the configuration flags that TierRouter evaluates at routing time.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] **Three-Tier Mode System and Runtime Switchability**

The `LLMAbstraction` component defines a `LLMMode` type (`'mock' | 'local' | 'public'`) in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` that maps to three fundamentally different execution paths: deterministic mock responses (zero-cost, no network), local Docker Model Runner inference (offline-capable, GPU-optional), and cloud API calls to Anthropic/OpenAI/Groq. These are not environment-level flags but a first-class runtime concept — the mode can be changed mid-session without restarting any process.

This design directly solves a pain point common in LLM-integrated systems: the inability to cheaply validate agent orchestration logic without burning API tokens or requiring network access. By making 'mock' a first-class mode rather than a test-only stub, developers can run full multi-agent workflows during CI, iterate on prompt logic locally, and only graduate to 'public' when cloud validation is needed. The architectural implication is that every agent must be mode-agnostic — none may directly instantiate an LLM client; all must go through the abstraction layer's `getLLMMode()` query and receive a normalized response structure regardless of provider.

### Children
- [TieredModelSelectionPolicy](./TieredModelSelectionPolicy.md) -- The document 'integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md' (titled 'Tiered Model Selection Proposal') is the primary design artifact for this policy, indicating that tier boundaries and selection criteria were formally proposed and documented rather than emerged organically.

### Siblings
- [LLMProviderConfig](./LLMProviderConfig.md) -- LLMProviderConfig is a sub-component of LLMAbstraction
- [PublicProviderAdapter](./PublicProviderAdapter.md) -- PublicProviderAdapter is a sub-component of LLMAbstraction


---

*Generated from 3 observations*

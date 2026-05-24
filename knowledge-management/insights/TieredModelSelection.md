# TieredModelSelection

**Type:** Detail

integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md ('CRITICAL Architecture Issues - RESOLVED') suggests the tiering design went through a significant revision cycle, meaning the current tier selection logic reflects deliberate architectural fixes rather than the original naive implementation.

# TieredModelSelection: Technical Insight Document

## What It Is

TieredModelSelection is a design concern within the `PublicProviderAdapter` layer of the MCP semantic analysis server, with its canonical specification documented at `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. The presence of this dedicated proposal document — explicitly titled "Tiered Model Selection Proposal" — elevates tier selection from an implementation detail to a first-class architectural concern of the public provider layer.

At its core, TieredModelSelection defines the strategy by which the system chooses among multiple model variants (typically distinguished by capability and cost) offered by external LLM providers. Rather than hard-coding a single model per provider, the tiered approach allows the orchestration layer to request work at a specific capability level and have the appropriate model selected uniformly across providers.

The architectural significance of this concern is reinforced by `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md` ("CRITICAL Architecture Issues - RESOLVED"), which indicates that the tiering design has been through a meaningful revision cycle. The current state therefore represents a deliberate, post-revision architecture rather than an organic accumulation of ad-hoc choices.

## Architecture and Design

The architectural pattern evident here is a **parameterized strategy**: public adapters under `integrations/mcp-server-semantic-analysis/src/providers/` expose a shared interface where the *tier* is a first-class parameter. This means that callers in the orchestration layer can substitute a cheaper or more capable model without touching provider-specific adapter code. The tier parameter abstracts over the heterogeneous model namespaces of different cloud providers, providing a uniform vocabulary at the API boundary.

TieredModelSelection sits as a child concern of `PublicProviderAdapter`, which itself organizes one adapter per cloud provider (consistent with the project's three-mode architecture). Because tier selection is shared across all such adapters, it functions as a **cross-cutting contract** that every concrete provider implementation must honor. This contract enables the orchestration layer to remain provider-agnostic when making cost/capability trade-offs.

The sibling component `ProviderConfig` plays a complementary role: it centralizes per-provider secrets and concrete model identifiers in `config/llm-providers.yaml`. TieredModelSelection consumes these identifiers indirectly — the *abstract* tier (e.g., a logical level like "small" or "large") is resolved to a *concrete* model identifier through the configuration. This separation means tiers are deployment-tunable: operations teams can rebind a tier to a different concrete model by editing YAML without code changes.

The fact that the architecture has been explicitly resolved through a "CRITICAL Architecture Issues - RESOLVED" cycle suggests that earlier iterations likely conflated tier semantics with provider-specific model strings or scattered tier-mapping logic across adapters. The current design instead treats tiering as a deliberate seam between policy (which tier to use, decided by orchestration) and mechanism (how a tier maps to a model, encoded in `ProviderConfig`).

## Implementation Details

The provided observations do not enumerate specific classes or functions implementing TieredModelSelection (the code symbols count is 0 for this entity). The authoritative implementation guidance lives in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`, which should be consulted as the source of truth for concrete tier names, selection rules, and adapter contracts.

What can be inferred structurally is that each concrete adapter beneath `src/providers/` must implement the tier-aware interface inherited from `PublicProviderAdapter`. The adapter is responsible for translating an incoming tier identifier into the provider-native model name resolved from `config/llm-providers.yaml`, then issuing the underlying API call. This keeps tier-resolution logic uniform while allowing provider-specific request formatting to remain encapsulated per adapter.

The revision history alluded to in `CRITICAL-ARCHITECTURE-ISSUES.md` implies that the current implementation likely centralizes tier-to-model resolution rather than duplicating it in each adapter — a correction consistent with the principle that adapters should differ only where the underlying APIs differ.

## Integration Points

TieredModelSelection integrates along three axes. **Upward**, it is consumed by the orchestration layer, which selects a tier based on task requirements (e.g., precision needs, latency budget, cost constraints) and passes it through the `PublicProviderAdapter` interface. **Sideways**, it depends on `ProviderConfig` — specifically the `config/llm-providers.yaml` file — to resolve abstract tiers to concrete model identifiers; this is the primary integration seam with the deployment environment. **Downward**, it is realized by the concrete per-provider adapters under `integrations/mcp-server-semantic-analysis/src/providers/`, each of which honors the same tier contract while talking to a different cloud API.

This three-way integration is what gives TieredModelSelection its leverage: a single change in the YAML can re-route every tier reference in the system to a different model, and a single new tier added to the contract propagates uniformly to every adapter that complies with the interface.

## Usage Guidelines

Developers extending the public provider layer should treat the tier as the *only* model-selection vocabulary visible above the adapter boundary. Hard-coding a specific provider model name in orchestration code defeats the purpose of TieredModelSelection and reintroduces the kind of coupling that the resolved architecture revision was designed to eliminate.

When adding a new provider adapter under `src/providers/`, the implementer must (1) accept the same tier identifiers as existing adapters, (2) resolve them via `ProviderConfig` / `config/llm-providers.yaml` rather than inlining model strings, and (3) refrain from introducing tier names that are meaningful only to that provider. If a provider lacks an analog for a given tier, the proper response is to document that limitation and either map to the nearest tier or raise an explicit error — not to silently substitute an arbitrary model.

Before making changes to the tier contract itself, consult both `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` (for the intended design) and `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md` (for the rationale behind the resolved revision). These two documents together establish the current contract and the constraints that future changes must respect.

---

### Summary of Requested Analysis

1. **Architectural patterns identified**: Parameterized strategy pattern; uniform adapter interface across heterogeneous backends; configuration-driven binding of abstract tiers to concrete models; separation of policy (orchestration chooses tier) from mechanism (adapter executes).

2. **Design decisions and trade-offs**: Choosing tiers as the public vocabulary trades some expressiveness (callers cannot request niche provider-specific models) for substitutability and cost control. Externalizing the tier-to-model map into `config/llm-providers.yaml` trades static type-safety for deployment flexibility. The resolved revision in `CRITICAL-ARCHITECTURE-ISSUES.md` suggests these trade-offs were consciously rebalanced.

3. **System structure insights**: TieredModelSelection sits as a cross-cutting child of `PublicProviderAdapter`, parallel to `ProviderConfig`, and is realized by per-provider adapters under `src/providers/`. It is the contract that lets the three-mode architecture treat public providers uniformly.

4. **Scalability considerations**: Adding a new provider scales linearly — only a new adapter and a YAML entry are required, with no changes to orchestration. Adding a new tier requires touching every adapter, which is a deliberate cost that ensures contract uniformity.

5. **Maintainability assessment**: The dedicated proposal document, the explicit "RESOLVED" status of past architecture issues, and the clear separation between `TieredModelSelection`, `ProviderConfig`, and the concrete adapters all indicate high maintainability. The primary maintenance risk is drift between the contract documented in `TIERED-MODEL-PROPOSAL.md` and the concrete adapter implementations — a risk best mitigated by treating the proposal document as the binding specification.


## Hierarchy Context

### Parent
- [PublicProviderAdapter](./PublicProviderAdapter.md) -- Provider implementations are located under integrations/mcp-server-semantic-analysis/src/providers/, one adapter per cloud provider as implied by the three-mode architecture

### Siblings
- [ProviderConfig](./ProviderConfig.md) -- The parent component analysis explicitly identifies config/llm-providers.yaml as the central configuration artifact for public provider adapters, storing per-provider secrets and model identifiers — making it the primary integration seam between adapter code and deployment environment.


---

*Generated from 3 observations*

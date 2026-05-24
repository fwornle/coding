# ProviderYamlSchema

**Type:** Detail

The schema includes a tier-assignment field per provider, a design concern corroborated by integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal'), which indicates provider capability tiers are declared statically at the config layer rather than derived at runtime from API responses.

# ProviderYamlSchema

## What It Is

ProviderYamlSchema defines the structural contract for entries within `config/llm-providers.yaml`, the canonical registry file that governs how LLM providers are declared and registered within the system. As a child detail of LLMProviderConfig, the schema specifies the required and optional fields each provider entry must conform to — including provider identification, endpoint URLs, supported model lists, and tier-assignment metadata. Documentation for the schema fields and their runtime semantics lives in `integrations/mcp-server-semantic-analysis/docs/configuration.md` (the "Configuration Reference"), which serves as the authoritative reference for developers interacting with the file.

The schema is positioned as the enforced entry point for all provider registration: adapter code is structurally blocked from referencing a provider until a corresponding entry exists in `config/llm-providers.yaml`. This makes the schema not merely a descriptive format but an operational gatekeeper — a provider does not exist to the rest of the system until it has been declared in conformance with ProviderYamlSchema.

## Architecture and Design

The architectural pattern underlying ProviderYamlSchema is **configuration-as-contract**: the YAML schema acts as a single, declarative source of truth that downstream code must respect. By centralizing provider definitions in one file under one schema, the design eliminates scattered provider knowledge across the codebase. This is reinforced by the parent LLMProviderConfig component, whose role is to load and surface these definitions to the rest of the LLM abstraction layer.

A notable design choice is that the schema **bundles model lists and endpoint URLs together within each provider entry**. This means the schema simultaneously serves two roles: a **routing table** (mapping providers to their network endpoints) and a **model capability manifest** (declaring which models each provider exposes). The trade-off is consolidation versus separation of concerns — the project has opted for consolidation, accepting that endpoint and model concerns are intertwined enough that a developer changing either has exactly one file to edit.

Another deliberate architectural decision is the **static declaration of provider capability tiers** via the tier-assignment field. As corroborated by `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` (the "Tiered Model Selection Proposal"), tiers are baked into the configuration layer rather than derived at runtime from API responses. This favors predictability and deterministic behavior over dynamic capability discovery: the system trusts the configuration rather than probing providers, which avoids runtime fragility tied to provider API instability but requires manual upkeep when providers add or remove capabilities.

## Implementation Details

ProviderYamlSchema is realized as the field structure within `config/llm-providers.yaml`. Each provider entry conforms to a strict shape that downstream adapters consume during initialization. The key field categories are:

- **Identification fields** — name the provider so adapter code can resolve it.
- **Endpoint fields** — supply the base URL(s) used for network calls, effectively driving the routing layer.
- **Model lists** — enumerate which models the provider supports, forming the capability manifest portion of the contract.
- **Tier-assignment fields** — statically declare each provider's tier per the Tiered Model Selection Proposal, feeding tier-aware selection logic.

Because the schema is a strict contract, unrecognized or malformed fields will break adapter initialization. This implies a fail-fast posture: schema violations are caught at config-load time rather than producing silent runtime degradations. The documentation in `integrations/mcp-server-semantic-analysis/docs/configuration.md` codifies the mapping between YAML fields and runtime behavior, making it the practical reference when extending or interpreting the schema.

No standalone code symbols were identified for the schema itself in the source observations, which is consistent with the schema being expressed primarily as a YAML structural convention enforced at the consumer (LLMProviderConfig) boundary rather than as a separate validator class.

## Integration Points

The schema's primary integration point is its parent, **LLMProviderConfig**, which loads `config/llm-providers.yaml` and exposes the parsed provider definitions to the rest of the system. All LLM abstraction adapters depend transitively on this contract: they read provider name, endpoint, model list, and tier data through LLMProviderConfig and rely on the schema's stability.

The schema also integrates with the tiered selection subsystem described in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. The tier-assignment field is the input that the tiered model selection logic consumes when deciding which provider/model to route a request to. Without a correctly populated tier value in the YAML entry, the tier-aware selection paths cannot include that provider.

Finally, the schema integrates with developer-facing documentation via `integrations/mcp-server-semantic-analysis/docs/configuration.md`. This document is the binding between schema fields and runtime semantics, making it the de facto interface specification for both human contributors and downstream code reviewers.

## Usage Guidelines

When onboarding a new LLM provider, the workflow is fixed: **edit `config/llm-providers.yaml` first**. Adapter code that references the new provider will not function — and is structurally blocked from referencing it — until the YAML entry exists and conforms to ProviderYamlSchema. This makes the schema the mandatory first step in any provider integration task.

Developers should populate every required field, including the tier-assignment, with care. Because tiers are static rather than runtime-derived, a missing or incorrect tier value will silently exclude the provider from tier-aware selection paths even though the provider may otherwise be functional. Cross-referencing the "Tiered Model Selection Proposal" document is recommended when assigning tiers to ensure consistency with system-wide tier semantics.

When modifying an existing provider — for example, changing its base URL or adding a new supported model — `config/llm-providers.yaml` is again the only file that needs to be edited. This single-edit-point property is one of the schema's main maintainability advantages and should be preserved: avoid replicating provider data (endpoints, model names, tier info) elsewhere in the codebase, as doing so would erode the schema's role as the single source of truth.

Finally, because adapter initialization fails on malformed or unrecognized fields, treat schema changes (adding new fields, renaming existing ones) as breaking changes. Such changes should be coordinated with updates to `integrations/mcp-server-semantic-analysis/docs/configuration.md` and with the LLMProviderConfig loader so that the contract remains coherent across all consumers.

---

### Summary of Key Findings

1. **Architectural patterns identified**: Configuration-as-contract; single-source-of-truth registry; static (declarative) capability tiering; consolidated routing-table + capability-manifest in one schema.
2. **Design decisions and trade-offs**: Bundling endpoints with model lists trades separation of concerns for single-edit-point convenience; static tier assignment trades dynamic capability discovery for predictability and avoidance of runtime fragility; fail-fast schema validation trades flexibility for early detection of misconfiguration.
3. **System structure insights**: ProviderYamlSchema sits beneath LLMProviderConfig as the structural contract for `config/llm-providers.yaml`, and is the upstream gate for all adapter code and the tiered selection subsystem.
4. **Scalability considerations**: Adding providers scales linearly with YAML entries and requires no code changes for routing/model additions — a strong scaling property. However, static tiering means scaling across provider capability changes requires manual upkeep, which can become burdensome as the provider catalog grows.
5. **Maintainability assessment**: High maintainability for additions and edits due to the single-file, single-schema design. Lower maintainability risk emerges around schema evolution itself — because adapters depend strictly on the field contract, schema changes are effectively API changes and must be coordinated with `integrations/mcp-server-semantic-analysis/docs/configuration.md` and the LLMProviderConfig loader.


## Hierarchy Context

### Parent
- [LLMProviderConfig](./LLMProviderConfig.md) -- config/llm-providers.yaml serves as the canonical registry of provider definitions, meaning adding a new provider requires an entry here before any adapter code is wired up


---

*Generated from 4 observations*

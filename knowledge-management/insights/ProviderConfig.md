# ProviderConfig

**Type:** Detail

The three-mode architecture (public / private / local) described in the PublicProviderAdapter parent context requires distinct credential and endpoint configuration per public cloud provider, so the YAML schema serves as the single source of truth that all public adapters read from rather than embedding credentials inline.

# ProviderConfig

## What It Is

ProviderConfig is the configuration schema and artifact that governs how public cloud provider adapters in the MCP semantic analysis server are credentialed, addressed, and parameterized at runtime. Its canonical materialization lives at `config/llm-providers.yaml`, which the parent component analysis explicitly identifies as the central configuration artifact for public provider adapters. The schema is documented in a dedicated configuration guide at `integrations/mcp-server-semantic-analysis/docs/configuration.md` ("Configuration Reference"), giving provider-level settings a standalone reference rather than scattering them across adapter source files.

Functionally, ProviderConfig serves as the single source of truth for per-provider secrets, model identifiers, and endpoint overrides that the `PublicProviderAdapter` family consumes. Rather than each cloud-specific adapter under `integrations/mcp-server-semantic-analysis/src/providers/` embedding credentials or hard-coding endpoints, all of them read from this externalized configuration layer — making ProviderConfig the integration seam between adapter code and the surrounding deployment environment.

## Architecture and Design

The design follows an externalized-configuration pattern in which a YAML file (`config/llm-providers.yaml`) is the declarative interface between deployment operators and the adapter runtime. This separation of concerns is deliberate: it allows the three-mode architecture (public / private / local) defined by the parent `PublicProviderAdapter` to vary credentials and endpoints per provider without requiring code changes. Each public cloud adapter has its own section in the YAML, keyed by provider, so the schema scales horizontally as new providers are added under `integrations/mcp-server-semantic-analysis/src/providers/`.

A key architectural decision is making endpoint overrides part of the schema itself. This elevates non-production routing — staging endpoints, regional failover targets, or specific model version pinning — to a first-class configurable concern rather than a deployment hack. The configuration layer thereby decouples provider transport details from adapter business logic, which means the same adapter code path serves production, staging, and canary deployments based purely on what ProviderConfig declares.

ProviderConfig sits alongside its sibling `TieredModelSelection`, which is documented separately at `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. The split is meaningful: ProviderConfig answers *how to reach and authenticate with* a provider, while TieredModelSelection answers *which model tier to pick* once the connection is established. Together they form the two axes of public provider configuration under `PublicProviderAdapter`, with model identifiers in ProviderConfig serving as the concrete values that tier-selection logic resolves into.

## Implementation Details

The implementation centers on `config/llm-providers.yaml` as a structured, per-provider configuration document. Although no code symbols are catalogued for ProviderConfig directly, its shape is constrained by what the public adapters need: credentials (API keys or token references) and model identifiers (the specific model names each provider exposes), plus optional endpoint overrides. Each top-level entry in the YAML corresponds to one cloud provider adapter, mirroring the one-adapter-per-provider organization under `integrations/mcp-server-semantic-analysis/src/providers/`.

Documentation in `integrations/mcp-server-semantic-analysis/docs/configuration.md` serves as the authoritative reference for the schema, meaning developers extending the system should treat that file as the contract definition. The fact that this configuration warrants a dedicated guide — rather than being a section inside a broader README — signals that the schema is non-trivial and expected to evolve as providers are added or extended.

Because ProviderConfig is loaded at adapter initialization, the YAML acts as input to the wiring layer that instantiates concrete public provider adapters. Endpoint overrides, when present, take precedence over default URLs baked into adapter code, enabling staging or version-pinned deployments. Model identifiers declared in ProviderConfig are the concrete strings that downstream selection logic — including the sibling `TieredModelSelection` mechanism — references when routing requests to a specific tier.

## Integration Points

ProviderConfig integrates upward into its parent `PublicProviderAdapter`, which is the consumer of every value declared in `config/llm-providers.yaml`. The relationship is strictly directional: adapters read from ProviderConfig, but ProviderConfig has no awareness of adapter implementation details. This one-way dependency keeps the YAML schema stable even as adapter internals change.

Laterally, ProviderConfig provides the data that `TieredModelSelection` operates on. Model identifiers configured per provider are the resolution targets for tier-selection decisions — so the two siblings are functionally coupled through shared vocabulary (model names) even though they remain architecturally distinct documents and concerns.

Externally, ProviderConfig is the integration seam with the deployment environment. Secrets management, environment-specific routing, and version pinning all flow through this YAML rather than through code-level changes. This makes ProviderConfig the boundary across which DevOps and application concerns meet: operators control the YAML, developers control the adapters, and the schema documented in `integrations/mcp-server-semantic-analysis/docs/configuration.md` is the contract between them.

## Usage Guidelines

Developers adding a new public provider adapter under `integrations/mcp-server-semantic-analysis/src/providers/` should define its configuration block in `config/llm-providers.yaml` rather than embedding credentials, endpoints, or model names in source code. The schema in `integrations/mcp-server-semantic-analysis/docs/configuration.md` is the reference for what fields are recognized; extending it requires updating both the YAML structure and the configuration reference document in tandem.

Endpoint overrides should be used for non-production routing scenarios — staging deployments, regional pinning, or testing against specific model versions — but production deployments should generally rely on adapter defaults unless an explicit operational need dictates otherwise. Secrets in `config/llm-providers.yaml` must be managed according to deployment-environment conventions; the YAML is the declared shape, not necessarily the storage mechanism for the secret values themselves.

When the schema is extended, the change has ripple effects across every adapter in the public tier and potentially across `TieredModelSelection` if model identifier semantics shift. Treat changes to ProviderConfig as schema-level changes requiring coordinated updates to the configuration documentation, the YAML examples, and any adapters that consume the new fields.

---

## Architectural Patterns Identified

- **Externalized configuration**: provider-specific values live in `config/llm-providers.yaml` rather than in adapter source code.
- **Single source of truth**: one YAML file consolidates all public-provider credentials, model identifiers, and endpoint overrides.
- **Schema-as-contract**: `integrations/mcp-server-semantic-analysis/docs/configuration.md` formalizes the configuration interface separately from implementation.
- **Separation of concerns between siblings**: ProviderConfig governs connectivity and identity; `TieredModelSelection` governs model choice.

## Design Decisions and Trade-offs

- Choosing YAML as the configuration medium prioritizes human readability and operator-friendliness over type safety; schema correctness is enforced by the configuration reference document rather than a compiled type system.
- Making endpoint overrides first-class enables flexible environment routing but introduces a configuration surface that must be carefully managed to avoid drift between environments.
- Centralizing all public providers in one file simplifies discovery and auditing but means changes to the file have wide blast radius across all `PublicProviderAdapter` instances.

## System Structure Insights

ProviderConfig occupies a clear hierarchical position as a Detail under `PublicProviderAdapter`, peering with `TieredModelSelection`. The structure reveals an intentional split between *connection-level configuration* (ProviderConfig) and *runtime selection logic* (TieredModelSelection), both feeding into the same parent adapter family located under `integrations/mcp-server-semantic-analysis/src/providers/`.

## Scalability Considerations

The YAML schema scales horizontally with new providers — each addition is a new top-level block — but the file itself can grow large as more providers are onboarded. Endpoint overrides allow scaling deployments across environments (staging, regional, version-pinned) without code changes, which is the primary scalability lever this component provides.

## Maintainability Assessment

Maintainability is strong due to the externalization pattern: adapter code and configuration evolve independently, and the dedicated reference document at `integrations/mcp-server-semantic-analysis/docs/configuration.md` lowers the cost of onboarding new providers. The main maintenance risk is documentation drift — the YAML, the reference doc, and the consuming adapters must stay synchronized, since there is no compiled schema enforcing consistency. Disciplined updates to all three artifacts when extending the schema are essential.


## Hierarchy Context

### Parent
- [PublicProviderAdapter](./PublicProviderAdapter.md) -- Provider implementations are located under integrations/mcp-server-semantic-analysis/src/providers/, one adapter per cloud provider as implied by the three-mode architecture

### Siblings
- [TieredModelSelection](./TieredModelSelection.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal') is an explicitly listed architecture document dedicated to model tier selection, confirming this is a first-class design concern for the public provider layer rather than an ad-hoc per-adapter decision.


---

*Generated from 4 observations*

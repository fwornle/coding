# TwoTierClassificationHierarchy

**Type:** Detail

The L2 sub-component description explicitly defines the two tiers: 'upper ontology defines broad abstract categories while lower ontology definitions provide concrete entity types' — this is the core structural contract that OntologyClassificationAgent depends on for all entity tagging decisions.

# TwoTierClassificationHierarchy

## What It Is

The TwoTierClassificationHierarchy is a structural classification contract defined within the broader Ontology component of the semantic analysis system. It is documented and contextualized across two primary locations: the architecture reference at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` (under the "Agent Architecture" section), and the system overview at `integrations/mcp-server-semantic-analysis/README.md` (under "MCP Server - Semantic Analysis").

At its core, the hierarchy enforces a two-level taxonomy: an **upper ontology** that defines broad abstract categories, and a **lower ontology** that provides concrete entity type definitions. This structural contract is what the OntologyClassificationAgent depends on when making entity tagging decisions for nodes in the code graph. Rather than treating classification as a flat list of labels, the hierarchy imposes a deliberate stratification between stable abstractions and extensible concrete types.

As a sub-component of the parent Ontology entity, the TwoTierClassificationHierarchy represents the *organizing principle* of how the ontology's content is structured — it is the schema-level decision that shapes how all ontological knowledge in the system is laid out and consumed.

## Architecture and Design

The architectural approach is a deliberate layered taxonomy pattern, where abstraction and concretion are separated into distinct tiers. The upper tier holds stable, abstract categories that are intended to remain consistent regardless of which codebase is being analyzed. The lower tier holds concrete entity type definitions that map specific, often language- or domain-bound, constructs into the broader categories of the upper tier.

This design directly enforces a separation of concerns: changes that introduce new entity types (for example, adding support for a new programming language's constructs, or a domain-specific framework's classes) happen at the lower tier without disturbing the upper contract. The OntologyClassificationAgent therefore has a predictable, stable interface to traverse — it can reason about broad categories with confidence while still resolving to specific entity types when needed.

The choice to document this hierarchy prominently in both the README ("MCP Server - Semantic Analysis") and the dedicated `agents.md` architecture file signals that it is treated as a foundational design decision of the semantic analysis server, explicitly distinguished from flat-classification approaches that would lack this stratification.

## Implementation Details

Because no code symbols are surfaced for this entity directly, the hierarchy is best understood as a *structural contract* embedded in the Ontology component rather than as a discrete class or module. Its implementation manifests through how the Ontology is organized: definitions are partitioned so that upper-ontology categories are declared as the abstract umbrella under which lower-ontology concrete entity types are registered.

The OntologyClassificationAgent operationalizes this contract during classification of code graph nodes. When tagging a node, the agent traverses the hierarchy — consulting concrete lower-tier definitions to identify what an entity is, and resolving upward to associate that entity with its broader abstract category. This traversal pattern is the mechanism by which the two-tier structure produces meaningful classifications rather than isolated tags.

The architecture documentation in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` is the canonical reference describing how this traversal works in the agent's decision flow. Developers wanting to understand the precise mechanics of how the OntologyClassificationAgent walks from concrete-to-abstract (or vice versa) should treat that file as the authoritative source.

## Integration Points

The TwoTierClassificationHierarchy is contained by its parent, the Ontology component, and serves as the structural backbone that the Ontology exposes to consumers. Its primary downstream consumer is the OntologyClassificationAgent, which depends on the hierarchy's contract for every entity tagging operation it performs on code graph nodes.

Upstream, the hierarchy integrates with the broader semantic analysis server documented in `integrations/mcp-server-semantic-analysis/README.md`. The README contextualizes the hierarchy as a defining characteristic of the server's approach, meaning the two-tier model is essentially part of the server's external promise — anyone integrating with the MCP semantic analysis server is implicitly relying on this stratified classification model.

The dependency direction is unidirectional and clean: lower-tier definitions depend on the upper-tier contract, but the upper tier knows nothing about specific lower-tier extensions. This makes the upper ontology a stable interface, and the lower ontology an extension surface.

## Usage Guidelines

When extending the ontology, new entity types should almost always be added at the lower tier. Adding to the upper tier should be a rare, deliberate act, because upper-tier categories form the stable contract that the OntologyClassificationAgent and downstream consumers rely on; introducing or changing abstract categories has wide-reaching implications across the classification system.

Developers introducing language-specific or domain-specific constructs (for example, new framework entity types, new language constructs, or codebase-specific concepts) should map them into existing upper-tier categories rather than inventing new abstract categories. This preserves the cross-codebase portability that the two-tier design was created to provide.

When reasoning about classification behavior or debugging unexpected tagging by the OntologyClassificationAgent, the first reference should be `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, since this document describes how the agent traverses the hierarchy. Treat the hierarchy as a contract: any change to the upper-tier categories must be considered a breaking change to the agent's classification semantics, while lower-tier additions should be backward compatible by design.

Finally, avoid collapsing the hierarchy into a flat classification scheme in any consumer code. The two-tier separation is the explicit design distinction called out in the README, and flattening it would erode both the stability guarantees of the upper ontology and the extensibility benefits of the lower ontology.

---

### Architectural Patterns Identified
- **Layered Taxonomy / Two-Tier Classification**: explicit stratification between abstract categories (upper) and concrete types (lower).
- **Stable Contract + Extension Surface**: the upper tier acts as a stable interface; the lower tier is the open extension point.
- **Hierarchical Traversal for Classification**: the OntologyClassificationAgent navigates between tiers rather than matching against flat labels.

### Design Decisions and Trade-offs
- **Decision**: Adopt a two-tier model over flat classification — explicitly noted in the README as a distinguishing design choice.
- **Trade-off**: Adds a layer of indirection and requires discipline about where new types belong, in exchange for cross-codebase stability and language/domain extensibility.
- **Decision**: Make upper categories codebase-agnostic, lower types codebase-specific — trades single-tier simplicity for separation of concerns.

### System Structure Insights
- The hierarchy is contained within the Ontology parent component and is the organizing schema of that component.
- The OntologyClassificationAgent is the principal traversal consumer; the hierarchy's contract effectively defines that agent's input model.
- Documentation is intentionally split between a high-level README touchpoint and a detailed `agents.md` architecture reference.

### Scalability Considerations
- Scales horizontally across codebases because the upper tier does not need to change to accommodate new domains.
- Scales in expressiveness by extending the lower tier with new concrete entity types per language or framework.
- The constraint on scalability is upper-tier rigidity: poorly chosen abstract categories would force awkward lower-tier mappings.

### Maintainability Assessment
- **High maintainability** for adding new entity types (lower-tier extension is low-risk).
- **Moderate-to-high risk** for upper-tier changes, which propagate through the OntologyClassificationAgent's behavior and any consumer of the Ontology.
- Centralized documentation in `agents.md` and the README reduces onboarding cost and makes the contract discoverable, supporting long-term maintainability.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- The upper ontology defines broad abstract categories while lower ontology definitions provide concrete entity types, creating a two-tier classification hierarchy referenced by OntologyClassificationAgent


---

*Generated from 4 observations*

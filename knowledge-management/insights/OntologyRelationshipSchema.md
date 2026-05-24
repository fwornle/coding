# OntologyRelationshipSchema

**Type:** Detail

The project documentation's 'Key documented components' section enumerates the ontology's full relationship vocabulary: CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, CONTAINS_MODULE, DEFINES, DEFINES_METHOD, and DEPENDS_ON_EXTERNAL — these are the classification targets OntologyClassificationAgent resolves entities to.

# OntologyRelationshipSchema

## What It Is

OntologyRelationshipSchema is the formal vocabulary of edge types that defines how entities in the codebase ontology relate to one another. It is documented as part of the project's ontology specification and serves as the classification target set for the `OntologyClassificationAgent` located at `integrations/mcp-server-semantic-analysis/src/agents/`. The schema enumerates seven distinct relationship types: `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, and `DEPENDS_ON_EXTERNAL`.

As a child component of the parent `Ontology` entity, OntologyRelationshipSchema provides the relational grammar that complements whatever node/entity vocabulary the broader Ontology defines. Where the Ontology describes *what* kinds of things exist in the modeled graph, OntologyRelationshipSchema describes *how* those things connect. This distinction is operationally important: the `OntologyClassificationAgent` consumes this schema as a closed set of valid classification outcomes when it resolves entity-to-entity relationships during semantic analysis.

The schema is categorized into three semantically distinct edge families: containment (four variants), definition (two variants), and external dependency (one variant). This tri-partite organization reflects an intentional separation of structural nesting, symbolic authorship, and cross-boundary references.

## Architecture and Design

The architectural approach is a **closed-vocabulary classification schema** — a fixed enumeration of relationship types that constrains the agent's output space and ensures consistency across the produced ontology graph. By making the schema a finite, named set rather than an open string field, the system enables deterministic graph traversal and predictable downstream consumption. The `OntologyClassificationAgent` (sibling in design intent, contained alongside this schema within the parent `Ontology`) resolves each detected entity-pair connection to exactly one of these seven values.

The schema embodies a clear **three-tier semantic stratification**:

1. **Structural containment tier** — `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE` form a four-level hierarchical nesting model. This establishes parent-child ownership chains that walk from the broadest organizational unit (package) down through filesystem layout (folder, file) to the language-level grouping unit (module).
2. **Symbolic authorship tier** — `DEFINES` and `DEFINES_METHOD` separate the *act of declaring a symbol* from the *act of containing a file*. This is a deliberate design decision: a file containing a class is structurally different from a class defining a method, even though both look like "parent contains child" superficially.
3. **Boundary-crossing tier** — `DEPENDS_ON_EXTERNAL` is the single edge type reserved for references that leave the ontology's internal graph, marking dependencies on external libraries or packages.

This stratification gives the agent four mutually exclusive classification outcomes per edge: structural nesting, symbolic definition, method-level definition, or external boundary crossing. Combined with the parent `Ontology` and the sibling `BaseAgentFiveMethodContract` (the abstract contract `OntologyClassificationAgent` implements), the schema closes the loop of the semantic analysis pipeline: contract defines the agent shape, schema defines the agent's output domain.

## Implementation Details

OntologyRelationshipSchema is implementation-light — it has zero associated code symbols and no listed key files in the present observations, which indicates it functions as a **specification artifact** rather than executable code. Its presence is documented in the project's "Key documented components" section as a normative reference enumerating the relationship vocabulary.

The mechanics of how the schema is *enforced* live in the consumer, `OntologyClassificationAgent` at `integrations/mcp-server-semantic-analysis/src/agents/`. This agent implements all five abstract methods of `BaseAgent` — the contract captured by the sibling component `BaseAgentFiveMethodContract` — and uses the schema's seven values as its classification labels. The containment relationships (`CONTAINS_PACKAGE` → `CONTAINS_FOLDER` → `CONTAINS_FILE` → `CONTAINS_MODULE`) are arranged to express ownership chains that mirror real codebase layout: a package owns folders, folders own files, files own modules. This ordering allows the agent to produce a strictly hierarchical containment subgraph.

The definition relationships isolate symbolic declaration from structural ownership. `DEFINES` covers the general case of a container declaring a symbol, while `DEFINES_METHOD` is a specialization for method-level definitions — likely chosen because method definition is the most frequent and analytically distinct authoring relationship in object-oriented or modular code. `DEPENDS_ON_EXTERNAL` is implemented as a deliberately singular edge type for *all* outbound dependencies that exit the ontology's known graph; this collapses the entire external dependency space into one classification, simplifying agent decision logic while preserving the boundary signal.

## Integration Points

The primary integration point is the consumption relationship with `OntologyClassificationAgent` in `integrations/mcp-server-semantic-analysis/src/agents/`. The agent uses the schema as its label set when classifying detected relationships between entities. Because the parent `Ontology` is implemented through `OntologyClassificationAgent`, the schema is effectively the contract between the ontology specification and the agent's runtime output.

Through its sibling `BaseAgentFiveMethodContract`, the schema participates in the broader `BaseAgent` framework: the five abstract methods implemented by `OntologyClassificationAgent` form the structural shell, and OntologyRelationshipSchema fills that shell with domain-specific output values. Any system that consumes the ontology graph downstream (search, traversal, dependency analysis) must understand these seven relationship types as the complete edge vocabulary.

The `DEPENDS_ON_EXTERNAL` edge type acts as a graph-boundary marker, signaling integration points with code outside the ontology's internal scope. This makes it the natural integration hook for tooling that needs to enumerate or analyze third-party dependencies.

## Usage Guidelines

When extending or modifying the system, developers should treat OntologyRelationshipSchema as a **closed enumeration**: any new edge type added here must be supported in `OntologyClassificationAgent`, and removing or renaming a type is a breaking change for downstream graph consumers. Because the schema lives at the parent `Ontology` level and the agent at `integrations/mcp-server-semantic-analysis/src/agents/` depends on it, changes should be coordinated across both locations.

Developers classifying relationships should respect the semantic tiers:

- Use **containment edges** (`CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`) strictly for structural parent-child nesting in the codebase layout. Maintain the hierarchical ordering — packages contain folders, folders contain files, files contain modules — rather than skipping levels.
- Use **definition edges** (`DEFINES`, `DEFINES_METHOD`) for symbolic authorship. Reserve `DEFINES_METHOD` specifically for the method-level case; use `DEFINES` for other symbol declarations. Do not conflate definition with containment, even when both apply between the same two entities.
- Use **`DEPENDS_ON_EXTERNAL`** exclusively for references that cross the ontology boundary into external libraries or packages. Internal dependencies must use other (or absent) relationship types — this edge is the explicit boundary signal.

### Scalability Considerations

The closed seven-value vocabulary scales well for classification (constant-time label lookup, predictable agent output), but it deliberately does not encode rich relationship metadata. If future use cases require more granular dependency typing (e.g., distinguishing import from inheritance), the schema would need expansion, which carries a coordinated-change cost across the agent and consumers.

### Maintainability Assessment

Maintainability is strong because the schema is small, well-stratified, and externally documented. The three-tier organization (containment / definition / external) makes the intent of each edge type self-evident, reducing the risk of misclassification. The primary maintenance risk lies in keeping the schema and `OntologyClassificationAgent` in lockstep — since the schema has no associated code symbols, drift between specification and implementation can only be caught through review or downstream test failures.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- OntologyClassificationAgent in integrations/mcp-server-semantic-analysis/src/agents/ implements all five BaseAgent abstract methods to classify entities against the defined ontology schema

### Siblings
- [BaseAgentFiveMethodContract](./BaseAgentFiveMethodContract.md) -- The L2 context explicitly states that OntologyClassificationAgent in integrations/mcp-server-semantic-analysis/src/agents/ 'implements all five BaseAgent abstract methods,' indicating a strict abstract class contract rather than an optional interface.


---

*Generated from 4 observations*

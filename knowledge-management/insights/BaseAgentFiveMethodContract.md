# BaseAgentFiveMethodContract

**Type:** Detail

Requiring all five abstract methods to be implemented enforces a complete lifecycle (e.g., initialization, classification execution, result validation, serialization, teardown) so that OntologyClassificationAgent cannot be partially constructed — a design decision that prevents incomplete agent states.

# BaseAgentFiveMethodContract

## What It Is

The `BaseAgentFiveMethodContract` is the abstract class contract defined within the `mcp-server-semantic-analysis` integration that governs how agent implementations must be structured. It is documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` ("Agent Architecture"), which serves as the primary reference for the BaseAgent contract and the shared agent pattern applied across this integration. The contract is currently realized by `OntologyClassificationAgent`, located at `integrations/mcp-server-semantic-analysis/src/agents/`, which is explicitly stated to implement *all five* of BaseAgent's abstract methods.

As a child concept of the broader `Ontology` parent component, this contract operationalizes the agent layer that performs entity classification against the ontology schema. Where its sibling `OntologyRelationshipSchema` defines the *vocabulary* of relationships (such as `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, and `DEPENDS_ON_EXTERNAL`), the BaseAgentFiveMethodContract defines the *behavioral shape* of any agent that resolves entities to that vocabulary.

## Architecture and Design

The architectural approach is a classic **Template Method / Abstract Base Class** pattern. Rather than offering an optional interface that subclasses can selectively implement, BaseAgent enforces a strict contract: all five abstract methods must be implemented for the subclass to be instantiable. This is a deliberate "no partial agents" design philosophy — it prevents the system from holding a half-constructed agent reference that could fail unpredictably during a lifecycle stage that was never wired up.

The five methods collectively model a complete agent lifecycle. Although the observations describe these conceptually as initialization, classification execution, result validation, serialization, and teardown, the key architectural insight is that the lifecycle is *closed and complete*. Each phase of an agent's runtime existence has a designated extension point, which means that cross-cutting concerns (logging at init, validation between execution and serialization, resource cleanup at teardown) can be reliably applied across every agent subclass.

This pattern fits well with the integration's role: `mcp-server-semantic-analysis` orchestrates agents that consume input, run analysis against the `Ontology`, and produce structured results. By making the contract uniform, the integration's higher layers can treat any subclass — currently `OntologyClassificationAgent`, and any future agents — through the same lifecycle hooks.

## Implementation Details

The concrete implementation reference for this contract is `OntologyClassificationAgent` in `integrations/mcp-server-semantic-analysis/src/agents/`. According to the L2 context, this agent implements *all five* BaseAgent abstract methods, with its specific responsibility being classification of entities against the defined ontology schema. The classification target set is precisely the relationship vocabulary documented by the sibling `OntologyRelationshipSchema` — meaning the agent's "classification execution" method effectively maps observed entities into one of `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, or `DEPENDS_ON_EXTERNAL`.

The five-method requirement enforces a complete agent lifecycle. In practical terms this means: an init phase to prepare any ontology references or model state, a classification execution phase performing the actual entity-to-relationship resolution, a validation phase ensuring outputs conform to the ontology schema, a serialization phase emitting results in a consumable format, and a teardown phase releasing resources. Because none of these methods is optional, `OntologyClassificationAgent` must provide a substantive implementation for each — Python's `abc` semantics (or equivalent) would refuse instantiation otherwise.

The architecture documentation at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` is the authoritative source for the precise method signatures and intended responsibilities. New agent implementations should be developed against that document.

## Integration Points

The primary integration point is between the BaseAgent contract and its parent `Ontology` component. The contract exists specifically to provide agents that can interact with the ontology — and the present implementation, `OntologyClassificationAgent`, classifies entities directly against the ontology schema. This creates a tight, intentional coupling: the agent contract's purpose is to serve the ontology, not to be a general-purpose agent framework.

A second integration point is with the sibling `OntologyRelationshipSchema`. The classification execution method in any BaseAgent subclass must produce outputs that conform to that schema's enumerated relationships (`CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, `DEPENDS_ON_EXTERNAL`). The validation phase of the lifecycle is the natural enforcement point for this conformance.

At a broader level, the contract integrates into the `mcp-server-semantic-analysis` MCP server itself, since the agents are how that server fulfills semantic analysis requests. Any caller of the MCP server indirectly relies on every BaseAgent subclass honoring the full five-method lifecycle so that requests don't hit an unimplemented hook.

## Usage Guidelines

When implementing a new agent against this contract, developers must implement all five abstract methods — there is no partial-implementation escape hatch. Attempting to omit any method should result in an instantiation error, which is the intended fail-fast behavior. Before starting an implementation, consult `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` for the exact method signatures and contract semantics.

The classification logic in any agent should produce outputs constrained to the `OntologyRelationshipSchema` vocabulary. Producing an out-of-vocabulary relationship label would break downstream consumers that assume the documented relationship set. Use the validation phase of the lifecycle to guard against this — do not rely on callers to filter invalid output.

Follow the precedent set by `OntologyClassificationAgent` in `integrations/mcp-server-semantic-analysis/src/agents/` when structuring new agents. Place new agent implementations alongside it in the same `src/agents/` directory so the integration's agent discovery and architectural conventions remain coherent. Treat initialization and teardown methods as *mandatory* operational hooks, not formalities — resource leaks or unconfigured state at these boundaries will surface as runtime failures elsewhere in the lifecycle.

---

**Summary of analytical findings:**

1. **Architectural patterns identified:** Abstract Base Class / Template Method pattern with a strictly enforced five-method lifecycle; uniform agent contract within the `mcp-server-semantic-analysis` integration.
2. **Design decisions and trade-offs:** Mandatory implementation of all five methods trades implementation flexibility for guaranteed lifecycle completeness, preventing partially-constructed agents at the cost of higher boilerplate for simple agents.
3. **System structure insights:** A clean hierarchy where `Ontology` (parent) contains both the relationship vocabulary (`OntologyRelationshipSchema`) and the behavioral contract (`BaseAgentFiveMethodContract`), with `OntologyClassificationAgent` as the concrete bridge between them.
4. **Scalability considerations:** Adding new agents is straightforward — implement the five methods and place under `integrations/mcp-server-semantic-analysis/src/agents/`. Uniform lifecycle hooks make it feasible to add cross-cutting features (metrics, tracing, batching) across all agents at once.
5. **Maintainability assessment:** Strong — a single architecture document (`agents.md`) acts as the source of truth, the contract is explicit rather than convention-based, and the closed lifecycle reduces surprise. The primary maintenance risk is drift between the documented contract and subclass implementations, mitigated by the language-level enforcement of the abstract methods.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- OntologyClassificationAgent in integrations/mcp-server-semantic-analysis/src/agents/ implements all five BaseAgent abstract methods to classify entities against the defined ontology schema

### Siblings
- [OntologyRelationshipSchema](./OntologyRelationshipSchema.md) -- The project documentation's 'Key documented components' section enumerates the ontology's full relationship vocabulary: CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, CONTAINS_MODULE, DEFINES, DEFINES_METHOD, and DEPENDS_ON_EXTERNAL — these are the classification targets OntologyClassificationAgent resolves entities to.


---

*Generated from 3 observations*

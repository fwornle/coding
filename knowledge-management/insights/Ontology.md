# Ontology

**Type:** SubComponent

The OntologyClassificationAgent utilizes a configuration file in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts to define its behavior and dependencies.

## What It Is  

The **Ontology** sub‑component lives inside the **SemanticAnalysis** domain of the MCP server. Its concrete implementation is scattered across a handful of TypeScript files under the `integrations/mcp-server-semantic-analysis/src/agents/` directory. The primary entry point for ontology‑based work is the **OntologyClassificationAgent**, whose configuration resides in  

```
integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts
```  

The agent draws on a hierarchical ontology definition declared in `ontology-definitions.ts`, resolves entity types through `entity-type-resolver.ts`, and guarantees the health of the model with `ontology-validator.ts`. Execution is funneled through the common `execute` method defined in the shared `base-agent.ts`. In short, Ontology provides a reusable, configuration‑driven service that classifies, validates, and maintains a structured knowledge graph for downstream semantic analysis.

---

## Architecture and Design  

The observed codebase follows a **modular agent architecture**. Each functional capability—classification, insight generation, pipeline orchestration, agent management—is encapsulated in its own agent class together with a dedicated configuration file. This mirrors the pattern used by the sibling agents (e.g., `insight-generation-agent.ts` and `agent-manager.ts`) and is orchestrated by the parent **SemanticAnalysis** component, which treats every agent as a plug‑in that implements a standardized `execute` contract from `base-agent.ts`.  

Within the Ontology sub‑component, two design patterns surface:

1. **Configuration‑Driven Behavior** – The `ontology-classification-agent.ts` file declares dependencies (e.g., the PersistenceAgent, resolver, validator) and runtime parameters. This decouples concrete implementations from the agent logic, allowing the same agent to be re‑wired simply by editing its config.  

2. **Hierarchical Ontology Definition** – `ontology-definitions.ts` stores upper‑level (core) and lower‑level (domain‑specific) ontology fragments. The hierarchy enables inheritance of concepts and properties, reducing duplication and supporting progressive refinement as new domains are added.  

Interaction flow: the `execute` method of the OntologyClassificationAgent pulls pre‑populated metadata from the **PersistenceAgent**, runs `resolveEntityType` to map raw input to an ontology node, then calls `validateOntology` to enforce structural integrity before returning a classified payload. The agent therefore acts as a thin orchestrator that stitches together independent, single‑responsibility modules.

---

## Implementation Details  

### Core Files  

| File | Primary Role |
|------|--------------|
| `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` | Declares the OntologyClassificationAgent configuration, lists required services (PersistenceAgent, resolver, validator), and implements the agent’s `execute` method. |
| `ontology-definitions.ts` | Holds the hierarchical ontology objects: an **upper ontology** with generic concepts and a **lower ontology** that extends those concepts for specific business domains. |
| `entity-type-resolver.ts` | Exposes `resolveEntityType(input: any): OntologyEntity` – a pure function that walks the ontology tree, matches input attributes against concept signatures, and returns the most specific entity type. |
| `ontology-validator.ts` | Provides `validateOntology(ontology: Ontology): ValidationResult` – checks for missing required properties, cyclic inheritance, and consistency between upper and lower layers. |
| `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts` | Defines the abstract `BaseAgent` class with the `execute(context: AgentContext): Promise<AgentResult>` signature that all agents, including OntologyClassificationAgent, must implement. |

### Execution Path  

1. **Metadata Retrieval** – The agent first reads the ontology metadata that the **PersistenceAgent** has already stored on the incoming payload. This prevents an unnecessary round‑trip to the LLM for re‑classification.  
2. **Entity Resolution** – `resolveEntityType` receives the raw data and, using the hierarchical definitions, selects the deepest matching node. The function is deliberately pure, making it trivially testable.  
3. **Validation** – Before the result is emitted, `validateOntology` runs a series of structural checks. If any violation is detected, the agent surfaces a detailed error, ensuring downstream components never consume a malformed ontology fragment.  
4. **Result Delivery** – The final classified entity, together with any validation warnings, is returned via the `execute` promise, adhering to the contract imposed by `BaseAgent`.

Because each step lives in its own file, developers can replace or extend any piece (e.g., swap the resolver for a more sophisticated ML model) without touching the surrounding orchestration code.

---

## Integration Points  

* **Parent – SemanticAnalysis** – Ontology is a child of the broader SemanticAnalysis component. The parent supplies the agent orchestration layer (via `base-agent.ts`) and coordinates configuration loading for all agents.  
* **Sibling – Pipeline, Insights, AgentManagement** – All siblings share the same configuration‑driven agent pattern. For example, the Pipeline’s DAG orchestration and the InsightGenerationAgent’s config files follow the same structural conventions, enabling a uniform developer experience.  
* **PersistenceAgent** – Provides pre‑populated ontology metadata fields. This coupling is explicit: the OntologyClassificationAgent reads those fields to avoid redundant LLM classification, reducing latency and cost.  
* **External Consumers** – Any downstream service that needs a classified entity (e.g., the InsightGenerationAgent) consumes the output of the OntologyClassificationAgent through the standardized `execute` interface. Because the output shape is defined centrally in the ontology definitions, downstream agents can rely on a stable contract.

---

## Usage Guidelines  

1. **Never modify the hierarchical definitions directly in production code.** Add new concepts by extending `ontology-definitions.ts` in a dedicated PR and run the full validation suite to catch inheritance cycles.  
2. **Leverage the configuration file** (`ontology-classification-agent.ts`) for wiring dependencies. If you need a custom resolver, register it in the config rather than editing the agent class.  
3. **Respect the metadata contract** supplied by the PersistenceAgent. When persisting new entities, ensure the required ontology metadata fields are populated; otherwise the agent will fall back to an LLM call, which is discouraged for performance reasons.  
4. **Unit‑test the pure functions** (`resolveEntityType`, `validateOntology`) in isolation. Their side‑effect‑free nature makes them ideal candidates for fast, deterministic tests.  
5. **When extending the ontology**, update both upper and lower layers consistently. The validator will reject mismatched extensions, so keep the hierarchy balanced to avoid validation failures at runtime.

---

## Architectural Patterns Identified  

1. **Modular Agent Architecture** – Each functional unit is an independent agent with its own configuration and lifecycle.  
2. **Configuration‑Driven Composition** – Agent behavior and dependencies are declared in TypeScript config files rather than hard‑coded.  
3. **Hierarchical Ontology (Inheritance‑Based Model)** – Upper and lower ontology layers provide a structured, extensible knowledge graph.  
4. **Pure Function Decomposition** – `resolveEntityType` and `validateOntology` are pure, stateless utilities that enable easy testing and replacement.  
5. **Standardized Execution Interface** – The `execute` method in `BaseAgent` enforces a uniform contract across all agents.

---

## Design Decisions and Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| **Separate resolver and validator** | Keeps concerns isolated; each can evolve independently. | Slightly more plumbing when wiring the agent, but improves testability. |
| **Pre‑populate ontology metadata via PersistenceAgent** | Avoids costly LLM re‑classification, improves latency. | Requires strict coordination between persistence and classification layers; missing metadata can cause fallback behavior. |
| **Hierarchical ontology definition** | Enables reuse of generic concepts and targeted extension for domains. | Adds complexity to validation (must guard against inheritance cycles). |
| **Configuration files per agent** | Facilitates hot‑swapping of implementations and clear dependency visibility. | Potential for configuration drift if not version‑controlled alongside code. |

---

## System Structure Insights  

The Ontology sub‑component is a **leaf node** in the SemanticAnalysis tree, but it acts as a **knowledge hub** for the entire semantic pipeline. Its modular design mirrors that of its siblings, reinforcing a cohesive architectural language across the system. Because every agent implements the same `BaseAgent` contract, the orchestration layer can treat OntologyClassificationAgent as just another step in a DAG, which is the same model used by the Pipeline coordinator. This uniformity simplifies both runtime scheduling and static analysis of the codebase.

---

## Scalability Considerations  

* **Horizontal Scaling of Agents** – Since each agent is stateless aside from its reliance on the PersistenceAgent, multiple instances can be spawned behind a load balancer to handle increased request volume.  
* **Ontology Growth** – The hierarchical model allows new lower‑ontology branches to be added without touching upper‑level definitions, supporting incremental scaling of the knowledge base. Validation remains O(n) in the number of concepts, which is acceptable for the current size but may need optimisation if the ontology reaches thousands of nodes.  
* **Metadata Caching** – By reusing pre‑populated metadata, the system reduces repeated LLM calls, a major scalability bottleneck. As the dataset grows, this caching strategy becomes increasingly beneficial.  

---

## Maintainability Assessment  

The Ontology component scores highly on maintainability:

* **Clear Separation of Concerns** – Resolver, validator, definitions, and orchestration live in distinct files, making the codebase easy to navigate.  
* **Configuration‑Centric Extensibility** – Adding new dependencies or swapping implementations requires only a config change, not a code rewrite.  
* **Standardized Interfaces** – The shared `execute` method enforces a consistent entry point, reducing the learning curve for new contributors.  
* **Automated Validation** – `validateOntology` acts as a guardrail, catching structural regressions early in the CI pipeline.  

Potential maintenance risks include the need to keep the PersistenceAgent’s metadata schema synchronized with ontology updates and ensuring that configuration files stay in sync with the actual code (i.e., avoiding stale references). Regular linting of config files and integration tests that assert the presence of required metadata fields can mitigate these risks.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a modular approach to agent development, with each agent having its own configuration and initialization logic. For instance, the OntologyClassificationAgent has its own configuration file (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) that defines its behavior and dependencies. This modular approach allows for easier maintenance and extension of the agents, as each agent can be developed and tested independently. The execute method in the base-agent.ts file (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) serves as the entry point for each agent's execution, providing a standardized interface for agent interactions.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline's batch processing is orchestrated by the coordinator agent, which utilizes a DAG-based execution model with topological sort in batch-analysis.yaml steps.
- [Insights](./Insights.md) -- The InsightGenerationAgent utilizes a configuration file in integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts to define its behavior and dependencies.
- [AgentManagement](./AgentManagement.md) -- The AgentManager utilizes a configuration file in integrations/mcp-server-semantic-analysis/src/agents/agent-manager.ts to define its behavior and dependencies.


---

*Generated from 7 observations*

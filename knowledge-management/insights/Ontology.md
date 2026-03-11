# Ontology

**Type:** SubComponent

The entity type resolution is performed using a validation mechanism, as implemented in the validateEntityTypes function in ontology-classification-agent.ts.

## What It Is  

The **Ontology** sub‑component lives inside the SemanticAnalysis domain of the MCP server. Its source code is anchored in the repository under  

```
integrations/mcp-server-semantic-analysis/src/ontology
integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts
integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts
integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts
integrations/mcp-server-semantic-analysis/src/agents/ontology-manager.ts
```  

At its core, Ontology supplies a structured classification system for entities extracted from code, git history, and LSL sessions. The system stores the ontology definitions in the dedicated *ontology* directory, while the **OntologyClassificationAgent** consumes those definitions to resolve the concrete type of each entity. The resolved type information is attached as metadata to the entities and later persisted by the **PersistenceAgent**. Validation of the resolved types is performed by the `validateEntityTypes` function that lives in `ontology-classification-agent.ts`.  

Thus, Ontology is the knowledge‑base that enables the rest of the SemanticAnalysis pipeline to reason about the semantics of code artifacts in a uniform, type‑safe manner.

---

## Architecture and Design  

The Ontology sub‑component follows a **layered, agent‑centric architecture** that is consistent with the broader SemanticAnalysis design. The base of the layer is the abstract **BaseAgent** class (`base-agent.ts`). All concrete agents—including **OntologyClassificationAgent**, **PersistenceAgent**, and the sibling **SemanticAnalysisAgent**, **CodeGraphAgent**, etc.—inherit from this base, guaranteeing a common lifecycle (`execute`, `initialize`, error handling) and allowing the coordinator (see the sibling *Pipeline* component) to treat every agent uniformly.

### Design patterns observed  

| Pattern | Evidence in code |
|---------|-------------------|
| **Template Method / Inheritance** | `OntologyClassificationAgent` extends `BaseAgent`, overriding its `execute` method while reusing the scaffolding provided by `BaseAgent`. |
| **Separation of Concerns** | Ontology definitions are isolated in `integrations/mcp-server-semantic-analysis/src/ontology`; classification logic lives in `ontology-classification-agent.ts`; validation is a pure function `validateEntityTypes`; persistence is handled by `persistence-agent.ts`. |
| **Coordinator (Mediator) pattern** | The sibling *Pipeline* component uses `coordinator.ts` to orchestrate batch processing of agents, keeping agents decoupled from each other. |
| **Facade (OntologyManager)** | `ontology-manager.ts` centralises access to the ontology definitions and metadata provisioning, presenting a simple API to agents that need ontology data. |

Interaction flow: the **SemanticAnalysis** parent component triggers the pipeline; the **OntologyClassificationAgent** reads the definitions from the ontology module, runs `validateEntityTypes` to ensure the resolved types are admissible, and annotates entities with metadata. The **PersistenceAgent** later consumes those annotated entities, persisting both the raw data and the attached ontology metadata. The **OntologyManager** acts as the single source of truth for the ontology definitions, exposing them to any consumer that requires them (e.g., InsightGenerationAgent for LLM‑driven insights).

---

## Implementation Details  

### BaseAgent (`base-agent.ts`)  
Provides the abstract contract for all agents: lifecycle hooks (`initialize`, `execute`, `shutdown`) and shared utilities such as logging and error handling. By inheriting from this class, each agent automatically conforms to the system’s execution contract, enabling the coordinator to schedule them without bespoke wiring.

### OntologyClassificationAgent (`ontology-classification-agent.ts`)  
* Extends `BaseAgent`.  
* In its `execute` method it loads ontology definitions from the `src/ontology` directory (the exact loader is not shown but the path is explicit).  
* It iterates over incoming entities, determines their candidate types by matching against the ontology schema, and then calls the pure function `validateEntityTypes` to enforce type constraints.  
* Successful resolution results in the attachment of a `metadata` field to each entity, containing the resolved ontology type and any auxiliary attributes defined in the ontology.

### Validation (`validateEntityTypes` function)  
Implemented as a pure, side‑effect‑free function inside `ontology-classification-agent.ts`. It receives an entity and a candidate type, checks the candidate against the ontology’s validation rules (e.g., required properties, allowed inheritance), and throws or returns an error object if the entity does not satisfy the constraints. Keeping validation isolated makes the classification logic easier to test and reuse.

### OntologyManager (`ontology-manager.ts`)  
Acts as a façade over the raw ontology files. It loads the definitions at startup (likely via a JSON/YAML parser) and offers methods such as `getEntitySchema(typeId)` and `listAllTypes()`. By centralising this logic, any future change to the storage format or source (e.g., moving to a database) can be confined to this module without touching the agents.

### PersistenceAgent (`persistence-agent.ts`)  
Consumes the entities after they have been enriched with ontology metadata. It persists both the core entity data and the attached metadata to the downstream storage layer (the storage mechanism is not detailed in the observations). The agent’s reliance on the metadata underscores the contract that any entity entering persistence must have passed through OntologyClassificationAgent.

### Relationship to Siblings  
* **InsightGenerationAgent** can query the ontology via `OntologyManager` to enrich LLM prompts with type information.  
* **CodeGraphConstructor** may use the same ontology definitions to label nodes in the knowledge graph, ensuring a consistent vocabulary across the system.  
* **Pipeline**’s coordinator schedules OntologyClassificationAgent early in the batch so that downstream agents (e.g., PersistenceAgent, InsightGenerationAgent) receive fully typed entities.

---

## Integration Points  

1. **Parent – SemanticAnalysis**  
   The SemanticAnalysis component orchestrates the overall flow. Its coordinator (`agents/coordinator.ts`) loads and runs the OntologyClassificationAgent as part of the multi‑agent pipeline. The parent expects the agent to conform to the `BaseAgent` contract and to emit entities with attached ontology metadata.

2. **Sibling – OntologyManager**  
   All agents that need to understand the ontology (Classification, Persistence, InsightGeneration) retrieve definitions through `OntologyManager`. This creates a single dependency point, reducing duplication.

3. **Sibling – PersistenceAgent**  
   Directly consumes the output of OntologyClassificationAgent. The contract is implicit: any entity persisted must have passed `validateEntityTypes` and carry a `metadata` field.

4. **Sibling – InsightGenerationAgent & CodeGraphConstructor**  
   While not directly observed, the documentation notes that these agents “utilize metadata” – they likely read the same `metadata` field to generate LLM‑driven insights or to label graph nodes.

5. **External – Ontology definitions**  
   The raw ontology files reside in `integrations/mcp-server-semantic-analysis/src/ontology`. Any change to the schema (addition of new types, property changes) propagates automatically to all agents via the OntologyManager reload mechanism.

---

## Usage Guidelines  

* **Always route entities through OntologyClassificationAgent before persisting or feeding them to downstream agents.** The validation step (`validateEntityTypes`) guarantees that the entity conforms to the current ontology, preventing downstream type mismatches.  
* **Do not modify ontology files directly from agents.** All reads should go through `OntologyManager`, which encapsulates loading and caching logic. If the ontology needs to be updated at runtime, extend `OntologyManager` with a reload API rather than editing files in place.  
* **When adding a new entity type, update the ontology definition files under `src/ontology` and augment the validation rules in `validateEntityTypes` if additional constraints are required.** Because the validation function is pure, unit tests can be added without touching the agent’s execution flow.  
* **Respect the BaseAgent lifecycle.** Implement `initialize` for any heavy‑weight setup (e.g., loading large ontology files) and keep `execute` focused on per‑batch processing. This ensures the coordinator can safely start, pause, or restart agents.  
* **Log classification outcomes.** The BaseAgent already provides logging utilities; use them to emit the resolved type and any validation warnings. This aids debugging when entities are rejected by `validateEntityTypes`.  

---

### 1. Architectural patterns identified  

* **Template Method / Inheritance** – `BaseAgent` defines the skeleton; concrete agents override `execute`.  
* **Facade** – `OntologyManager` hides the details of ontology storage and retrieval.  
* **Mediator / Coordinator** – The Pipeline’s `coordinator.ts` schedules agents without them directly invoking each other.  
* **Separation of Concerns** – Distinct modules for definitions, classification, validation, and persistence.  

### 2. Design decisions and trade‑offs  

* **Centralised ontology source** (single directory + manager) simplifies consistency but creates a single point of failure; any schema change impacts all agents.  
* **Pure validation function** isolates business rules, making testing easy, at the cost of having to pass all required context explicitly.  
* **Inheritance from BaseAgent** gives uniform behaviour and easier orchestration, yet ties agents to a specific lifecycle which may be restrictive if an agent needs a radically different execution model.  

### 3. System structure insights  

The Ontology sub‑component is a **vertical slice** within the SemanticAnalysis domain: definitions → classification → validation → metadata attachment → persistence. Each slice is implemented as an independent agent, enabling the coordinator to reorder or parallelise them in the future. The sibling components share the same ontology source via the manager, guaranteeing a unified vocabulary across code‑graph construction, insight generation, and persistence.

### 4. Scalability considerations  

* **Horizontal scaling of agents** – Because each agent follows the `BaseAgent` contract and works on batches of entities, multiple instances of OntologyClassificationAgent could be spawned to handle larger codebases, provided the underlying ontology data is read‑only or safely cached.  
* **Ontology size** – Loading the entire ontology into memory (as likely done by OntologyManager) works for modest schemas; extremely large ontologies may require lazy loading or a backing store to avoid memory pressure.  
* **Validation cost** – `validateEntityTypes` runs per entity; its complexity should remain linear in the number of validation rules to keep throughput high.  

### 5. Maintainability assessment  

The current design scores **high** on maintainability:  

* **Clear separation** of responsibilities makes it straightforward to locate and modify a specific concern (e.g., adding a new validation rule).  
* **Single source of truth** for ontology definitions reduces duplication and the risk of drift between agents.  
* **Use of pure functions** (`validateEntityTypes`) and a façade (`OntologyManager`) encourages unit testing and isolates side effects.  

Potential maintenance risks arise from the tight coupling to the file‑system location of ontology definitions; a future shift to a database or external service would require changes primarily in `OntologyManager`, but all agents would need to be verified against the new access pattern. Overall, the architecture is well‑structured for incremental evolution.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a multi-agent system to process git history and LSL sessions, with agents such as OntologyClassificationAgent, SemanticAnalysisAgent, and CodeGraphAgent working together to extract and persist structured knowledge entities. This is evident in the integrations/mcp-server-semantic-analysis/src/agents directory, where each agent has its own TypeScript file, such as ontology-classification-agent.ts, semantic-analysis-agent.ts, and code-graph-agent.ts. The BaseAgent class, defined in base-agent.ts, serves as an abstract base class for all agents in the system, providing a foundation for their implementation. For instance, the SemanticAnalysisAgent, which performs comprehensive semantic analysis of code files and git history, extends the BaseAgent class and overrides its execute method to perform the actual analysis.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline utilizes a coordinator to manage the batch processing workflow, as seen in the integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts file.
- [Insights](./Insights.md) -- The InsightGenerationAgent in insight-generation-agent.ts generates semantic insights using LLM and code graph context.
- [OntologyManager](./OntologyManager.md) -- The OntologyManager in ontology-manager.ts manages the ontology system and provides metadata to entities.
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- The CodeGraphConstructor in code-graph-constructor.ts constructs the code knowledge graph using AST parsing and Memgraph.
- [InsightGenerationAgent](./InsightGenerationAgent.md) -- The InsightGenerationAgent in insight-generation-agent.ts generates semantic insights using LLM and code graph context.
- [PersistenceAgent](./PersistenceAgent.md) -- The PersistenceAgent in persistence-agent.ts handles entity persistence and retrieval from the graph database.
- [GitHistoryAgent](./GitHistoryAgent.md) -- The GitHistoryAgent in git-history-agent.ts analyzes git history to extract relevant information for semantic analysis.


---

*Generated from 5 observations*

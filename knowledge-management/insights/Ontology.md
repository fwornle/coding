# Ontology

**Type:** SubComponent

The ontology classification agent in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts handles errors and exceptions by logging them to a file and notifying the development team

## What It Is  

The **Ontology** sub‑component lives inside the **SemanticAnalysis** module of the MCP server. Its source code is concentrated under the directory  

```
integrations/mcp-server-semantic-analysis/src/
```

Key files that define the ontology layer are:

* `ontologies/upper-ontology.ts` – the *upper* ontology that supplies a high‑level conceptual framework for classifying entities.  
* `ontologies/lower-ontology.ts` – the *lower* ontology that expands the upper concepts with fine‑grained entity types.  
* `ontologies/ontology-db.ts` – the persistence layer that stores the ontology definitions in a database.  

Ontology‑related processing is performed by a set of agents:

* `agents/ontology-classification-agent.ts` – consumes the hierarchical classification model to resolve an entity’s type.  
* `agents/entity-type-resolution-agent.ts` – applies a rule‑based system for additional type resolution.  
* `agents/validation-agent.ts` – validates the consistency of the upper and lower ontology definitions.  

Together these files constitute a self‑contained sub‑system that provides a structured, queryable view of domain entities for the broader **SemanticAnalysis** pipeline.

---

## Architecture and Design  

Ontology is built on a **modular agent‑based architecture**. Each responsibility (classification, rule‑based resolution, validation) is encapsulated in its own agent class under `src/agents/`. The agents share a common contract defined by the `BaseAgent` abstract class (`src/agents/base-agent.ts`), which standardises response shapes and confidence scoring across the whole SemanticAnalysis component. This design promotes *separation of concerns* and makes the behaviour of each agent interchangeable or extensible without touching unrelated code.

The classification path uses a **hierarchical classification model** (child component `HierarchicalClassificationModel`). The `ontology-classification-agent.ts` invokes this model to walk the ontology tree from the upper ontology down to the lower ontology, selecting the most specific type that matches the input entity. The rule‑based fallback in `entity-type-resolution-agent.ts` provides a deterministic, maintainable way to handle edge cases that the statistical model may miss.

Error handling follows a **logging‑and‑notification pattern**: the classification agent catches exceptions, writes detailed logs to a file, and triggers a notification to the development team. This is explicitly mentioned in observation 6 and reflects a defensive design aimed at rapid incident response.

The sibling **Pipeline** component (see `agents/coordinator-agent.ts`) uses a DAG‑based execution model, which the Ontology agents inherit indirectly through the shared `BaseAgent` infrastructure. This means ontology processing can be scheduled as a node in the overall analysis DAG, respecting explicit `depends_on` relationships defined in `batch-analysis.yaml`.

---

## Implementation Details  

1. **Ontology Definitions** – `upper-ontology.ts` and `lower-ontology.ts` each export a set of TypeScript interfaces or classes that model concepts and their hierarchical relationships. The upper ontology defines broad categories (e.g., *Person*, *Organization*), while the lower ontology refines these into concrete types (e.g., *Software Engineer*, *Non‑Profit Organization*).  

2. **Persistence Layer** – `ontology-db.ts` abstracts database interactions. It likely provides CRUD operations such as `loadUpperOntology()`, `loadLowerOntology()`, and `saveOntologyChanges()`. By centralising persistence, the agents can fetch the latest definitions at runtime without hard‑coding them.

3. **OntologyClassificationAgent** – The core of the classification flow lives in `agents/ontology-classification-agent.ts`. Its `classify(entity)` method retrieves the hierarchical model (instantiated from the child component `HierarchicalClassificationModel`), walks the ontology tree, and returns a classification result together with a confidence score. Errors are caught, logged to a file (path not disclosed), and a notification routine is invoked.

4. **EntityTypeResolutionAgent** – Implemented in `agents/entity-type-resolution-agent.ts`, this agent runs a deterministic rule set (e.g., “if entity has attribute X, assign type Y”) to either confirm the hierarchical result or override it when business rules dictate. The rule engine is simple but explicit, making it easy to audit.

5. **ValidationAgent** – The `agents/validation-agent.ts` performs consistency checks between the upper and lower ontologies. Typical checks include ensuring every lower‑level type maps to a valid upper‑level parent, detecting duplicate identifiers, and verifying required fields are present. Validation failures are reported back to the pipeline, preventing downstream agents from operating on corrupt ontology data.

All agents inherit from `BaseAgent`, which defines lifecycle hooks (`initialize()`, `execute()`, `finalize()`) and a standard response envelope `{ result, confidence, metadata }`. This uniform interface allows the **Pipeline** coordinator to treat each agent as a node in the DAG, simplifying orchestration.

---

## Integration Points  

* **SemanticAnalysis (Parent)** – Ontology is a child of the `SemanticAnalysis` component. The parent coordinates the agents via the DAG defined in `batch-analysis.yaml`. Ontology agents provide classification and validation services that downstream agents (e.g., `insight-generation-agent.ts`, `semantic-insight-generator-agent.ts`) consume to generate higher‑level insights.

* **HierarchicalClassificationModel (Child)** – The classification agent directly depends on this model. Any change to the model’s algorithm (e.g., switching from a simple tree walk to a probabilistic classifier) would be isolated to the child component, leaving the agent’s public contract untouched.

* **Pipeline (Sibling)** – The coordinator agent (`coordinator-agent.ts`) schedules ontology processing alongside other sibling agents such as `insight-generation-agent.ts` and `entity-validation-agent.ts`. Because all agents share the `BaseAgent` contract, the pipeline can inject Ontology as a node with explicit `depends_on` edges, ensuring that validation runs before classification, for example.

* **Database Layer** – `ontology-db.ts` is the gateway to the persistent store. Other modules that need ontology data (e.g., the CodeKnowledgeGraph constructor) can import this module to fetch the latest definitions, guaranteeing a single source of truth.

* **Logging & Notification** – The classification agent writes logs to a file and notifies the development team. This implies an external logging framework and a notification service (e.g., email or Slack) are wired into the system, though their exact locations are not enumerated in the observations.

---

## Usage Guidelines  

1. **Do not modify ontology files directly**; always use the API exposed by `ontology-db.ts` to add, update, or delete concepts. This guarantees that the in‑memory representation used by the agents stays in sync with the persisted state.

2. **When extending the ontology**, add new concepts to the appropriate level: high‑level abstractions belong in `upper-ontology.ts`, while concrete sub‑types go to `lower-ontology.ts`. After any change, run the `validation-agent` to ensure hierarchical consistency before the pipeline executes.

3. **If you need custom classification logic**, implement it inside `HierarchicalClassificationModel` rather than altering `ontology-classification-agent.ts`. The agent is a thin orchestration layer; keeping algorithmic changes confined to the child component preserves the clean separation between orchestration and business logic.

4. **Handle rule updates carefully** in `entity-type-resolution-agent.ts`. Because the rule‑based system is deterministic, adding or reordering rules can change classification outcomes for existing data. Always accompany rule changes with a regression test suite that validates a representative sample of entities.

5. **Monitor logs and alerts** generated by the classification agent. The logging‑and‑notification pattern is the primary safety net for runtime errors; ignoring these signals can lead to silent misclassifications that propagate downstream.

---

### 1. Architectural patterns identified  

* **Agent‑based modular architecture** – each functional unit is an independent agent file.  
* **Template method via BaseAgent** – shared lifecycle hooks enforce a uniform execution model.  
* **Hierarchical classification** – a tree‑structured model that resolves entity types from general to specific.  
* **Rule‑based fallback** – deterministic rule engine complements the statistical model.  
* **DAG‑based pipeline orchestration** – agents are scheduled as nodes with explicit dependencies (inherited from the sibling Pipeline component).  
* **Logging‑and‑notification error handling** – centralized exception capture with file logging and team alerts.

### 2. Design decisions and trade‑offs  

* **Separation of classification and rule‑based resolution** keeps the probabilistic model simple while still allowing precise business‑rule overrides; however it introduces two points of truth that must stay consistent.  
* **Persisting ontology definitions in a database** enables runtime updates without redeploying code, at the cost of added latency for each load unless caching is employed.  
* **Using a shared BaseAgent** reduces duplication and enforces consistency, but tightly couples all agents to the same response schema, which may limit flexibility for agents with unique output needs.  
* **Error handling via file logs and notifications** provides visibility but may become noisy if the classification agent encounters frequent transient errors; a more granular retry strategy could mitigate this.

### 3. System structure insights  

The Ontology sub‑component sits as a leaf in the SemanticAnalysis hierarchy, exposing a **read‑only view** of domain concepts to downstream insight generators. Its child, the `HierarchicalClassificationModel`, encapsulates the core algorithm, while sibling agents (validation, rule‑based resolution) supply supporting services. The overall structure mirrors a classic *pipeline* where data flows from raw entity extraction → validation → hierarchical classification → rule‑based refinement → insight generation.

### 4. Scalability considerations  

* **Ontology size** – As the number of concepts grows, the hierarchical walk may become deeper; optimizing the model with indexing or caching of parent‑child relationships will keep classification latency low.  
* **Database access** – High‑throughput classification may cause contention on `ontology-db.ts`. Introducing an in‑process cache or read‑replica can alleviate load.  
* **Parallel execution** – Because agents conform to `BaseAgent`, the DAG scheduler can run independent agents concurrently, allowing ontology validation and classification to be parallelised across multiple worker threads or containers.

### 5. Maintainability assessment  

The clear **agent boundary** and **single source of truth** for ontology definitions make the codebase approachable for new developers. The `BaseAgent` abstraction enforces consistent patterns, reducing accidental divergence. Validation logic is isolated, ensuring that schema changes are caught early. The main maintainability risk lies in the dual classification path (hierarchical model + rule engine); keeping these synchronized requires disciplined testing and documentation. Overall, the design favours **modularity and explicit contracts**, which are strong indicators of long‑term maintainability.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a modular design, with each agent responsible for a specific task, such as the OntologyClassificationAgent for ontology-based classification, and the SemanticAnalysisAgent for analyzing git and vibe data. This is evident in the file structure, where each agent has its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts. The use of a BaseAgent abstract class, as seen in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, standardizes the responses and confidence calculations across all agents, promoting consistency and maintainability.

### Children
- [HierarchicalClassificationModel](./HierarchicalClassificationModel.md) -- The ontology classification agent in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts uses a hierarchical classification model to resolve entity types, indicating a hierarchical structure for entity classification.

### Siblings
- [Pipeline](./Pipeline.md) -- The coordinator agent in integrations/mcp-server-semantic-analysis/src/agents/coordinator-agent.ts utilizes a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Insights](./Insights.md) -- The insight generation agent in integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts utilizes a machine learning model to identify patterns in the data
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- The code knowledge graph constructor in integrations/mcp-server-semantic-analysis/src/code-knowledge-graph/code-knowledge-graph-constructor.ts utilizes an AST parser to parse the code and extract entities
- [EntityValidationModule](./EntityValidationModule.md) -- The entity validation agent in integrations/mcp-server-semantic-analysis/src/entity-validation-module/entity-validation-agent.ts utilizes a rule-based system to validate entities
- [SemanticInsightGenerator](./SemanticInsightGenerator.md) -- The semantic insight generator agent in integrations/mcp-server-semantic-analysis/src/semantic-insight-generator/semantic-insight-generator-agent.ts utilizes a machine learning model to identify patterns in the code and entity relationships
- [LLMIntegrationModule](./LLMIntegrationModule.md) -- The LLM integration agent in integrations/mcp-server-semantic-analysis/src/llm-integration-module/llm-integration-agent.ts initializes the LLM service and handles interactions
- [BaseAgent](./BaseAgent.md) -- The BaseAgent class in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts provides a base class for all agents


---

*Generated from 7 observations*

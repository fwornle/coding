# Ontology

**Type:** SubComponent

The OntologyClassificationAgent in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts uses the LLMService in lib/llm/dist/index.js for large language model operations.

## What It Is  

The **Ontology** sub‑component lives inside the **SemanticAnalysis** domain and is the logical core that defines, resolves, and validates entity types against a structured knowledge model. Its implementation is spread across several key files:  

* **Upper ontology definitions** – a set of high‑level type schemas that provide the framework for entity‑type resolution and validation.  
* **Lower ontology definitions** – concrete entity type specifications and the relationships that bind them.  
* **GraphDatabaseAdapter** – located at `storage/graph-database-adapter.js`, this adapter persists ontology entities and their relationships in the underlying graph database.  
* **LLMService** – the large‑language‑model façade found in `lib/llm/dist/index.js`, used for semantic validation of entities.  
* **OntologyClassificationAgent** – the agent that lives in `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` and orchestrates classification of incoming observations by invoking the LLMService and the GraphDatabaseAdapter.  

Together, these pieces enable the system to take raw observations, map them to a well‑defined ontology, validate them with an LLM, and store the resulting knowledge graph for downstream consumption.

---

## Architecture and Design  

The Ontology sub‑component follows a **modular, layered architecture**. At the top level, the **SemanticAnalysis** parent component aggregates a collection of agents (e.g., OntologyClassificationAgent) that each own a single responsibility. This “single‑responsibility agent” pattern is evident from the parent description: *“various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation.”*  

Two concrete architectural patterns surface from the observations:

1. **Adapter Pattern** – The `GraphDatabaseAdapter` abstracts the concrete graph‑database implementation behind a stable API. Both the Ontology sub‑component and sibling components (Pipeline, CodeGraphConstructor, etc.) rely on this adapter for persisting knowledge entities, which decouples business logic from storage specifics.  

2. **Service Facade / Wrapper** – `LLMService` acts as a façade over the external large language model. By centralising all LLM calls (text generation, classification, validation) in a single module, the system isolates third‑party integration concerns from the ontology logic.  

Interaction flow: an incoming observation is handed to **OntologyClassificationAgent** (`ontology-classification-agent.ts`). The agent first calls **LLMService** to classify the observation against the upper and lower ontology definitions. The result is then fed into the **entity‑type resolution mechanism** (part of the Ontology sub‑component) which determines the concrete type. Finally, the validated entity is persisted through **GraphDatabaseAdapter**.  

The design deliberately separates **definition** (upper/lower ontology files) from **runtime mechanics** (resolution, validation, storage), promoting clear boundaries and easier evolution of each concern.

---

## Implementation Details  

### OntologyClassificationAgent (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`)  
* **Role** – Acts as the entry point for classification requests.  
* **Key Operations** –  
  * Invokes `LLMService` (from `lib/llm/dist/index.js`) to obtain a semantic classification of the raw observation.  
  * Calls the Ontology sub‑component’s **entity type resolution** routine to map the LLM output to a concrete ontology node.  
  * Persists the resolved, validated entity via `GraphDatabaseAdapter` (`storage/graph-database-adapter.js`).  

### LLMService (`lib/llm/dist/index.js`)  
* Provides methods for **text generation**, **classification**, and **validation**. The Ontology sub‑component leverages it specifically for *validating entities against the ontology system*. By centralising all LLM interactions, the service can manage authentication, request throttling, and response parsing in one place.

### GraphDatabaseAdapter (`storage/graph-database-adapter.js`)  
* Implements CRUD‑style operations against the underlying graph database (e.g., Neo4j, JanusGraph). The Ontology sub‑component uses this adapter to **store validated entities** and to retrieve relationships when performing type resolution. Sibling components (Pipeline, CodeGraphConstructor) also reuse the same adapter, confirming its role as a shared infrastructure service.

### Upper & Lower Ontology Definitions  
* **Upper ontology** – High‑level abstract concepts (e.g., “Entity”, “Concept”, “Process”) that define the *framework* for type resolution.  
* **Lower ontology** – Concrete domain‑specific types (e.g., “Customer”, “Order”, “APIEndpoint”) together with explicit relationship declarations. These files are consulted during the **entity type resolution mechanism** to map an LLM‑produced label to a concrete node in the graph.

### Entity Type Resolution Mechanism  
* Not tied to a single file in the observations, but described as part of the Ontology sub‑component. It consumes the LLM classification output, walks the upper ontology to locate the appropriate abstract category, then drills down into the lower ontology to pinpoint the exact entity type. The resolved type is subsequently validated (again via LLMService) before persistence.

---

## Integration Points  

1. **Parent – SemanticAnalysis**  
   * The Ontology sub‑component is a child of **SemanticAnalysis**, which orchestrates the overall pipeline of agents. SemanticAnalysis supplies the observation stream that OntologyClassificationAgent consumes.  

2. **Sibling Components**  
   * **Pipeline**, **CodeGraphConstructor**, and **Insights** all share the same `GraphDatabaseAdapter`. This common dependency ensures that any entity stored by Ontology is immediately queryable by those components.  
   * **Insights** and **LLMController** also share `LLMService`, meaning that any changes to LLM request handling (e.g., model version upgrades) propagate uniformly across classification, insight generation, and content validation.  

3. **Child – OntologyClassificationAgent**  
   * The agent is the concrete implementation that bridges external observations to the Ontology core. It is the only direct consumer of both `LLMService` and `GraphDatabaseAdapter` within the Ontology sub‑component, encapsulating the end‑to‑end workflow.  

4. **External Dependencies**  
   * The **LLMService** likely wraps a cloud‑based LLM (e.g., OpenAI, Anthropic). Its external nature introduces latency and rate‑limit considerations.  
   * The **GraphDatabaseAdapter** abstracts the underlying graph store; swapping the database implementation would only require changes inside this adapter, leaving the rest of the ontology logic untouched.

---

## Usage Guidelines  

* **Always route ontology‑related operations through the OntologyClassificationAgent.** Direct calls to `LLMService` or `GraphDatabaseAdapter` bypass the entity‑type resolution logic and can lead to inconsistent data.  
* **Keep upper‑ontology definitions stable.** Since they form the backbone of the resolution algorithm, frequent changes can ripple through the entire validation pipeline. Introduce new abstract concepts only after thorough impact analysis.  
* **Version‑control lower‑ontology files carefully.** Adding or deprecating concrete entity types should be accompanied by migration scripts that re‑classify existing graph nodes, ensuring backward compatibility.  
* **Respect LLM rate limits.** Because validation relies on `LLMService`, batch observations where possible, and implement exponential back‑off on throttling errors.  
* **Leverage the GraphDatabaseAdapter for all persistence needs.** Do not embed raw database queries elsewhere; this preserves the adapter’s contract and enables future database swaps without code‑base churn.  
* **Testing tip:** Mock `LLMService` responses when unit‑testing the OntologyClassificationAgent to isolate logic from external LLM variability. Use an in‑memory graph database or mock the `GraphDatabaseAdapter` for integration tests.  

---

### Architectural patterns identified  
1. **Adapter pattern** – `GraphDatabaseAdapter` abstracts graph‑DB specifics.  
2. **Service façade / wrapper** – `LLMService` centralises all LLM interactions.  
3. **Modular/agent‑based architecture** – each agent (e.g., OntologyClassificationAgent) has a single responsibility within the broader SemanticAnalysis component.  

### Design decisions and trade‑offs  
* **LLM‑driven validation** provides rich semantic checking but introduces external latency and cost; the trade‑off is higher accuracy versus performance predictability.  
* **Graph database storage** enables natural representation of entities and relationships, supporting complex queries, but requires careful graph‑model design and may increase operational complexity compared to a relational store.  
* **Separation of upper vs. lower ontology** offers clear abstraction layers, simplifying maintenance of abstract concepts, yet adds an extra lookup step during type resolution.  

### System structure insights  
* The Ontology sub‑component is a **domain‑centric hub**: it defines the knowledge model, resolves types, validates via LLM, and persists results.  
* Shared infrastructure (LLMService, GraphDatabaseAdapter) is deliberately placed at the sibling level, fostering reuse across Pipeline, Insights, and CodeGraphConstructor.  
* The parent **SemanticAnalysis** orchestrates a suite of agents, making the system extensible: new agents can be added without touching the core Ontology logic.  

### Scalability considerations  
* **Horizontal scaling of LLM calls** can be achieved by configuring the LLMService to route requests to a pool of model endpoints or by employing caching of classification results.  
* **Graph database scalability** depends on the chosen backend; most modern graph stores support sharding and read‑replicas, allowing the Ontology sub‑component to handle growing knowledge graphs.  
* The **adapter‑centric design** means that scaling the storage layer (e.g., moving from a single‑node to a clustered graph DB) requires changes only inside `storage/graph-database-adapter.js`.  

### Maintainability assessment  
* High maintainability stems from **clear separation of concerns**: definition files, resolution logic, validation service, and persistence adapter are all isolated.  
* Reuse of `LLMService` and `GraphDatabaseAdapter` across siblings reduces duplicate code and eases updates.  
* The only potential maintenance hotspot is the **entity‑type resolution mechanism**, which must stay in sync with both upper and lower ontology definitions; thorough documentation and automated schema validation tests are recommended to mitigate drift.

## Diagrams

### Relationship

![Ontology Relationship](images/ontology-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/ontology-relationship.png)


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component employs a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, is responsible for classifying observations against the ontology system. This agent utilizes the LLMService, found in lib/llm/dist/index.js, for large language model operations, such as text generation and classification. The GraphDatabaseAdapter, located in storage/graph-database-adapter.js, is used for interacting with the graph database, which stores knowledge entities and their relationships.

### Children
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- The OntologyClassificationAgent uses the LLMService in lib/llm/dist/index.js for large language model operations, as indicated by the parent context.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses the GraphDatabaseAdapter in storage/graph-database-adapter.js for storing and retrieving knowledge entities and their relationships.
- [Insights](./Insights.md) -- The Insights sub-component uses the LLMService in lib/llm/dist/index.js for generating insights and pattern catalog extraction.
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- The CodeGraphConstructor uses the GraphDatabaseAdapter in storage/graph-database-adapter.js for storing and retrieving code entities and their relationships.
- [LLMController](./LLMController.md) -- The LLMController uses the LLMService in lib/llm/dist/index.js for large language model operations.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The GraphDatabaseAdapter uses the graph database for storing and retrieving knowledge entities and their relationships.


---

*Generated from 7 observations*

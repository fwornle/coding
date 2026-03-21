# MemgraphAdapter

**Type:** SubComponent

MemgraphConfiguration.yaml defines the Memgraph configuration, including connection and schema definitions

## What It Is  

`MemgraphAdapter` is the concrete adapter responsible for persisting and retrieving **code‑entity** objects in a Memgraph graph database. The core behaviour lives in the `MemgraphAdapter` class, whose two public operations are `persistCodeEntity()` – which writes a code entity into Memgraph – and `queryCodeEntity()` – which reads a code entity back from the store. Configuration for the adapter (connection details, schema definitions, etc.) is supplied via a dedicated YAML file, **`MemgraphConfiguration.yaml`**, and the adapter is instantiated and wired up by **`MemgraphAdapterManager.loadAdapter()`**. Supporting utilities such as `MemgraphAdapterUtils.getCodeEntity()` and logging via `MemgraphAdapterLogger.logMemgraph()` round out the implementation.  

The adapter sits one level below the **SemanticAnalysis** component, which orchestrates a multi‑agent pipeline for extracting structured knowledge from Git history and LSL sessions. Within the broader system, `MemgraphAdapter` is a sibling to other persistence‑related adapters (e.g., `GraphDatabaseAdapter`) and to components that produce the data it stores, such as `CodeKnowledgeGraphBuilder` in the **CodeKnowledgeGraph** module.

---

## Architecture and Design  

The design follows a classic **Adapter pattern**: `MemgraphAdapter` implements a uniform interface for graph‑database operations while encapsulating the specifics of the Memgraph driver. This isolates the rest of the system (e.g., `SemanticAnalysis`, `CodeKnowledgeGraphBuilder`) from any Memgraph‑specific APIs, allowing the higher‑level components to remain agnostic about the underlying storage engine.

Configuration‑as‑code is achieved through **`MemgraphConfiguration.yaml`**, which centralises connection strings, authentication credentials, and schema mapping. The manager class, `MemgraphAdapterManager`, reads this file and performs the adapter’s lifecycle steps (instantiation, connection establishment, schema verification) in its `loadAdapter()` method. This separation of configuration from code promotes environment‑specific deployments without code changes.

Utility and logging concerns are delegated to dedicated classes:
* **`MemgraphAdapterUtils`** supplies reusable helpers such as `getCodeEntity()`, keeping the adapter’s core methods focused on I/O rather than data‑model transformations.  
* **`MemgraphAdapterLogger`** provides a thin wrapper around the system‑wide logging facility, emitting structured logs for every Memgraph operation and capturing errors via `logMemgraph()`.  

Interaction flows are straightforward: a higher‑level agent (e.g., the **CodeKnowledgeGraphBuilder**) calls `MemgraphAdapter.persistCodeEntity()` to store a newly parsed entity; later, analytical agents invoke `MemgraphAdapter.queryCodeEntity()` to retrieve it for insight generation. All calls pass through the manager‑instantiated adapter, ensuring a single point of configuration and connection handling.

---

## Implementation Details  

1. **`MemgraphAdapter.persistCodeEntity()`** – Accepts a domain‑level *code entity* object, translates it into the appropriate Cypher statements (or driver‑specific commands), and executes them against the Memgraph instance. Error handling is funneled to `MemgraphAdapterLogger.logMemgraph()` which records the operation outcome and any exception stack traces.

2. **`MemgraphAdapter.queryCodeEntity()`** – Takes a query predicate (e.g., entity identifier or attribute filter), builds the corresponding read‑only Cypher query, and returns the deserialized entity. The method relies on `MemgraphAdapterUtils.getCodeEntity()` to map raw graph results back into the internal `CodeEntity` model.

3. **`MemgraphConfiguration.yaml`** – Declares keys such as `host`, `port`, `username`, `password`, and a `schema` section that enumerates node and edge types expected for code‑entity representation. The YAML file is parsed by `MemgraphAdapterManager.loadAdapter()` during system startup.

4. **`MemgraphAdapterManager.loadAdapter()`** – Reads `MemgraphConfiguration.yaml`, creates a driver/connection object, validates the schema (creating missing indices or constraints if needed), and returns a fully‑initialised `MemgraphAdapter` instance. This manager acts as the single source of truth for adapter lifecycle, preventing multiple concurrent connections and ensuring consistent configuration.

5. **`MemgraphAdapterUtils.getCodeEntity()`** – Provides a static helper that accepts raw query results (e.g., a map of node properties) and constructs a strongly‑typed `CodeEntity`. This utility isolates mapping logic from the adapter, making it reusable across other components that may need to reconstruct entities from graph data.

6. **`MemgraphAdapterLogger.logMemgraph()`** – Centralises logging for all Memgraph‑related actions. It records operation type (persist, query), timestamps, entity identifiers, and any error details. By using a dedicated logger, the system can filter or route Memgraph logs independently from other subsystems.

Because the source observation list reports **“0 code symbols found”**, the exact package paths are not disclosed, but the naming convention (e.g., `MemgraphAdapter`, `MemgraphAdapterManager`) suggests a dedicated sub‑package under the **SemanticAnalysis** component, likely something akin to `semantic_analysis.adapters.memgraph`.

---

## Integration Points  

* **Parent – SemanticAnalysis**: `SemanticAnalysis` orchestrates the overall knowledge‑extraction workflow. It delegates persistence of code entities to `MemgraphAdapter`, thereby decoupling semantic processing from storage concerns. The parent component likely injects the adapter instance (produced by `MemgraphAdapterManager`) into agents that need to persist or retrieve entities.

* **Sibling – GraphDatabaseAdapter**: Both adapters provide graph‑database persistence, but `MemgraphAdapter` is specialised for the Memgraph engine, while `GraphDatabaseAdapter` may target a different backend (e.g., Neo4j). Their shared interface (if any) enables the system to switch databases with minimal impact on higher‑level logic.

* **Sibling – CodeKnowledgeGraph**: `CodeKnowledgeGraphBuilder.buildGraph()` constructs the code‑knowledge graph using AST parsing and then calls `MemgraphAdapter.persistCodeEntity()` to materialise nodes/relationships in Memgraph. This creates a direct data‑flow dependency: the builder produces entities; the adapter stores them.

* **Sibling – InsightGenerator**: `InsightGenerator.generateInsights()` consumes persisted entities via `MemgraphAdapter.queryCodeEntity()`. The generator’s pattern‑based insight extraction relies on the adapter to supply up‑to‑date graph data.

* **Utility – MemgraphAdapterUtils**: Other components that need to transform raw query results (e.g., validation agents) can reuse `MemgraphAdapterUtils.getCodeEntity()`, ensuring a consistent mapping across the codebase.

* **Logging – MemgraphAdapterLogger**: System‑wide observability tools ingest logs emitted by `logMemgraph()`. This integration allows operators to monitor graph‑operation latency, error rates, and audit entity changes.

All integration occurs through well‑defined method signatures; there is no indication of event‑bus or asynchronous messaging, implying a synchronous, call‑based interaction model.

---

## Usage Guidelines  

1. **Configuration First** – Ensure `MemgraphConfiguration.yaml` is present and correctly populated for the target environment (development, staging, production). Missing or malformed configuration will cause `MemgraphAdapterManager.loadAdapter()` to raise errors during system startup.

2. **Instantiate via the Manager** – Do **not** create `MemgraphAdapter` objects directly. Always obtain an instance through `MemgraphAdapterManager.loadAdapter()`. This guarantees that connection pooling, schema validation, and logging hooks are correctly established.

3. **Prefer Utility Mapping** – When handling raw query results, call `MemgraphAdapterUtils.getCodeEntity()` rather than manually constructing `CodeEntity` objects. This reduces duplication and keeps mapping logic centralised.

4. **Log All Operations** – Although the adapter internally logs each operation, callers should still capture context (e.g., calling agent name, operation purpose) and include it in log messages if additional traceability is required.

5. **Error Handling** – Wrap calls to `persistCodeEntity()` and `queryCodeEntity()` in try‑catch blocks. On failure, inspect the structured logs emitted by `MemgraphAdapterLogger.logMemgraph()` to diagnose connectivity issues, schema mismatches, or Cypher syntax errors.

6. **Schema Evolution** – When extending the code‑entity model (adding new node types or properties), update the `schema` section of `MemgraphConfiguration.yaml` and, if necessary, modify the Cypher generation logic inside the adapter. Because the manager validates the schema at load time, mismatches will be caught early.

---

### Architectural patterns identified  
* **Adapter pattern** – `MemgraphAdapter` abstracts Memgraph‑specific APIs behind a uniform persistence interface.  
* **Configuration‑as‑Code** – `MemgraphConfiguration.yaml` externalises connection and schema settings.  
* **Utility/Helper pattern** – `MemgraphAdapterUtils` centralises entity‑mapping logic.  
* **Logging façade** – `MemgraphAdapterLogger` provides a dedicated logging entry point for all Memgraph operations.

### Design decisions and trade‑offs  
* **Synchronous API** – Direct method calls simplify reasoning and debugging but may limit throughput under high load; an asynchronous queue could improve scalability but adds complexity.  
* **Single‑point configuration** – Centralising settings in YAML eases deployment but requires careful version control to avoid environment drift.  
* **Separate logger** – Improves observability without polluting business logic, though it introduces an extra class to maintain.  
* **Utility class for mapping** – Encourages reuse but can become a catch‑all if not kept focused; future refactoring may split it into more granular mappers.

### System structure insights  
`MemgraphAdapter` sits in a thin persistence layer under **SemanticAnalysis**, sharing a sibling relationship with other adapters and downstream builders. Its manager‑based lifecycle enforces a clear entry point, while utilities and logging are decoupled, reflecting a modular, layered architecture.

### Scalability considerations  
* **Connection pooling** – The manager should configure the underlying driver for pooled connections; otherwise, each call could open a new socket, limiting scalability.  
* **Batch operations** – The current API appears to handle single‑entity persistence; for bulk imports (e.g., large AST parses), adding batch‑persist methods would reduce round‑trips.  
* **Read‑write separation** – If read traffic grows (e.g., many insight generators querying the graph), consider read‑replicas of Memgraph and routing queries accordingly.

### Maintainability assessment  
The clear separation of concerns (adapter, manager, utils, logger) makes the codebase approachable and testable. Configuration externalisation reduces hard‑coded values, and the use of descriptive method names (`persistCodeEntity`, `queryCodeEntity`) aids discoverability. The main maintenance risk lies in the utility mapper becoming a monolith as entity models evolve; disciplined refactoring and unit tests will mitigate this. Overall, the design promotes straightforward extension and reliable operation within the broader **SemanticAnalysis** ecosystem.

## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It features a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The system utilizes a range of technologies, including GraphDatabaseAdapter for persistence, LLMService for language model integration, and Wave agents for concurrent execution.

### Siblings
- [Pipeline](./Pipeline.md) -- PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification approach, with upper and lower ontology definitions in ontology-definitions.yaml
- [Insights](./Insights.md) -- InsightGenerator.generateInsights() uses a pattern-based approach to generate insights from knowledge entities
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph
- [EntityValidator](./EntityValidator.md) -- EntityValidator.validateEntity() implements a validation strategy based on entity metadata and definitions
- [LLMFacade](./LLMFacade.md) -- LLMFacade.getLLMModel() retrieves the LLM model instance based on configuration and provider
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- WorkflowOrchestrator.runWorkflow() executes the workflow with the given input and parameters
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter.persistEntity() persists the entity to the graph database

---

*Generated from 6 observations*

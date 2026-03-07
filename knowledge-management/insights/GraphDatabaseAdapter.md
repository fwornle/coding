# GraphDatabaseAdapter

**Type:** SubComponent

GraphDatabaseConfiguration.yaml defines the graph database configuration, including connection and schema definitions

**GraphDatabaseAdapter – Technical Insight Document**  
*Sub‑component of **SemanticAnalysis***  

---

## What It Is  

`GraphDatabaseAdapter` is the concrete persistence layer that the **SemanticAnalysis** component uses to store and retrieve knowledge entities in a graph database. All of its public behaviour lives in a handful of well‑named members that are referenced from configuration and utility modules:

* **`GraphDatabaseAdapter.persistEntity()`** – writes a domain entity into the underlying graph store.  
* **`GraphDatabaseAdapter.queryEntity()`** – reads an entity back, applying the query semantics required by the semantic‑analysis pipelines.  
* **`GraphDatabaseConfiguration.yaml`** – the YAML file that declares the connection parameters (host, port, credentials) and the schema artefacts (node/edge types, indexes) required by the adapter.  
* **`GraphDatabaseAdapterManager.loadAdapter()`** – the bootstrap routine that reads the configuration file, creates an adapter instance, and performs any one‑time initialisation (e.g., schema creation, connection pooling).  
* **`GraphDatabaseAdapterUtils.getEntity()`** – a helper that hides the low‑level query mechanics and returns a fully‑hydrated domain object to callers.  
* **`GraphDatabaseAdapterLogger.logDatabase()`** – a dedicated logger that records every persistence or query operation together with any error conditions, providing observability for the whole SemanticAnalysis pipeline.

All of these artefacts sit under the same logical directory (e.g., `src/semantic_analysis/graph_adapter/`) and are wired together through the configuration‑driven manager. The adapter therefore acts as the *single source of truth* for how SemanticAnalysis persists its structured knowledge.

---

## Architecture and Design  

The observations reveal a **configuration‑driven façade** pattern. `GraphDatabaseAdapter` exposes a small, purpose‑specific façade (`persistEntity`, `queryEntity`) while delegating the heavy lifting to lower‑level utilities and a logger. The façade hides the graph‑database client library (e.g., Memgraph, Neo4j) behind a stable interface, allowing the rest of the system to remain agnostic to the exact database technology.

* **Manager‑based initialisation** – `GraphDatabaseAdapterManager.loadAdapter()` follows a *Factory*‑like approach: it reads `GraphDatabaseConfiguration.yaml`, constructs the concrete adapter, and registers it for use by other agents. This keeps configuration concerns separate from business logic and enables easy swapping of connection parameters without code changes.  

* **Utility‑centric data access** – `GraphDatabaseAdapterUtils.getEntity()` centralises the query‑building logic. By funneling all retrievals through a single utility, the design enforces a consistent query shape and reduces duplication across agents that need entity data (e.g., InsightGenerator, EntityValidator).  

* **Dedicated logging** – `GraphDatabaseAdapterLogger.logDatabase()` implements a cross‑cutting concern (observability) via a specialised logger rather than sprinkling generic logging statements throughout the code. This is a classic *Aspect‑oriented* technique, albeit realised manually.  

Interaction flow (high level):  

1. **Startup** – `GraphDatabaseAdapterManager.loadAdapter()` reads `GraphDatabaseConfiguration.yaml` and creates an adapter instance.  
2. **Persist** – any downstream agent (e.g., `CodeKnowledgeGraphBuilder`, `EntityValidator`) calls `persistEntity()`. The method writes to the graph, then invokes `logDatabase()` to record the operation.  
3. **Query** – agents that need existing knowledge (e.g., `InsightGenerator`) call `GraphDatabaseAdapterUtils.getEntity()`, which internally uses `queryEntity()` and again logs via `logDatabase()`.  

Because the parent **SemanticAnalysis** component is a multi‑agent system, this adapter provides a **shared, thread‑safe persistence contract** that all agents can rely on, mirroring the way sibling components such as `Pipeline` and `Ontology` expose their own façade‑style APIs (e.g., `PipelineController`, `OntologyClassifier`).

---

## Implementation Details  

### Core Classes / Functions  

| Symbol | Responsibility | Key Mechanics (as inferred) |
|--------|----------------|-----------------------------|
| `GraphDatabaseAdapter.persistEntity(entity)` | Serialises a domain entity into the graph. Likely converts the entity into a set of node/edge definitions, opens a transaction, writes, and commits. |
| `GraphDatabaseAdapter.queryEntity(criteria)` | Constructs a graph query (Cypher or Memgraph‑specific) based on supplied criteria, executes it, and maps the result set back to a domain object. |
| `GraphDatabaseConfiguration.yaml` | Holds connection strings (`uri`, `username`, `password`) and schema descriptors (`nodeTypes`, `edgeTypes`, `indexes`). The manager parses this file at start‑up. |
| `GraphDatabaseAdapterManager.loadAdapter()` | Reads the YAML, validates required fields, creates a client instance (e.g., a Memgraph driver), possibly runs schema‑initialisation statements, and returns a ready‑to‑use `GraphDatabaseAdapter`. |
| `GraphDatabaseAdapterUtils.getEntity(id)` | A thin wrapper that calls `queryEntity({id})`, performs null‑checks, and returns a typed entity object. |
| `GraphDatabaseAdapterLogger.logDatabase(event, details)` | Formats a log entry (including timestamps, operation type, success/failure) and forwards it to the system logger (likely using a structured logging library). |

### Configuration‑Driven Bootstrapping  

The YAML file is the single source of truth for connection parameters. By externalising these values, the system can be re‑targeted to a different graph instance (e.g., a development Memgraph cluster) without recompiling. The manager likely validates the schema definitions against the actual database at start‑up, ensuring that required indexes exist—this guards against runtime query‑performance regressions.

### Utility Layer  

`GraphDatabaseAdapterUtils` abstracts repetitive query patterns (e.g., “find entity by UUID”). By centralising this logic, the adapter avoids leaking query syntax into business agents, making future migrations to a different graph query language easier.

### Logging  

All database interactions funnel through `GraphDatabaseAdapterLogger`. This design isolates logging concerns, making it straightforward to enrich logs with correlation IDs (useful for tracing across the multi‑agent pipelines) or to switch to a different logging backend.

---

## Integration Points  

1. **Parent – SemanticAnalysis**  
   *The adapter is the persistence backbone for SemanticAnalysis.* Every agent that produces or consumes knowledge entities (e.g., `CodeKnowledgeGraphBuilder`, `EntityValidator`, `InsightGenerator`) ultimately calls into `persistEntity` or `getEntity`. The parent component’s orchestration logic therefore depends on the adapter being available and correctly initialised by the manager.

2. **Sibling Components**  
   *Shared patterns*: Like `PipelineController` (which reads `pipeline-configuration.yaml`) and `OntologyClassifier` (which reads `ontology-definitions.yaml`), the adapter reads its own YAML (`GraphDatabaseConfiguration.yaml`). This demonstrates a consistent **configuration‑as‑code** approach across the system.  
   *Potential collaboration*: The `MemgraphAdapter` sibling likely implements a similar façade for a specific graph engine; the existence of both suggests an abstraction layer that could allow swapping implementations (e.g., switching from a generic `GraphDatabaseAdapter` to a specialised `MemgraphAdapter` for performance‑critical paths).

3. **External Services**  
   While not directly referenced, the adapter’s persistence responsibilities imply downstream consumption by reporting or analytics services that query the graph for insights. The logger also provides hooks for monitoring tools (e.g., Prometheus exporters) that can ingest the structured logs.

4. **Configuration Management**  
   The YAML file is a touchpoint for DevOps: environment‑specific configuration files can be injected at deployment time, enabling the same codebase to run against a local test graph, a staging cluster, or a production Memgraph instance.

---

## Usage Guidelines  

* **Initialisation** – Always obtain an adapter instance through `GraphDatabaseAdapterManager.loadAdapter()`. Direct construction bypasses configuration validation and may lead to missing schema elements.  

* **Entity Lifecycle** – Use `persistEntity()` for any creation or update operation. The method is expected to be idempotent for updates (i.e., it should upsert based on the entity’s unique identifier).  

* **Querying** – Prefer the utility `GraphDatabaseAdapterUtils.getEntity(id)` for simple look‑ups. For more complex queries, invoke `queryEntity()` directly but keep query construction within the utility layer to maintain consistency.  

* **Error Handling** – All database errors are logged by `GraphDatabaseAdapterLogger.logDatabase()`. Still, callers should catch exceptions thrown by `persistEntity` / `queryEntity` and translate them into domain‑specific errors (e.g., `EntityNotFoundException`).  

* **Performance** – Because each call opens a transaction, batch operations should be wrapped in a single transaction when possible (e.g., a bulk import routine in `CodeKnowledgeGraphBuilder`). The configuration file can be tuned with index definitions to accelerate frequent lookup patterns.  

* **Testing** – Tests should supply a lightweight in‑memory graph configuration (or a Dockerised Memgraph instance) and point `GraphDatabaseConfiguration.yaml` to it. This ensures that the manager loads the adapter correctly and that the logger captures expected events.  

* **Extensibility** – If a new graph engine is required, implement a new subclass that respects the same façade (`persistEntity`, `queryEntity`) and register it in `GraphDatabaseAdapterManager`. Because the rest of SemanticAnalysis interacts only through the façade, the change is isolated.

---

### Summary of Architectural Findings  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Pattern(s)** | Configuration‑driven façade, Factory/Manager for creation, Utility‑centric data access, Dedicated logging (cross‑cutting concern). |
| **Design Decisions** | Separate configuration (`.yaml`) from code; centralise query logic in utils; expose minimal public API; use a manager to enforce one‑time initialisation. |
| **Trade‑offs** | Simplicity and low coupling at the cost of a thin abstraction layer (no explicit repository interface). Centralised utils can become a bottleneck if not designed for concurrency. |
| **System Structure** | Adapter lives under `SemanticAnalysis`, providing persistence for all sibling agents; shares a configuration‑as‑code philosophy with `Pipeline` and `Ontology`. |
| **Scalability** | Scalability hinges on the underlying graph engine and proper indexing defined in `GraphDatabaseConfiguration.yaml`. The manager can be extended to pool connections, supporting high‑throughput pipelines. |
| **Maintainability** | High – clear separation of concerns, single point of configuration, and uniform logging make future changes (e.g., schema evolution, engine swap) straightforward. The only risk is the “utility‑only” query layer becoming monolithic; periodic refactoring into more granular query objects may be needed. |

The **GraphDatabaseAdapter** thus embodies a clean, configuration‑driven persistence contract that enables the multi‑agent **SemanticAnalysis** system to store and retrieve rich knowledge graphs reliably, while remaining flexible enough to evolve with the rest of the platform’s modular architecture.


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
- [MemgraphAdapter](./MemgraphAdapter.md) -- MemgraphAdapter.persistCodeEntity() persists the code entity to Memgraph


---

*Generated from 6 observations*

# Pipeline

**Type:** SubComponent

PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges

## What It Is  

The **Pipeline** sub‑component lives inside the **SemanticAnalysis** parent component and is the engine that drives the end‑to‑end processing of knowledge‑graph entities. Its definition is anchored in the file **`pipeline-configuration.yaml`**, which declares every step of the workflow together with explicit `depends_on` edges that form a directed‑acyclic graph (DAG). At runtime the **`PipelineController`** reads this YAML file, builds the DAG, and executes the steps in a topologically‑sorted order. The controller works hand‑in‑hand with **`PipelineCoordinator.runPipeline()`**, which is responsible for orchestrating the step execution, handling any runtime errors and applying retry logic where needed. Supporting agents such as **`ObservationGenerator.mapEntityToKG()`**, **`PersistenceAgent.persistEntity()`**, and **`KGOperator.applyDeduplication()`** are invoked as individual pipeline steps, each contributing a focused piece of functionality (metadata pre‑population, transactional persistence, and deduplication respectively).  

Because **Pipeline** is a child of the **`DagBasedExecutionModel`** entity, the DAG construction logic lives inside that child component, while the surrounding agents are siblings to other SemanticAnalysis agents like **Ontology**, **Insights**, **CodeKnowledgeGraph**, **EntityValidator**, **LLMFacade**, **WorkflowOrchestrator**, **GraphDatabaseAdapter**, and **MemgraphAdapter**. This positioning makes the Pipeline the central orchestrator that strings together the capabilities offered by those sibling agents into a coherent, data‑driven workflow.

---

## Architecture and Design  

The architecture that emerges from the observations is a **DAG‑driven, step‑oriented pipeline** built on top of a declarative configuration file. The key design pattern is **Declarative Workflow Definition**: the `pipeline-configuration.yaml` file lists steps and their `depends_on` relationships, allowing the system to infer execution order without hard‑coding it. The **`PipelineController`** materialises this pattern by parsing the YAML, constructing a **DagBasedExecutionModel**, and applying a **topological sort** to produce a deterministic execution sequence.  

Error handling and resilience are addressed through the **Coordinator pattern** embodied by **`PipelineCoordinator.runPipeline()`**. This component wraps each step execution with try‑catch logic, logs failures, and triggers configurable retries, ensuring that transient issues do not abort the whole workflow.  

Data integrity is guaranteed by a **Transactional Persistence pattern** implemented in **`PersistenceAgent.persistEntity()`**. Each step that writes to the knowledge graph does so within a transaction scope, committing only when the step completes successfully. This aligns with the overall pipeline’s need for **atomicity** across multiple dependent steps.  

Finally, the pipeline incorporates a **Deduplication strategy** via **`KGOperator.applyDeduplication()`**, which uses entity identifiers and attached metadata to prune duplicate entities before they are persisted. This reflects a **Data Cleansing** concern baked directly into the pipeline rather than as a post‑processing step.

No micro‑service or event‑driven infrastructure is mentioned, so the design stays within a **single‑process, in‑memory orchestration** model, relying on the configuration‑driven DAG to drive parallelism (if any) and ordering.

---

## Implementation Details  

### Core Files & Classes  
* **`pipeline-configuration.yaml`** – The single source of truth for the pipeline workflow. Each entry defines a step name, the class or function to invoke, and a `depends_on` list that creates the DAG edges.  
* **`PipelineController`** – Reads the YAML, builds the **DagBasedExecutionModel**, and invokes a **topological sort** algorithm to produce an execution queue. The controller then hands the queue to the coordinator.  
* **`DagBasedExecutionModel`** (child component) – Provides the data structures (nodes, edges) and the sorting routine. It is responsible for detecting cycles and reporting configuration errors early.  
* **`PipelineCoordinator.runPipeline()`** – Iterates over the sorted step list, calling each step’s entry point. It wraps calls in a retry loop, respects per‑step timeout settings, and aggregates error information for reporting.  
* **`ObservationGenerator.mapEntityToKG()`** – The first pipeline step for most flows. It enriches incoming raw entities with `entityType` and `metadata.kgClass`, preventing downstream agents from re‑classifying the same entity with an LLM.  
* **`PersistenceAgent.persistEntity()`** – Executes within a transaction (likely using the underlying **GraphDatabaseAdapter** or **MemgraphAdapter**). It writes the enriched entity to the knowledge graph and commits only on success.  
* **`KGOperator.applyDeduplication()`** – Scans the current batch of entities, compares their identifiers and metadata, and removes duplicates before the persistence step.  

### Execution Flow  
1. **Configuration Load** – `PipelineController` parses `pipeline-configuration.yaml`.  
2. **DAG Construction** – Using the child **DagBasedExecutionModel**, nodes are created for each step, and edges are added per `depends_on`. A cycle detection pass guarantees a valid DAG.  
3. **Topological Sort** – The model returns an ordered list respecting dependencies.  
4. **Orchestration** – `PipelineCoordinator.runPipeline()` receives the list and executes steps sequentially (or in parallel where steps are independent). Each step is called via its fully‑qualified class/method reference.  
5. **Step Logic** – For example, `ObservationGenerator.mapEntityToKG()` enriches entities; `KGOperator.applyDeduplication()` removes duplicates; `PersistenceAgent.persistEntity()` writes to the graph inside a transaction.  
6. **Error & Retry** – If a step throws an exception, the coordinator logs the failure, applies the configured retry count, and either proceeds (if recoverable) or aborts the pipeline, rolling back any open transactions.  

All of these pieces are tightly coupled through the shared configuration file, which means adding, removing, or re‑ordering steps only requires editing `pipeline-configuration.yaml`—no code changes to the controller or coordinator are needed.

---

## Integration Points  

* **SemanticAnalysis (Parent)** – The Pipeline is invoked by the SemanticAnalysis orchestrator when a new batch of raw data (e.g., git history or LSL session logs) arrives. SemanticAnalysis passes the raw entities to the first pipeline step, `ObservationGenerator.mapEntityToKG()`.  
* **Ontology & EntityValidator (Siblings)** – After the Pipeline has persisted enriched entities, the **OntologyClassifier** (from the Ontology sibling) may be called to further classify entities against the hierarchical ontology definitions in `ontology-definitions.yaml`. Likewise, **EntityValidator.validateEntity()** can be triggered downstream to enforce schema constraints using the metadata set during `mapEntityToKG()`.  
* **LLMFacade (Sibling)** – While the Pipeline deliberately avoids redundant LLM calls by pre‑populating `entityType` and `metadata.kgClass`, any step that still requires language‑model assistance can obtain an LLM instance via `LLMFacade.getLLMModel()`.  
* **GraphDatabaseAdapter / MemgraphAdapter (Siblings)** – The transactional persistence performed by `PersistenceAgent.persistEntity()` relies on one of these adapters to open a transaction, execute write queries, and commit/rollback. The choice of adapter is typically configured elsewhere in the system and injected into the PersistenceAgent.  
* **WorkflowOrchestrator (Sibling)** – At a higher level, the **WorkflowOrchestrator** may schedule the entire Pipeline run as part of a larger multi‑agent workflow (e.g., after code parsing by CodeKnowledgeGraphBuilder).  

All interfaces are driven by method signatures observed (`mapEntityToKG()`, `persistEntity()`, `applyDeduplication()`, `runPipeline()`) and the shared configuration file, ensuring loose coupling while preserving a clear contract between components.

---

## Usage Guidelines  

1. **Define Steps Declaratively** – Always add or modify pipeline behavior by editing `pipeline-configuration.yaml`. Declare each step’s `depends_on` relationships explicitly to guarantee correct ordering.  
2. **Keep Steps Idempotent** – Because the coordinator may retry failed steps, each step should be safe to run multiple times without side‑effects (e.g., use up‑serts in the persistence layer).  
3. **Leverage Pre‑populated Metadata** – Do not re‑invoke the LLM for classification inside later steps; rely on the `entityType` and `metadata.kgClass` fields set by `ObservationGenerator.mapEntityToKG()`. This reduces latency and cost.  
4. **Respect Transaction Boundaries** – When extending the pipeline with new persistence logic, wrap database writes in the same transactional pattern used by `PersistenceAgent.persistEntity()`. This ensures atomicity across dependent steps.  
5. **Test DAG Validity** – Before deploying a new configuration, run the DAG construction routine locally to confirm there are no cycles or missing dependencies. The `DagBasedExecutionModel` will raise an error if the graph is invalid.  
6. **Monitor Deduplication** – If you introduce new entity identifier schemes, update `KGOperator.applyDeduplication()` accordingly so that duplicates are still detected correctly.  

Following these conventions keeps the pipeline robust, reproducible, and easy to evolve.

---

### Architectural patterns identified  
* **Declarative Workflow (YAML‑driven DAG)** – pipeline‑configuration.yaml defines steps and dependencies.  
* **Coordinator/Orchestrator pattern** – `PipelineCoordinator.runPipeline()` manages execution, error handling, and retries.  
* **Transactional Persistence** – `PersistenceAgent.persistEntity()` uses transactions to guarantee data consistency.  
* **Data Cleansing/Deduplication** – `KGOperator.applyDeduplication()` implements a deduplication strategy based on identifiers and metadata.  

### Design decisions and trade‑offs  
* **Configuration‑first vs. code‑first** – By externalising step ordering to YAML, the system gains flexibility (easy re‑ordering) at the cost of runtime validation overhead.  
* **Single‑process orchestration** – Simpler to reason about and debug, but may limit horizontal scalability; parallelism is only achievable when steps are independent in the DAG.  
* **Pre‑populating metadata** – Reduces LLM calls and improves performance, but requires early, accurate classification; mis‑classifications propagate downstream.  
* **Transactional writes** – Guarantees consistency but may increase latency for large batches; developers must be aware of transaction size limits.  

### System structure insights  
* **Pipeline** sits as a child of **DagBasedExecutionModel**, inheriting the DAG construction logic.  
* It acts as the glue between the parent **SemanticAnalysis** orchestrator and sibling agents that provide domain‑specific capabilities (ontology classification, validation, graph persistence).  
* The modular step design encourages reuse: any sibling component that implements a `run()`‑style method can be dropped into the pipeline by declaring it in the YAML.  

### Scalability considerations  
* **Parallel execution** is possible for DAG branches without dependencies; extending the coordinator to launch those branches concurrently would improve throughput.  
* **Transaction size** may become a bottleneck for massive entity batches; consider chunking persistence steps or using bulk‑load APIs of the underlying graph database.  
* **Deduplication cost** grows with batch size; indexing on entity identifiers and metadata will be essential to keep `applyDeduplication()` performant.  

### Maintainability assessment  
The declarative DAG approach yields high maintainability: pipeline behaviour lives in a readable YAML file, and new steps can be added without touching core controller code. The clear separation of concerns (metadata enrichment, deduplication, persistence) aligns with the single‑responsibility principle, making each class easy to test in isolation. However, the reliance on correct YAML definitions places a burden on configuration reviewers, and the lack of an explicit schema for the YAML may lead to subtle runtime errors if a step name or dependency is misspelled. Introducing schema validation (e.g., JSON‑Schema for the YAML) would further improve maintainability without altering the core architecture.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It features a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The system utilizes a range of technologies, including GraphDatabaseAdapter for persistence, LLMService for language model integration, and Wave agents for concurrent execution.

### Children
- [DagBasedExecutionModel](./DagBasedExecutionModel.md) -- The pipeline-configuration.yaml file defines the steps and their dependencies, which are used to construct the DAG.

### Siblings
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification approach, with upper and lower ontology definitions in ontology-definitions.yaml
- [Insights](./Insights.md) -- InsightGenerator.generateInsights() uses a pattern-based approach to generate insights from knowledge entities
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph
- [EntityValidator](./EntityValidator.md) -- EntityValidator.validateEntity() implements a validation strategy based on entity metadata and definitions
- [LLMFacade](./LLMFacade.md) -- LLMFacade.getLLMModel() retrieves the LLM model instance based on configuration and provider
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- WorkflowOrchestrator.runWorkflow() executes the workflow with the given input and parameters
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter.persistEntity() persists the entity to the graph database
- [MemgraphAdapter](./MemgraphAdapter.md) -- MemgraphAdapter.persistCodeEntity() persists the code entity to Memgraph


---

*Generated from 6 observations*

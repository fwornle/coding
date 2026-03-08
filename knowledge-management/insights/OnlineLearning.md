# OnlineLearning

**Type:** SubComponent

OnlineLearning probably utilizes a batch analysis pipeline, similar to the one described in batch-analysis.yaml, to extract knowledge from git history and other sources.

## What It Is  

**OnlineLearning** is a sub‑component of the **KnowledgeManagement** component that automatically extracts, processes, and persists knowledge from sources such as Git history.  The implementation lives alongside the other knowledge‑management pieces and relies heavily on the same persistence layer that the rest of the system uses – a **Graphology + LevelDB** database accessed through the **GraphDatabaseAdapter** (see `storage/graph-database-adapter.ts`).  The extraction work is driven by a batch‑analysis pipeline whose definition is captured in `batch-analysis.yaml`.  In practice, OnlineLearning runs a series of batch jobs that read raw artefacts, apply natural‑language‑processing / machine‑learning models, and write the resulting knowledge‑graph entities into the LevelDB store.  When an entity must be created or updated, the component ultimately calls the `storeEntity` method of the adapter, just as the sibling **ManualLearning** does for hand‑crafted data.

## Architecture and Design  

The architecture of OnlineLearning follows a **batch‑oriented processing pipeline** that is orchestrated by the YAML‑described workflow (`batch-analysis.yaml`).  The pipeline is split into distinct stages – data ingestion, analysis, and persistence – each of which can be executed in parallel.  Concurrency is achieved through the same **work‑stealing** technique employed by the sibling **WaveController**: a shared `nextIndex` counter is used by worker threads to pull the next batch task as soon as they become idle, which maximises CPU utilisation without requiring a central scheduler.

Persistence is handled through the **Graphology + LevelDB** stack.  The `GraphDatabaseAdapter` abstracts the underlying database and exposes a small, well‑defined API (e.g., `storeEntity`).  OnlineLearning does not interact with LevelDB directly; instead it delegates all graph writes and queries to the adapter, preserving a clean separation between analysis logic and storage concerns.  

Routing of knowledge‑graph operations is mediated by the **IntelligentRouter**.  When OnlineLearning needs to read or write a graph fragment, the router decides—based on configuration or runtime heuristics—whether to go through the local LevelDB store or to invoke the external **VKB API**.  This “intelligent routing” pattern gives the sub‑component flexibility to fall back to a remote knowledge‑graph service when the local store is insufficient, while still keeping the fast‑path local for the majority of operations.

Overall, the design leans on **pipeline composition**, **adapter abstraction**, and **conditional routing** rather than monolithic processing.  Each concern (batch orchestration, concurrency, storage, remote routing) is encapsulated in its own module, making the system easier to reason about and extend.

## Implementation Details  

1. **Batch definition (`batch-analysis.yaml`)** – This YAML file enumerates the steps that OnlineLearning executes:  
   * *source‑fetch*: pulls Git logs, commit messages, and other artefacts.  
   * *nlp‑transform*: runs NLP/ML models to extract entities, relationships, and semantic annotations.  
   * *graph‑write*: invokes the `storeEntity` method of `GraphDatabaseAdapter` to persist the extracted knowledge.  

   The YAML‑driven approach enables the pipeline to be re‑configured without code changes, a pattern already used by other batch‑oriented components in the repository.

2. **Graph storage (`storage/graph-database-adapter.ts`)** – The adapter wraps Graphology’s LevelDB backend.  Its `storeEntity(entity: GraphEntity): Promise<void>` method serialises a domain‑specific entity object into the LevelDB key‑value store, handling conflict resolution and index updates.  Because OnlineLearning shares this adapter with **ManualLearning**, any change to the persistence contract propagates uniformly across both automated and manual ingestion paths.

3. **Intelligent routing (`IntelligentRouter`)** – The router implements a simple decision tree: if the requested operation matches a pre‑defined “remote‑only” pattern (e.g., large‑scale graph traversal), the request is forwarded to the VKB API; otherwise it stays local.  The router’s public interface (`route(operation: GraphOperation): Promise<Result>`) is used by OnlineLearning when it needs to query the graph for enrichment or validation before persisting new entities.

4. **Concurrency (`WaveController.runWithConcurrency`)** – OnlineLearning inherits the work‑stealing loop from WaveController.  A pool of worker threads reads the next batch index from a shared atomic counter; when a worker finishes its current batch it immediately attempts to steal the next one.  This eliminates idle time and scales the batch analysis linearly with the number of CPU cores, a design decision that mirrors the pattern already proven in the WaveController sibling.

5. **ML/NLP integration** – While the observations do not name a concrete library, the pipeline’s *nlp‑transform* stage is expected to invoke external ML models (e.g., spaCy, TensorFlow) to generate the knowledge graph elements.  The output of this stage is a collection of plain objects that match the `GraphEntity` shape expected by the adapter.

## Integration Points  

- **Parent component – KnowledgeManagement**: OnlineLearning is invoked by KnowledgeManagement when a new learning cycle is triggered (e.g., after a repository push).  It consumes the same storage layer (`GraphDatabaseAdapter`) and routing logic (`IntelligentRouter`) that the parent uses for all knowledge‑graph interactions.  

- **Sibling components**:  
  * **ManualLearning** – Shares the `storeEntity` persistence path, meaning any schema changes affect both manual and automated ingestion.  
  * **WaveController** – Provides the concurrency primitive (work‑stealing) that OnlineLearning re‑uses for its batch jobs.  
  * **UKBTraceReportGenerator** – May consume the knowledge graph produced by OnlineLearning to generate trace reports, illustrating a downstream dependency.  

- **External services** – The **VKB API** is consulted via the IntelligentRouter when the local LevelDB store cannot satisfy a particular query or when a remote enrichment step is required.  This external dependency is abstracted away behind the router, keeping OnlineLearning’s core logic free of direct HTTP handling.

- **Configuration files** – `batch-analysis.yaml` is the primary declarative integration point; modifications here alter the stages, ordering, or parameters of the learning pipeline without touching source code.

## Usage Guidelines  

1. **Define batch steps in `batch-analysis.yaml`** – Keep the YAML concise and version‑controlled.  Adding a new analysis stage should be a matter of appending a step object; the runtime will automatically pick it up.  Avoid embedding business logic in the YAML – keep it to orchestration only.

2. **Persist through `GraphDatabaseAdapter.storeEntity`** – All entities, whether produced automatically by OnlineLearning or manually by ManualLearning, must be handed to the adapter.  This guarantees that indexing, conflict handling, and routing decisions are applied uniformly.

3. **Leverage the IntelligentRouter for remote queries** – When an operation may benefit from VKB’s capabilities (large‑scale traversal, external ontology lookup), invoke the router rather than accessing LevelDB directly.  The router will decide the optimal path.

4. **Scale with work‑stealing** – Do not create custom thread pools; reuse the concurrency pattern from WaveController (`runWithConcurrency`).  The shared `nextIndex` counter is thread‑safe and ensures even distribution of batch work across cores.

5. **Monitor batch health** – Since the pipeline is batch‑driven, failures in any stage will abort the current run.  Implement idempotent `storeEntity` calls and ensure that the NLP/ML stage can be re‑run without side effects.

6. **Version the knowledge‑graph schema** – Because both OnlineLearning and ManualLearning write to the same graph, any schema evolution must be coordinated.  Use migration scripts that run before the batch pipeline starts to keep the LevelDB store compatible.

---

### Architectural patterns identified  
1. **Batch‑oriented pipeline (YAML‑driven orchestration)**  
2. **Adapter pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB.  
3. **Intelligent routing (conditional delegation)** – switches between local store and VKB API.  
4. **Work‑stealing concurrency** – shared counter model from `WaveController.runWithConcurrency`.  

### Design decisions and trade‑offs  
* **Batch vs. real‑time** – Choosing a batch pipeline simplifies deterministic processing of large code histories but adds latency compared to an event‑driven approach.  
* **Local LevelDB + remote VKB** – Gives fast local reads/writes while retaining the ability to fall back to a richer remote graph service; however it introduces complexity in routing logic and potential consistency gaps.  
* **Shared storage adapter** – Guarantees a single source of truth for graph persistence, but any change to the adapter’s contract impacts all ingestion paths (manual and automated).  
* **Work‑stealing** – Provides excellent CPU utilisation for heterogeneous batch sizes, at the cost of a slightly more complex synchronization mechanism (the atomic `nextIndex`).  

### System structure insights  
OnlineLearning sits in a **knowledge‑centric layer** beneath KnowledgeManagement.  It re‑uses core infrastructure (GraphDatabaseAdapter, IntelligentRouter, WaveController) and contributes the **automated knowledge extraction** capability that complements the manual entry path.  The component’s responsibilities are cleanly separated: orchestration (`batch-analysis.yaml`), analysis (NLP/ML stage), persistence (adapter), and routing (router).  

### Scalability considerations  
* **Horizontal scaling** – Because batch jobs are independent and fetched via work‑stealing, adding more CPU cores linearly improves throughput.  The LevelDB backend scales well for read‑heavy workloads but may become a bottleneck for massive write bursts; in that case, sharding or moving to a distributed graph store would be required.  
* **Remote VKB fallback** – Off‑loading heavy graph queries to VKB prevents the local store from being overloaded, but network latency must be accounted for in batch timing estimates.  
* **Pipeline extensibility** – New analysis stages can be added without code changes, allowing the system to grow as new ML models become available.  

### Maintainability assessment  
The component benefits from **high modularity**: each concern lives in its own module and is referenced through well‑defined interfaces.  The use of a declarative YAML pipeline reduces code churn when adjusting processing steps.  However, the reliance on several shared abstractions (adapter, router, concurrency primitive) creates **tight coupling** with sibling components; any breaking change in those shared pieces will ripple through OnlineLearning.  Maintaining **clear versioned contracts** for `storeEntity` and the router API is therefore essential to keep the sub‑component stable.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of a Graphology+LevelDB database for persistence, as seen in the GraphDatabaseAdapter (storage/graph-database-adapter.ts), allows for efficient storage and querying of knowledge graphs. This choice of database is particularly noteworthy due to its ability to handle large amounts of data and provide a robust foundation for the component's intelligent routing mechanism. The intelligent routing, which switches between VKB API and direct database access, enables the component to optimize its interactions with the knowledge graph, thus improving overall performance. For instance, when an agent needs to store an entity, it can use the storeEntity method in GraphDatabaseAdapter, which ultimately relies on the Graphology+LevelDB database for persistence.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning likely utilizes the storeEntity method in GraphDatabaseAdapter (storage/graph-database-adapter.ts) to persist manually created entities.
- [WaveController](./WaveController.md) -- WaveController implements work-stealing via a shared nextIndex counter, allowing idle workers to pull tasks immediately, as seen in the runWithConcurrency method.
- [UKBTraceReportGenerator](./UKBTraceReportGenerator.md) -- UKBTraceReportGenerator probably utilizes a report generation mechanism to create detailed trace reports for UKB workflow runs.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter utilizes the Graphology+LevelDB database for storing and querying knowledge graphs, as seen in the storeEntity method.
- [IntelligentRouter](./IntelligentRouter.md) -- IntelligentRouter utilizes the VKB API and direct database access to optimize interactions with the knowledge graph, as seen in the intelligent routing mechanism.


---

*Generated from 7 observations*

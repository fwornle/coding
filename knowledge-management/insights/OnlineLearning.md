# OnlineLearning

**Type:** SubComponent

OnlineLearning uses the GraphDatabaseAdapter to store and retrieve extracted knowledge, utilizing Graphology+LevelDB persistence with automatic JSON export sync

## What It Is  

**OnlineLearning** is a sub‑component of the **KnowledgeManagement** domain that extracts, classifies, and persists knowledge from code repositories and other learning sources. The core implementation lives in the same repository as its siblings – *ManualLearning*, *GraphDatabaseManager*, *OntologyClassifier*, *CodeKnowledgeGraphConstructor* and *PersistenceAgent* – and it relies heavily on the **GraphDatabaseAdapter** located at  

```
storage/graph-database-adapter.ts
```  

for all persistence operations.  The extraction pipeline is described in a declarative DAG file  

```
batch-analysis.yaml
```  

which defines the ordered steps that feed into the **CodeKnowledgeGraphConstructor** (AST‑based graph building) and the **OntologyClassifier** (entity classification).  Once entities are produced, the **PersistenceAgent** (implemented in  

```
integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts
```  

) maps them into shared memory and pre‑populates ontology metadata fields, avoiding redundant LLM re‑classification.  Concurrency is driven by a **work‑stealing** scheduler that lets idle workers immediately pull pending tasks, while the **dynamic import** logic inside *GraphDatabaseAdapter* sidesteps TypeScript compilation constraints and keeps the module graph loosely coupled.

---

## Architecture and Design  

### High‑level architectural stance  

OnlineLearning follows a **modular, data‑centric** architecture anchored on a **graph‑based persistence layer** (Graphology + LevelDB).  The component does not introduce a new micro‑service boundary; instead, it composes existing sibling services through well‑defined adapters and agents.  The parent **KnowledgeManagement** component provides a **lock‑free, shared‑atomic index** strategy that is re‑used by OnlineLearning’s work‑stealing scheduler to guarantee contention‑free access to LevelDB files.

### Design patterns observed  

| Pattern | Where it appears | Why it is used |
|---------|------------------|----------------|
| **Adapter** | `storage/graph-database-adapter.ts` (GraphDatabaseAdapter) | Abstracts Graphology + LevelDB implementation behind a uniform API used by OntologyClassifier, CodeKnowledgeGraphConstructor, PersistenceAgent, and GraphDatabaseManager. |
| **Dynamic Import (Lazy Loading)** | GraphDatabaseAdapter dynamically imports `VkbApiClient` (and potentially other heavy modules) | Prevents TypeScript compile‑time circular dependencies and reduces initial bundle size, supporting a modular design. |
| **Work‑Stealing Scheduler** | Concurrency mechanism described in observations | Enables idle workers to “steal” tasks from busy queues, improving CPU utilization and reducing latency in batch analysis. |
| **DAG‑Based Pipeline** | `batch-analysis.yaml` (topological sort) | Guarantees deterministic execution order of analysis steps (e.g., AST extraction → graph construction → ontology classification). |
| **Shared Memory Mapping** | `PersistenceAgent.mapEntityToSharedMemory()` | Provides fast, in‑process lookup of entities and pre‑populates ontology fields, reducing round‑trips to the graph store. |

No other high‑level patterns (e.g., event‑driven, CQRS) are mentioned, so they are omitted.

### Component interaction  

1. **Batch driver** reads `batch-analysis.yaml`, performs a topological sort, and dispatches tasks to the work‑stealing pool.  
2. **CodeKnowledgeGraphConstructor** consumes source code, walks the AST, and produces a knowledge graph that it hands off to **GraphDatabaseAdapter** for persistence.  
3. **OntologyClassifier** receives raw extracted entities, classifies them against the ontology system, and also stores the results via **GraphDatabaseAdapter**.  
4. **PersistenceAgent** acts as the bridge to shared memory: after each store operation, it calls `mapEntityToSharedMemory()` to cache the entity and fill fields such as `entityType` and `metadata.ontologyClass`.  
5. All persistence calls funnel through **GraphDatabaseAdapter**, which automatically synchronises a JSON export of the LevelDB store, ensuring a human‑readable backup and downstream consumption.

The parent **KnowledgeManagement** component supplies the lock‑free index counters that both the work‑stealing scheduler and the LevelDB adapters share, eliminating file‑level lock conflicts across the entire knowledge‑processing pipeline.

---

## Implementation Details  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  

* **Dynamic import** – The adapter lazily loads heavyweight clients (e.g., `VkbApiClient`) only when a store or retrieve operation is invoked. This avoids TypeScript circular‑dependency errors and keeps the build graph lightweight.  
* **Graphology + LevelDB** – Internally the adapter creates a Graphology instance whose underlying storage driver is LevelDB. All mutations are wrapped in transactions that trigger an **automatic JSON export** after each commit, guaranteeing that the persisted graph can be inspected or versioned outside the binary store.  

### PersistenceAgent (`integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`)  

* **`mapEntityToSharedMemory(entity)`** – Receives a fully‑qualified entity object, writes it into a process‑wide shared memory map, and pre‑populates ontology metadata fields (`entityType`, `metadata.ontologyClass`). This reduces the need for downstream LLM calls that would otherwise re‑classify the same entity.  
* **Lock‑free indexing** – The agent uses the atomic counters defined in the parent KnowledgeManagement component to generate unique IDs without acquiring OS‑level file locks, aligning with the lock‑free design of the overall system.  

### Batch Analysis DAG (`batch-analysis.yaml`)  

* The YAML file enumerates steps such as `extract-ast`, `construct-graph`, `classify-ontology`, and `persist-entity`.  
* A **topological sort** algorithm determines execution order, ensuring that downstream steps only run after their dependencies have completed. The sorted list is fed to the work‑stealing pool, which distributes work across available threads.  

### Work‑Stealing Concurrency  

* Workers maintain local deques of tasks. When a worker’s deque empties, it **steals** a task from the tail of another worker’s deque, minimizing idle time.  
* Because the underlying LevelDB store is accessed through the lock‑free GraphDatabaseAdapter, concurrent reads/writes do not cause file‑level contention, a design decision inherited from the parent KnowledgeManagement component.  

### CodeKnowledgeGraphConstructor  

* Performs an **AST‑based analysis** of source repositories, generating nodes (functions, classes, variables) and edges (calls, imports, inheritance).  
* Calls `GraphDatabaseAdapter.saveGraph(graph)` to persist the constructed graph.  

### OntologyClassifier  

* Consumes raw entities, runs them through an ontology mapping service, and enriches them with relationship metadata.  
* Persists the classified entities using the same GraphDatabaseAdapter, guaranteeing a single source of truth for all graph data.  

---

## Integration Points  

1. **Parent – KnowledgeManagement**  
   * Provides the lock‑free atomic index counters used by both **PersistenceAgent** and the work‑stealing scheduler.  
   * Enforces the shared JSON export convention for LevelDB stores, a contract that OnlineLearning respects via GraphDatabaseAdapter.  

2. **Sibling Components**  
   * **ManualLearning** – Shares the same `PersistenceAgent.mapEntityToSharedMemory()` implementation to pre‑populate ontology fields, ensuring consistent metadata across manual and automated pipelines.  
   * **GraphDatabaseManager** – Wraps the same GraphDatabaseAdapter, exposing higher‑level CRUD APIs that OnlineLearning can call directly or via the adapter.  
   * **OntologyClassifier** and **CodeKnowledgeGraphConstructor** – Both rely on GraphDatabaseAdapter for persistence, meaning any change to the adapter (e.g., swapping LevelDB for RocksDB) would affect all siblings uniformly.  

3. **External Services**  
   * The dynamic import of `VkbApiClient` suggests a remote API used for additional knowledge enrichment; this client is only loaded when needed, keeping the core OnlineLearning module decoupled from network concerns until runtime.  

4. **Data Export / Import**  
   * The automatic JSON export sync performed by GraphDatabaseAdapter creates a consumable artifact that downstream analytics or reporting tools can ingest without needing direct LevelDB access.  

---

## Usage Guidelines  

* **Prefer the high‑level adapter** – All persistence interactions should go through `GraphDatabaseAdapter`. Direct LevelDB manipulation bypasses the JSON export sync and can corrupt the shared state.  
* **Leverage the DAG definition** – When extending the batch pipeline, add new steps to `batch-analysis.yaml` and declare explicit dependencies; the topological sorter will automatically place them in the correct execution order.  
* **Do not manually instantiate `VkbApiClient`** – Rely on the adapter’s dynamic import mechanism; manual imports re‑introduce the TypeScript circular‑dependency problems the design deliberately avoids.  
* **Respect the work‑stealing contract** – Tasks submitted to the scheduler must be idempotent or have built‑in retry logic, because a stolen task may be re‑executed if a worker crashes after pulling it.  
* **Cache through PersistenceAgent** – After persisting an entity, always call `PersistenceAgent.mapEntityToSharedMemory(entity)` to ensure the shared memory cache stays in sync and to avoid redundant ontology classification.  
* **Avoid holding long‑lived locks** – The lock‑free design assumes that no component acquires OS‑level file locks on the LevelDB store; any such lock will break the concurrency guarantees of the work‑stealing pool.  

---

### Summary of Architectural Insights  

1. **Architectural patterns identified** – Adapter, Dynamic Import (Lazy Loading), Work‑Stealing Scheduler, DAG‑Based Pipeline, Shared Memory Mapping.  
2. **Design decisions and trade‑offs** –  
   * *Lock‑free indexing* trades the simplicity of a global mutex for higher concurrency, at the cost of requiring careful atomic counter management.  
   * *Dynamic imports* reduce compile‑time coupling but add a small runtime overhead the first time a module is loaded.  
   * *Work‑stealing* maximises CPU utilization but demands idempotent task design.  
3. **System structure insights** – OnlineLearning is a tightly‑coupled set of pipelines that share a single graph persistence layer (GraphDatabaseAdapter) and a shared‑memory cache (PersistenceAgent). All siblings converge on the same storage contract, ensuring data consistency across manual and automated learning flows.  
4. **Scalability considerations** – The lock‑free, work‑stealing architecture scales horizontally across CPU cores without LevelDB lock contention. Automatic JSON export provides a low‑cost way to shard or snapshot data for downstream scaling. However, LevelDB’s single‑process write model may become a bottleneck if the write volume exceeds what a single process can handle; future scaling could involve sharding the graph across multiple adapters.  
5. **Maintainability assessment** – By centralising persistence in GraphDatabaseAdapter and re‑using PersistenceAgent’s mapping logic, the codebase avoids duplication and eases future refactors (e.g., swapping the underlying graph store). The explicit DAG file makes pipeline changes visible and versionable. The main maintenance risk lies in the dynamic import paths; any rename of imported modules must be reflected in the adapter’s import strings, otherwise runtime failures will occur. Overall, the design promotes clear separation of concerns and a high degree of reuse, supporting long‑term maintainability.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component employs a lock-free architecture to prevent LevelDB lock conflicts, as seen in the use of shared atomic index counters in the work-stealing concurrency mechanism. This design decision is crucial in ensuring efficient and scalable processing of large datasets, and is implemented in the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts). The GraphDatabaseAdapter (storage/graph-database-adapter.ts) also plays a key role in this architecture, providing Graphology+LevelDB persistence with automatic JSON export sync. Furthermore, the dynamic import mechanism used in the GraphDatabaseAdapter, such as the import of VkbApiClient, helps to avoid TypeScript compilation issues and ensures a modular design pattern.

### Siblings
- [ManualLearning](./ManualLearning.md) -- PersistenceAgent.mapEntityToSharedMemory() pre-populates ontology metadata fields (entityType, metadata.ontologyClass) to prevent redundant LLM re-classification
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter to provide Graphology+LevelDB persistence with automatic JSON export sync
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseAdapter to store and retrieve classified entities, utilizing Graphology+LevelDB persistence with automatic JSON export sync
- [CodeKnowledgeGraphConstructor](./CodeKnowledgeGraphConstructor.md) -- CodeKnowledgeGraphConstructor uses the GraphDatabaseAdapter to store and retrieve constructed knowledge graphs, utilizing Graphology+LevelDB persistence with automatic JSON export sync
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent uses the GraphDatabaseAdapter to store and retrieve entities, utilizing Graphology+LevelDB persistence with automatic JSON export sync


---

*Generated from 7 observations*

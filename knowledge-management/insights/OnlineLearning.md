# OnlineLearning

**Type:** SubComponent

OnlineLearning stores automatically extracted knowledge entities in the graph database using the GraphDatabaseAdapter, allowing for efficient retrieval and querying of automatic knowledge

## What It Is  

**OnlineLearning** is the automatic‑knowledge‑extraction sub‑component of the **KnowledgeManagement** domain. Its implementation lives primarily in the batch‑analysis pipeline that pulls data from three sources – the Git repository history, LSL (Learning‑Session‑Log) recordings, and static code analysis results. The extracted artefacts are transformed into *knowledge entities* and persisted in the graph store via the **GraphDatabaseAdapter** located at `storage/graph-database-adapter.ts`.  

The sub‑component also relies on a small supporting ecosystem:  
* **EntityPersistenceManager** – orchestrates the write‑through of the newly created entities into the graph database.  
* **DataLossTracker** – monitors the extraction run for missing or incomplete data, flagging bottlenecks that could affect downstream queries.  
* A **factory‑based LLM creator** (the same factory used by the Wave agents) supplies a large‑language‑model instance only when the pipeline actually needs it, following the `constructor(repoPath, team) → ensureLLMInitialized() → execute(input)` lazy‑initialisation contract.  

Together these pieces give OnlineLearning the ability to “learn” from a codebase without any manual authoring, feeding the broader KnowledgeManagement graph with up‑to‑date, automatically derived knowledge.

---

## Architecture and Design  

### High‑level architectural style  
OnlineLearning follows a **pipeline‑oriented batch processing** architecture. The pipeline is triggered periodically (or on demand) and runs a series of extraction stages – Git history parsing, LSL session mining, and code‑analysis scanning – each feeding its output downstream. This design keeps the extraction work isolated from real‑time user interactions, allowing the system to scale the heavy‑weight analysis independently of the online services that query the knowledge graph.

### Core design patterns  

| Pattern | Where it appears | Purpose |
|---------|------------------|---------|
| **Factory pattern** | LLM creation in the Wave agents (and inherited by OnlineLearning) | Centralises the construction of potentially expensive LLM objects, enabling configuration (model selection, credentials) to be managed in one place. |
| **Lazy initialization** | `constructor(repoPath, team) → ensureLLMInitialized() → execute(input)` pattern | Defers the costly LLM startup until the first execution, reducing startup latency and resource consumption for batch runs that may not need the model. |
| **Adapter pattern** | `storage/graph-database-adapter.ts` (GraphDatabaseAdapter) | Provides a uniform interface for persisting and retrieving knowledge entities regardless of the underlying graph store (Graphology + LevelDB). |
| **Manager/Coordinator** | `EntityPersistenceManager` | Encapsulates the persistence workflow, isolating the pipeline from direct storage calls and making it easy to swap persistence strategies. |
| **Tracker/Observer** | `DataLossTracker` | Observes the extraction flow, records missing data events, and surfaces them for diagnostics – a lightweight monitoring pattern. |

### Component interaction  

1. **Batch Pipeline** creates a *run context* containing `repoPath` and `team`.  
2. The pipeline **ensures the LLM** is instantiated via the shared factory (`ensureLLMInitialized`).  
3. Extraction stages emit **raw knowledge artefacts** (e.g., commit‑level insights, session‑level patterns).  
4. These artefacts are handed to **EntityPersistenceManager**, which translates them into graph‑entity objects.  
5. Persistence manager delegates the actual storage to **GraphDatabaseAdapter**, which writes to the Graphology‑LevelDB backend.  
6. Throughout the run, **DataLossTracker** records any gaps (e.g., missing LSL files, unparsable commits) and persists its diagnostics via the same adapter.  

The sibling components – **ManualLearning**, **KnowledgeGraphQueryEngine**, **DataLossTracker**, and **EntityPersistenceManager** – all share the same adapter, ensuring a consistent storage contract across the KnowledgeManagement suite.

---

## Implementation Details  

### Batch analysis pipeline  
While the exact file names are not listed, the observations state that the pipeline “extracts knowledge from git history, LSL sessions, and code analysis.” Each source is likely wrapped in a dedicated extractor class that reads raw data, normalises it into a common *knowledge‑entity* schema, and passes the result downstream. Because the pipeline is batch‑oriented, it can process large histories in chunks, leveraging streaming or pagination to stay memory‑efficient.

### LLM lazy‑initialisation contract  
The contract `constructor(repoPath, team) + ensureLLMInitialized() + execute(input)` mirrors the Wave agents’ design. The constructor stores configuration, `ensureLLMInitialized` checks an internal flag and, if needed, calls the **LLM factory** to create the model instance (potentially loading model weights, establishing API connections, etc.). `execute` then receives the extracted artefacts (or a prompt built from them) and returns LLM‑generated insights that are later persisted.

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
This adapter abstracts the underlying **Graphology + LevelDB** persistence layer. It likely exposes methods such as `saveEntity(entity)`, `getEntityById(id)`, and `query(filter)`. By keeping all storage calls behind this adapter, OnlineLearning (and its siblings) can evolve the storage backend without touching extraction logic.

### EntityPersistenceManager  
Acts as a façade over the adapter. It receives domain‑level entities, possibly validates them against a schema, enriches them with timestamps or provenance metadata (repoPath, team, extraction run ID), and then invokes the adapter’s `saveEntity`. This separation means the batch pipeline does not need to know about transaction handling or batch writes; the manager can batch‑commit for performance.

### DataLossTracker  
Integrated into the pipeline, it records events such as “missing LSL file for session X” or “commit Y could not be parsed”. The tracker stores its logs via the same GraphDatabaseAdapter, allowing analysts to query loss patterns through the **KnowledgeGraphQueryEngine**. This design provides observability without adding a separate logging system.

---

## Integration Points  

| Integration | Direction | Interface / Path |
|-------------|-----------|------------------|
| **KnowledgeManagement (parent)** | OnlineLearning contributes automatically extracted entities to the overall knowledge graph managed by KnowledgeManagement. | Uses the same `GraphDatabaseAdapter` and shares the LLM factory configuration. |
| **EntityPersistenceManager (sibling)** | OnlineLearning delegates all persistence responsibilities to this manager. | Calls `EntityPersistenceManager.persist(entity)` (exact method name inferred). |
| **DataLossTracker (sibling)** | OnlineLearning reports extraction anomalies to the tracker. | Tracker API likely `trackLoss(event)`. |
| **ManualLearning (sibling)** | Both write to the same graph store but differ in source (automatic vs manual). | Shared `GraphDatabaseAdapter`. |
| **KnowledgeGraphQueryEngine (sibling)** | Consumers of the entities that OnlineLearning stores. | Queries the graph via the adapter; no direct coupling required. |
| **LLM Factory (shared across Wave agents & KnowledgeManagement)** | Provides the LLM instance used during extraction. | Factory method `createLLM(config)`. |

All these integrations are file‑path agnostic except for the explicit adapter location: `storage/graph-database-adapter.ts`. The rest of the contracts are inferred from the observed patterns and are implemented as method calls on the respective classes.

---

## Usage Guidelines  

1. **Do not instantiate the LLM directly.** Follow the lazy‑initialisation contract: create the OnlineLearning runner with `new OnlineLearning(repoPath, team)`, then invoke `ensureLLMInitialized()` before any `execute` call. This guarantees that the shared LLM factory is used and that resources are allocated only when needed.  

2. **Persist through EntityPersistenceManager.** When extending the pipeline with new extraction stages, hand the resulting knowledge objects to the manager rather than calling the adapter yourself. This maintains a single point for validation, metadata enrichment, and batch commit logic.  

3. **Report extraction gaps to DataLossTracker.** Any new source (e.g., a new LSL format) should emit loss events via the tracker so that the system can surface missing data without silent failures.  

4. **Keep storage interactions limited to the GraphDatabaseAdapter.** If you need to change the underlying graph database (e.g., switch from LevelDB to another KV store), modify only `storage/graph-database-adapter.ts`. All other components will remain untouched.  

5. **Batch size and resource budgeting.** Because the pipeline can be heavyweight (especially the LLM step), configure batch sizes to fit the execution environment’s memory and CPU limits. The lazy‑initialisation pattern helps keep the LLM footprint low when the pipeline runs in a “dry‑run” mode that only validates source data.  

---

### Architectural patterns identified  

* Factory pattern (LLM creation)  
* Lazy initialization (LLM startup)  
* Adapter pattern (GraphDatabaseAdapter)  
* Manager/Coordinator pattern (EntityPersistenceManager)  
* Tracker/Observer pattern (DataLossTracker)  

### Design decisions and trade‑offs  

* **Batch vs. real‑time** – Choosing a batch pipeline isolates heavy analysis but introduces latency between code changes and knowledge availability.  
* **Lazy LLM init** – Saves resources on runs that may skip the LLM step, at the cost of a small runtime check before each execution.  
* **Single storage adapter** – Centralises persistence logic, simplifying future storage swaps, but creates a single point of failure that must be robustly tested.  

### System structure insights  

OnlineLearning sits under **KnowledgeManagement**, sharing the LLM factory and storage adapter with its siblings. The sibling components each specialise (manual entry, querying, loss tracking) but converge on the same graph database, forming a cohesive knowledge‑graph ecosystem.

### Scalability considerations  

* The batch pipeline can be parallelised per source (e.g., processing Git commits in parallel shards) because each extraction stage is stateless aside from the shared LLM.  
* GraphDatabaseAdapter’s underlying LevelDB store scales horizontally with sharding; however, write contention may appear if many extraction runs overlap.  
* Lazy LLM init prevents unnecessary model loading when multiple pipeline runs are scheduled concurrently; a shared pool of LLM instances could be introduced later if throughput becomes a bottleneck.  

### Maintainability assessment  

* **High modularity** – Clear separation between extraction, persistence, and observability makes the codebase easy to navigate.  
* **Adapter‑centric storage** – Changes to the persistence layer require only edits in a single file.  
* **Consistent patterns** – Reusing the Wave‑agent LLM factory and lazy‑init contract reduces duplicated logic across the KnowledgeManagement domain.  
* **Potential fragility** – The reliance on a single GraphDatabaseAdapter means that any regression in that file propagates to all siblings; comprehensive unit and integration tests around the adapter are essential.  

Overall, OnlineLearning is a well‑structured batch component that leverages proven patterns (factory, lazy init, adapter) to automatically enrich the knowledge graph while keeping resource usage and code coupling under control.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a factory pattern for creating LLM instances, as seen in the Wave agents, which follow the constructor(repoPath, team) + ensureLLMInitialized() + execute(input) pattern for lazy LLM initialization. This pattern allows for efficient initialization of LLM instances only when required, reducing unnecessary resource allocation. The ensureLLMInitialized() method, likely defined in the Wave agent classes, ensures that the LLM instance is properly initialized before execution. This approach enables the component to manage resources effectively and optimize performance. The GraphDatabaseAdapter, employed for Graphology+LevelDB persistence, also plays a crucial role in storing and retrieving knowledge graph data, as defined in storage/graph-database-adapter.ts.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve manual knowledge entities
- [EntityPersistenceManager](./EntityPersistenceManager.md) -- EntityPersistenceManager utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve entities in the graph database
- [DataLossTracker](./DataLossTracker.md) -- DataLossTracker utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve data loss information
- [KnowledgeGraphQueryEngine](./KnowledgeGraphQueryEngine.md) -- KnowledgeGraphQueryEngine utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to query and retrieve knowledge entities from the graph database


---

*Generated from 7 observations*

# OnlineLearning

**Type:** SubComponent

OnlineLearning could leverage the 'getGraph' function from the GraphDatabaseAdapter to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.

## What It Is  

**OnlineLearning** is a *SubComponent* of the **KnowledgeManagement** domain that drives the automatic extraction, enrichment, and persistence of learning‑related knowledge. The core of its implementation lives in the **BatchAnalysisPipeline** (a child component) and relies heavily on the **GraphDatabaseAdapter** found at `storage/graph-database-adapter.ts`. Through this adapter the sub‑component can obtain a Graphology‑backed graph backed by LevelDB (`getGraph`) and later commit newly discovered entities (`saveGraph`). The pipeline pulls raw signals from three distinct sources – Git history, LSL (Learning Session Language) sessions, and static code analysis – and transforms them into graph‑structured knowledge that is stored in the central knowledge graph shared across the system.

## Architecture and Design  

The architecture around **OnlineLearning** follows a *modular, data‑centric* style where each concern (analysis, persistence, graph access) is isolated in its own module. The **BatchAnalysisPipeline** acts as the orchestrator for data‑ingestion, while the **GraphDatabaseModule** supplies a type‑safe façade over the low‑level `GraphDatabaseAdapter`. This separation yields a clear *Adapter* pattern: `GraphDatabaseAdapter` abstracts the dual‑source nature of the graph (remote VKB API vs. local LevelDB) and presents a uniform API (`getGraph`, `saveGraph`).  

Interaction is largely *pull‑based*: OnlineLearning invokes `getGraph` to read the current state, enriches it with entities derived from the batch analysis, and finally calls `saveGraph` to write back. The adapter’s “intelligent routing mechanism” decides at runtime which storage backend to address, enabling seamless switching between cloud (VKB API) and edge (LevelDB) deployments without code changes. The sibling components **ManualLearning**, **EntityPersistenceModule**, and **PersistenceAgent** share the same adapter, reinforcing a *single source of truth* for graph persistence across the whole KnowledgeManagement suite.

## Implementation Details  

The pivotal class lives in `storage/graph-database-adapter.ts`. Its public surface includes:

* **`getGraph()`** – Returns a Graphology instance. Internally the method checks a configuration flag; if the system is operating in “online” mode it opens a remote VKB API stream, otherwise it loads the LevelDB store from the local filesystem. This duality eliminates duplicated loading logic elsewhere.  

* **`saveGraph(graph)`** – Accepts a mutated Graphology graph and serialises it to LevelDB. After the local write completes, the adapter triggers a synchronisation routine that pushes a JSON export to the VKB API, guaranteeing eventual consistency between edge and cloud stores.  

The **BatchAnalysisPipeline** (child of OnlineLearning) is responsible for three extraction stages:

1. **Git history mining** – parses commit metadata, file change graphs, and author‑contribution patterns.  
2. **LSL session parsing** – consumes session logs, extracts learner actions, and maps them to domain concepts.  
3. **Static code analysis** – runs language‑specific parsers to discover APIs, modules, and dependency graphs.  

Each stage produces a collection of *entities* (nodes) and *relationships* (edges) that are fed into the graph returned by `getGraph`. OnlineLearning may implement a custom integration layer that translates raw extraction results into the schema expected by the central graph (e.g., adding `learningSession`, `codeArtifact`, `gitCommit` node types). Once the graph is enriched, `saveGraph` persists the changes, and the **EntityPersistenceModule** can optionally be invoked to handle any auxiliary bookkeeping (e.g., indexing, version stamping).

## Integration Points  

* **Parent – KnowledgeManagement** – OnlineLearning is a child of the KnowledgeManagement component, which owns the shared `GraphDatabaseAdapter`. All knowledge‑graph interactions flow through this parent‑provided adapter, ensuring that OnlineLearning’s outputs are immediately visible to other knowledge‑centric services.  

* **Siblings** –  
  * **ManualLearning** uses the same `saveGraph` call to persist hand‑crafted entities, meaning that both manual and automatic knowledge converge in the same graph.  
  * **GraphDatabaseModule** consumes `getGraph` to expose a type‑safe API to any consumer, including OnlineLearning itself.  
  * **EntityPersistenceModule** and **PersistenceAgent** also rely on `saveGraph` for low‑level write‑through, allowing OnlineLearning to delegate ancillary persistence concerns (e.g., backup, replication) without re‑implementing them.  

* **Child – BatchAnalysisPipeline** – The pipeline is the only place where raw data sources are touched. It is deliberately isolated so that changes to extraction logic (e.g., adding a new source like CI/CD logs) do not ripple into the persistence layer.  

* **External – VKB API** – When configured for cloud operation, the adapter forwards the JSON export of the graph to the VKB API, enabling downstream services (search, recommendation) to consume the enriched knowledge without direct database access.

## Usage Guidelines  

1. **Always obtain the graph via `GraphDatabaseAdapter.getGraph()`** before performing any mutation. Directly instantiating a Graphology graph bypasses the routing logic and can lead to divergent state between the local LevelDB and the VKB API.  

2. **Batch analysis should be treated as an idempotent operation.** The pipeline may be re‑run on the same data set; therefore, entity creation logic must be deterministic (e.g., using stable IDs derived from source hashes) to avoid duplicate nodes.  

3. **Persist changes with `GraphDatabaseAdapter.saveGraph()`** as the final step. Do not attempt manual LevelDB writes; the adapter’s synchronisation hook guarantees that the VKB API receives the latest export.  

4. **Leverage the type‑safe façade in `GraphDatabaseModule`** when consuming graph data elsewhere. This reduces the risk of schema drift because the module validates node/edge types against TypeScript interfaces.  

5. **Configuration awareness:** The system’s behaviour (remote vs. local) is driven by a runtime configuration flag (often an environment variable). Developers should verify the flag before debugging persistence issues, as the underlying storage may differ.  

6. **Extending the pipeline:** When adding new extraction sources, encapsulate the logic in a separate function within the BatchAnalysisPipeline and ensure it emits entities that conform to the existing graph schema. This keeps the integration surface stable for sibling modules.  

---

### 1. Architectural Patterns Identified  
* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the dual‑backend (VKB API / LevelDB) behind a uniform interface.  
* **Facade/Type‑Safe Wrapper** – `GraphDatabaseModule` provides a strongly‑typed façade over the adapter, shielding consumers from low‑level details.  
* **Modular Pipeline** – The **BatchAnalysisPipeline** isolates data‑ingestion concerns, following a classic *pipeline* pattern.  
* **Single Source of Truth** – All knowledge persists in a single graph instance shared across siblings, reinforcing consistency.

### 2. Design Decisions and Trade‑offs  
* **Dual Persistence (cloud + edge)** – Offers high availability and offline capability but adds complexity in synchronisation logic. The trade‑off is mitigated by the adapter’s routing and automatic JSON export.  
* **Centralised Graph vs. Distributed Stores** – Using a single Graphology + LevelDB graph simplifies queries and reasoning but may become a bottleneck at massive scale; the VKB API can off‑load read‑heavy workloads.  
* **Batch‑Oriented Extraction** – Guarantees comprehensive analysis but introduces latency; real‑time learning would require a separate streaming path, which is intentionally omitted to keep the batch pipeline simple and deterministic.

### 3. System Structure Insights  
The system is organised hierarchically: **KnowledgeManagement** (root) → **OnlineLearning** (sub‑component) → **BatchAnalysisPipeline** (child). Sibling components share the same persistence backbone, ensuring that manual, automated, and agent‑driven knowledge converge in one graph. The clear separation of concerns (analysis, graph access, persistence) yields a clean, maintainable module map.

### 4. Scalability Considerations  
* **Read scalability** is achieved by routing read requests (`getGraph`) to the VKB API when available, allowing the cloud service to cache or shard the graph.  
* **Write scalability** hinges on the batch nature of the pipeline; large ingestion jobs can be sharded across multiple pipeline instances, each writing to its own LevelDB slice before a coordinated `saveGraph` sync.  
* **Synchronization overhead** grows with graph size; the JSON export mechanism should be monitored for payload size, and future optimisation could involve delta‑based sync instead of full dumps.

### 5. Maintainability Assessment  
The architecture’s strong modular boundaries make it highly maintainable. The adapter isolates storage concerns, the module façade enforces type safety, and the pipeline encapsulates extraction logic. Because all persistence paths funnel through a single well‑documented adapter, changes to storage (e.g., swapping LevelDB for RocksDB) affect only `storage/graph-database-adapter.ts`. However, the reliance on a full‑graph JSON export for synchronization could become a maintenance hotspot as the graph grows; introducing incremental sync would improve long‑term maintainability. Overall, the design balances clarity with flexibility, supporting straightforward extensions while keeping the core knowledge graph consistent across the KnowledgeManagement ecosystem.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.

### Children
- [BatchAnalysisPipeline](./BatchAnalysisPipeline.md) -- The OnlineLearning sub-component uses the batch analysis pipeline to extract relevant knowledge from various sources.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may use the GraphDatabaseAdapter's 'saveGraph' function to persist manually created entities to the local LevelDB storage and synchronize it with the VKB API.
- [GraphDatabaseModule](./GraphDatabaseModule.md) -- GraphDatabaseModule uses the GraphDatabaseAdapter's 'getGraph' function to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.
- [EntityPersistenceModule](./EntityPersistenceModule.md) -- EntityPersistenceModule uses the GraphDatabaseAdapter's 'saveGraph' function to persist entities to the local LevelDB storage and synchronize it with the VKB API.
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent uses the GraphDatabaseAdapter's 'saveGraph' function to persist data to the local LevelDB storage and synchronize it with the VKB API.


---

*Generated from 7 observations*

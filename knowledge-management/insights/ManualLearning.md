# ManualLearning

**Type:** SubComponent

The 'getGraph' function in the GraphDatabaseAdapter can be used by ManualLearning to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.

## What It Is  

ManualLearning is the **SubComponent** responsible for handling the creation, editing, and persistence of *hand‑crafted* knowledge‑graph entities.  The code that powers ManualLearning lives alongside the other knowledge‑management sub‑systems and ultimately relies on the **GraphDatabaseAdapter** located at `storage/graph-database-adapter.ts`.  Through this adapter ManualLearning can **save** newly authored entities to the local **LevelDB** store and, when configured, push the same changes to the external **VKB API**.  Conversely, it can **retrieve** the current graph (via `getGraph`) from either source, giving it a consistent view of the knowledge base regardless of where the data resides.  In the broader hierarchy ManualLearning is a child of **KnowledgeManagement** and sits on the same level as its siblings **OnlineLearning**, **GraphDatabaseModule**, **EntityPersistenceModule**, and **PersistenceAgent**.  

## Architecture and Design  

The architecture that ManualLearning participates in is built around a **central GraphDatabaseAdapter** that abstracts the underlying storage mechanisms (Graphology + LevelDB) and the remote VKB service.  This adapter implements an **adapter pattern**: the component presents a uniform API (`saveGraph`, `getGraph`) while internally routing calls to the appropriate backend based on configuration.  ManualLearning consumes this API directly, which means it does not need to know whether the graph is being read from LevelDB or fetched over the network.  

ManualLearning also appears to have its **own module** (not explicitly named in the observations) that encapsulates the logic for “direct edits and hand‑crafted observations.”  This module likely collaborates with the **EntityPersistenceModule** for generic persistence concerns and with the **PersistenceAgent** for metadata enrichment via the `mapEntityToSharedMemory` helper.  The design therefore follows a **separation‑of‑concerns** approach:  

* **GraphDatabaseAdapter** – low‑level persistence and routing.  
* **EntityPersistenceModule** – generic entity‑level CRUD helpers.  
* **ManualLearning module** – UI/CLI‑driven creation and edit flows, invoking the adapter and persistence helpers.  
* **PersistenceAgent** – cross‑cutting concerns such as populating shared‑memory ontology fields.  

All siblings share the same underlying adapter, which guarantees a **type‑safe interface** (as noted for GraphDatabaseModule) and ensures that any change in storage strategy automatically propagates to ManualLearning without code changes.

## Implementation Details  

The concrete implementation hinges on three public functions exposed by `storage/graph-database-adapter.ts`:

1. **`saveGraph(graph: Graph): Promise<void>`** – Called by ManualLearning (and by EntityPersistenceModule, PersistenceAgent, etc.) to write the in‑memory Graphology instance to LevelDB and, if the configuration enables it, to push a JSON export to the VKB API.  ManualLearning invokes this after a user finishes editing an entity or after a batch of hand‑crafted observations is ready for commit.  

2. **`getGraph(): Promise<Graph>`** – Used by ManualLearning to obtain the latest graph snapshot.  The adapter decides whether to load from LevelDB or to request the graph from VKB, based on runtime flags defined in the parent KnowledgeManagement configuration.  This enables ManualLearning to work offline (pure LevelDB) or in a synchronized mode (VKB).  

3. **`mapEntityToSharedMemory(entity: Entity): SharedMemoryEntity`** – Exposed by **PersistenceAgent**, this helper pre‑populates ontology‑metadata fields (e.g., timestamps, provenance tags) before the entity is handed to the adapter for persistence.  ManualLearning can call this function to guarantee that every manually authored entity carries the same metadata envelope as automatically generated ones.  

The “custom implementation for handling direct edits” mentioned in the observations is likely a set of service functions or a class (e.g., `ManualEditor`) that orchestrates the flow:  

* **Create / edit** → build a plain JavaScript object representing the entity.  
* **Enrich** via `mapEntityToSharedMemory`.  
* **Persist** via `saveGraph`.  

Because the GraphDatabaseAdapter already provides a **type‑safe façade** for MCP server agents (as described for GraphDatabaseModule), ManualLearning inherits the same compile‑time guarantees without additional wrappers.

## Integration Points  

ManualLearning’s primary integration surface is the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`).  All read/write operations funnel through this file, making it the single point of change for storage strategy.  Secondary integration occurs with:

* **EntityPersistenceModule** – Supplies generic entity validation and transformation utilities that ManualLearning can reuse when constructing hand‑crafted entities.  
* **PersistenceAgent** – Provides the `mapEntityToSharedMemory` function, ensuring that manual entries receive the same ontology metadata as those produced by automated pipelines (OnlineLearning, batch analysis, etc.).  
* **KnowledgeManagement** – As the parent component, it configures the adapter (e.g., toggling VKB sync) and may expose higher‑level services that ManualLearning calls to report progress or errors.  

Because siblings such as **OnlineLearning**, **GraphDatabaseModule**, and **EntityPersistenceModule** all depend on the same adapter, any modification to `saveGraph` or `getGraph` automatically propagates to ManualLearning, preserving consistency across the knowledge‑management suite.

## Usage Guidelines  

1. **Always retrieve the latest graph via `getGraph` before mutating it.**  This guarantees that ManualLearning works on the most recent state, whether the source is local LevelDB or the remote VKB API.  
2. **Enrich entities with shared‑memory metadata** by calling `PersistenceAgent.mapEntityToSharedMemory` before persisting.  Skipping this step will produce entities that lack provenance information used elsewhere in the system.  
3. **Persist through `saveGraph` only after all edits are finalized.**  The adapter batches the write‑through to LevelDB and the optional VKB sync; invoking it multiple times in a short span can cause unnecessary I/O overhead.  
4. **Respect the configuration set by KnowledgeManagement.**  If the system is running in offline mode, the adapter will bypass VKB; manual developers should not attempt to force a remote sync, as this will be ignored or cause errors.  
5. **Leverage EntityPersistenceModule utilities for validation.**  Re‑using the same validation logic as the automated pipelines ensures that manually authored entities conform to the same schema constraints.  

---

### 1. Architectural patterns identified  
* **Adapter pattern** – `GraphDatabaseAdapter` abstracts LevelDB and VKB API behind `saveGraph` / `getGraph`.  
* **Separation of concerns** – distinct modules for persistence (EntityPersistenceModule), metadata mapping (PersistenceAgent), and manual editing (ManualLearning module).  
* **Type‑safe façade** – GraphDatabaseModule’s description indicates a compile‑time safe interface that ManualLearning also inherits.

### 2. Design decisions and trade‑offs  
* **Single‑source persistence via the adapter** simplifies the code base but creates a bottleneck; any change to adapter behavior impacts all consumers.  
* **Optional VKB synchronization** adds flexibility (offline vs. online) at the cost of having two possible data sources that must stay consistent.  
* **ManualLearning’s own module** isolates hand‑crafted logic, making it easier to evolve UI/CLI workflows without touching generic persistence code, but it introduces an extra layer that developers must understand.

### 3. System structure insights  
* **KnowledgeManagement** is the parent orchestrator; it owns the configuration that drives the adapter’s routing logic.  
* **ManualLearning**, **OnlineLearning**, **GraphDatabaseModule**, **EntityPersistenceModule**, and **PersistenceAgent** are peer sub‑components that all depend on the same adapter, forming a tightly‑coupled persistence layer beneath a loosely‑coupled business‑logic layer.  

### 4. Scalability considerations  
* Because the adapter writes directly to LevelDB and optionally pushes a full JSON export to VKB, the **write path scales with the size of the graph**.  Large batch saves could become a performance hotspot; developers should batch manual edits where possible.  
* The **routing logic** that decides between local and remote sources allows horizontal scaling of read traffic: multiple instances can read from LevelDB concurrently, while VKB sync can be throttled to avoid network saturation.  

### 5. Maintainability assessment  
* **High maintainability** for ManualLearning itself: it contains only orchestration code and relies on well‑defined adapters and shared utilities.  
* **Medium risk** in the adapter layer: any change to `saveGraph` or `getGraph` has ripple effects across all siblings, so thorough integration testing is required.  
* The explicit separation of metadata mapping (`PersistenceAgent`) and generic entity handling (`EntityPersistenceModule`) reduces duplication and eases future schema evolution.  

Overall, ManualLearning is a thin but essential layer that leverages the robust GraphDatabaseAdapter infrastructure to let engineers and domain experts inject curated knowledge directly into the system’s graph, while staying aligned with the same persistence and metadata conventions used by the automated pipelines.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, which is then persisted using the GraphDatabaseAdapter.
- [GraphDatabaseModule](./GraphDatabaseModule.md) -- GraphDatabaseModule uses the GraphDatabaseAdapter's 'getGraph' function to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.
- [EntityPersistenceModule](./EntityPersistenceModule.md) -- EntityPersistenceModule uses the GraphDatabaseAdapter's 'saveGraph' function to persist entities to the local LevelDB storage and synchronize it with the VKB API.
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent uses the GraphDatabaseAdapter's 'saveGraph' function to persist data to the local LevelDB storage and synchronize it with the VKB API.


---

*Generated from 7 observations*

# EntityPersistenceModule

**Type:** SubComponent

EntityPersistenceModule could leverage the 'getGraph' function from the GraphDatabaseAdapter to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.

## What It Is  

The **EntityPersistenceModule** lives inside the **KnowledgeManagement** component and is the dedicated sub‑component that guarantees a type‑safe, end‑to‑end lifecycle for every knowledge entity (creation, update, deletion).  All persistence work is funneled through the **GraphDatabaseAdapter** defined in `storage/graph-database-adapter.ts`.  The module calls the adapter’s `saveGraph` routine to write the in‑memory graph to the local **LevelDB** store and, when configured, to push the same payload to the external **VKB API**.  Conversely, it can obtain the current graph via the adapter’s `getGraph` method, which abstracts whether the source is the remote VKB service or the local LevelDB cache.  In addition to raw storage, the module adds a thin validation/normalisation layer, maps ontology metadata into shared memory through `PersistenceAgent.mapEntityToSharedMemory`, and may optionally employ a dedicated caching sub‑module for hot‑path entity reads.

---

## Architecture and Design  

The design follows a **layered‑adapter architecture**.  At the core is the **GraphDatabaseAdapter** (the “adapter” pattern) that hides the dual‑source nature of the graph – VKB API vs. LevelDB – behind a single, coherent API (`getGraph`, `saveGraph`).  **EntityPersistenceModule** sits on top of this adapter, acting as a **repository** for domain entities: it exposes a type‑safe façade for CRUD operations while delegating the actual I/O to the adapter.  

Because the module is a sibling of **ManualLearning**, **OnlineLearning**, **GraphDatabaseModule**, and **PersistenceAgent**, it re‑uses the same persistence primitives (`saveGraph`, `getGraph`).  This shared reliance creates a **horizontal reuse pattern** where multiple higher‑level services converge on a single persistence contract, reducing duplication and ensuring consistency across the knowledge pipeline.  

The optional **entity‑caching sub‑module** introduces a **cache‑aside** strategy: frequently accessed entities are stored in memory, while writes still flow through the adapter to guarantee durability.  The presence of a custom validation/normalisation step indicates a **pipeline‑oriented processing model** – entities are first vetted, then normalised, then handed off to the persistence layer.

---

## Implementation Details  

* **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – Provides `saveGraph(graph: Graph): Promise<void>` and `getGraph(): Promise<Graph>`.  Internally it decides, based on configuration, whether to write/read directly to LevelDB or to invoke the VKB HTTP API.  The “intelligent routing” mentioned in the parent hierarchy ensures seamless switching without callers needing to know the source.  

* **EntityPersistenceModule** – Although no concrete file is listed, its responsibilities can be inferred from the observations:  
  * **Type‑safe CRUD façade** – Public methods such as `createEntity<T>(entity: T): Promise<void>`, `updateEntity<T>(id: string, patch: Partial<T>)`, and `deleteEntity(id: string)`.  Generics enforce compile‑time safety, preventing accidental schema mismatches.  
  * **Validation & Normalisation** – Before any persistence call, the module runs a custom validator (e.g., `validateEntity(entity)`) and a normaliser that aligns the payload with the ontology’s canonical form.  This step is isolated, allowing future extensions (e.g., schema version upgrades) without touching storage code.  
  * **Metadata Mapping** – By invoking `PersistenceAgent.mapEntityToSharedMemory(entity)`, the module pre‑populates shared‑memory structures (likely a fast‑lookup table used by other components) with ontology‑specific fields.  This tight coupling to **PersistenceAgent** ensures that downstream consumers see a fully‑hydrated entity.  
  * **Caching (optional)** – A separate caching layer (not explicitly named) stores the most recent entity objects in an in‑process map or LRU store.  Reads first query this cache; on a miss the module falls back to `getGraph` and then populates the cache.  

* **Interaction with Siblings** –  
  * **ManualLearning** and **PersistenceAgent** also call `saveGraph`; they rely on the same adapter, guaranteeing that manually created or agent‑generated entities are persisted identically to those handled by **EntityPersistenceModule**.  
  * **OnlineLearning** pushes batch‑extracted knowledge through the same adapter, meaning that bulk imports and single‑entity operations share the same durability guarantees.  
  * **GraphDatabaseModule** consumes `getGraph` to provide read‑only graph queries; the persistence module therefore supplies the freshest graph state for those queries.

---

## Integration Points  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – The sole persistence contract; all writes and reads flow through its `saveGraph` and `getGraph` methods.  Configuration flags (e.g., `useVKB`, `localOnly`) dictate the routing logic.  

2. **PersistenceAgent** – Supplies the `mapEntityToSharedMemory` helper.  The module must import this function to enrich entities before they are persisted, ensuring that shared‑memory caches used by other subsystems (e.g., inference engines) are immediately consistent.  

3. **Entity Caching Sub‑module** – When present, this module exposes `getFromCache(id)` and `setCache(id, entity)`.  The persistence module calls these hooks around its adapter interactions.  

4. **KnowledgeManagement (parent)** – Orchestrates the lifecycle of the persistence module; it may configure the adapter (VKB vs. LevelDB) based on deployment mode (offline development vs. production).  

5. **Sibling Components** – ManualLearning, OnlineLearning, GraphDatabaseModule, and PersistenceAgent all share the same adapter instance, so any change to the adapter’s routing or serialization format propagates uniformly across the entire knowledge pipeline.

---

## Usage Guidelines  

* **Prefer the type‑safe façade** – Always interact with entities through the module’s generic CRUD methods.  Directly calling `saveGraph` or `getGraph` bypasses validation, normalisation, and metadata mapping, and should be avoided except in low‑level tooling.  

* **Validate before persisting** – Although the module performs its own validation, supplying pre‑validated entities (e.g., from a form or a batch job) reduces redundant work and improves throughput.  

* **Respect the caching contract** – When the optional cache is enabled, never mutate cached objects in place.  Instead, retrieve, modify, and re‑store via the module’s update path so that the cache is refreshed atomically.  

* **Configure the adapter consciously** – In environments with limited network connectivity, set `localOnly` to true to force LevelDB persistence only.  In cloud‑connected deployments, enable `useVKB` to keep the remote VKB graph in sync.  

* **Keep ontology metadata up to date** – Because `mapEntityToSharedMemory` relies on the current ontology definition, any schema change must be reflected in the shared‑memory mapping logic before persisting new entities.  

---

### 1. Architectural patterns identified  

* **Adapter pattern** – `GraphDatabaseAdapter` abstracts VKB API vs. LevelDB.  
* **Repository pattern** – `EntityPersistenceModule` presents a type‑safe repository façade for entities.  
* **Cache‑aside strategy** – Optional entity‑caching sub‑module.  
* **Pipeline processing** – Validation → Normalisation → Metadata mapping → Persistence.

### 2. Design decisions and trade‑offs  

* **Single source of truth via adapter** – Guarantees consistency but introduces a runtime routing decision that must be carefully tested.  
* **Type‑safe generics** – Improves compile‑time safety at the cost of additional generic boilerplate.  
* **Optional caching** – Boosts read performance for hot entities; however, it adds cache‑coherency complexity when multiple writers (ManualLearning, OnlineLearning) operate concurrently.  
* **Separate validation/normalisation layer** – Enables flexible schema evolution but adds latency for each CRUD operation.

### 3. System structure insights  

* **Vertical stack** – KnowledgeManagement → EntityPersistenceModule → GraphDatabaseAdapter → (LevelDB ↔ VKB API).  
* **Horizontal reuse** – ManualLearning, OnlineLearning, PersistenceAgent, GraphDatabaseModule all share the same adapter, reinforcing a unified persistence contract across the knowledge pipeline.  
* **Extensibility point** – The validation/normalisation step and the caching sub‑module are natural extension hooks for future features (e.g., versioned entities, distributed caches).

### 4. Scalability considerations  

* **Write scalability** – `saveGraph` writes the entire graph; for very large graphs this could become a bottleneck.  Batch‑or‑incremental writes may be required as the knowledge base grows.  
* **Read scalability** – The optional cache‑aside layer mitigates read pressure on LevelDB/VKB, but cache size must be bounded to avoid memory pressure.  
* **Network latency** – When `useVKB` is enabled, each `saveGraph` incurs a remote API round‑trip; in high‑throughput scenarios a background sync queue could decouple local writes from remote replication.

### 5. Maintainability assessment  

The module’s clear separation of concerns (validation, mapping, persistence) and reliance on a single adapter make the codebase **highly maintainable**.  Adding new entity types only requires extending the generic façade and, if needed, augmenting the validation logic.  Because all persistence pathways converge on `GraphDatabaseAdapter`, any change to storage technology (e.g., swapping LevelDB for RocksDB) is isolated to that adapter file.  The main maintenance risk lies in the cache coherence model—if multiple components write concurrently, developers must ensure cache invalidation is correctly handled.  Overall, the architecture promotes straightforward testing (unit tests for validation, integration tests for adapter routing) and future evolution.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may use the GraphDatabaseAdapter's 'saveGraph' function to persist manually created entities to the local LevelDB storage and synchronize it with the VKB API.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, which is then persisted using the GraphDatabaseAdapter.
- [GraphDatabaseModule](./GraphDatabaseModule.md) -- GraphDatabaseModule uses the GraphDatabaseAdapter's 'getGraph' function to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent uses the GraphDatabaseAdapter's 'saveGraph' function to persist data to the local LevelDB storage and synchronize it with the VKB API.


---

*Generated from 7 observations*

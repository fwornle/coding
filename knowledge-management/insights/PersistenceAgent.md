# PersistenceAgent

**Type:** SubComponent

PersistenceAgent could leverage the 'getGraph' function from the GraphDatabaseAdapter to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.

## What It Is  

**PersistenceAgent** is the type‑safe façade that the **KnowledgeManagement** component uses to persist and retrieve data from the underlying graph store.  All interactions with the storage layer flow through the `GraphDatabaseAdapter` that lives in `storage/graph-database-adapter.ts`.  The agent calls the adapter’s `saveGraph` method to write a graph (or a set of entities) to the local LevelDB files and then synchronises the same payload with the remote VKB API.  Conversely, it can obtain a live graph instance by invoking the adapter’s `getGraph` function, which internally decides whether to pull the data from LevelDB or from the VKB endpoint based on the current configuration.  

Beyond simple read/write, PersistenceAgent presents a **type‑safe interface** for two distinct persistence concerns: **entity persistence** (handled in cooperation with the `EntityPersistenceModule`) and **graph persistence** (directly through the adapter).  It may also embed custom validation/normalisation logic, pre‑populate ontology metadata via `mapEntityToSharedMemory`, and optionally employ a dedicated caching sub‑module for hot data.  In short, PersistenceAgent is the orchestrator that guarantees consistent, validated, and efficiently cached persistence while shielding callers from the details of LevelDB vs. VKB routing.

---

## Architecture and Design  

The observed codebase follows a **modular, adapter‑based architecture**.  The `GraphDatabaseAdapter` is the concrete implementation of a storage abstraction that knows how to talk to both LevelDB (local) and the VKB API (remote).  PersistenceAgent sits on top of this adapter, acting as a **Facade** that aggregates lower‑level services (entity handling, graph handling, validation, caching) behind a single, type‑safe API surface.  

The routing decision between VKB and LevelDB is performed inside the adapter’s `getGraph` method, an example of the **Strategy** style: the runtime configuration selects the concrete data‑source strategy without the caller needing to know which one is active.  The relationship to sibling modules (e.g., `EntityPersistenceModule`, `ManualLearning`, `OnlineLearning`) shows a **shared‑service** pattern—each sibling re‑uses the same adapter functions (`saveGraph`, `getGraph`) rather than duplicating storage logic.  This promotes consistency across the system while keeping each domain‑specific component focused on its own responsibilities.  

Because PersistenceAgent may contain its own validation/normalisation layer and a caching module, the design also reflects a **Decorator‑like** layering: raw persistence calls are wrapped with data‑quality checks and an optional in‑memory cache before reaching the adapter.  No evidence of micro‑service boundaries or event‑driven pipelines is present in the observations, so the architecture remains monolithic but well‑segregated into logical sub‑components.

---

## Implementation Details  

1. **Core Interaction with the Adapter** – PersistenceAgent invokes `saveGraph` (from `storage/graph-database-adapter.ts`) whenever it needs to persist a graph or a batch of entities.  This call writes the JSON representation to LevelDB and triggers an asynchronous synchronisation with the VKB API, guaranteeing eventual consistency between the local and remote stores.  

2. **Retrieval Logic** – To read data, PersistenceAgent calls `getGraph`.  Inside the adapter, `getGraph` inspects the current configuration (e.g., a flag indicating “offline” vs. “online”) and either opens the LevelDB instance directly or issues a request to the VKB endpoint, returning a Graphology‑compatible graph object to the caller.  

3. **Entity‑Level Support** – When entity‑specific persistence is required, PersistenceAgent delegates to the `EntityPersistenceModule`.  That module, in turn, also uses `saveGraph` for its low‑level writes, ensuring that both entity and graph persistence share the exact same storage semantics.  

4. **Metadata Enrichment** – The optional call to `mapEntityToSharedMemory` allows PersistenceAgent to pre‑populate ontology metadata fields before the entity is handed off to the storage layer.  This step is typically performed after validation/normalisation, guaranteeing that every persisted entity carries the required shared‑memory descriptors.  

5. **Caching Sub‑module** – Although not explicitly named, the observations mention a separate caching module.  In practice, this module would sit between the façade and the adapter, storing frequently accessed graph fragments or entity look‑ups in an in‑process map (or a lightweight LRU cache).  Cache hits bypass the adapter entirely, while cache misses fall back to `getGraph`/`saveGraph`.  

6. **Type Safety** – All public methods of PersistenceAgent expose strongly typed signatures (e.g., `persistEntity(entity: Entity): Promise<void>`), leveraging TypeScript’s type system to catch mismatches at compile time.  This design choice reduces runtime errors when different parts of KnowledgeManagement interact with the persistence layer.

---

## Integration Points  

- **Parent Component – KnowledgeManagement**: PersistenceAgent is a child of KnowledgeManagement, which owns the overall knowledge graph lifecycle.  KnowledgeManagement configures the adapter (e.g., selects LevelDB path, VKB endpoint) and passes that configuration down to PersistenceAgent.  

- **Sibling Modules** – `ManualLearning` and `OnlineLearning` both rely on the same `saveGraph` function via their own logic, illustrating that PersistenceAgent is not the sole consumer of the adapter but shares it with peers.  `EntityPersistenceModule` is a sibling that may be invoked by PersistenceAgent for entity‑centric operations, creating a bidirectional collaboration.  

- **GraphDatabaseModule** – This sibling directly calls `getGraph` to obtain the live graph for analytics or visualisation.  Because both PersistenceAgent and GraphDatabaseModule use the same adapter, any change in routing (e.g., switching from LevelDB to VKB) automatically propagates to all consumers.  

- **External APIs** – The VKB API is an external synchronisation target.  PersistenceAgent does not call the API directly; instead, it relies on the adapter’s built‑in synchronisation logic encapsulated in `saveGraph`.  This keeps external‑service coupling isolated to a single module.  

- **Caching Layer** – If present, the caching sub‑module is injected into PersistenceAgent at construction time, allowing developers to enable or disable caching via configuration without touching the core persistence code.  

Overall, PersistenceAgent sits at the intersection of type‑safe domain logic, storage abstraction, and optional performance‑enhancing caches, while remaining loosely coupled to both its parent and its siblings through well‑defined interfaces.

---

## Usage Guidelines  

1. **Prefer the Facade API** – Call PersistenceAgent’s public methods (`persistEntity`, `persistGraph`, `loadGraph`) rather than invoking `GraphDatabaseAdapter` directly.  This ensures that validation, metadata mapping, and caching are applied consistently.  

2. **Respect Configuration** – The behaviour of `getGraph` and `saveGraph` is driven by the system configuration (offline vs. online mode).  Changing the configuration should be done at the KnowledgeManagement level before any PersistenceAgent instances are created; otherwise, you may encounter mixed‑mode reads/writes.  

3. **Validate Before Persisting** – Although PersistenceAgent may include its own validation, developers should perform domain‑specific checks early (e.g., schema compliance) to avoid costly roll‑backs.  If custom validation is required, extend the optional validation hook inside PersistenceAgent rather than duplicating logic elsewhere.  

4. **Leverage Caching When Appropriate** – Enable the caching sub‑module for read‑heavy workloads (e.g., frequent ontology look‑ups).  Remember that the cache is a best‑effort optimisation; it does not replace the need to call `saveGraph` after any mutation to keep the remote VKB store in sync.  

5. **Do Not Bypass Type Safety** – All entities passed to PersistenceAgent must conform to the declared TypeScript interfaces.  Casting or using `any` defeats the purpose of the type‑safe façade and can introduce subtle bugs that the façade is designed to prevent.  

6. **Coordinate with EntityPersistenceModule** – When persisting individual entities, use the helper methods provided by EntityPersistenceModule (or let PersistenceAgent delegate to it).  This avoids divergent persistence paths and keeps entity metadata handling uniform across the system.  

---

### Summary of Key Insights  

| Aspect | Observation‑Based Insight |
|--------|----------------------------|
| **Architectural patterns identified** | Adapter (`GraphDatabaseAdapter`), Facade (`PersistenceAgent`), Strategy (runtime routing between LevelDB and VKB), Decorator‑like validation/normalisation layer, Modular service sharing among siblings. |
| **Design decisions and trade‑offs** | Centralising storage logic in a single adapter simplifies consistency but adds an indirection layer; type‑safe façade improves developer ergonomics at the cost of a small runtime overhead; optional caching boosts read performance but introduces cache‑staleness risk that must be managed. |
| **System structure insights** | PersistenceAgent lives under `KnowledgeManagement`, re‑uses `GraphDatabaseAdapter` (found in `storage/graph-database-adapter.ts`), collaborates with `EntityPersistenceModule`, and is parallel to `ManualLearning`, `OnlineLearning`, `GraphDatabaseModule`.  All persistence‑related modules share the same underlying storage implementation. |
| **Scalability considerations** | The dual‑store approach (local LevelDB + remote VKB) allows horizontal scaling of read‑only workloads via local cache, while writes are synchronised asynchronously to the remote API.  The routing strategy enables seamless fail‑over to offline mode.  Caching can be tuned per workload to reduce LevelDB I/O. |
| **Maintainability assessment** | Clear separation of concerns (adapter, façade, validation, caching) makes the codebase easy to reason about and extend.  Because all persistence paths funnel through the same adapter, bug fixes or performance improvements in `saveGraph`/`getGraph` propagate automatically.  The reliance on TypeScript’s type system further reduces regression risk.  The only maintenance overhead is ensuring that configuration changes (e.g., switching storage back‑ends) are performed centrally in KnowledgeManagement. |

These insights should give developers and architects a solid grounding in how **PersistenceAgent** fits into the overall system, the rationale behind its design, and the practical considerations for extending or tuning it in future work.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may use the GraphDatabaseAdapter's 'saveGraph' function to persist manually created entities to the local LevelDB storage and synchronize it with the VKB API.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, which is then persisted using the GraphDatabaseAdapter.
- [GraphDatabaseModule](./GraphDatabaseModule.md) -- GraphDatabaseModule uses the GraphDatabaseAdapter's 'getGraph' function to retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration.
- [EntityPersistenceModule](./EntityPersistenceModule.md) -- EntityPersistenceModule uses the GraphDatabaseAdapter's 'saveGraph' function to persist entities to the local LevelDB storage and synchronize it with the VKB API.


---

*Generated from 7 observations*

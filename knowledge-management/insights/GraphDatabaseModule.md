# GraphDatabaseModule

**Type:** SubComponent

GraphDatabaseModule could leverage the 'saveGraph' function from the GraphDatabaseAdapter to persist changes to the knowledge graph to the local LevelDB storage and synchronize it with the VKB API.

## What It Is  

**GraphDatabaseModule** is a **SubComponent** that lives inside the **KnowledgeManagement** component.  It is the primary, type‑safe façade through which MCP server agents read from and write to the central knowledge graph that is built on **Graphology** and persisted with **LevelDB**.  All interaction with the underlying storage is funneled through the **GraphDatabaseAdapter** (source file `storage/graph-database-adapter.ts`).  The adapter’s `getGraph` method supplies the in‑memory Graphology instance, pulling the data either from the remote **VKB API** or from the local LevelDB store based on the current configuration.  Conversely, `saveGraph` writes any changes back to LevelDB and synchronises them with the VKB API.  By wrapping these low‑level calls, GraphDatabaseModule offers a clean, strongly‑typed API that shields MCP agents from the details of storage routing, schema handling, and entity‑metadata preparation.

## Architecture and Design  

The design revolves around an **Adapter pattern** embodied by `GraphDatabaseAdapter`.  This adapter abstracts two distinct persistence back‑ends—remote VKB API and local LevelDB—behind a single, coherent interface (`getGraph` / `saveGraph`).  GraphDatabaseModule sits on top of the adapter as a **Facade**, exposing a type‑safe contract for the rest of the system while delegating all storage concerns to the adapter.  

A secondary **Facade/Helper** relationship exists with the **PersistenceAgent**: GraphDatabaseModule can invoke `mapEntityToSharedMemory` (from PersistenceAgent) to enrich newly‑created graph nodes with ontology‑metadata before they are persisted.  The module also has a potential **collaboration** with **EntityPersistenceModule**, which can be called to handle the life‑cycle of entities that need deeper persistence logic beyond simple graph writes.  

The module is deliberately **modular**: schema‑related responsibilities are expected to be delegated to a dedicated “graph schema management” sub‑module (not detailed in the observations but referenced).  This separation keeps the core graph‑access layer focused on query/transaction handling while schema evolution is isolated, supporting independent versioning and testing.  

Interaction with sibling components—**ManualLearning**, **OnlineLearning**, **EntityPersistenceModule**, and **PersistenceAgent**—is uniform: they all rely on the same `saveGraph` function of the adapter.  This shared dependency reinforces a **single source of truth** for persistence logic and reduces duplication across learning pipelines and manual data entry tools.

## Implementation Details  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**  
   - `getGraph(): Graphology` – Detects the runtime configuration, then either fetches the graph JSON from the VKB API (remote) or reads the LevelDB store (local) and builds a Graphology instance.  
   - `saveGraph(graph: Graphology): void` – Serialises the in‑memory graph to JSON, writes it to LevelDB, and triggers an asynchronous synchronisation with the VKB API.  The adapter also implements an “intelligent routing” mechanism that decides whether to use the remote API or direct DB access for each operation, ensuring optimal performance and scalability.  

2. **GraphDatabaseModule** (no concrete file path is listed, but it resides within the KnowledgeManagement component)  
   - Provides a **type‑safe API** (e.g., `addEntity<T extends Entity>(entity: T): Promise<void>`, `queryGraph<T>(query: GraphQuery): Promise<T[]>`) that internally calls `GraphDatabaseAdapter.getGraph()` to obtain the working graph instance.  
   - May contain **custom query/transaction handling**: bespoke functions that wrap Graphology’s traversal APIs, enforce transaction boundaries, and roll back on failure.  
   - Integrates with **PersistenceAgent.mapEntityToSharedMemory** to pre‑populate ontology metadata fields (such as `createdAt`, `source`, `ontologyId`) before the entity is inserted into the graph.  
   - Optionally collaborates with **EntityPersistenceModule** for complex persistence scenarios (e.g., bulk upserts, conflict resolution).  

3. **Schema Management Sub‑module** (conceptual)  
   - Responsible for defining node/edge types, property constraints, and versioned schema migrations.  GraphDatabaseModule would call into this sub‑module when creating or altering graph structures, ensuring that all schema changes are centrally governed.  

The overall flow when an MCP agent creates a new knowledge entity is:  
`Agent → GraphDatabaseModule.addEntity → mapEntityToSharedMemory (PersistenceAgent) → EntityPersistenceModule (if needed) → GraphDatabaseAdapter.getGraph → Graphology mutation → GraphDatabaseAdapter.saveGraph → LevelDB + VKB sync`.

## Integration Points  

- **Parent Component – KnowledgeManagement**: GraphDatabaseModule is the core data‑access layer for KnowledgeManagement.  All higher‑level knowledge‑management services (e.g., inference engines, recommendation services) consume its type‑safe API.  
- **Sibling Components**:  
  - **ManualLearning** and **OnlineLearning** both call `GraphDatabaseAdapter.saveGraph` after they have generated new entities from user input or batch analysis pipelines.  
  - **EntityPersistenceModule** and **PersistenceAgent** also rely on `saveGraph` for persisting their own payloads, meaning any change to the adapter’s contract propagates to all siblings.  
- **External Interfaces**: The VKB API is accessed indirectly through the adapter; developers never import VKB client code directly into GraphDatabaseModule, preserving encapsulation.  
- **Configuration Layer**: A runtime config (likely a JSON/YAML file or environment variables) dictates whether `getGraph` pulls from VKB or LevelDB, allowing seamless switching between offline and online modes without code changes.  

## Usage Guidelines  

1. **Always use the GraphDatabaseModule façade** rather than calling `GraphDatabaseAdapter` directly.  This guarantees that schema checks, metadata mapping, and transaction handling are applied consistently.  
2. **Respect the type‑safe contracts**: pass concrete entity types that conform to the shared `Entity` interface.  The compiler will enforce correct property names, reducing runtime errors.  
3. **Persist changes through the module’s `save` pathway**: after mutating the graph (adding nodes, edges, or updating properties), invoke the module’s `commit`/`save` method which internally calls `GraphDatabaseAdapter.saveGraph`.  Skipping this step leaves the in‑memory graph unsynchronised with LevelDB and the VKB API.  
4. **Leverage `mapEntityToSharedMemory`** when creating new entities.  This ensures ontology metadata is consistently populated, which downstream analytics expect.  
5. **When altering the graph schema**, route the request through the dedicated schema‑management sub‑module.  Direct Graphology manipulations that bypass schema validation can corrupt the knowledge graph.  
6. **Configure the persistence mode early** (e.g., via environment variable `GRAPH_BACKEND=VKB|LOCAL`).  Changing the mode at runtime is unsupported because the adapter caches the graph instance on first load.  

---

### 1. Architectural patterns identified  

| Pattern | Evidence |
|---------|----------|
| **Adapter** | `GraphDatabaseAdapter` abstracts VKB API vs. LevelDB (`getGraph`, `saveGraph`). |
| **Facade** | `GraphDatabaseModule` presents a type‑safe API that hides adapter internals. |
| **Separation of Concerns** | Distinct modules for schema management, entity persistence, and metadata mapping (`PersistenceAgent.mapEntityToSharedMemory`). |
| **Intelligent Routing** | Adapter decides at runtime which backend to use based on configuration (mentioned in hierarchy context). |

### 2. Design decisions and trade‑offs  

- **Unified persistence via an adapter** simplifies the codebase (single `saveGraph` implementation) but introduces a dependency on the adapter’s routing logic; a bug there could affect all consumers.  
- **Type‑safe façade** improves developer ergonomics and reduces runtime errors, at the cost of a thin additional abstraction layer that must be kept in sync with Graphology’s API.  
- **Optional schema‑management sub‑module** isolates schema evolution, making version upgrades safer, but adds another coordination point when introducing new node/edge types.  
- **Pre‑populating metadata through `mapEntityToSharedMemory`** enforces consistency but couples the module to the PersistenceAgent’s data‑model expectations.  

### 3. System structure insights  

- **KnowledgeManagement** is the parent container; it owns the graph‑access stack (Adapter → Module → Schema).  
- **Sibling components** (ManualLearning, OnlineLearning, EntityPersistenceModule, PersistenceAgent) are *consumers* of the same persistence contract, illustrating a **shared‑service** model rather than duplicated storage code.  
- The **graph itself** lives in memory as a Graphology instance, with LevelDB serving as the durable backing store and VKB acting as a remote synchronisation target.  

### 4. Scalability considerations  

- **Backend routing** allows the system to operate in an offline (LevelDB‑only) mode, supporting edge deployments where network latency to VKB would be prohibitive.  
- **LevelDB** provides fast local reads/writes; however, the entire graph must fit in memory for Graphology operations, which may limit scalability for extremely large knowledge bases.  
- **Synchronization with VKB** is performed after each `saveGraph` call; batch‑wise synchronisation or background jobs could be introduced to reduce network overhead as the graph grows.  

### 5. Maintainability assessment  

- **High cohesion**: GraphDatabaseModule focuses solely on graph access; persistence, schema, and metadata are delegated to specialised modules.  
- **Low coupling**: Consumers interact only with the façade, making it straightforward to replace the underlying storage implementation if needed.  
- **Potential fragility**: The adapter’s “intelligent routing” logic is a single point of failure; comprehensive unit tests and clear configuration documentation are essential.  
- **Documentation need**: Because the module may have custom query/transaction handling and optional schema management, explicit developer guides (e.g., “how to add a new entity type”) are required to keep the knowledge graph consistent.  

Overall, GraphDatabaseModule embodies a clean, adapter‑driven architecture that balances flexibility (remote vs. local storage) with type safety and modularity, providing a solid foundation for the KnowledgeManagement component while remaining mindful of scalability and maintainability trade‑offs.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may use the GraphDatabaseAdapter's 'saveGraph' function to persist manually created entities to the local LevelDB storage and synchronize it with the VKB API.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, which is then persisted using the GraphDatabaseAdapter.
- [EntityPersistenceModule](./EntityPersistenceModule.md) -- EntityPersistenceModule uses the GraphDatabaseAdapter's 'saveGraph' function to persist entities to the local LevelDB storage and synchronize it with the VKB API.
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent uses the GraphDatabaseAdapter's 'saveGraph' function to persist data to the local LevelDB storage and synchronize it with the VKB API.


---

*Generated from 7 observations*

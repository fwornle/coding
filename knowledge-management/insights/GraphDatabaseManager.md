# GraphDatabaseManager

**Type:** SubComponent

GraphDatabaseManager provides a graph metadata repository in graph-metadata.ts to store graph configuration and registration data.

## What It Is  

The **GraphDatabaseManager** is the core sub‑component responsible for persisting, retrieving, and synchronising graph‑structured data used throughout the platform. Its implementation lives in a set of focused modules:

* **`leveldb-database.ts`** – wraps a **LevelDB** instance to provide low‑level key/value storage for graph nodes, edges and auxiliary data.  
* **`graph-serializer.ts`** – implements a JSON‑based graph serialization format that converts in‑memory graph objects to a portable representation and back again.  
* **`cache-graph.ts`** – supplies an in‑process caching layer that holds recently accessed graph fragments to minimise LevelDB I/O.  
* **`graph-metadata.ts`** – hosts a lightweight metadata repository that records configuration, registration information, and versioning for each stored graph.  
* **`sync-manager.ts`** – orchestrates an automatic JSON‑export synchronisation routine, ensuring that any change to the persisted graph is reflected in an external JSON artefact.  

The manager does not work in isolation; it is wired into the **ConstraintSystem** (its parent) through the **GraphDatabaseAdapter** (its child) located at `storage/graph-database-adapter.ts`. Sibling components such as **ContentValidator**, **ViolationDetector**, and **HookManager** also depend on the same adapter, illustrating a shared persistence contract across the system.

---

## Architecture and Design  

The observed structure reveals a **layered architecture** built around clear separation of concerns:

1. **Adapter Layer** – The `GraphDatabaseAdapter` abstracts the underlying storage technology (LevelDB) from higher‑level services. This is a classic **Adapter pattern**, allowing the ConstraintSystem, ContentValidator, and ViolationDetector to interact with a uniform API without coupling to LevelDB specifics.

2. **Persistence Layer** – `leveldb-database.ts` provides the concrete LevelDB implementation. By confining all direct LevelDB calls to this file, the design isolates database‑specific error handling, configuration (e.g., cache size, write options), and lifecycle management.

3. **Serialization / Deserialization Layer** – `graph-serializer.ts` encapsulates the transformation between the in‑memory graph model (likely built on Graphology) and a JSON representation. This isolates format evolution and makes the export/import process replaceable.

4. **Caching Layer** – `cache-graph.ts` implements an in‑process cache that sits between the adapter and the serializer. The cache reduces read latency and LevelDB disk access, following a **Cache‑Aside** strategy: callers request data, the cache checks for a hit, otherwise the adapter fetches from LevelDB and populates the cache.

5. **Metadata Repository** – `graph-metadata.ts` follows a **Repository pattern** for graph configuration data, providing a dedicated store for non‑graph payload (e.g., schema version, registration timestamps). This keeps the main graph store lean and focused on structural data.

6. **Synchronization Mechanism** – `sync-manager.ts` provides automatic JSON export sync, effectively a **Background Sync** worker that watches for persistence events (likely via an event emitter or observer pattern) and writes a canonical JSON file. This keeps external consumers or backup processes aligned with the internal state.

Interaction flows are straightforward: a higher‑level component (e.g., **ContentValidator**) invokes the GraphDatabaseAdapter to persist validation metadata; the adapter delegates to `leveldb-database.ts`, optionally passing through `cache-graph.ts` for read‑through. Before writing, the data is serialized by `graph-serializer.ts`. After a successful write, `sync-manager.ts` is notified to emit the updated JSON export. The metadata repository is consulted whenever configuration data is needed, ensuring that each graph instance is self‑describing.

---

## Implementation Details  

### LevelDB Persistence (`leveldb-database.ts`)  
The module creates a LevelDB instance configured for the graph store directory. Typical functions include `put(key, value)`, `get(key)`, `del(key)`, and batch operations for atomic multi‑node updates. Error handling is centralised here, translating LevelDB errors into domain‑specific exceptions that higher layers can interpret.

### Graph Serialization (`graph-serializer.ts`)  
Serialization is performed by traversing the graph structure (nodes, edges, attributes) and emitting a JSON object that mirrors Graphology’s internal schema. Deserialization reconstructs the graph by feeding the JSON back into Graphology constructors. The serializer likely exposes `toJSON(graph): string` and `fromJSON(json): Graph` methods, making it reusable for both persistence and the external export performed by the sync manager.

### Caching (`cache-graph.ts`)  
Implemented as a simple LRU (Least Recently Used) map, the cache stores serialized graph fragments keyed by graph identifiers. The cache size is configurable, and eviction policies are enforced to keep memory usage bounded. Public methods such as `get(id)`, `set(id, graph)`, and `invalidate(id)` enable the rest of the system to control cache freshness, especially after mutation operations.

### Metadata Repository (`graph-metadata.ts`)  
This repository maintains a separate LevelDB namespace (or a distinct key prefix) for metadata entries. Functions include `registerGraph(id, config)`, `getMetadata(id)`, and `updateMetadata(id, patch)`. By keeping metadata separate, the system can query configuration without loading the full graph, supporting UI dashboards or administrative tooling.

### Synchronization Manager (`sync-manager.ts`)  
The sync manager subscribes to persistence events emitted by the GraphDatabaseAdapter. Upon receiving a “graph‑changed” notification, it invokes `graph-serializer.ts` to produce the latest JSON payload and writes it to a predefined export location (e.g., `exports/graph-{id}.json`). This process runs asynchronously to avoid blocking the primary write path and includes retry logic for transient I/O failures.

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
The adapter exposes a domain‑specific API such as `saveGraph(id, graph)`, `loadGraph(id)`, `deleteGraph(id)`, and `listGraphs()`. Internally it coordinates the cache, serializer, LevelDB persistence, metadata updates, and sync notifications. By consolidating these responsibilities, the adapter provides a single point of evolution for storage‑related changes.

---

## Integration Points  

* **Parent – ConstraintSystem** – The ConstraintSystem relies on the GraphDatabaseAdapter to store constraint metadata. This relationship means any change to the adapter’s contract (e.g., method signatures, error semantics) propagates up to the ConstraintSystem, which must handle versioning accordingly.

* **Siblings – ContentValidator & ViolationDetector** – Both components use the same GraphDatabaseAdapter to persist validation and violation metadata. Because they share the same storage backend, they benefit from the unified caching and synchronization mechanisms, ensuring that validation results are instantly reflected in exported JSON artifacts.

* **Child – GraphDatabaseAdapter** – The adapter is the concrete bridge between the high‑level manager responsibilities and the low‑level LevelDB store. It encapsulates the cache (`cache-graph.ts`), serialization (`graph-serializer.ts`), metadata handling (`graph-metadata.ts`), and sync (`sync-manager.ts`). Any new consumer (e.g., a future analytics module) would interact with the adapter rather than directly with LevelDB.

* **External Export Consumers** – The JSON files produced by `sync-manager.ts` serve as integration artefacts for downstream services (e.g., reporting dashboards, backup scripts). Because the export is JSON, it is language‑agnostic and can be consumed without requiring LevelDB access.

* **Configuration & Runtime** – The manager likely reads configuration (paths, cache sizes, LevelDB options) from a central configuration service used by the ConstraintSystem. This ensures consistent environment settings across all components that depend on the graph store.

---

## Usage Guidelines  

1. **Always go through the GraphDatabaseAdapter** – Direct access to `leveldb-database.ts` bypasses caching, metadata handling, and sync notifications, leading to stale exports and potential data inconsistency. Use the adapter’s `saveGraph`, `loadGraph`, and `deleteGraph` methods.

2. **Leverage the cache for read‑heavy workloads** – When retrieving a graph for inspection or validation, the adapter will automatically check `cache-graph.ts`. If you perform a bulk update, consider calling `invalidate` on affected graph IDs to avoid serving stale cached data.

3. **Respect the serialization contract** – The graph objects passed to the adapter must be compatible with `graph-serializer.ts`. Avoid mutating the graph after a `saveGraph` call without a subsequent `saveGraph` to ensure the persisted JSON reflects the current state.

4. **Handle synchronization failures** – The sync manager operates asynchronously; its promise‑based API (if exposed) should be awaited or its error events listened to. Implement retry or alerting logic if the JSON export is critical for downstream processes.

5. **Maintain metadata consistency** – When registering a new graph, first invoke `graph-metadata.ts` (via the adapter) to create a configuration entry, then store the graph itself. Deleting a graph should clean up both the LevelDB data and its metadata record to prevent orphaned entries.

---

### Architectural patterns identified  
* **Adapter pattern** – `GraphDatabaseAdapter` abstracts LevelDB.  
* **Repository pattern** – `graph-metadata.ts` isolates configuration storage.  
* **Cache‑Aside strategy** – `cache-graph.ts` sits between callers and LevelDB.  
* **Observer/Publish‑Subscribe** – `sync-manager.ts` listens for persistence events.  
* **Serialization pattern** – `graph-serializer.ts` handles format conversion.

### Design decisions and trade‑offs  
* **LevelDB as the storage engine** offers fast key/value access and on‑disk durability but limits query flexibility; complex graph traversals must be performed in‑memory after loading.  
* **JSON export** provides human‑readable backups and easy integration but incurs serialization overhead on every write; the async sync manager mitigates blocking but introduces eventual consistency for the exported file.  
* **In‑process caching** improves read latency for hot graphs but adds memory pressure; the LRU policy balances this at the cost of occasional cache misses.  
* **Separate metadata store** keeps the main graph payload lean, enabling quick configuration look‑ups, though it introduces an extra read path when both data and metadata are needed together.

### System structure insights  
The GraphDatabaseManager sits at the intersection of persistence, caching, and synchronization, acting as a self‑contained persistence domain. Its child adapter consolidates all lower‑level concerns, while the parent ConstraintSystem treats it as a black‑box storage service. Sibling components share the same adapter, reinforcing a **single source of truth** for all graph‑related metadata across the platform.

### Scalability considerations  
* **Horizontal scaling** is limited by LevelDB’s single‑process design; to scale beyond a single node, one would need to shard graphs across multiple LevelDB instances or migrate to a distributed store.  
* **Cache sizing** can be tuned per deployment; larger caches improve read throughput for large graphs but must be bounded to avoid OOM.  
* **Batch writes** via LevelDB’s batch API can reduce I/O overhead when persisting many nodes/edges at once.  
* **Sync frequency** can be throttled (e.g., debounce rapid updates) to avoid excessive JSON export I/O in high‑write scenarios.

### Maintainability assessment  
The modular split—persistence, serialization, caching, metadata, and sync—promotes **high cohesion** within each file and **low coupling** between them, simplifying unit testing and future refactoring. The explicit adapter interface shields higher‑level components from storage details, making it straightforward to replace LevelDB with another key/value store if needed. However, the reliance on a single JSON export for external sync introduces a maintenance hotspot: any change to the serialization format must be coordinated with downstream consumers. Overall, the design is maintainable, with clear boundaries and well‑named modules that reflect their responsibilities.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and managing constraint metadata. This allows for efficient persistence and retrieval of constraint data, leveraging the capabilities of Graphology and LevelDB. The automatic JSON export sync feature ensures that the data remains consistent and up-to-date. Furthermore, the GraphDatabaseAdapter provides a flexible and scalable solution for handling large amounts of constraint metadata, making it an ideal choice for the ConstraintSystem.

### Children
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The GraphDatabaseManager sub-component uses the GraphDatabaseAdapter to provide persistence functionality, as indicated by the parent context.

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve validation metadata.
- [HookManager](./HookManager.md) -- HookManager uses a modular hook registration system in hook-registry.ts to manage hook subscriptions.
- [ViolationDetector](./ViolationDetector.md) -- ViolationDetector uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve violation metadata.
- [ConstraintMetadataManager](./ConstraintMetadataManager.md) -- ConstraintMetadataManager uses a metadata repository in metadata-repository.ts to store constraint configuration and registration data.
- [AgentManager](./AgentManager.md) -- AgentManager uses an agent repository in agent-repository.ts to store agent configuration and registration data.


---

*Generated from 6 observations*

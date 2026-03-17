# EntityPersistence

**Type:** SubComponent

The adapter provides a layer of abstraction between EntityPersistence and the underlying graph database, allowing for seamless interaction with the database

## What It Is  

**EntityPersistence** is the sub‑component that owns the lifecycle of all domain‑level “entities” inside the **KnowledgeManagement** stack. It lives in the same module that houses the `storage/graph-database-adapter.ts` file, where the `GraphDatabaseAdapter` class is defined. All persistence operations – creating, reading, updating, and deleting entities – are funneled through this adapter, which in turn talks to a Graphology‑based in‑memory graph that is backed by LevelDB on disk. The adapter also runs an automatic JSON‑export‑sync routine, guaranteeing that a portable JSON snapshot of the graph is always up‑to‑date.  

EntityPersistence is the authoritative source for entity metadata (ontology class, type, etc.) and exposes a clean, component‑level interface that the sibling sub‑components **ManualLearning**, **OnlineLearning**, **OntologyClassification**, **SemanticCodeSearch**, and **UKBTraceReporting** call into when they need to store or retrieve knowledge artifacts.

---

## Architecture and Design  

The design follows a classic **Adapter / Facade** pattern. `GraphDatabaseAdapter` abstracts the concrete storage technology (Graphology + LevelDB) behind a set of high‑level methods that EntityPersistence consumes. This isolates EntityPersistence from low‑level database concerns and makes the persistence layer replaceable without rippling changes through the rest of the system.  

EntityPersistence itself acts as a **Repository** for domain entities. It owns the contract that other sub‑components implement (e.g., “storeEntity”, “getEntityById”, “queryByOntology”). By keeping this contract within EntityPersistence, the architecture enforces a **separation of concerns**: the KnowledgeManagement parent component delegates all graph‑related responsibilities to EntityPersistence, while the sibling components focus on learning, classification, or search logic.  

Because the same `GraphDatabaseAdapter` is referenced by multiple siblings, the system exhibits **shared‑service reuse**. All components that need persistence reach for the same adapter instance (or a singleton), ensuring a single source of truth for the graph data and avoiding divergent state. The automatic JSON export sync adds a **synchronization** aspect that guarantees an external, human‑readable representation of the graph is always consistent with the live LevelDB store.

---

## Implementation Details  

* **`storage/graph-database-adapter.ts` – `GraphDatabaseAdapter`**  
  * Provides methods such as `connect()`, `writeNode()`, `readNode()`, `exportJSON()`, and `sync()`.  
  * Internally creates a Graphology graph object (`new Graph()`) and attaches a LevelDB backend (`levelup`, `leveldown`).  
  * The **automatic JSON export sync** runs after each mutation, serializing the entire graph to a JSON file (path not disclosed) and writing it to disk. This guarantees that any consumer that reads the JSON snapshot sees the latest state.  

* **EntityPersistence Interface**  
  * Exposes high‑level CRUD operations that accept or return entity objects containing at least an `id`, `ontologyClass`, and `type`.  
  * Delegates the actual persistence to the adapter, e.g., `adapter.writeNode(entity.id, entityMetadata)`.  
  * Handles translation between the domain model used by ManualLearning/OnlineLearning and the raw graph node format required by Graphology.  

* **Metadata Handling**  
  * EntityPersistence stores ontology‑related fields directly on graph nodes, enabling fast traversal queries that other components (e.g., OntologyClassification) can leverage.  
  * Because LevelDB is a key‑value store, the adapter maps each node’s identifier to a LevelDB key, ensuring O(log n) lookup performance while retaining Graphology’s rich edge semantics for relationship queries.  

* **Interaction with Siblings**  
  * **ManualLearning** and **OnlineLearning** call EntityPersistence to persist newly discovered entities from code analysis or LSL sessions.  
  * **OntologyClassification** reads entity metadata to assign or refine ontology classes.  
  * **SemanticCodeSearch** queries the graph for relationships that support semantic lookup.  
  * **UKBTraceReporting** extracts trace information from the persisted graph for reporting purposes.  

---

## Integration Points  

1. **Parent – KnowledgeManagement**  
   * KnowledgeManagement treats EntityPersistence as its persistence layer. All higher‑level knowledge‑graph operations (e.g., merging ontologies, global queries) are routed through EntityPersistence, which in turn uses the shared `GraphDatabaseAdapter`.  

2. **Sibling Components**  
   * Each sibling imports the EntityPersistence interface (likely via a TypeScript type definition) and calls its methods. Because they all rely on the same adapter, any schema change in the graph model must be coordinated across all siblings.  

3. **External JSON Export**  
   * The automatic JSON export generated by the adapter can be consumed by external tools (e.g., visualization dashboards, backup scripts). The sync mechanism is a built‑in integration point that does not require additional code.  

4. **LevelDB Storage**  
   * The physical LevelDB files reside on the host filesystem; any deployment that moves the KnowledgeManagement component must ensure the LevelDB data directory is persisted across restarts.  

5. **Graphology API**  
   * Advanced queries (e.g., traversals, path finding) can be performed directly on the Graphology instance exposed by the adapter, allowing components like SemanticCodeSearch to implement custom graph algorithms without re‑implementing storage logic.  

---

## Usage Guidelines  

* **Always go through EntityPersistence** – Direct access to `GraphDatabaseAdapter` or LevelDB should be avoided by application code. This preserves the abstraction barrier and ensures metadata (ontology class, type) is consistently applied.  

* **Treat entity objects as immutable after persistence** – If an entity’s core identifiers change, delete the old node and insert a new one rather than mutating in place; this aligns with LevelDB’s append‑only nature and avoids stale indexes in Graphology.  

* **Leverage the JSON export for debugging** – The exported JSON file reflects the exact state of the graph after every mutation. Use it to validate that ManualLearning or OnlineLearning pipelines are persisting the expected structures.  

* **Mind the storage size** – LevelDB stores data on disk; large knowledge graphs can grow quickly. Periodic compaction (LevelDB’s `compactRange`) may be needed in long‑running deployments.  

* **Coordinate schema changes** – Adding new metadata fields (e.g., a “confidence” score) requires updating the EntityPersistence contract and the adapter’s node‑serialization logic. Because all siblings share the same graph, a coordinated rollout is essential to prevent runtime mismatches.  

---

### Architectural Patterns Identified  

1. **Adapter / Facade** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB.  
2. **Repository** – EntityPersistence provides a domain‑specific CRUD interface.  
3. **Shared Service / Singleton** – The same adapter instance is reused across multiple sibling components.  

### Design Decisions and Trade‑offs  

* **Abstraction vs. Performance** – By inserting an adapter layer, the system gains flexibility (swap storage back‑end) at the cost of an extra method call indirection.  
* **Graphology + LevelDB** – Combines rich graph semantics with a durable key‑value store, offering fast lookups and expressive traversals, but requires careful synchronization (hence the automatic JSON export).  
* **Automatic JSON Sync** – Guarantees external consistency but introduces I/O overhead on every write; suitable for environments where read‑heavy analytics outweigh write latency.  

### System Structure Insights  

* **Vertical layering** – KnowledgeManagement (parent) → EntityPersistence (persistence sub‑component) → GraphDatabaseAdapter (storage abstraction).  
* **Horizontal reuse** – ManualLearning, OnlineLearning, OntologyClassification, SemanticCodeSearch, UKBTraceReporting all sit at the same level and share the persistence contract.  

### Scalability Considerations  

* **Horizontal scaling** is limited by LevelDB’s single‑process model; to scale out, the architecture would need to replace LevelDB with a distributed graph store.  
* **Write throughput** may be constrained by the JSON export sync; batching writes or toggling sync frequency could improve performance in high‑ingest scenarios.  
* **Graph size** – Graphology keeps the entire graph in memory; very large knowledge bases may exhaust RAM, suggesting a future need for on‑demand loading or a more scalable graph engine.  

### Maintainability Assessment  

* **High maintainability** – Clear separation of concerns, a single adapter class, and a well‑defined EntityPersistence interface make the codebase easy to navigate and reason about.  
* **Risk areas** – Tight coupling of all siblings to the same graph schema means that schema evolution requires coordinated releases. The automatic JSON sync, while useful, adds hidden I/O that developers must be aware of when profiling performance.  
* **Documentation** – Because the observations contain no explicit API signatures, adding TypeScript typings and inline docs around the adapter methods would further improve developer experience.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a GraphDatabaseAdapter for persistence, leveraging Graphology and LevelDB for data storage. This is evident in the storage/graph-database-adapter.ts file, where the GraphDatabaseAdapter class is defined. The adapter provides a layer of abstraction between the KnowledgeManagement component and the underlying graph database, allowing for seamless interaction with the database. The use of Graphology and LevelDB enables efficient storage and querying of knowledge graphs, which is crucial for the component's functionality. Furthermore, the adapter's automatic JSON export sync feature ensures that data is consistently updated and available for use.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [SemanticCodeSearch](./SemanticCodeSearch.md) -- SemanticCodeSearch utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- GraphDatabaseManagement utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence


---

*Generated from 7 observations*

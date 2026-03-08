# PersistenceManager

**Type:** SubComponent

PersistenceManager uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph

## What It Is  

**PersistenceManager** is a sub‑component that lives under the **KnowledgeManagement** component and is responsible for persisting entities and their relationships in the central knowledge graph. The implementation is anchored in the `graph-database-adapter.ts` file, where the **GraphDatabaseAdapter** class lives, and it is consumed by the `persistence-agent.ts` file through the **PersistenceAgent** class. By delegating all low‑level graph operations to the adapter, PersistenceManager offers a type‑safe, lock‑free façade that can transparently switch between the VKB API (when the server is running) and direct LevelDB access (when the server is stopped). Its child component, **EntityPersistence**, concentrates the actual entity‑level CRUD logic, while sibling components such as **ManualLearning**, **OntologyClassifier**, and **TraceReportGenerator** reuse the same adapter to interact with the graph.

---

## Architecture and Design  

The architecture centres on an **Adapter** pattern: `GraphDatabaseAdapter` abstracts the concrete storage engine (Graphology + LevelDB) and the optional VKB API behind a uniform, type‑safe interface. PersistenceManager composes this adapter, exposing higher‑level operations needed by agents (e.g., `PersistenceAgent`) without leaking storage details.  

A **lock‑free** approach is explicitly mentioned. Rather than using mutexes or transactional locks, PersistenceManager relies on the underlying Graphology/LevelDB stack, which provides atomic batch writes, allowing the component to toggle between remote API calls and local DB writes without contention. This design reduces latency in hot paths (e.g., real‑time entity insertion) and simplifies concurrency handling for callers.  

Composition is evident in the parent‑child relationship: KnowledgeManagement aggregates PersistenceManager, which in turn contains **EntityPersistence**. This hierarchical composition isolates concerns—KnowledgeManagement orchestrates overall knowledge‑base lifecycle, PersistenceManager focuses on graph persistence, and EntityPersistence handles entity‑specific logic.  

Sibling components (ManualLearning, OntologyClassifier, etc.) share the same adapter, reinforcing **reuse** and **consistency** across the system. The shared adapter ensures that all graph interactions, whether for learning, classification, or reporting, obey the same schema validation and JSON export semantics.

---

## Implementation Details  

1. **GraphDatabaseAdapter (`graph-database-adapter.ts`)** – Provides the core API (`addNode`, `addEdge`, `removeNode`, `query`, …) with full TypeScript typings. It encapsulates Graphology’s in‑memory model backed by LevelDB persistence and also knows how to route calls to the VKB API when the server process is alive. Automatic JSON export sync is baked into the adapter; after each mutation it triggers a serialization step that writes a JSON snapshot of the graph to disk, guaranteeing an up‑to‑date external representation.  

2. **PersistenceManager** – Though no explicit source file is listed, its responsibilities are inferred from the observations: it holds an instance of `GraphDatabaseAdapter`, offers higher‑level methods such as `persistEntity(entity: Entity)`, `classifyOntology(ontology: Ontology)`, and orchestrates lock‑free writes by delegating directly to the adapter’s batch API. Because the adapter already handles JSON export, PersistenceManager does not need additional sync logic.  

3. **PersistenceAgent (`persistence-agent.ts`)** – Acts as a consumer of PersistenceManager. When an agent needs to store a new entity or update an ontology, it calls the manager’s public methods. The agent itself does not touch the adapter, preserving a clean separation between business‑logic agents and storage mechanics.  

4. **EntityPersistence (child component)** – Implements the entity‑centric CRUD operations that PersistenceManager exposes. It likely contains functions such as `createEntity`, `updateEntity`, and `deleteEntity`, each mapping to corresponding adapter calls while preserving type safety.  

5. **Lock‑free Switching** – The manager checks runtime state (e.g., “server running” flag). If true, it forwards operations to the VKB API via the adapter; otherwise, it writes directly to LevelDB. Because both paths share the same method signatures, the switch is transparent to callers.  

6. **Automatic JSON Export** – Triggered inside `GraphDatabaseAdapter` after each successful write, ensuring that an external JSON dump of the knowledge graph is always synchronized with the internal LevelDB store.

---

## Integration Points  

- **KnowledgeManagement (parent)** – Instantiates PersistenceManager and passes the shared `GraphDatabaseAdapter` instance. It may also coordinate lifecycle events (e.g., initializing LevelDB, starting the VKB API server) that affect the manager’s lock‑free switching logic.  

- **PersistenceAgent (`persistence-agent.ts`)** – Calls PersistenceManager to persist domain objects. The agent is the primary client for runtime entity persistence and ontology classification.  

- **Sibling Components** – ManualLearning, OntologyClassifier, and other graph‑aware modules also import `GraphDatabaseAdapter`. They benefit from the same type‑safe interface and automatic JSON export, ensuring that any learning or classification activity writes to a consistent graph state.  

- **External VKB API** – When the server is up, the adapter routes writes to this remote service. The integration is encapsulated inside the adapter, so no sibling or child component needs to know about the remote endpoint.  

- **LevelDB Storage** – The concrete persistence layer is managed by Graphology’s LevelDB backend. PersistenceManager never interacts with LevelDB directly; all persistence is funneled through the adapter, which abstracts file paths, transaction semantics, and recovery logic.

---

## Usage Guidelines  

1. **Always go through PersistenceManager** – Application code (including agents and learning modules) should never instantiate `GraphDatabaseAdapter` directly. Use the manager’s public API to guarantee that lock‑free switching and JSON sync are applied uniformly.  

2. **Leverage Type Safety** – The adapter’s methods are fully typed; pass correctly typed entity and ontology objects to avoid runtime schema mismatches.  

3. **Do Not Bypass the JSON Export** – If you need a custom export, call the manager’s export method (if exposed) rather than writing directly to LevelDB, because the automatic JSON sync lives inside the adapter and guarantees consistency.  

4. **Respect the Server‑State Switch** – When writing integration tests that simulate server downtime, ensure the manager’s “server running” flag is set appropriately; otherwise you may unintentionally hit the remote VKB API.  

5. **Prefer Batch Operations** – For high‑throughput scenarios (e.g., bulk learning), use the adapter’s batch API via PersistenceManager to keep the lock‑free guarantees and minimize write overhead.  

---

### 1. Architectural patterns identified  
- **Adapter Pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB and the VKB API behind a unified interface.  
- **Composition/Hierarchical Aggregation** – KnowledgeManagement → PersistenceManager → EntityPersistence.  
- **Lock‑free Concurrency** – Direct use of atomic batch writes and runtime switching without explicit locks.  

### 2. Design decisions and trade‑offs  
- **Lock‑free vs. transactional locking** – Chosen to reduce latency and simplify concurrency, at the cost of relying on the underlying database’s atomic guarantees.  
- **Single adapter for both local and remote stores** – Provides seamless switching but couples the manager to the adapter’s runtime‑state detection logic.  
- **Automatic JSON export** – Guarantees an external snapshot but adds a write‑path overhead after each mutation.  

### 3. System structure insights  
- PersistenceManager is the central persistence façade within the KnowledgeManagement domain, with **EntityPersistence** handling entity‑level details.  
- Sibling components share the same adapter, promoting consistency across learning, classification, and reporting pipelines.  
- The hierarchy isolates storage concerns (adapter) from business concerns (agents, learning modules), enabling clearer responsibility boundaries.  

### 4. Scalability considerations  
- Because the adapter uses Graphology + LevelDB, scalability is bounded by LevelDB’s single‑process write model; horizontal scaling would require sharding or migrating to a distributed graph store.  
- The lock‑free design supports high‑frequency, low‑latency writes as long as the underlying batch API remains performant.  
- Automatic JSON export may become a bottleneck for massive mutation bursts; consider throttling or async export in future iterations.  

### 5. Maintainability assessment  
- **High maintainability** – Clear separation of concerns (adapter, manager, entity layer) and strong TypeScript typings reduce accidental misuse.  
- Centralizing graph interactions in `graph-database-adapter.ts` means changes to storage (e.g., swapping LevelDB for another backend) are localized.  
- The lock‑free switching logic is simple but must be kept in sync with any changes to the VKB API contract; documentation of the “server running” flag is essential.  
- Automatic JSON sync is a hidden side‑effect; developers need to be aware of it to avoid unexpected I/O spikes, but its encapsulation keeps the rest of the codebase clean.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.

### Children
- [EntityPersistence](./EntityPersistence.md) -- The PersistenceManager sub-component uses the GraphDatabaseAdapter class to provide a type-safe interface for agents to interact with the central knowledge graph, implying a strong focus on entity persistence.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [CodeKnowledgeGraphConstructor](./CodeKnowledgeGraphConstructor.md) -- CodeKnowledgeGraphConstructor uses the batch analysis pipeline to construct the code knowledge graph
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the batch analysis pipeline to generate detailed trace reports of workflow runs and data flow
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology+LevelDB database for persistence


---

*Generated from 7 observations*

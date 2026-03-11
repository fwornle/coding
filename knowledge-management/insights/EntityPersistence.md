# EntityPersistence

**Type:** SubComponent

The CodeGraphAgent (src/agents/code-graph-agent.ts) is used by EntityPersistence to construct the AST-based code knowledge graph for semantic code search capabilities.

## What It Is  

EntityPersistence is the **sub‑component** that lives inside the **KnowledgeManagement** layer and is responsible for persisting, retrieving, and mutating domain entities in the system’s graph‑based knowledge store. The core implementation is anchored in two concrete files that appear throughout the code base:  

* `storage/graph-database-adapter.ts` – the low‑level adapter that talks to the underlying Graphology + LevelDB graph database.  
* `src/agents/persistence-agent.ts` – the higher‑level agent that EntityPersistence invokes to carry out create, update, and delete operations on entities.  

Together these pieces give EntityPersistence the ability to manage **entity metadata** (such as the entity type and the associated ontology class) while guaranteeing data consistency and integrity across the whole knowledge graph. Because both **ManualLearning** and **OnlineLearning** depend on EntityPersistence for their entity lifecycle management, this sub‑component is a critical bridge between learning pipelines and the persistent knowledge store.

---

## Architecture and Design  

The architecture that emerges from the observations follows a **layered adapter‑agent pattern**. The **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`) sits at the storage‑infrastructure layer, abstracting the concrete Graphology + LevelDB implementation behind a clean API. Above it, the **PersistenceAgent** (`src/agents/persistence-agent.ts`) acts as a domain‑level service that encapsulates business rules around entity creation, updates, and deletion. EntityPersistence itself does not implement its own storage logic; instead, it *delegates* to these two collaborators, which yields a clear separation of concerns:

1. **Storage Layer (Adapter)** – isolates graph‑database specifics, making it possible to swap the underlying store without touching higher‑level logic.  
2. **Domain Service Layer (Agent)** – contains the entity‑centric workflow (validation, metadata handling, consistency checks) and orchestrates calls to the adapter.  

EntityPersistence also reuses the **CodeGraphAgent** (`src/agents/code-graph-agent.ts`) when it needs to materialise an AST‑based code knowledge graph for semantic code‑search features. This reuse demonstrates a **service‑oriented composition** where agents are treated as interchangeable building blocks that each own a distinct responsibility (persistence vs. code‑graph construction).  

Because the component is shared by its sibling sub‑components—**ManualLearning**, **OnlineLearning**, **GraphDatabaseStorage**, **CodeKnowledgeGraph**, and **UKBTraceReporting**—the design emphasizes **common infrastructure reuse**. All of these siblings rely on the same `GraphDatabaseAdapter`, ensuring a uniform data‑access contract across the KnowledgeManagement domain.

---

## Implementation Details  

* **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – Exposes methods such as `addNode`, `updateNode`, `removeNode`, and query helpers. Internally it wraps Graphology’s mutable graph API and persists the serialized graph to LevelDB. The adapter also implements transaction‑like semantics (e.g., batch writes) that EntityPersistence leverages to keep the knowledge graph in a consistent state after a series of entity mutations.  

* **PersistenceAgent (`src/agents/persistence-agent.ts`)** – Provides higher‑level functions like `createEntity(metadata)`, `updateEntity(id, changes)`, and `deleteEntity(id)`. Each function first validates the incoming metadata (ensuring the presence of an ontology class, checking entity‑type constraints) and then calls the appropriate adapter method. The agent also emits domain events (e.g., `EntityCreated`, `EntityDeleted`) that downstream learners can subscribe to, although the exact event‑bus implementation is not detailed in the observations.  

* **EntityPersistence Logic** – Although no concrete class file is listed, the sub‑component orchestrates the two agents. When a new entity is needed (e.g., during ManualLearning’s curation step), EntityPersistence invokes `PersistenceAgent.createEntity`. For code‑search capabilities, it calls `CodeGraphAgent.buildGraphFromAST(sourceCode)` and then stores the resulting nodes/edges through the same adapter, thereby keeping the code knowledge graph and the generic entity graph in sync.  

* **Metadata Management** – EntityPersistence maintains a lightweight schema that maps each entity to an **ontology class** and a **type identifier**. This mapping is stored as node attributes in the graph, allowing fast look‑ups by type and enabling the learning components to filter entities based on ontology semantics.  

* **Consistency Guarantees** – By routing all write paths through the `GraphDatabaseAdapter`, EntityPersistence inherits the adapter’s batch‑write and error‑handling mechanisms. This design choice centralises consistency logic, reducing the risk of divergent state across ManualLearning and OnlineLearning pipelines.

---

## Integration Points  

EntityPersistence sits at the heart of the **KnowledgeManagement** hierarchy. Its primary integration points are:

* **ManualLearning & OnlineLearning** – Both sub‑components call into EntityPersistence for any entity lifecycle operation. ManualLearning uses it to persist manually curated entities, while OnlineLearning relies on it after batch analysis of git history and LSL sessions to store newly discovered concepts.  

* **GraphDatabaseStorage** – Shares the same `GraphDatabaseAdapter` instance, meaning any configuration change (e.g., switching LevelDB directories) propagates automatically to EntityPersistence.  

* **CodeKnowledgeGraph** – Leverages the same `CodeGraphAgent` that EntityPersistence uses to construct the AST‑based graph. This creates a tight coupling where updates to the code‑graph agent affect both the code‑specific knowledge graph and the generic entity graph.  

* **UKBTraceReporting** – Although its purpose is workflow‑run reporting, it also uses the `GraphDatabaseAdapter`. This common dependency ensures that trace data and entity data coexist in the same underlying graph, simplifying cross‑entity queries (e.g., “which entities were touched by a given workflow run”).  

* **External Consumers** – Any component that needs to query entities (e.g., a semantic search UI) would interact with the `GraphDatabaseAdapter` directly or through a higher‑level query service that sits above EntityPersistence. The observations do not expose a dedicated query façade, but the adapter’s read methods are the de‑facto interface.

---

## Usage Guidelines  

1. **Always go through PersistenceAgent** – Direct calls to the `GraphDatabaseAdapter` from outside EntityPersistence bypass validation and metadata handling. Use `PersistenceAgent.createEntity`, `updateEntity`, or `deleteEntity` to guarantee that ontology class information is correctly recorded.  

2. **Batch operations for performance** – When inserting or updating many entities (as is common in OnlineLearning), wrap the calls in a batch provided by the adapter (`adapter.batch(() => { … })`). This reduces LevelDB I/O and keeps the graph in a consistent intermediate state.  

3. **Synchronise code‑graph updates** – If you modify the AST‑based code knowledge graph via `CodeGraphAgent`, immediately persist the resulting nodes through the same adapter. This prevents divergence between the code graph and the generic entity graph.  

4. **Respect metadata contracts** – Every entity must include both an `entityType` and an `ontologyClass`. Missing fields will cause the PersistenceAgent to reject the operation, preserving the integrity of downstream learning pipelines.  

5. **Handle errors at the agent level** – The PersistenceAgent surfaces adapter errors (e.g., LevelDB write failures) as domain‑specific exceptions. Catch these at the caller (ManualLearning or OnlineLearning) to implement retry or compensation logic, rather than swallowing them silently.  

---

### Architectural patterns identified  
* Layered adapter‑agent pattern (storage adapter → domain service agent).  
* Service composition (PersistenceAgent + CodeGraphAgent used together).  

### Design decisions and trade‑offs  
* **Centralised adapter** – simplifies consistency but creates a single point of failure; however, it enables uniform configuration across siblings.  
* **Agent‑centric validation** – keeps business rules out of low‑level storage code, at the cost of an extra indirection layer.  
* **Shared code‑graph agent** – promotes reuse but couples code‑graph generation tightly to entity persistence, which may limit independent evolution of the code‑graph subsystem.  

### System structure insights  
* EntityPersistence is a leaf sub‑component under **KnowledgeManagement**, but it is a shared service for several sibling components.  
* All persistence‑related concerns funnel through `GraphDatabaseAdapter`, establishing a common data‑access backbone.  
* Metadata (entity type, ontology class) is stored as node attributes, enabling fast type‑based queries throughout the system.  

### Scalability considerations  
* The batch‑write capability of the adapter supports high‑throughput ingestion (e.g., bulk entity creation during OnlineLearning).  
* Because the underlying store is LevelDB backed by Graphology, scaling is bounded by single‑process storage; horizontal scaling would require sharding or moving to a distributed graph store, which is not currently abstracted.  

### Maintainability assessment  
* Clear separation between storage (adapter) and business logic (agent) makes the codebase easy to understand and modify.  
* Reusing the same adapter across many components reduces duplication but also means changes to the adapter impact a wide surface area; thorough regression testing is essential.  
* Absence of a dedicated query façade may lead to ad‑hoc read logic scattered across callers, which could affect maintainability as the system grows. Adding a thin read‑service layer would improve encapsulation without disrupting existing patterns.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for efficient data storage and retrieval in the Graphology + LevelDB knowledge graph. This adapter enables the component to handle data persistence, graph database storage, and query capabilities seamlessly. For instance, the PersistenceAgent (src/agents/persistence-agent.ts) leverages the GraphDatabaseAdapter to store and retrieve entities from the graph database, demonstrating a clear example of how the component's architecture supports data management. Furthermore, the CodeGraphAgent (src/agents/code-graph-agent.ts) uses the GraphDatabaseAdapter to construct the AST-based code knowledge graph, facilitating semantic code search capabilities.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve manually curated entities.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning leverages the batch analysis pipeline to extract knowledge from git history and LSL sessions.
- [GraphDatabaseStorage](./GraphDatabaseStorage.md) -- GraphDatabaseStorage utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve graph data.
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraph utilizes the CodeGraphAgent (src/agents/code-graph-agent.ts) to construct the AST-based code knowledge graph.
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve workflow run data.


---

*Generated from 6 observations*

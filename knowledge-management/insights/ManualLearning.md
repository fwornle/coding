# ManualLearning

**Type:** SubComponent

The CodeKnowledgeGraph sub-component is used by ManualLearning for constructing and managing the code knowledge graph, enabling semantic code search and analysis.

## What It Is  

**ManualLearning** is a sub‑component that lives inside the **KnowledgeManagement** component. Its implementation is spread across the code‑base but the key interactions are anchored in three concrete files that appear in the observations:  

* `storage/graph-database-adapter.ts` – the low‑level storage adapter that all knowledge‑graph‑related components, including ManualLearning, rely on for persisting entities and relationships.  
* `agents/persistence-agent.ts` – the `PersistenceAgent` class whose `execute()` method is the entry point for persisting manual‑learning data through the GraphDatabaseAdapter.  
* The sibling sub‑components (`EntityManagement`, `OntologyClassification`, `CodeKnowledgeGraph`, `PersistenceService`) that ManualLearning composes to provide a full manual‑knowledge‑capture workflow.

In practice, ManualLearning enables users or external tools to **create entities and relationships by hand**, classify those entities using the ontology layer, and inject them into the **code knowledge graph** so that downstream features (semantic code search, analysis, etc.) can immediately benefit from the newly added knowledge.

---

## Architecture and Design  

The architecture that emerges from the observations is a **layered, composition‑based design** centred on a **shared GraphDatabaseAdapter**. The adapter lives in `storage/graph-database-adapter.ts` and abstracts the underlying Graphology + LevelDB persistence mechanism. All sibling sub‑components—including ManualLearning—depend on this single adapter, which enforces a **single source of truth for graph storage** and guarantees that every component writes to the same physical store.

ManualLearning does not implement its own persistence logic; instead it **delegates** to the **PersistenceAgent** (`agents/persistence-agent.ts`). The `execute()` function of the agent orchestrates the flow: it receives the manual‑learning payload, calls into the GraphDatabaseAdapter to create or update nodes/edges, and then hands off the data to higher‑level services (e.g., `PersistenceService`) for any post‑processing or transaction management. This separation of concerns mirrors a **service‑oriented internal layer** where the agent acts as a façade for persistence operations.

The component also **composes** three functional siblings:

1. **EntityManagement** – supplies CRUD‑style APIs for manual entities, again backed by the GraphDatabaseAdapter.  
2. **OntologyClassification** – classifies newly created entities into types/categories, using the same storage backend to persist classification results.  
3. **CodeKnowledgeGraph** – integrates the manually created entities into the broader code‑knowledge graph, making them available for semantic queries.

By re‑using these siblings, ManualLearning follows a **composition over inheritance** approach, allowing each concern (entity handling, classification, graph integration) to evolve independently while still participating in the manual‑learning workflow.

---

## Implementation Details  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
The adapter encapsulates Graphology’s in‑memory graph model together with LevelDB’s durable storage. Its public API likely includes methods such as `addNode`, `addEdge`, `updateNode`, and `query`. Because every sub‑component (EntityManagement, OntologyClassification, CodeKnowledgeGraph, PersistenceService, and ManualLearning) uses this adapter, it serves as the **canonical gateway** to the knowledge graph.

### PersistenceAgent (`agents/persistence-agent.ts`) – `execute()`  
The `execute()` method is the operational heart of ManualLearning’s persistence. The observed flow is:

1. **Input validation** – the agent receives a payload describing manual entities and relationships.  
2. **Adapter interaction** – it calls the GraphDatabaseAdapter to materialise those entities in the graph.  
3. **Trigger downstream services** – after successful writes, it invokes the `PersistenceService` to finalize the transaction (e.g., commit, emit events, or trigger JSON export sync).  
4. **Error handling** – any failure bubbles back to the caller, ensuring that manual learning does not corrupt the graph.

Because `execute()` is a single, well‑named entry point, developers can invoke ManualLearning persistence in a **consistent, testable** manner without needing to know the internal storage details.

### EntityManagement, OntologyClassification, CodeKnowledgeGraph  
These siblings expose their own APIs (e.g., `EntityManagement.createEntity`, `OntologyClassification.classify`, `CodeKnowledgeGraph.addToGraph`). ManualLearning orchestrates calls to them in the order required for a complete manual‑learning cycle: first create the raw entity, then classify it, and finally embed it into the code knowledge graph. The fact that each sibling also depends on the same GraphDatabaseAdapter eliminates the need for data‑translation layers between them.

### PersistenceService  
While not described in depth, the `PersistenceService` is mentioned as the component that “manages the persistence of manually created entities and relationships in the knowledge graph.” It likely provides higher‑level transaction semantics (e.g., batch commits, rollback) and may expose hooks for other components that need to react to persistence events.

---

## Integration Points  

ManualLearning sits at the intersection of several key system pieces:

* **Parent – KnowledgeManagement**: All manual‑learning artifacts become part of the overall knowledge base managed by KnowledgeManagement. The parent component’s design (automatic JSON export sync, Graphology + LevelDB persistence) directly benefits ManualLearning because any entity persisted through ManualLearning is automatically available for export and downstream consumption.

* **Sibling – EntityManagement, OntologyClassification, CodeKnowledgeGraph, PersistenceService, GraphDatabaseAdapter, PersistenceAgent**: ManualLearning re‑uses the storage contract defined by GraphDatabaseAdapter, leverages the CRUD utilities of EntityManagement, obtains type information from OntologyClassification, and inserts the final graph structures via CodeKnowledgeGraph. The PersistenceAgent’s `execute()` method acts as the glue that ties these siblings together in a single transaction.

* **External Consumers**: Features such as semantic code search, LSL session analysis, or any component that queries the code knowledge graph will see manual entities instantly because they are persisted to the same graph store used by the rest of the system.

The only explicit **interface** visible from the observations is the `execute()` method of `PersistenceAgent`. All other interactions are inferred from the shared adapter usage and the naming of sibling APIs.

---

## Usage Guidelines  

1. **Always route manual‑learning persistence through `PersistenceAgent.execute()`** – this guarantees that the GraphDatabaseAdapter, PersistenceService, and any classification steps are applied consistently. Direct calls to the adapter bypass important orchestration logic and may lead to orphaned nodes or missing classifications.

2. **Create entities via EntityManagement first** – supply the minimal required attributes (e.g., identifier, raw metadata). This ensures that the entity exists in the graph before classification.

3. **Run OntologyClassification immediately after creation** – classification enriches the entity with type information that downstream graph queries rely on. The classification step should be idempotent; re‑classifying an already‑classified entity must not create duplicate edges.

4. **Add the entity to the CodeKnowledgeGraph** – use the APIs provided by the CodeKnowledgeGraph sibling to link the new entity to existing code‑level nodes (functions, modules, etc.). This step is essential for enabling semantic search across both automatically extracted and manually added knowledge.

5. **Handle errors at the agent level** – if `execute()` throws, roll back any partial writes via the PersistenceService. Do not attempt manual clean‑up of the graph; let the service manage consistency.

6. **Respect the automatic JSON export sync** – because KnowledgeManagement automatically exports the graph to JSON after each successful persistence, avoid mutating the graph directly after `execute()` returns; any additional changes should be performed through the same agent pathway to keep the export in sync.

---

### Architectural Patterns Identified  

* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the concrete storage (Graphology + LevelDB) behind a uniform API used by all components.  
* **Facade / Service Layer** – `PersistenceAgent.execute()` provides a single façade for the complex series of persistence, classification, and graph‑integration steps.  
* **Composition over Inheritance** – ManualLearning composes functionality from sibling sub‑components (EntityManagement, OntologyClassification, CodeKnowledgeGraph) rather than extending a base class.  
* **Layered Architecture** – A clear separation exists between the storage layer (adapter), the business‑logic layer (entity management, classification, graph construction), and the orchestration layer (persistence agent).

### Design Decisions and Trade‑offs  

* **Single Shared Adapter** – Guarantees data consistency and reduces duplication, but couples all sub‑components to the same storage technology, limiting the ability to swap out LevelDB without affecting the whole system.  
* **Centralised Persistence Agent** – Simplifies the call‑site for developers and ensures transactional integrity; however, it creates a single point of failure and may become a bottleneck if the manual‑learning workload scales dramatically.  
* **Explicit Classification Step** – Improves semantic richness of manual entities, yet introduces extra latency and a dependency on the ontology service being available at persistence time.  
* **Automatic JSON Export Sync** – Enables easy integration with external tools, but adds I/O overhead on every write operation, which could affect performance under heavy manual‑learning activity.

### System Structure Insights  

The system is organised as a **tree of components**: `KnowledgeManagement` at the root, with several peer sub‑components that each specialise in a particular aspect of knowledge handling. ManualLearning is a leaf node that **orchestrates** its peers to achieve its goal. All leaf components share the same persistence backbone, reinforcing a **cohesive data model** across the entire knowledge‑management domain.

### Scalability Considerations  

* **GraphDatabaseAdapter scalability** hinges on LevelDB’s write throughput and Graphology’s in‑memory representation. As the number of manual entities grows, memory consumption may become a limiting factor; sharding or partitioning the graph could be required.  
* **PersistenceAgent bottleneck** – Because all manual‑learning writes funnel through a single `execute()` method, concurrent writes will be serialized unless the agent internally batches or queues operations. Introducing async batching or a worker‑pool could improve throughput.  
* **Classification overhead** – OntologyClassification may involve rule evaluation or ML inference; scaling this service (e.g., via caching or background processing) will be necessary if manual‑learning volume spikes.

### Maintainability Assessment  

The **clear separation of concerns** (adapter, agent, specialised siblings) makes the codebase approachable: changes to storage details stay within `graph-database-adapter.ts`, while business‑logic updates reside in the respective sub‑components. The heavy reliance on a **single adapter** simplifies debugging because all graph mutations trace back to a common implementation. However, the tight coupling also means that a change in the adapter’s API propagates to every sibling, demanding careful versioning and comprehensive integration tests. The **facade‑style `execute()` method** centralises error handling and transaction logic, which aids maintainability but also requires diligent testing to avoid hidden side‑effects.

Overall, ManualLearning’s design is **well‑structured for extensibility** (new manual‑learning features can be added by extending the orchestration in `PersistenceAgent` or by plugging in additional classification rules) while retaining **high cohesion** with the rest of the KnowledgeManagement ecosystem.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for Graphology+LevelDB persistence allows for automatic JSON export sync, ensuring data consistency across the system. This design decision enables efficient data storage and retrieval, leveraging the strengths of both Graphology and LevelDB. The automatic JSON export sync feature, in particular, facilitates seamless integration with other components, as seen in the execute() function of the PersistenceAgent (agents/persistence-agent.ts), which relies on the GraphDatabaseAdapter for entity persistence and ontology classification.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline for extracting knowledge from git history, LSL sessions, and code analysis.
- [EntityManagement](./EntityManagement.md) -- EntityManagement relies on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving entity data.
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification relies on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving classification data.
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraph relies on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving code knowledge graph data.
- [PersistenceService](./PersistenceService.md) -- PersistenceService relies on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving persistence data.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter relies on the LevelDB database (storage/leveldb.ts) for storing and retrieving graph data.
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent relies on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving persistence data.


---

*Generated from 6 observations*

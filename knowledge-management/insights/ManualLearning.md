# ManualLearning

**Type:** SubComponent

ManualLearning relies on the CodeGraphAgent (src/agents/code-graph-agent.ts) to construct the AST-based code knowledge graph for semantic code search capabilities.

## What It Is  

**ManualLearning** is a *SubComponent* that lives inside the **KnowledgeManagement** component. Its concrete implementation can be found in the files that interact with the graph‑storage layer, most notably `storage/graph-database-adapter.ts`, `src/agents/persistence-agent.ts` and `src/agents/code-graph-agent.ts`. The sub‑component is responsible for ingesting **human‑curated knowledge** – direct edits, hand‑crafted observations, and other manually created entities – and persisting them into the system‑wide knowledge graph. Because ManualLearning is part of KnowledgeManagement, every piece of manually curated data becomes available to the broader ecosystem (e.g., online learning pipelines, trace reporting, and code‑search services).

## Architecture and Design  

The architecture that emerges from the observations is a **layered, adapter‑driven design** anchored on a single graph‑database abstraction.  

1. **Adapter Layer** – `GraphDatabaseAdapter` (located at `storage/graph-database-adapter.ts`) implements the *Adapter* pattern, encapsulating the concrete storage technology (Graphology + LevelDB) behind a uniform API. All components that need to read or write graph data, including ManualLearning, rely on this adapter instead of coupling directly to LevelDB.  

2. **Agent Layer** – Two agents sit on top of the adapter:  
   * `PersistenceAgent` (`src/agents/persistence-agent.ts`) provides CRUD‑style services for *entities* in the graph. ManualLearning delegates creation, update, and deletion of its manually curated entities to this agent, ensuring that the same validation, indexing and transaction logic used by the sibling **EntityPersistence** component is reused.  
   * `CodeGraphAgent` (`src/agents/code-graph-agent.ts`) builds the AST‑based code knowledge graph. ManualLearning calls this agent when a manually added code snippet needs to be woven into the semantic code‑search index, sharing the same pipeline that the sibling **CodeKnowledgeGraph** component uses.  

3. **Sub‑Component Boundary** – Within KnowledgeManagement, ManualLearning is a distinct *SubComponent* that collaborates with the **EntityPersistence** sub‑component (its own child) to manage entity lifecycle. This separation clarifies responsibilities: ManualLearning focuses on *what* is being added (human‑curated content), while EntityPersistence handles *how* those entities are persisted.  

The overall pattern is a **clear separation of concerns**: storage concerns are isolated in the adapter, business‑logic concerns in agents, and domain‑specific concerns (manual curation) in the ManualLearning sub‑component. The sibling components (OnlineLearning, GraphDatabaseStorage, UKBTraceReporting, etc.) all share the same adapter, reinforcing a **single source of truth** for graph data.

## Implementation Details  

* **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – Exposes methods such as `getNode`, `addNode`, `updateNode`, and `removeNode`. It hides the underlying Graphology API and LevelDB file handling, providing a stable contract for all higher‑level services.  

* **PersistenceAgent (`src/agents/persistence-agent.ts`)** – Wraps the adapter with domain‑level logic. Typical functions include `createEntity(entityDto)`, `updateEntity(id, patch)`, and `deleteEntity(id)`. The agent also triggers any indexing or event hooks required by the knowledge graph (e.g., updating reverse lookup tables). ManualLearning calls these functions whenever a user edits an entity through the UI or an import script.  

* **CodeGraphAgent (`src/agents/code-graph-agent.ts`)** – Parses source code into an abstract syntax tree (AST), then maps AST nodes to graph nodes and edges. The agent uses the adapter to persist the resulting sub‑graph. ManualLearning invokes this agent when a manually entered code fragment must be searchable via the semantic code‑search feature.  

* **EntityPersistence Sub‑Component** – Though not a separate file in the observations, it is explicitly mentioned as “crucial for ManualLearning.” It likely consists of a thin façade over `PersistenceAgent`, exposing a higher‑level API such as `addManualEntity`, `modifyManualEntity`, and `removeManualEntity`. This façade isolates ManualLearning from the broader persistence contract, allowing future changes to the underlying agent without breaking ManualLearning’s callers.  

* **Interaction Flow** – A typical manual edit follows this path:  
  1. UI/CLI captures a human‑curated observation.  
  2. ManualLearning receives the raw payload and forwards it to **EntityPersistence**.  
  3. EntityPersistence calls `PersistenceAgent.createEntity`, which in turn uses `GraphDatabaseAdapter.addNode`.  
  4. If the payload contains code, ManualLearning also triggers **CodeGraphAgent** to enrich the graph with AST‑derived nodes.  

All file paths and class names are preserved exactly as observed, ensuring traceability from the design document to the source.

## Integration Points  

ManualLearning sits at the nexus of several system modules:  

* **Parent – KnowledgeManagement** – The parent component orchestrates the overall knowledge graph. ManualLearning contributes the “human‑curated” slice, which KnowledgeManagement aggregates with automatically extracted knowledge (e.g., from **OnlineLearning**).  

* **Sibling – EntityPersistence** – Both ManualLearning and the sibling **EntityPersistence** component rely on the same `PersistenceAgent`. This shared dependency guarantees consistent handling of entity identifiers, schema validation, and indexing across manual and automated pipelines.  

* **Sibling – CodeKnowledgeGraph** – When ManualLearning adds code snippets, it uses the same `CodeGraphAgent` that **CodeKnowledgeGraph** uses to construct the AST‑based graph. This ensures that manually added code is indistinguishable from code harvested automatically, enabling uniform semantic search.  

* **Sibling – GraphDatabaseStorage & UKBTraceReporting** – These components also consume `GraphDatabaseAdapter`. Any change to the adapter’s contract (e.g., a new method signature) must be coordinated across all siblings, reinforcing the importance of the adapter as a stable integration contract.  

* **External Consumers** – Downstream services (e.g., LLM‑driven query engines, UI dashboards) query the knowledge graph via the adapter indirectly. Because ManualLearning’s data resides in the same graph, no special routing is required; the same query endpoints serve both manual and automated knowledge.  

## Usage Guidelines  

1. **Always go through the PersistenceAgent** – Direct calls to `GraphDatabaseAdapter` from ManualLearning code should be avoided. The agent encapsulates validation, indexing, and transaction semantics that are essential for graph consistency.  

2. **Leverage EntityPersistence for lifecycle ops** – When adding, updating, or deleting a manually curated entity, use the façade provided by the EntityPersistence sub‑component. This isolates ManualLearning from future changes in the agent’s API.  

3. **Invoke CodeGraphAgent only for code‑related payloads** – If a manual entry includes source code that needs to be searchable, route it through `CodeGraphAgent`. Do not attempt to manually construct AST nodes; let the agent handle parsing and graph mapping.  

4. **Respect the shared schema** – All entities stored via ManualLearning must conform to the same schema used by automated pipelines (e.g., required `type`, `createdAt`, `source` fields). Divergence will break downstream queries that assume a uniform shape.  

5. **Batch writes when possible** – While manual edits are typically low‑volume, grouping multiple create/update operations into a single transaction (via the agent’s batch API, if available) reduces write amplification on LevelDB and improves overall throughput.  

6. **Test against the adapter contract** – Because many components depend on `GraphDatabaseAdapter`, any modification to its interface should be covered by integration tests that exercise ManualLearning, EntityPersistence, and the other siblings.  

## Architectural Patterns Identified  

| Pattern | Where It Appears | Rationale |
|---------|------------------|-----------|
| **Adapter** | `storage/graph-database-adapter.ts` | Abstracts Graphology + LevelDB behind a stable API used by all components. |
| **Agent (Service) Layer** | `src/agents/persistence-agent.ts`, `src/agents/code-graph-agent.ts` | Encapsulates domain‑specific operations (CRUD, AST construction) and provides a reusable service surface. |
| **Facade (Sub‑Component)** | EntityPersistence sub‑component (used by ManualLearning) | Offers a thin, purpose‑specific interface over the PersistenceAgent, shielding ManualLearning from implementation details. |
| **Layered Architecture** | Overall stack (UI → ManualLearning → EntityPersistence → PersistenceAgent → GraphDatabaseAdapter) | Enforces separation of concerns and promotes independent evolution of each layer. |

## Design Decisions and Trade‑offs  

* **Single Graph Store vs. Multiple Stores** – The decision to centralize all knowledge (manual, online, trace data) in one graph database simplifies query semantics and guarantees referential integrity, but it can become a performance bottleneck if write volume spikes. ManualLearning’s low‑frequency writes mitigate this risk.  

* **Agent‑Centric Business Logic** – Placing CRUD and AST‑generation logic in agents avoids duplication across siblings. The trade‑off is that agents become a critical point of failure; they must be well‑tested and versioned carefully.  

* **Explicit Sub‑Component (EntityPersistence)** – Introducing a dedicated sub‑component for entity lifecycle isolates ManualLearning’s responsibilities, improving readability. However, it adds an extra indirection layer, which can slightly increase call‑stack depth and debugging complexity.  

* **No Direct Storage Calls in ManualLearning** – By forbidding direct use of `GraphDatabaseAdapter` inside ManualLearning, the design enforces consistency but limits flexibility for edge‑case optimizations that might bypass the agent.  

## System Structure Insights  

* **Vertical Integration** – ManualLearning is vertically integrated from the UI/CLI (input) down to the low‑level storage (LevelDB) through a well‑defined chain of components.  

* **Horizontal Reuse** – Siblings share the same adapters and agents, demonstrating a high degree of horizontal code reuse. This reduces duplication and ensures that any improvement to, say, the indexing logic in `PersistenceAgent` instantly benefits ManualLearning and all other consumers.  

* **Clear Ownership** – KnowledgeManagement owns the graph; ManualLearning owns the “human‑curated” slice; EntityPersistence owns the entity‑lifecycle slice. This clear ownership model aids both mental mapping and future refactoring.  

## Scalability Considerations  

* **Write Scaling** – ManualLearning’s write pattern is sporadic, so LevelDB’s single‑process write lock is not a limiting factor under normal operation. If manual contributions were to increase (e.g., crowd‑sourced curation), a sharding strategy or migration to a multi‑writer graph store would be required.  

* **Read Scaling** – Since all knowledge resides in a single graph, read traffic from downstream services (semantic search, LLM queries) is shared across manual and automated data. Indexes built by `PersistenceAgent` and `CodeGraphAgent` must be kept up‑to‑date; otherwise, query latency could degrade as the graph grows.  

* **Horizontal Scaling via Adapter** – The `GraphDatabaseAdapter` abstracts the storage backend, meaning the system could swap LevelDB for a distributed graph store (e.g., Neo4j, Dgraph) with minimal changes to ManualLearning, provided the adapter’s contract remains stable.  

## Maintainability Assessment  

* **High Cohesion, Low Coupling** – ManualLearning’s responsibilities are narrowly focused, and its dependencies (agents, adapter) are injected via well‑defined interfaces. This yields high cohesion and low coupling, facilitating independent evolution.  

* **Testability** – Because ManualLearning interacts with agents rather than the storage layer directly, unit tests can mock `PersistenceAgent` and `CodeGraphAgent`, achieving fast, deterministic test suites. Integration tests that spin up the real adapter provide confidence that the graph schema remains consistent.  

* **Documentation Footprint** – The explicit naming of files and classes (`graph-database-adapter.ts`, `persistence-agent.ts`, `code-graph-agent.ts`) aids discoverability. However, the lack of visible code symbols in the observation set suggests that additional inline documentation (e.g., JSDoc) would be valuable for future maintainers.  

* **Risk Areas** – The shared `GraphDatabaseAdapter` is a single point of failure; any breaking change ripples across all siblings. Strict versioning and backward‑compatible extensions are essential. Additionally, the manual nature of the data entry process introduces the risk of schema drift; validation logic inside `PersistenceAgent` must be robust.  

---

**In summary**, ManualLearning is a well‑encapsulated sub‑component that leverages a common graph‑database adapter and two purpose‑built agents to integrate human‑curated knowledge into the broader KnowledgeManagement ecosystem. Its architecture emphasizes reuse, clear separation of concerns, and a stable storage contract, positioning it for reliable operation while still leaving room for future scaling or storage‑backend evolution.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for efficient data storage and retrieval in the Graphology + LevelDB knowledge graph. This adapter enables the component to handle data persistence, graph database storage, and query capabilities seamlessly. For instance, the PersistenceAgent (src/agents/persistence-agent.ts) leverages the GraphDatabaseAdapter to store and retrieve entities from the graph database, demonstrating a clear example of how the component's architecture supports data management. Furthermore, the CodeGraphAgent (src/agents/code-graph-agent.ts) uses the GraphDatabaseAdapter to construct the AST-based code knowledge graph, facilitating semantic code search capabilities.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning leverages the batch analysis pipeline to extract knowledge from git history and LSL sessions.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve entities.
- [GraphDatabaseStorage](./GraphDatabaseStorage.md) -- GraphDatabaseStorage utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve graph data.
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraph utilizes the CodeGraphAgent (src/agents/code-graph-agent.ts) to construct the AST-based code knowledge graph.
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve workflow run data.


---

*Generated from 6 observations*

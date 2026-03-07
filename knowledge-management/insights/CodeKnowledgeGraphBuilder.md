# CodeKnowledgeGraphBuilder

**Type:** GraphDatabase

CodeKnowledgeGraphBuilder uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.

## What It Is  

The **CodeKnowledgeGraphBuilder** is the concrete component that assembles a knowledge graph of a code‑base by parsing source files into an Abstract Syntax Tree (AST), performing semantic analysis, and persisting the resulting entities into the system’s graph store.  All of the low‑level storage work is delegated to the **GraphDatabaseAdapter** found in `storage/graph-database-adapter.ts`.  Although the source file for the builder itself has not been enumerated in the observations, the naming convention and surrounding documentation strongly indicate that its implementation lives in `code-knowledge-graph-builder.ts`.  Within the broader **KnowledgeManagement** component, the builder is the engine that transforms raw code artefacts into structured graph data that can later be queried, enriched, or visualised by downstream services such as **QueryEngine**, **ManualLearning**, and **OnlineLearning**.

## Architecture and Design  

The architecture around **CodeKnowledgeGraphBuilder** follows a clear *adapter‑centric* style.  The **GraphDatabaseAdapter** abstracts the concrete Graphology + LevelDB backend behind a thin, purpose‑built API.  By exposing an `initialize` method that implements “intelligent routing” (i.e., choosing the VKB API when it is reachable and falling back to direct LevelDB access otherwise), the adapter acts as a *strategy* layer that shields the builder from storage‑specific concerns.  This separation enables the builder to focus exclusively on graph construction logic—AST traversal, node/edge creation, and semantic enrichment—while delegating persistence, synchronization, and export (automatic JSON export) to the adapter.

The component hierarchy shows **CodeKnowledgeGraphBuilder** as a child of **KnowledgeManagement**, which itself coordinates several sibling sub‑components (e.g., **EntityPersistence**, **OntologyManager**, **GraphDatabaseManager**).  All of these siblings also rely on the same `storage/graph-database-adapter.ts`, indicating a shared‑adapter pattern that promotes consistency in how graph data is read and written across the system.  The builder may additionally collaborate with **EntityPersistence** for fine‑grained CRUD operations on individual graph entities and with **OntologyManager** for classifying newly created nodes against the domain ontology.  This collaborative design resembles a *facade* where **CodeKnowledgeGraphBuilder** offers a high‑level “build” operation that internally orchestrates lower‑level services.

## Implementation Details  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – The adapter’s public API includes an `initialize` method that performs “intelligent routing”.  At start‑up it probes for the VKB API; if reachable, it routes all database calls through that remote service, otherwise it opens a direct LevelDB instance backed by Graphology.  The adapter also implements automatic JSON export synchronization, ensuring that any mutation performed by the builder is reflected in a portable JSON snapshot.

2. **CodeKnowledgeGraphBuilder (`code-knowledge-graph-builder.ts`)** – The builder likely exports a class (e.g., `CodeKnowledgeGraphBuilder`) that receives an instance of the adapter via constructor injection.  Its core workflow can be broken into three phases:  
   * **AST Generation** – Using a language‑specific parser (e.g., TypeScript compiler API, Babel, or Esprima) the builder produces an AST for each source file.  
   * **Semantic Analysis** – Traversal of the AST extracts symbols, relationships (inheritance, imports/exports, function calls), and contextual metadata (type information, documentation comments).  
   * **Graph Population** – For each discovered entity, the builder creates a node in the Graphology graph, assigns ontology‑based labels (via **OntologyManager**), and wires edges that capture the code relationships.  Persistence calls (`adapter.addNode`, `adapter.addEdge`, etc.) are batched where possible to minimise LevelDB I/O.

3. **EntityPersistence & OntologyManager** – While not directly visible in the observations, the builder’s mention of “may utilize the EntityPersistence sub‑component” and “may interact with the OntologyManager sub‑component” suggests that after node creation the builder delegates to **EntityPersistence** for any additional attribute storage (e.g., versioning, timestamps) and to **OntologyManager** for mapping raw symbols to higher‑level concepts (e.g., `Class`, `Interface`, `Service`).  This keeps the builder’s responsibilities narrow and lets each sub‑component evolve independently.

## Integration Points  

* **Parent – KnowledgeManagement** – The parent component orchestrates the overall lifecycle of knowledge extraction.  It triggers the builder when new code is checked in or when a batch analysis job (handled by **OnlineLearning**) is scheduled.  KnowledgeManagement also consumes the JSON export produced by the adapter for downstream reporting or backup.

* **Siblings – EntityPersistence, OntologyManager, GraphDatabaseManager** – All siblings share the same storage adapter, guaranteeing that any entity persisted by the builder is immediately visible to queries issued by **QueryEngine** or to learning pipelines in **ManualLearning** and **OnlineLearning**.  The shared adapter also means that configuration changes (e.g., switching from LevelDB to a remote VKB service) propagate uniformly across the entire knowledge‑graph ecosystem.

* **External – VKB API / LevelDB** – The adapter abstracts the two possible back‑ends.  When the VKB API is reachable, the builder’s persistence calls are translated into HTTP/WS requests; otherwise, the adapter opens a local LevelDB instance.  This dual‑mode operation enables the system to run in both cloud‑connected and offline development environments without code changes in the builder.

* **Export / Import – DataImporter** – The automatic JSON export generated by the adapter can be consumed by **DataImporter** for bulk loading into other analysis tools or for migration between environments.

## Usage Guidelines  

1. **Inject the Adapter** – Always construct the `CodeKnowledgeGraphBuilder` with an already‑initialized `GraphDatabaseAdapter`.  Do not call `initialize` inside the builder; let the surrounding **KnowledgeManagement** component perform initialization once at application start‑up.

2. **Batch Mutations** – When building large graphs (e.g., processing an entire repository), accumulate node/edge creations in memory and flush them in batches through the adapter.  This reduces the number of LevelDB write cycles and improves VKB API throughput.

3. **Ontology Alignment** – Before invoking the builder, ensure that the latest ontology is loaded via **OntologyManager**.  The builder relies on ontology labels to classify nodes; mismatched or missing ontology entries will result in generic “Unclassified” nodes.

4. **Error Handling** – Propagate any adapter errors (e.g., storage write failures, JSON export collisions) up to **KnowledgeManagement** so that the system can trigger a retry or fallback to a safe state.  The builder itself should treat storage failures as unrecoverable for the current build run.

5. **Testing in Isolation** – For unit tests, mock the `GraphDatabaseAdapter` interface rather than the concrete LevelDB implementation.  This keeps tests fast and deterministic, and mirrors the design intent of decoupling graph construction from persistence.

---

### 1. Architectural patterns identified  
* **Adapter pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB (and the optional VKB API).  
* **Strategy/intelligent routing** – The `initialize` method selects the optimal storage backend at runtime.  
* **Facade** – `CodeKnowledgeGraphBuilder` presents a high‑level “build graph” operation that internally coordinates parsing, analysis, and persistence.  

### 2. Design decisions and trade‑offs  
* **Backend flexibility** – By routing through an adapter, the system can run both locally (LevelDB) and in a cloud‑connected mode (VKB).  The trade‑off is a modest runtime cost for the routing logic and the need to keep the adapter API stable.  
* **Shared storage layer** – All sibling components use the same adapter, simplifying configuration but creating a single point of contention if write throughput spikes.  Batching in the builder mitigates this.  
* **Separation of concerns** – AST parsing and ontology classification are kept outside the adapter, preserving a clean boundary but requiring careful contract management between the builder and sub‑components like **EntityPersistence**.  

### 3. System structure insights  
The system is organized around a **KnowledgeManagement** hub that owns several specialized children (builder, persistence, ontology, import/export).  The common storage adapter sits at the core, acting as the glue that binds these children together.  This hierarchy yields a clear vertical flow: code → AST → semantic entities → graph nodes → persisted store → queries/learning pipelines.

### 4. Scalability considerations  
* **Batch processing** – The builder should process files in parallel where possible and batch database writes to avoid saturating LevelDB I/O or VKB request limits.  
* **JSON export size** – Automatic export may become large for massive codebases; consider streaming the export or partitioning the graph into sub‑graphs.  
* **Adapter routing** – In high‑load scenarios, preferring the remote VKB API (which can scale horizontally) over local LevelDB may improve throughput, provided network latency is acceptable.  

### 5. Maintainability assessment  
The clear separation between graph construction (`CodeKnowledgeGraphBuilder`) and storage (`GraphDatabaseAdapter`) makes the codebase easy to evolve: changes to the underlying graph engine or to the persistence format can be confined to the adapter without touching the builder logic.  Shared usage of the adapter across many siblings encourages reuse but also demands rigorous versioning of the adapter’s public API.  Overall, the design promotes maintainability, provided that the adapter remains stable and that comprehensive integration tests verify the interactions among builder, ontology, and persistence layers.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of the GraphDatabaseAdapter in storage/graph-database-adapter.ts enables seamless interaction with the Graphology+LevelDB database, facilitating automatic JSON export synchronization. This design choice allows for efficient data storage and retrieval, as evidenced by the adapter's initialize method, which implements intelligent routing for database access. By leveraging the VKB API when available and direct access otherwise, the component optimizes database interactions, as seen in the GraphDatabaseAdapter's initialize method.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, as described in the KnowledgeManagement component's description.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [DataImporter](./DataImporter.md) -- DataImporter uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [QueryEngine](./QueryEngine.md) -- QueryEngine uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.


---

*Generated from 7 observations*

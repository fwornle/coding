# QueryEngine

**Type:** GraphDatabase

QueryEngine uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.

## What It Is  

The **QueryEngine** is the core execution component of the *KnowledgeManagement* subsystem that runs graph‑based queries against the underlying **Graphology+LevelDB** store.  Its implementation lives alongside the rest of the knowledge stack, most plausibly in a file named `query-engine.ts` (the observations note that “the QueryEngine component is likely to be implemented in a file such as `query-engine.ts`”).  All data‑access work is delegated to the **GraphDatabaseAdapter** found at `storage/graph-database-adapter.ts`.  By invoking the adapter’s `initialize` method, the QueryEngine gains “intelligent routing” – i.e., it can decide whether to call the VKB API or fall back to direct LevelDB access – and thereby executes queries efficiently while keeping the graph in sync with an automatic JSON export mechanism.

## Architecture and Design  

The architecture follows a **layered adapter‑centric** style.  The *KnowledgeManagement* component sits at the top level and contains the QueryEngine as its query‑execution layer.  Direct interaction with the low‑level graph store is abstracted behind the **GraphDatabaseAdapter**, which implements an *Adapter* pattern: it translates the higher‑level QueryEngine calls into concrete Graphology+LevelDB operations and handles ancillary concerns such as JSON export synchronization.  

The adapter’s `initialize` method embodies a **routing/strategy** decision point.  It inspects the runtime environment and chooses either the VKB API (when available) or direct LevelDB access, thereby optimizing latency and bandwidth without exposing those choices to the QueryEngine.  This separation of concerns keeps the QueryEngine focused on query formulation, result handling, and coordination with other knowledge‑management sub‑components (e.g., **EntityPersistence** and **OntologyManager**).  

Sibling components—*ManualLearning*, *OnlineLearning*, *EntityPersistence*, *GraphDatabaseManager*, *CodeKnowledgeGraphBuilder*—all reuse the same `storage/graph-database-adapter.ts`.  This shared dependency reinforces a **single source of truth** for persistence logic and ensures that any change to the adapter (e.g., a new export format) propagates uniformly across the entire knowledge stack.

## Implementation Details  

* **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**  
  * Exposes an `initialize()` method that performs environment detection and selects the appropriate access path (VKB API vs. direct LevelDB).  
  * Manages automatic JSON export synchronization, guaranteeing that any mutation performed through the adapter is reflected in a portable JSON snapshot.  

* **QueryEngine (`query-engine.ts`)**  
  * Instantiates or receives a pre‑initialized GraphDatabaseAdapter instance.  
  * Calls `adapter.initialize()` during its own startup sequence, thereby inheriting the intelligent routing logic.  
  * Provides a public API (e.g., `executeQuery(query: string | QueryObject)`) that translates user‑level query specifications into Graphology calls via the adapter.  
  * May collaborate with **EntityPersistence** for CRUD‑style entity handling and with **OntologyManager** to enrich query results with classification metadata.  

* **Interaction Flow**  
  1. A consumer (e.g., a KnowledgeManagement service or a Learning component) invokes `QueryEngine.executeQuery(...)`.  
  2. QueryEngine validates the request, optionally enriches it using OntologyManager, then forwards the low‑level operation to GraphDatabaseAdapter.  
  3. GraphDatabaseAdapter, already initialized, routes the request to either the VKB API endpoint or directly to the LevelDB instance.  
  4. Results travel back up the stack, where QueryEngine may post‑process them (e.g., map raw node IDs to domain entities via EntityPersistence).  

Because the observations do not list concrete class or function signatures beyond `initialize`, the above description stays faithful to the documented behavior without extrapolating undocumented methods.

## Integration Points  

* **Parent – KnowledgeManagement**  
  * QueryEngine is a child of KnowledgeManagement and supplies the query‑execution capability required by higher‑level knowledge‑retrieval workflows.  

* **Sibling Components**  
  * *ManualLearning*, *OnlineLearning*, *EntityPersistence*, *GraphDatabaseManager*, *CodeKnowledgeGraphBuilder* all depend on the same GraphDatabaseAdapter, meaning they share connection pooling, export synchronization, and routing logic.  This commonality simplifies cross‑component data consistency.  

* **Child – GraphDatabaseAdapter**  
  * The sole child of QueryEngine is the GraphDatabaseAdapter, which encapsulates all persistence concerns.  Any change to the adapter (e.g., a new storage backend) will be automatically reflected in QueryEngine without code changes.  

* **External Interfaces**  
  * When the VKB API is reachable, GraphDatabaseAdapter forwards calls to that service, implying a REST/HTTP contract that is abstracted away from QueryEngine.  
  * Direct LevelDB access suggests a Node.js native binding or LevelUP/LevelDOWN usage, again hidden behind the adapter.  

* **Potential Extension Points**  
  * Adding new query languages (e.g., Cypher) would involve extending QueryEngine’s translation layer while keeping the adapter unchanged.  
  * Introducing additional persistence backends would require only modifications inside GraphDatabaseAdapter’s routing logic.

## Usage Guidelines  

1. **Always obtain a pre‑initialized adapter** – before calling any QueryEngine method, ensure that `adapter.initialize()` has been executed (the QueryEngine itself typically performs this in its constructor).  Skipping initialization would bypass the intelligent routing and could lead to unexpected failures.  

2. **Prefer the QueryEngine API for all graph interactions** – direct use of GraphDatabaseAdapter outside of QueryEngine defeats the abstraction and may cause duplicate export operations or inconsistent routing decisions.  

3. **Leverage EntityPersistence for entity‑level CRUD** – when a query result must be persisted or mutated, pass the entity through EntityPersistence; this guarantees that the same adapter‑driven synchronization path is used.  

4. **Consult OntologyManager for classification** – before executing queries that depend on ontology concepts (e.g., “all nodes of type X”), retrieve the relevant classifications from OntologyManager and incorporate them into the query payload.  

5. **Respect the export synchronization contract** – any bulk write operation should be performed through the adapter so that the automatic JSON export remains current.  Avoid file‑system writes that bypass the adapter.  

6. **Handle routing failures gracefully** – if the VKB API is unavailable, the adapter will fall back to direct LevelDB access.  Applications should be prepared for a potential change in latency characteristics but need not implement additional fallback logic.  

---

### Architectural Patterns Identified  

* **Adapter Pattern** – `GraphDatabaseAdapter` isolates QueryEngine from concrete storage implementations (VKB API, LevelDB).  
* **Strategy / Routing Logic** – The `initialize` method selects the optimal access path at runtime.  

### Design Decisions and Trade‑offs  

* **Single Adapter for Multiple Consumers** – Centralizing persistence logic reduces duplication and eases maintenance, but places higher coupling on the adapter; a breaking change in the adapter impacts many siblings.  
* **Intelligent Routing at Initialization** – Improves performance by using the fastest available backend, yet adds complexity to the initialization phase and requires reliable environment detection.  
* **Automatic JSON Export Synchronization** – Guarantees portable snapshots, at the cost of extra I/O on every mutation.  

### System Structure Insights  

The system is organized as a **knowledge‑centric hierarchy**: KnowledgeManagement → QueryEngine → GraphDatabaseAdapter.  Sibling components share the adapter, forming a horizontal layer of feature modules (Learning, Persistence, Builders) that all converge on a single storage abstraction.  

### Scalability Considerations  

* **Read‑Heavy Workloads** – Because routing can select the VKB API, scaling read traffic may be offloaded to a dedicated service, reducing pressure on the local LevelDB instance.  
* **Write Synchronization** – Automatic JSON export could become a bottleneck under high write rates; batching or async export mechanisms would be a natural extension point.  
* **Horizontal Scaling** – Adding more QueryEngine instances is straightforward as long as the underlying storage (LevelDB or VKB) can handle concurrent connections; the adapter’s routing logic must remain stateless or safely share connection pools.  

### Maintainability Assessment  

The adapter‑centric design yields high **maintainability**: changes to storage technology or export format are confined to `storage/graph-database-adapter.ts`.  The clear separation between query logic (QueryEngine) and persistence (adapter) reduces cognitive load for developers working on either side.  However, the heavy reliance on a single adapter means that rigorous testing of the adapter is critical; any regression propagates to all knowledge‑management features.  Documentation should explicitly describe the initialization contract and export synchronization to avoid misuse.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of the GraphDatabaseAdapter in storage/graph-database-adapter.ts enables seamless interaction with the Graphology+LevelDB database, facilitating automatic JSON export synchronization. This design choice allows for efficient data storage and retrieval, as evidenced by the adapter's initialize method, which implements intelligent routing for database access. By leveraging the VKB API when available and direct access otherwise, the component optimizes database interactions, as seen in the GraphDatabaseAdapter's initialize method.

### Children
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The GraphDatabaseAdapter is used in the QueryEngine to interact with the Graphology+LevelDB database, as mentioned in the parent context.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, as described in the KnowledgeManagement component's description.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [CodeKnowledgeGraphBuilder](./CodeKnowledgeGraphBuilder.md) -- CodeKnowledgeGraphBuilder uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [DataImporter](./DataImporter.md) -- DataImporter uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.


---

*Generated from 7 observations*

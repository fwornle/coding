# KnowledgeGraphQueryEngine

**Type:** SubComponent

KnowledgeGraphQueryEngine employs the ensureLLMInitialized() method, likely defined in the Wave agent classes, to ensure that the LLM instance is properly initialized before querying

## What It Is  

**KnowledgeGraphQueryEngine** is a sub‑component that lives inside the **KnowledgeManagement** module. Its implementation is spread across the code‑base that deals with graph‑database interaction, most notably the file **`storage/graph-database-adapter.ts`**, which provides the low‑level persistence API used by the engine. The engine’s primary responsibility is to accept a natural‑language query, ensure that a large language model (LLM) is ready for use, run the query through the LLM, and then store or retrieve the resulting knowledge entities in the underlying graph database.  

The engine re‑uses two existing infrastructure pieces:  

1. **GraphDatabaseAdapter** – the adapter that abstracts the Graphology + LevelDB backend for creating, updating, deleting, and reading graph nodes and edges.  
2. **EntityPersistenceManager** – a higher‑level manager that coordinates persistence of knowledge entities and is itself built on top of the same GraphDatabaseAdapter.  

Together they give KnowledgeGraphQueryEngine the ability to both **query** the graph for existing knowledge and **persist** new query results, keeping the knowledge graph up‑to‑date with the latest LLM‑derived insights.

---

## Architecture and Design  

The observations reveal a **lazy‑initialization** architecture for the LLM that mirrors the pattern used by the Wave agents. Each agent (and therefore KnowledgeGraphQueryEngine) follows a three‑step construction sequence:

1. **Constructor** – receives the repository path and the team identifier (`constructor(repoPath, team)`), but does **not** create the LLM immediately.  
2. **ensureLLMInitialized()** – a guard method (defined in the Wave agent hierarchy) that checks whether the LLM instance exists; if not, it creates one using a **factory pattern**.  
3. **execute(input)** – the public entry point that runs the actual query after the LLM is guaranteed to be ready.

This pattern isolates the heavyweight LLM creation from object construction, reducing start‑up cost and memory pressure when many agents are instantiated but only a subset actually perform queries.

The **factory pattern** for LLM creation is explicitly mentioned in the observations. By centralising LLM instantiation, the system can enforce a single configuration point, cache instances if desired, and swap out LLM implementations without touching the engine logic.  

On the persistence side, the engine leans on **GraphDatabaseAdapter** for all CRUD operations. The adapter abstracts the underlying storage (Graphology + LevelDB) and is shared across sibling components—**ManualLearning**, **EntityPersistenceManager**, and **DataLossTracker**—which all store different kinds of graph data using the same API. This creates a **shared‑adapter** architectural style that encourages consistency and reduces duplication of persistence code.

Overall, the design combines:

* **Lazy initialization** of heavyweight resources (LLM)  
* **Factory method** for LLM creation  
* **Adapter pattern** for graph storage (GraphDatabaseAdapter)  
* **Manager/Facade** (EntityPersistenceManager) for higher‑level entity handling  

These patterns together give KnowledgeGraphQueryEngine a clear separation between *query execution* and *data persistence* while reusing common infrastructure.

---

## Implementation Details  

### LLM Lifecycle  
The engine’s constructor stores `repoPath` and `team` but postpones LLM creation. When `execute(input)` is called, the first step is a call to `ensureLLMInitialized()`. This method (inherited from the Wave agents) checks an internal field such as `_llm` and, if undefined, invokes the LLM factory—likely a static method like `LLMFactory.create(team)`—to obtain a ready‑to‑use LLM instance. Because the factory is shared across all Wave agents, any configuration changes (model version, temperature, token limits) automatically propagate to KnowledgeGraphQueryEngine.

### Query Execution Flow  
1. **Input Normalisation** – the raw user query is normalised (e.g., trimmed, language‑detected) before being fed to the LLM.  
2. **LLM Invocation** – the LLM processes the query and returns a structured representation of the knowledge entities it has inferred (e.g., a list of node definitions, edge relationships, or metadata).  
3. **Result Persistence** – the engine hands the LLM output to **EntityPersistenceManager**, which in turn uses **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`) to create or update graph nodes/edges. The adapter provides methods such as `createNode()`, `updateNode()`, `deleteNode()`, and query helpers like `findNodeById()`.

### Storing Query Results  
Observations state that the engine “stores query results in the graph database using the GraphDatabaseAdapter, allowing for efficient retrieval and querying of knowledge entities.” Practically, this means each LLM‑derived entity is persisted as a graph node with properties (e.g., `type`, `source`, `timestamp`) and edges that capture relationships (e.g., “depends‑on”, “derived‑from”). The same adapter is also used by **ManualLearning** and **DataLossTracker**, meaning the schema for these nodes is consistent across the system.

### Interaction with EntityPersistenceManager  
EntityPersistenceManager abstracts the raw adapter calls, offering higher‑level methods such as `saveKnowledgeEntity(entity)` or `fetchKnowledgeEntity(id)`. KnowledgeGraphQueryEngine delegates persistence responsibilities to this manager, keeping the engine focused on query orchestration rather than low‑level storage concerns.

---

## Integration Points  

* **Parent – KnowledgeManagement** – KnowledgeGraphQueryEngine is a child of the KnowledgeManagement component, which itself adopts the same LLM‑factory and lazy‑init pattern. KnowledgeManagement likely orchestrates when the engine is invoked (e.g., in response to user‑facing queries or scheduled knowledge refresh jobs).  

* **Sibling – ManualLearning** – Both ManualLearning and KnowledgeGraphQueryEngine use the same GraphDatabaseAdapter, meaning they share the same storage format. ManualLearning may populate the graph with human‑curated entities, which KnowledgeGraphQueryEngine can later query or augment.  

* **Sibling – OnlineLearning** – While OnlineLearning extracts knowledge from git history and LSL sessions, the results it produces are eventually persisted via EntityPersistenceManager, the same path that KnowledgeGraphQueryEngine follows for its own results. This creates a unified pipeline where both automated extraction and LLM‑driven inference converge onto the same graph.  

* **Sibling – EntityPersistenceManager** – Directly called by KnowledgeGraphQueryEngine for all CRUD actions. The manager hides the adapter’s API surface, providing a stable contract for any component that needs to store or retrieve entities.  

* **Sibling – DataLossTracker** – Also uses GraphDatabaseAdapter to log data‑loss events. Because all components write to the same underlying graph, cross‑component queries (e.g., “show all knowledge entities that were lost in the last release”) become straightforward.  

* **External – GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – The sole persistence gateway. Any change to the underlying LevelDB schema or Graphology configuration will ripple through all components, so its interface stability is critical.  

* **LLM Factory (Wave agents)** – The shared factory that creates LLM instances is the bridge between KnowledgeGraphQueryEngine and the language‑model infrastructure. Any modification to model selection, caching strategy, or authentication lives here, not inside the engine.

---

## Usage Guidelines  

1. **Instantiate with Context** – Always create KnowledgeGraphQueryEngine with the correct `repoPath` and `team` values. These parameters are used both for locating the LevelDB store and for selecting the appropriate LLM configuration via the factory.  

2. **Rely on Lazy Initialization** – Do not manually call the LLM factory; instead, invoke `execute(input)` and let `ensureLLMInitialized()` handle creation. This avoids unnecessary resource allocation when the engine is constructed but never used.  

3. **Persist Through EntityPersistenceManager** – When extending or customizing the engine, interact with EntityPersistenceManager for any persistence operation. Direct calls to GraphDatabaseAdapter should be avoided to keep the abstraction layer intact and to benefit from any future manager‑level validation or transformation logic.  

4. **Follow the Shared Schema** – Since siblings like ManualLearning and DataLossTracker share the same graph schema, adhere to the property conventions defined by EntityPersistenceManager (e.g., `type`, `source`, `createdAt`). Introducing divergent node structures will break cross‑component queries.  

5. **Handle Errors Gracefully** – Both the LLM call and the graph adapter can throw runtime errors (e.g., network timeouts, LevelDB corruption). Wrap `execute` in try/catch blocks and surface meaningful messages to callers, allowing higher‑level orchestration (KnowledgeManagement) to decide on retries or fallbacks.  

6. **Testing** – Unit tests should mock the LLM factory and GraphDatabaseAdapter separately. Because the engine defers LLM creation, tests can inject a mock LLM instance via the factory or by spying on `ensureLLMInitialized()`. Persistence tests should use an in‑memory LevelDB instance to verify that EntityPersistenceManager correctly writes nodes.  

---

### Architectural patterns identified  

* **Lazy‑initialization** of heavyweight resources (LLM) via `ensureLLMInitialized()`  
* **Factory Method** for creating LLM instances (shared across Wave agents)  
* **Adapter Pattern** (`GraphDatabaseAdapter`) to abstract Graphology + LevelDB storage  
* **Facade/Manager** (`EntityPersistenceManager`) providing a higher‑level API over the adapter  

### Design decisions and trade‑offs  

* **Lazy LLM init** reduces start‑up cost but adds a small runtime check on every `execute`.  
* **Centralised LLM factory** simplifies configuration changes but creates a single point of failure if the factory misbehaves.  
* **Shared GraphDatabaseAdapter** promotes consistency across components; however, any change to the adapter’s contract impacts all siblings, increasing coupling.  
* **Persisting query results** directly into the graph enables fast downstream retrieval but may increase graph size; pruning or archiving strategies must be considered.  

### System structure insights  

KnowledgeGraphQueryEngine sits at the intersection of **LLM‑driven inference** and **graph persistence**. It leans on the parent KnowledgeManagement for orchestration, shares persistence infrastructure with ManualLearning, EntityPersistenceManager, and DataLossTracker, and feeds its results back into the same graph that OnlineLearning populates. This creates a tightly integrated knowledge‑graph ecosystem where all knowledge creation paths converge onto a single source of truth.  

### Scalability considerations  

* **LLM scaling** – Because LLM instances are created lazily and potentially cached by the factory, the system can handle bursts of queries without pre‑allocating many models. Horizontal scaling would involve deploying multiple factory‑backed LLM workers.  
* **Graph storage** – LevelDB is an embedded key‑value store; as the graph grows, read/write latency may increase. Sharding or migrating to a distributed graph store would be a future scalability path, but would require changes to GraphDatabaseAdapter.  
* **Concurrent access** – Multiple agents may simultaneously invoke `execute`, leading to concurrent writes via EntityPersistenceManager. The adapter must guarantee thread‑safe operations (LevelDB provides atomic batch writes).  

### Maintainability assessment  

The component benefits from **clear separation of concerns**: LLM handling, query orchestration, and persistence are each isolated behind well‑named methods and shared abstractions. The reliance on a single adapter reduces code duplication, making bug fixes and enhancements localized. However, the tight coupling to the shared GraphDatabaseAdapter means that any breaking change to the underlying storage API will ripple through all siblings, demanding careful versioning and thorough integration testing. Overall, the design is **moderately maintainable**—easy to extend query logic, but changes to storage or LLM configuration require coordinated updates across the whole KnowledgeManagement family.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a factory pattern for creating LLM instances, as seen in the Wave agents, which follow the constructor(repoPath, team) + ensureLLMInitialized() + execute(input) pattern for lazy LLM initialization. This pattern allows for efficient initialization of LLM instances only when required, reducing unnecessary resource allocation. The ensureLLMInitialized() method, likely defined in the Wave agent classes, ensures that the LLM instance is properly initialized before execution. This approach enables the component to manage resources effectively and optimize performance. The GraphDatabaseAdapter, employed for Graphology+LevelDB persistence, also plays a crucial role in storing and retrieving knowledge graph data, as defined in storage/graph-database-adapter.ts.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve manual knowledge entities
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [EntityPersistenceManager](./EntityPersistenceManager.md) -- EntityPersistenceManager utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve entities in the graph database
- [DataLossTracker](./DataLossTracker.md) -- DataLossTracker utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve data loss information

---

*Generated from 7 observations*

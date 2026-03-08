# OntologyClassifier

**Type:** SubComponent

OntologyClassifier uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph

## What It Is  

**OntologyClassifier** is a sub‑component that lives inside the **KnowledgeManagement** module.  All of its source code is anchored in the same repository that contains the `graph-database-adapter.ts` and `persistence-agent.ts` files.  The classifier is the logical engine that examines incoming entities and decides which ontology class they belong to.  It does this by delegating the actual graph operations to the **GraphDatabaseAdapter** (implemented in `graph-database-adapter.ts`), which supplies a type‑safe façade over the underlying **Graphology+LevelDB** store.  In practice, a `PersistenceAgent` (found in `persistence-agent.ts`) invokes OntologyClassifier to obtain the proper class label before persisting the entity, and the classifier also drives the automatic JSON‑export synchronisation that keeps the LevelDB backing store in step with any external VKB API endpoint.

The component is deliberately lock‑free: when the server process is running it talks directly to the LevelDB graph, but when the server is stopped it can fall back to the VKB API without needing any heavyweight locking or transaction coordination.  This dual‑mode capability is a core part of its design and is exposed through the same `GraphDatabaseAdapter` interface, keeping callers (e.g., `PersistenceAgent`, `ManualLearning`, `PersistenceManager`) oblivious to the underlying transport.

---

## Architecture and Design  

The architecture centres on an **Adapter pattern**.  `graph-database-adapter.ts` defines the `GraphDatabaseAdapter` class, which abstracts the details of Graphology+LevelDB and the optional VKB API behind a single, type‑safe API.  OntologyClassifier consumes this adapter, meaning that the classifier does not need to know whether a read/write will hit a local LevelDB instance or a remote VKB service.  This separation of concerns enables the **lock‑free architecture** highlighted in the observations: the system can switch between direct database access and API calls transparently, avoiding contention and the need for explicit lock management.

A second, implicit pattern is **Separation of Classification and Persistence**.  `PersistenceAgent` (in `persistence-agent.ts`) is responsible for persisting entities, but it delegates the decision of *what* class an entity belongs to to OntologyClassifier.  This keeps the classification logic isolated, making it reusable across sibling components such as **ManualLearning** and **PersistenceManager**, both of which also rely on the same `GraphDatabaseAdapter`.  The shared adapter therefore becomes a common contract for all knowledge‑graph‑related sub‑components.

Finally, the design embraces **Event‑free synchronization** via “automatic JSON export sync”.  Rather than emitting events that other parts of the system must listen to, the `GraphDatabaseAdapter` itself writes a JSON snapshot whenever the graph changes.  This deterministic side‑effect simplifies the data‑flow model and contributes to the lock‑free guarantee because there is no asynchronous event queue that could introduce race conditions.

---

## Implementation Details  

At the heart of the implementation is the `GraphDatabaseAdapter` class defined in `graph-database-adapter.ts`.  It offers methods such as `addNode`, `addEdge`, `query`, and `exportJSON`.  These methods are typed, ensuring that callers—most notably OntologyClassifier—receive compile‑time guarantees about the shape of the data they manipulate.  The adapter internally decides whether to route a call to the **Graphology+LevelDB** engine (the default persistence layer) or to forward it to the **VKB API** when the local server is unavailable.  This decision logic is encapsulated within the adapter, so OntologyClassifier never contains conditional code for “online vs. offline” modes.

OntologyClassifier itself is a pure‑logic module.  It receives an entity (typically a plain JavaScript object) and, using the adapter’s query capabilities, inspects the current ontology graph to locate the most appropriate class node.  The classifier may employ rule‑based matching or similarity heuristics—details not exposed in the observations—but the output is a deterministic class identifier that is then handed back to the caller.  Because the classifier does not perform any I/O itself, it remains lightweight and easily testable.

The `PersistenceAgent` (in `persistence-agent.ts`) ties the two together.  When a new entity arrives, the agent calls `OntologyClassifier.classify(entity)`, receives the ontology class, and then invokes `GraphDatabaseAdapter.addNode` (or `addEdge` as appropriate) to store the entity together with its classification.  After the mutation, the adapter’s automatic JSON export mechanism writes a fresh snapshot to disk, guaranteeing that the LevelDB store and any external consumers stay in sync without additional coordination code.

---

## Integration Points  

OntologyClassifier sits directly under the **KnowledgeManagement** parent component.  All siblings that need to interact with the knowledge graph—**ManualLearning**, **PersistenceManager**, and **TraceReportGenerator**—share the same `GraphDatabaseAdapter`.  This common dependency means that any change to the adapter’s contract (e.g., adding a new query method) propagates uniformly across the entire knowledge‑management subsystem.

The primary integration surface for OntologyClassifier is the `classify` method (implicit from the observations).  Callers such as `PersistenceAgent` import the classifier and invoke it before persisting data.  Because the classifier relies on the adapter, the integration chain looks like:  

`PersistenceAgent → OntologyClassifier → GraphDatabaseAdapter → Graphology+LevelDB / VKB API → JSON export`.  

No other modules are mentioned as direct consumers of OntologyClassifier, but the design makes it trivial for future components to plug in the same classification step simply by importing the classifier and the adapter.

---

## Usage Guidelines  

1. **Always obtain a classifier instance through the KnowledgeManagement export** rather than constructing it manually; this ensures the underlying `GraphDatabaseAdapter` is correctly initialised with the current mode (local DB vs. VKB API).  
2. **Pass plain, serialisable entity objects** to the classifier.  Because the adapter enforces type safety, malformed payloads will be caught at compile time (or throw clear runtime errors).  
3. **Do not perform persistence inside OntologyClassifier**.  Its responsibility ends at returning the ontology class; persisting the result must be delegated to a dedicated agent such as `PersistenceAgent` or `PersistenceManager`.  
4. **Rely on the automatic JSON export** for any downstream processes that need a snapshot of the graph.  There is no need to trigger additional export calls; the adapter handles it after every mutation.  
5. **When testing, mock the GraphDatabaseAdapter** rather than the classifier.  Since the classifier is pure logic, a mock adapter that returns deterministic query results will allow unit tests to focus on classification rules without involving the LevelDB store or network calls.

---

### Architectural Patterns Identified  

* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts Graphology+LevelDB and VKB API behind a unified, type‑safe interface.  
* **Separation of Concerns** – Classification (OntologyClassifier) is decoupled from persistence (PersistenceAgent).  
* **Lock‑Free Design** – Dual‑mode operation (direct DB vs. API) eliminates the need for mutexes or transaction locks.  

### Design Decisions and Trade‑offs  

* **Lock‑free vs. Consistency** – By avoiding locks, the system gains responsiveness and simplicity, but it must rely on the adapter’s internal logic to keep the two data paths (LevelDB and VKB) consistent.  
* **Single Adapter for Multiple Consumers** – Centralising graph access reduces duplication but creates a single point of failure; any bug in the adapter impacts all siblings.  
* **Automatic JSON Export** – Guarantees a fresh snapshot but may introduce I/O overhead on every write; this trade‑off is acceptable for the current use‑case where real‑time external sync is required.  

### System Structure Insights  

The KnowledgeManagement hierarchy forms a **core graph‑centric layer**: the adapter sits at the bottom, providing low‑level access; OntologyClassifier sits just above it, adding domain‑specific logic; agents (PersistenceAgent, PersistenceManager, ManualLearning) sit on top, orchestrating workflow.  Sibling components share the same adapter, reinforcing a **horizontal cohesion** around the knowledge graph.  

### Scalability Considerations  

* **Horizontal scaling** is facilitated by the lock‑free approach; additional instances can read/write to the LevelDB store concurrently without contention, provided the underlying storage supports concurrent access.  
* **API fallback** allows the system to scale out to a distributed VKB service when the local LevelDB becomes a bottleneck, making the architecture adaptable to larger datasets.  
* **JSON export size** could become a limiting factor; large graphs may need incremental export or streaming rather than full‑snapshot writes.  

### Maintainability Assessment  

The clear separation between adapter, classifier, and agents makes the codebase **highly maintainable**.  Type safety enforced by the adapter reduces runtime errors, and the lock‑free model simplifies concurrency reasoning.  However, because many components share the same adapter, any change to its API requires coordinated updates across all siblings, which can increase the coordination overhead during refactors.  Overall, the design balances extensibility with simplicity, supporting straightforward unit testing and future feature addition.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [PersistenceManager](./PersistenceManager.md) -- PersistenceManager uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [CodeKnowledgeGraphConstructor](./CodeKnowledgeGraphConstructor.md) -- CodeKnowledgeGraphConstructor uses the batch analysis pipeline to construct the code knowledge graph
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the batch analysis pipeline to generate detailed trace reports of workflow runs and data flow
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology+LevelDB database for persistence


---

*Generated from 7 observations*

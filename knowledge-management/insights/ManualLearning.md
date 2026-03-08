# ManualLearning

**Type:** SubComponent

This sub-component might use the VKB API for certain knowledge graph operations, as suggested by the intelligent routing mechanism in the KnowledgeManagement component.

## What It Is  

**ManualLearning** is a sub‑component that lives inside the **KnowledgeManagement** component.  All concrete interactions that have been observed point to the file **`storage/graph-database-adapter.ts`**, where the **`storeEntity`** (and, by inference, an `updateEntity`) method is defined.  ManualLearning is the part of the system that lets a user or an automated agent create or edit knowledge‑graph entities by hand rather than through the automated pipelines found in the sibling **OnlineLearning** component.  The concrete UI‑level work is performed by its child component **EntityEditor**, which ultimately calls into the GraphDatabaseAdapter to persist the manually entered data.

The component does not appear to introduce its own persistence layer; instead it re‑uses the **Graphology+LevelDB** database that the rest of KnowledgeManagement relies on.  When a manual edit is submitted, the flow is: **EntityEditor → GraphDatabaseAdapter.storeEntity / updateEntity → Graphology+LevelDB**.  In addition, the surrounding KnowledgeManagement code may route the operation through the **IntelligentRouter**, which can switch between a direct LevelDB write and a remote **VKB API** call depending on runtime conditions.  This “intelligent routing” is mentioned explicitly in the observations and is shared with other siblings such as **IntelligentRouter** itself.

In short, ManualLearning is the hand‑crafted observation‑handling surface of the knowledge‑graph platform, built on top of the same storage and routing infrastructure that powers the rest of KnowledgeManagement.

---

## Architecture and Design  

The architecture that ManualLearning participates in is a **layered persistence‑routing model**.  At the lowest level the **Graphology+LevelDB** database provides a key‑value store for graph entities.  Above it sits **GraphDatabaseAdapter** (in `storage/graph-database-adapter.ts`), which offers a thin, domain‑specific façade – methods like `storeEntity` and `updateEntity` – that translate higher‑level entity objects into the low‑level graph operations required by Graphology.  

On top of that façade the **IntelligentRouter** implements a simple **routing decision** pattern: when an operation originates from ManualLearning (or any other sub‑component), the router decides whether to invoke the local GraphDatabaseAdapter directly or to forward the request to the external **VKB API**.  The routing logic is described as “intelligent” in the observations, indicating that runtime heuristics (e.g., network availability, data size, or consistency requirements) guide the choice.  

ManualLearning itself does not introduce a new architectural style; it is a **client** of the adapter/router stack.  Its child **EntityEditor** is a UI‑oriented module that captures user edits and forwards them through the same `storeEntity`/`updateEntity` calls used by automated pipelines.  Because ManualLearning shares the same adapter and router as its siblings (**OnlineLearning**, **WaveController**, etc.), the system achieves **horizontal reuse** of persistence and routing logic, reducing duplication and ensuring consistent behavior across manual and automated knowledge ingestion paths.

---

## Implementation Details  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**  
   * Exposes `storeEntity(entity: GraphEntity): Promise<void>` – persists a newly created node or edge into the Graphology+LevelDB store.  
   * Likely also offers `updateEntity(id: string, changes: Partial<GraphEntity>)` for in‑place edits, as hinted by observation 6.  
   * Internally translates the high‑level entity shape into Graphology’s API (`graph.addNode`, `graph.mergeEdge`, etc.) and then writes the serialized form to LevelDB.  

2. **IntelligentRouter (sibling component)**  
   * Contains the “intelligent routing mechanism” that decides between a direct call to GraphDatabaseAdapter and a remote VKB API request.  
   * The routing decision is probably encapsulated in a method like `routeOperation(op: GraphOperation): Promise<Result>`; the exact signature is not observed, but the behavior is described.  

3. **EntityEditor (child of ManualLearning)**  
   * Provides the UI surface for manual creation and editing of entities.  
   * Calls `GraphDatabaseAdapter.storeEntity` for new entities and `updateEntity` for modifications.  
   * May also expose validation hooks or transformation utilities before delegating to the adapter, though those details are not explicit in the observations.  

4. **KnowledgeManagement (parent component)**  
   * Holds the overall orchestration, including the routing logic and the shared Graphology+LevelDB instance.  
   * ManualLearning is listed as a contained sub‑component, indicating that KnowledgeManagement is responsible for wiring ManualLearning’s dependencies (adapter, router, possibly configuration).  

5. **External VKB API**  
   * Mentioned as an alternative backend for graph operations.  When the IntelligentRouter selects the VKB path, the request likely goes through a thin HTTP client that conforms to the same `storeEntity`/`updateEntity` contract, ensuring that ManualLearning does not need to know whether the operation is local or remote.  

Overall, ManualLearning’s implementation is essentially a thin façade over the existing persistence stack, with the heavy lifting performed by GraphDatabaseAdapter and the routing decisions delegated to IntelligentRouter.

---

## Integration Points  

* **Parent – KnowledgeManagement**: ManualLearning receives its configuration (e.g., which routing policy to use) from KnowledgeManagement.  KnowledgeManagement also owns the shared Graphology+LevelDB instance, so ManualLearning does not instantiate its own database.  

* **Sibling – IntelligentRouter**: All manual persistence calls pass through the router, meaning ManualLearning must import or be injected with the router’s service interface.  This allows the same routing heuristics that benefit OnlineLearning or WaveController to apply to manual edits.  

* **Sibling – GraphDatabaseAdapter**: Direct calls to `storeEntity`/`updateEntity` are made either by ManualLearning itself (when the router decides on a local path) or indirectly via the router.  The adapter lives in the `storage/` directory, making it a clear boundary between business logic and storage concerns.  

* **Child – EntityEditor**: The UI component that gathers user input.  It is the only visible entry point for manual edits, and it must conform to the adapter’s method signatures.  Any future UI enhancements (e.g., richer validation) will stay within EntityEditor, preserving the adapter contract.  

* **External – VKB API**: When the router selects the remote path, ManualLearning’s operations become part of a distributed workflow that may involve network latency, authentication, and versioning constraints imposed by the VKB service.  The router abstracts these concerns away from ManualLearning.  

These integration points illustrate a clear dependency direction: ManualLearning → (EntityEditor) → IntelligentRouter → GraphDatabaseAdapter → Graphology+LevelDB / VKB API.

---

## Usage Guidelines  

1. **Always go through the adapter** – ManualLearning code should never manipulate LevelDB or Graphology objects directly.  Use `storeEntity` for creation and `updateEntity` for edits to keep the persistence contract stable.  

2. **Let the IntelligentRouter decide** – Do not hard‑code a preference for local vs. remote storage.  Invoke the operation via the router’s public method (e.g., `router.routeStore(entity)`) so that future routing policy changes (e.g., switching to a new external graph service) require no changes in ManualLearning.  

3. **Validate before persisting** – EntityEditor should perform domain‑level validation (required fields, type constraints) before calling the adapter.  This prevents malformed graph nodes from reaching the storage layer and keeps the graph consistent.  

4. **Handle async errors gracefully** – Both the adapter and the router return promises.  Consumers of ManualLearning must `await` these calls and implement retry or fallback logic, especially when the VKB API is involved and network failures are possible.  

5. **Keep ManualLearning stateless** – All stateful information (e.g., current graph session, transaction IDs) is managed by KnowledgeManagement and the adapter.  ManualLearning should treat each edit as an independent request to aid testability and scalability.  

Following these guidelines will ensure that ManualLearning remains a thin, maintainable layer that leverages the robust persistence and routing infrastructure already present in the system.

---

### Architectural Patterns Identified  

* **Adapter Pattern** – `GraphDatabaseAdapter` translates domain entity objects into the Graphology+LevelDB API.  
* **Routing/Strategy Pattern** – `IntelligentRouter` selects between a local adapter call and a remote VKB API call at runtime.  
* **Facade Pattern** – ManualLearning (via EntityEditor) presents a simple “store / update” interface while hiding the complexity of routing and storage.  

### Design Decisions & Trade‑offs  

* **Reuse of a single persistence stack** (Graphology+LevelDB) reduces duplication but couples ManualLearning tightly to the graph schema used elsewhere.  
* **Intelligent routing** adds flexibility (can switch to VKB without code changes) at the cost of added runtime decision logic and potential latency when the remote path is chosen.  
* **Stateless UI layer (EntityEditor)** simplifies testing but pushes validation responsibility onto the UI rather than the storage layer.  

### System Structure Insights  

The system is organized as a hierarchy: **KnowledgeManagement** (root) → **ManualLearning** (sub‑component) → **EntityEditor** (child).  Parallel siblings (OnlineLearning, WaveController, etc.) share the same lower‑level services (adapter, router), illustrating a **horizontal service reuse** strategy.  

### Scalability Considerations  

* **LevelDB + Graphology** scales well for read‑heavy workloads and can handle large graphs, but write contention may become a bottleneck if many manual edits are submitted concurrently.  
* The **router’s ability to offload writes to the VKB API** provides an out‑of‑process scaling path, allowing the system to distribute load across a separate service.  
* Because ManualLearning is stateless, horizontal scaling of the UI layer (multiple EntityEditor instances) is straightforward; the only shared contention point is the underlying database.  

### Maintainability Assessment  

* **High maintainability** for the ManualLearning code itself: it contains only thin wrappers around well‑defined adapter methods.  
* **Medium maintainability** for the routing logic: any change in routing policy requires updates to IntelligentRouter, which is shared across many components.  
* **Low risk of regression** because ManualLearning does not embed custom persistence logic; updates to GraphDatabaseAdapter automatically propagate to ManualLearning.  

Overall, ManualLearning benefits from a clean separation of concerns, leveraging shared infrastructure while remaining easy to test, extend, and maintain.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of a Graphology+LevelDB database for persistence, as seen in the GraphDatabaseAdapter (storage/graph-database-adapter.ts), allows for efficient storage and querying of knowledge graphs. This choice of database is particularly noteworthy due to its ability to handle large amounts of data and provide a robust foundation for the component's intelligent routing mechanism. The intelligent routing, which switches between VKB API and direct database access, enables the component to optimize its interactions with the knowledge graph, thus improving overall performance. For instance, when an agent needs to store an entity, it can use the storeEntity method in GraphDatabaseAdapter, which ultimately relies on the Graphology+LevelDB database for persistence.

### Children
- [EntityEditor](./EntityEditor.md) -- The ManualLearning sub-component utilizes the storeEntity method in GraphDatabaseAdapter to persist manually created entities, implying a close relationship with the EntityEditor.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning probably utilizes a batch analysis pipeline, similar to the one described in batch-analysis.yaml, to extract knowledge from git history and other sources.
- [WaveController](./WaveController.md) -- WaveController implements work-stealing via a shared nextIndex counter, allowing idle workers to pull tasks immediately, as seen in the runWithConcurrency method.
- [UKBTraceReportGenerator](./UKBTraceReportGenerator.md) -- UKBTraceReportGenerator probably utilizes a report generation mechanism to create detailed trace reports for UKB workflow runs.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter utilizes the Graphology+LevelDB database for storing and querying knowledge graphs, as seen in the storeEntity method.
- [IntelligentRouter](./IntelligentRouter.md) -- IntelligentRouter utilizes the VKB API and direct database access to optimize interactions with the knowledge graph, as seen in the intelligent routing mechanism.


---

*Generated from 7 observations*

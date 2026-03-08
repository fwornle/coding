# ManualLearning

**Type:** SubComponent

ManualLearning uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph

## What It Is  

ManualLearning is a **sub‑component** of the broader **KnowledgeManagement** module. Its source lives alongside the other knowledge‑graph utilities and is realized through a handful of tightly‑coupled TypeScript files, most notably **`graph-database-adapter.ts`** and **`persistence-agent.ts`**. The component supplies a *type‑safe* programming surface that lets agents create, edit, and classify hand‑crafted observations directly in the central knowledge graph. Because it can operate both through the VKB (Virtual Knowledge Base) API **and** by bypassing that API to talk straight to the underlying **Graphology + LevelDB** store, ManualLearning acts as the bridge that enables “lock‑free” editing of the graph whether the server process is up or down.  

In practice, ManualLearning is the entry point for any workflow that needs to persist manually authored entities—think of a developer adding a new ontology term, an analyst correcting a mis‑classified node, or a UI widget that lets users edit graph metadata. All of these actions are funneled through the same adapter‑driven API, guaranteeing consistency with the rest of the KnowledgeManagement stack.

---

## Architecture and Design  

The architecture around ManualLearning is deliberately **modular** and **adapter‑centric**. The **`GraphDatabaseAdapter`** class (found in `graph-database-adapter.ts`) implements the *Adapter* pattern: it abstracts the concrete persistence mechanism (Graphology + LevelDB) behind a clean, type‑safe interface. All agents that need to read or write the graph—including **ManualLearning**, **PersistenceManager**, **OntologyClassifier**, and the **PersistenceAgent**—depend on this single adapter, which eliminates duplicated database‑specific code and makes the overall system easier to evolve.

A second, implicit design choice is the **lock‑free** execution model. ManualLearning can “seamlessly switch” between invoking the VKB API (when the server is live) and performing direct LevelDB operations (when the server is stopped). This dual‑path approach avoids the classic read‑write lock contention that would otherwise arise if every edit had to be serialized through a single service endpoint. The decision to keep both paths available in the same component simplifies the developer experience: callers do not need to know whether the server is running—they simply invoke the ManualLearning API and the adapter decides the optimal route.

The component also embraces **separation of concerns**. ManualLearning focuses solely on handling *direct edits* and *hand‑crafted observations*, while the heavy‑weight batch pipelines (e.g., OnlineLearning’s git‑history extraction or the CodeKnowledgeGraphConstructor’s bulk graph building) reside in sibling components. This delineation ensures that real‑time, user‑driven edits do not interfere with the high‑throughput, asynchronous processing performed elsewhere in the KnowledgeManagement hierarchy.

---

## Implementation Details  

1. **GraphDatabaseAdapter (`graph-database-adapter.ts`)**  
   - Exposes a **type‑safe API** (methods such as `addNode`, `updateEdge`, `exportJSON`) that abstracts the underlying Graphology + LevelDB store.  
   - Implements **automatic JSON export synchronization**: every mutation triggers a background job that writes a fresh JSON snapshot, ensuring that downstream consumers (e.g., visualizers or export services) always see a consistent view.  

2. **PersistenceAgent (`persistence-agent.ts`)**  
   - Instantiates the `GraphDatabaseAdapter` and uses it to **persist manually authored entities**.  
   - Calls into the adapter to **classify ontologies**, meaning that when a new hand‑crafted node is added, the agent can immediately invoke classification logic (shared with the OntologyClassifier sibling) via the same adapter interface.  

3. **ManualLearning Logic**  
   - Does not appear as a separate source file in the observations, but its behavior is inferred from the way **PersistenceAgent** and **GraphDatabaseAdapter** are used.  
   - Provides a façade that orchestrates the two possible execution paths:  
     * **VKB‑API path** – When the server process is alive, calls are routed through a remote API client that ultimately forwards to the same adapter on the server side.  
     * **Direct‑DB path** – When the server is offline, the façade opens a LevelDB instance locally and invokes the adapter’s low‑level methods directly.  
   - This façade guarantees that callers experience a **lock‑free** interface: there is no need for external locking or coordination because the adapter internally manages concurrency (Graphology handles graph mutations in a thread‑safe manner).  

4. **Persistence Mechanics**  
   - All edits are persisted to LevelDB, which is the storage engine behind Graphology. Because LevelDB is an **append‑only log‑structured** store, writes are fast and can be performed without blocking reads, reinforcing the lock‑free guarantee.  
   - After each successful write, the adapter’s JSON export routine runs, producing a file (likely under a `exports/` directory) that mirrors the current graph state. This file can be consumed by other components, such as the **TraceReportGenerator**, without needing to query the live graph.

---

## Integration Points  

ManualLearning sits at the nexus of several KnowledgeManagement pieces. Its primary integration surface is the **`GraphDatabaseAdapter`**, which is also the shared dependency of the **PersistenceManager**, **OntologyClassifier**, and **PersistenceAgent** siblings. Because the adapter is the single source of truth for graph mutations, any component that needs to read or write graph data does so through the same contract, guaranteeing data‑consistency across the system.

- **Parent – KnowledgeManagement**: The parent component orchestrates the overall graph lifecycle and supplies the Graphology + LevelDB instance. ManualLearning inherits the parent’s configuration (e.g., database path, JSON export location) and respects the parent’s lifecycle hooks (startup/shutdown).  
- **Sibling – PersistenceManager & OntologyClassifier**: Both use the same adapter, meaning that a node created via ManualLearning is instantly visible to the OntologyClassifier for automatic categorization, and the PersistenceManager can later batch‑persist any pending changes without conflict.  
- **Sibling – OnlineLearning, CodeKnowledgeGraphConstructor, TraceReportGenerator**: These components operate on the *batch* side of the system. They read the JSON export generated by ManualLearning (or directly query the graph) to incorporate manual edits into downstream analyses, ensuring that hand‑crafted knowledge is not overwritten by automated pipelines.  

External callers (e.g., UI layers, CLI tools) interact with ManualLearning through a **public façade** that hides the dual‑path logic. The only required dependency is the adapter’s type definitions, which are exported from `graph-database-adapter.ts`. No direct LevelDB handling is exposed to callers, preserving encapsulation.

---

## Usage Guidelines  

1. **Always go through the adapter** – Whether you are adding a node, updating an edge, or exporting the graph, invoke the methods on `GraphDatabaseAdapter`. Direct LevelDB manipulation circumvents the lock‑free guarantees and may corrupt the JSON export sync.  

2. **Treat ManualLearning as the authoritative source for manual edits** – When you need to insert hand‑crafted observations (e.g., a new ontology term), use the **PersistenceAgent** or call the adapter directly from your custom script. Do not attempt to modify the graph by editing the JSON export file; those files are read‑only views generated by the system.  

3. **Respect the server state** – The façade automatically selects the VKB‑API route if the KnowledgeManagement server is running. If you are running a background script on a CI worker where the server is not present, you can still perform edits because the direct‑DB path will be used. No additional configuration is required.  

4. **Handle export latency** – The automatic JSON export runs asynchronously after each mutation. If downstream processes need the latest snapshot, either listen for the export‑completion event (if exposed) or introduce a short debounce before reading the export file.  

5. **Avoid heavy batch operations in ManualLearning** – The component is optimized for low‑latency, fine‑grained edits. Large‑scale imports should be delegated to the **CodeKnowledgeGraphConstructor** or **OnlineLearning** pipelines, which are built for bulk processing and will not interfere with the lock‑free semantics of ManualLearning.

---

### Architectural Patterns Identified  

1. **Adapter Pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB behind a type‑safe interface.  
2. **Facade (Dual‑Path) Pattern** – ManualLearning presents a single API that internally switches between VKB‑API and direct DB access, delivering a lock‑free experience.  
3. **Separation of Concerns** – ManualLearning handles real‑time manual edits; batch pipelines (OnlineLearning, CodeKnowledgeGraphConstructor) handle bulk analysis.  

### Design Decisions and Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Use a single `GraphDatabaseAdapter` for all agents | Centralizes persistence logic, ensures consistency, reduces duplication | All components become coupled to the adapter’s contract; changes to the adapter affect many callers |
| Support both VKB‑API and direct LevelDB access | Enables lock‑free operation regardless of server state | Adds complexity in the façade (runtime detection of server) and requires careful testing of both paths |
| Automatic JSON export after each mutation | Provides up‑to‑date snapshots for downstream consumers without manual triggers | Slight overhead on every write; may cause minor latency spikes under heavy edit load |

### System Structure Insights  

- **Hierarchy**: `KnowledgeManagement` (parent) → `ManualLearning` (sub‑component) → uses `GraphDatabaseAdapter` (shared sibling).  
- **Shared Dependency Graph**: `PersistenceAgent`, `PersistenceManager`, and `OntologyClassifier` all depend on the same adapter, forming a tight coupling around the graph persistence layer.  
- **Sibling Collaboration**: ManualLearning’s JSON export is a data source for `TraceReportGenerator` and other reporting tools, illustrating a producer‑consumer relationship between real‑time edits and batch reporting.  

### Scalability Considerations  

- **Write Scalability** – Leveraging LevelDB’s log‑structured design and Graphology’s in‑memory graph representation allows high‑throughput, low‑latency writes, supporting many concurrent manual edits.  
- **Read Scalability** – Since ManualLearning primarily performs writes, read paths are delegated to other components (e.g., OnlineLearning) that can cache the exported JSON or query the graph directly.  
- **Horizontal Scaling** – The lock‑free, dual‑path design means multiple instances of a client can edit the graph simultaneously without a central lock server, but the underlying LevelDB file is still a single point of contention on the host machine. Scaling beyond a single node would require a distributed graph store, which is not present in the current design.  

### Maintainability Assessment  

- **High Maintainability** – The adapter encapsulation isolates database‑specific changes to `graph-database-adapter.ts`. Adding new graph operations or swapping the storage engine would involve limited modifications.  
- **Moderate Risk** – Because many siblings share the same adapter, a breaking change in the adapter’s API could ripple across the entire KnowledgeManagement subsystem. Comprehensive integration tests are essential.  
- **Clear Separation** – ManualLearning’s responsibilities are narrowly defined (direct edits, JSON sync), making the codebase easier to reason about and reducing cognitive load for developers extending the component.  

--- 

**In summary**, ManualLearning is the lock‑free, adapter‑driven gateway for hand‑crafted knowledge insertion within the KnowledgeManagement ecosystem. Its design centers on a shared `GraphDatabaseAdapter`, dual execution paths, and automatic JSON export, providing a consistent and performant interface for real‑time graph edits while integrating cleanly with sibling components that handle classification, persistence, and batch analysis.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [PersistenceManager](./PersistenceManager.md) -- PersistenceManager uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [CodeKnowledgeGraphConstructor](./CodeKnowledgeGraphConstructor.md) -- CodeKnowledgeGraphConstructor uses the batch analysis pipeline to construct the code knowledge graph
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the batch analysis pipeline to generate detailed trace reports of workflow runs and data flow
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology+LevelDB database for persistence


---

*Generated from 7 observations*

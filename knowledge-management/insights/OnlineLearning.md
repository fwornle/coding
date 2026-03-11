# OnlineLearning

**Type:** SubComponent

The CodeGraphAgent (src/agents/code-graph-agent.ts) is used by OnlineLearning to construct the AST-based code knowledge graph for semantic code search capabilities.

## What It Is  

**OnlineLearning** is a *SubComponent* of the **KnowledgeManagement** domain that automatically harvests, transforms, and persists knowledge from developers’ work‑flows. The core implementation lives in the batch‑analysis pipeline that ingests two primary data sources – **git history** and **LSL (Live Session Logging) sessions** – and produces structured artefacts that feed a graph‑based knowledge store.  

The pipeline orchestrates three concrete artefacts that appear in the source tree:  

1. **`src/agents/code-graph-agent.ts`** – the **CodeGraphAgent** that parses source files, builds an AST, and materialises an *AST‑based code knowledge graph* used for semantic code search.  
2. **`storage/graph-database-adapter.ts`** – the **GraphDatabaseAdapter** that abstracts the underlying Graphology + LevelDB graph database, providing CRUD‑style persistence for the automatically extracted entities.  
3. **`EntityPersistence`** (a sibling sub‑component) – the manager that drives creation, update and deletion of graph entities on behalf of OnlineLearning.  

In addition, **`UKBTraceReporting`** (another sibling) is invoked to emit detailed trace reports for each batch run, giving operators visibility into the workflow execution.

---

## Architecture and Design  

The observable architecture follows a **pipeline‑oriented, agent‑based** style anchored by an **adapter** abstraction for storage.  

* **Batch‑analysis pipeline** – The entry point is a scheduled or on‑demand batch job that pulls raw artefacts from git and LSL. This reflects a *batch processing* design rather than a streaming one, favouring deterministic runs and easier reproducibility.  

* **Agent pattern** – Both **CodeGraphAgent** and the (implicit) **PersistenceAgent** (referenced in the parent component description) act as autonomous workers that encapsulate a single responsibility: graph construction and entity persistence, respectively. By delegating to agents, OnlineLearning keeps the pipeline orchestration thin and testable.  

* **Adapter pattern** – The **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`) isolates the rest of the system from the concrete graph database (Graphology + LevelDB). All reads and writes—whether they originate from OnlineLearning, ManualLearning, EntityPersistence, or UKBTraceReporting—pass through this adapter, guaranteeing a uniform API surface.  

* **Sub‑component decomposition** – The **EntityPersistence** sub‑component is a dedicated manager for graph entity lifecycle. Its placement alongside siblings such as **ManualLearning** and **GraphDatabaseStorage** signals a *vertical slice* where each sibling focuses on a distinct acquisition or curation strategy but shares the same storage backbone.  

* **Trace reporting** – The **UKBTraceReporting** sub‑component is plugged into the pipeline to emit workflow‑run metadata, indicating a concern for observability that is baked into the architecture.  

Overall, the design emphasizes **separation of concerns** (data extraction vs. graph construction vs. persistence) while re‑using a common storage adapter across the KnowledgeManagement family.

---

## Implementation Details  

1. **Data Extraction** – The batch job reads **git commit objects** (file diffs, commit messages, authorship) and **LSL session logs** (runtime events, user interactions). The specifics of the extraction code are not listed, but the observations confirm that these two sources feed the downstream agents.  

2. **CodeGraphAgent (`src/agents/code-graph-agent.ts`)** –  
   * Parses each source file into an **Abstract Syntax Tree (AST)** using a language‑specific parser (e.g., TypeScript’s compiler API).  
   * Traverses the AST to identify entities such as classes, functions, imports, and references.  
   * Emits graph nodes and edges that capture *semantic relationships* (e.g., “calls”, “inherits”, “imports”).  
   * Hands the constructed sub‑graph to the **GraphDatabaseAdapter** for insertion.  

3. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** –  
   * Wraps **Graphology** (the in‑memory graph library) and **LevelDB** (persistent key‑value store).  
   * Exposes methods like `addNode`, `addEdge`, `findNodeById`, `query`, and `remove`.  
   * Implements transaction‑like semantics for batch inserts, ensuring that a complete knowledge‑graph update is atomic from the perspective of the pipeline.  

4. **EntityPersistence** – Though not a concrete file in the observations, this sub‑component orchestrates calls to the adapter:  
   * **Create** – When the CodeGraphAgent discovers a new code entity, EntityPersistence builds the corresponding graph node and persists it.  
   * **Update** – On subsequent batch runs, changes in git or LSL trigger updates (e.g., renames, moved functions).  
   * **Delete** – Stale entities that disappear from the source base are removed to keep the graph clean.  

5. **UKBTraceReporting** – After each batch execution, this sub‑component gathers metrics (run duration, number of nodes/edges created, errors) and stores them via the same **GraphDatabaseAdapter**. The stored trace data can later be visualised or audited, providing a feedback loop for developers and operators.  

All components share the **GraphDatabaseAdapter** as their persistence contract, reinforcing a uniform data model across the KnowledgeManagement hierarchy.

---

## Integration Points  

* **Parent – KnowledgeManagement** – OnlineLearning inherits the storage contract defined by KnowledgeManagement’s use of `GraphDatabaseAdapter`. The parent also supplies the broader *graph‑oriented* context (Graphology + LevelDB) that all siblings rely on.  

* **Siblings** –  
  * **ManualLearning** and **EntityPersistence** both call the same adapter for CRUD operations, meaning they can interoperate on the same graph without conflict.  
  * **GraphDatabaseStorage** is the low‑level storage implementation; any changes to its configuration (e.g., LevelDB tuning) affect OnlineLearning automatically.  
  * **CodeKnowledgeGraph** re‑uses the **CodeGraphAgent** to build a *static* representation of the code base; OnlineLearning’s batch runs augment this graph with temporal knowledge derived from LSL sessions.  
  * **UKBTraceReporting** consumes the same adapter to persist trace artefacts, enabling cross‑component analytics (e.g., correlating learning efficacy with trace data).  

* **External Interfaces** – The batch pipeline likely exposes a CLI or scheduler hook (e.g., a npm script or CI job) that triggers the extraction‑to‑graph flow. The only explicit code‑level interfaces are the agent classes and the adapter methods.  

* **Data Flow** –  
  1. **Input** – Git + LSL → extraction module.  
  2. **Processing** – CodeGraphAgent builds AST graph; EntityPersistence reconciles with existing graph.  
  3. **Persistence** – GraphDatabaseAdapter writes the updated graph.  
  4. **Observability** – UKBTraceReporting records run metadata via the same adapter.  

---

## Usage Guidelines  

1. **Run the batch pipeline only after a stable commit set** – Because OnlineLearning processes the *entire* git history snapshot, invoking it on a partially merged or rebased branch can lead to duplicate or orphaned graph nodes.  

2. **Treat the GraphDatabaseAdapter as the sole persistence entry point** – Direct manipulation of Graphology or LevelDB outside the adapter bypasses the consistency checks performed by EntityPersistence and may corrupt the knowledge graph.  

3. **Leverage EntityPersistence for any programmatic updates** – If a custom tool needs to add or modify entities (e.g., a script that annotates code with additional metadata), it should call the same EntityPersistence APIs used by OnlineLearning to guarantee proper versioning and traceability.  

4. **Monitor UKBTraceReporting outputs** – Trace reports are the primary diagnostic artefacts for batch runs. Regularly review them for error spikes, unusually long runtimes, or sudden drops in node/edge counts, which may indicate extraction or parsing regressions.  

5. **Coordinate with sibling components** – When extending the knowledge graph (e.g., adding a new entity type), ensure that ManualLearning, CodeKnowledgeGraph, and any other consumers of the graph are updated to understand the new schema, as they all read from the same storage via the adapter.  

---

### Architectural Patterns Identified  

1. **Batch Processing Pipeline** – deterministic, scheduled extraction of git and LSL data.  
2. **Agent Pattern** – `CodeGraphAgent` (and implicitly `PersistenceAgent`) encapsulate isolated responsibilities.  
3. **Adapter Pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB.  
4. **Sub‑component Decomposition** – clear separation between extraction, graph construction, persistence, and reporting.  

### Design Decisions and Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Use a **single GraphDatabaseAdapter** for all KnowledgeManagement siblings | Guarantees a unified data model and reduces duplication of storage logic. | Couples all siblings to the same underlying database; a change in storage technology impacts the entire family. |
| **Batch‑oriented** rather than streaming ingestion | Simpler reasoning about complete snapshots, easier to reproduce runs, aligns with git’s commit‑based nature. | Higher latency for new knowledge to become searchable; not suitable for real‑time feedback. |
| **AST‑based graph** via CodeGraphAgent | Enables rich semantic queries (e.g., “find all callers of a function”). | Requires full parsing of source files each run, which can be CPU‑intensive for large codebases. |
| Dedicated **EntityPersistence** sub‑component | Centralises lifecycle logic, making updates and deletions consistent. | Adds an extra indirection layer; developers must understand its API to interact correctly. |

### System Structure Insights  

* **Vertical stacking** – KnowledgeManagement sits at the top, exposing the storage adapter; each sibling (OnlineLearning, ManualLearning, etc.) builds a vertical slice that consumes the adapter for its specific acquisition strategy.  
* **Horizontal sharing** – All siblings share the same graph schema, allowing cross‑component queries (e.g., combining manually curated entities with automatically learned ones).  
* **Observability layer** – UKBTraceReporting is the only explicit observability component, indicating a design where traceability is treated as a first‑class concern.  

### Scalability Considerations  

* **Graph size** – As the codebase and LSL logs grow, the AST graph can become large. Since Graphology holds the graph in memory before persisting to LevelDB, memory consumption may become a bottleneck; sharding or incremental updates could mitigate this.  
* **Batch duration** – Full parsing of the repository each run may not scale linearly; incremental parsing (only changed files) would improve throughput but would require additional change‑detection logic.  
* **Adapter throughput** – LevelDB provides fast key‑value writes, but bulk inserts from large batches should be wrapped in LevelDB write batches to avoid I/O thrashing.  

### Maintainability Assessment  

* **High cohesion** – Each agent/sub‑component has a narrowly defined purpose, which simplifies unit testing and future refactoring.  
* **Low coupling via adapter** – The adapter isolates storage concerns, making it feasible to swap the underlying database with minimal impact on higher‑level logic.  
* **Potential fragility in batch parsing** – Reliance on full AST reconstruction each run can make the system sensitive to parser updates or language feature changes; encapsulating the parser behind an interface would improve resilience.  
* **Traceability** – UKBTraceReporting provides concrete run artefacts, aiding debugging and regression detection, which is a strong maintainability asset.  

Overall, OnlineLearning exhibits a clean, agent‑driven architecture that leverages a shared storage adapter, making it both extensible and observable, while its batch‑centric processing model invites future optimisation for large‑scale codebases.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for efficient data storage and retrieval in the Graphology + LevelDB knowledge graph. This adapter enables the component to handle data persistence, graph database storage, and query capabilities seamlessly. For instance, the PersistenceAgent (src/agents/persistence-agent.ts) leverages the GraphDatabaseAdapter to store and retrieve entities from the graph database, demonstrating a clear example of how the component's architecture supports data management. Furthermore, the CodeGraphAgent (src/agents/code-graph-agent.ts) uses the GraphDatabaseAdapter to construct the AST-based code knowledge graph, facilitating semantic code search capabilities.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve manually curated entities.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve entities.
- [GraphDatabaseStorage](./GraphDatabaseStorage.md) -- GraphDatabaseStorage utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve graph data.
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraph utilizes the CodeGraphAgent (src/agents/code-graph-agent.ts) to construct the AST-based code knowledge graph.
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve workflow run data.


---

*Generated from 6 observations*

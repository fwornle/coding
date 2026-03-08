# ManualLearning

**Type:** SubComponent

ManualLearning uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database

## What It Is  

**ManualLearning** is a sub‑component of the **KnowledgeManagement** domain that lives in the file  
`integrations/mcp-server-semantic-analysis/src/storage/manual-learning.ts`. Its primary responsibility is to manage the portion of the knowledge graph that is generated from manual (human‑curated) learning activities. The component stores its data in the same graph database used by the rest of the system and keeps that data in lock‑step with the global knowledge graph through an automatic JSON‑export synchronization step. Because it is a child of **KnowledgeManagement**, ManualLearning inherits the persistence strategy defined by the parent – namely the use of the **GraphDatabaseAdapter** abstraction.

## Architecture and Design  

The architecture that emerges from the observations is a **layered abstraction** built around a single graph‑persistence service. The `GraphDatabaseAdapter` class (found in `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`) implements an **Adapter pattern**: it hides the concrete storage technology—Graphology together with LevelDB—from all higher‑level components. ManualLearning, the **CodeGraphAgent**, **OntologyManager**, **InsightGenerator**, and **OnlineLearning** all depend on this adapter rather than on Graphology or LevelDB directly.  

ManualLearning’s design therefore follows a **dependency‑inversion** principle: the component declares a dependency on the abstract `GraphDatabaseAdapter` interface, and the concrete adapter supplies the actual storage implementation. This yields a clean separation between *domain logic* (the manual‑learning rules) and *infrastructure concerns* (graph storage, serialization).  

The “automatic JSON export sync” mentioned in the observations is a **synchronization mechanism** that runs whenever ManualLearning mutates the graph. By exporting the current graph state to JSON immediately after a change, the system guarantees that any downstream consumer that reads the exported file (e.g., for analytics or visualization) sees a view that is always consistent with the internal graph. This mechanism is shared across the whole KnowledgeManagement stack because the same adapter provides the export capability.

## Implementation Details  

- **File location:** `integrations/mcp-server-semantic-analysis/src/storage/manual-learning.ts` houses the ManualLearning class (or module). Although the source symbols are not listed, the file is the sole implementation artifact for this sub‑component.  

- **Persistence layer:** ManualLearning does not interact with LevelDB or Graphology directly. Instead, it calls into the `GraphDatabaseAdapter` (found in `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`). The adapter internally creates a Graphology graph instance backed by LevelDB, giving ManualLearning a flexible in‑memory graph view that is persisted to disk.  

- **Data flow:** When a manual learning event occurs (e.g., a user adds a new concept or relationship), ManualLearning writes the corresponding node/edge to the adapter via methods such as `addNode`, `addEdge`, or generic `executeTransaction`. After the write, the adapter triggers its **automatic JSON export sync** routine, which serializes the full graph to a JSON file and writes it to a known location. This ensures that the exported representation is always “up‑to‑date.”  

- **Interaction with other agents:** The `CodeGraphAgent` (`integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`) also uses the same `GraphDatabaseAdapter` to store and retrieve code‑graph data. Because both agents share the same adapter instance (or at least the same implementation), their data lives in a single unified graph, enabling cross‑entity queries (e.g., linking manually added concepts to automatically extracted code entities).  

- **Parent‑child relationship:** The parent component **KnowledgeManagement** orchestrates the overall knowledge graph. ManualLearning contributes a distinct sub‑graph that is merged into the global graph managed by the adapter. The parent does not need to know the internal details of ManualLearning; it only relies on the adapter’s contract for persistence and export.

## Integration Points  

1. **GraphDatabaseAdapter** – The sole persistence contract. All reads and writes from ManualLearning flow through the adapter’s API. The adapter’s use of Graphology + LevelDB is an implementation detail hidden from ManualLearning.  

2. **CodeGraphAgent** – Consumes the same graph database via the adapter. ManualLearning’s nodes can be referenced by the code‑graph data, enabling richer insights (e.g., mapping manual concepts to code structures).  

3. **OntologyManager & InsightGenerator** – Sibling components that also rely on the adapter. Because they share the same storage backend, any ontology changes or generated insights can directly reference manual learning entities without additional translation layers.  

4. **Automatic JSON Export** – The export file is a public artifact that other subsystems (e.g., reporting tools, external analytics pipelines) may read. ManualLearning’s guarantee that this export is always current makes it a reliable integration point for downstream consumers.  

5. **KnowledgeManagement (parent)** – Provides the overall orchestration and may expose higher‑level services (e.g., a unified query API) that internally delegate to the adapter. ManualLearning’s compliance with the adapter contract ensures seamless inclusion in the parent’s workflows.

## Usage Guidelines  

- **Always go through the GraphDatabaseAdapter.** Direct manipulation of Graphology or LevelDB from ManualLearning (or any sibling) would break the abstraction and could bypass the automatic JSON sync, leading to stale exports.  

- **Treat the exported JSON as read‑only.** It is generated automatically after each mutation; manual edits will be overwritten on the next sync.  

- **Prefer batch updates when adding many manual nodes/edges.** The adapter’s transaction semantics allow grouping multiple writes into a single sync operation, reducing the number of JSON exports and improving performance.  

- **Respect the shared graph namespace.** Since ManualLearning, CodeGraphAgent, OntologyManager, and InsightGenerator all populate the same graph, coordinate naming conventions for node identifiers to avoid collisions.  

- **Leverage the parent KnowledgeManagement services for queries.** Rather than querying the adapter directly, use any higher‑level query APIs exposed by KnowledgeManagement; this keeps ManualLearning decoupled from the rest of the system’s query logic.  

---

### Architectural patterns identified  
1. **Adapter pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB.  
2. **Dependency inversion** – ManualLearning depends on the adapter interface, not on concrete storage.  
3. **Synchronization/Export pattern** – Automatic JSON export after each mutation ensures consistency across components.

### Design decisions and trade‑offs  
- **Single graph store** simplifies cross‑component queries but couples all sub‑components to the same persistence technology.  
- **Automatic JSON export** guarantees up‑to‑date external views but adds I/O overhead on every write; batch updates mitigate this.  
- **Adapter abstraction** provides flexibility to swap the underlying DB, at the cost of an extra indirection layer.

### System structure insights  
- The system is organized around a **knowledge‑graph core** (managed by the adapter) with multiple domain‑specific sub‑components (ManualLearning, OnlineLearning, OntologyManager, InsightGenerator, CodeGraphAgent) that all read/write to the same graph.  
- **ManualLearning** sits as a child of **KnowledgeManagement**, contributing a manually curated sub‑graph while relying on the parent’s persistence strategy.

### Scalability considerations  
- Graphology + LevelDB can handle large graph datasets, but the **automatic JSON export** may become a bottleneck as the graph grows; consider throttling or incremental export strategies.  
- Because all components share a single adapter instance, concurrent write contention could arise; the adapter should implement proper locking or transaction isolation to maintain consistency.  

### Maintainability assessment  
- The clear separation of concerns (domain logic in ManualLearning, storage logic in GraphDatabaseAdapter) enhances maintainability; changes to storage technology are isolated to the adapter.  
- Shared reliance on a single adapter means that bugs in the adapter affect all siblings, so the adapter must be well‑tested and versioned.  
- The explicit file‑level organization (`manual-learning.ts`, `graph-database-adapter.ts`, `code-graph-agent.ts`) makes navigation straightforward for developers.  

Overall, ManualLearning is a well‑encapsulated sub‑component that leverages a common graph‑persistence abstraction, ensuring consistent data across the KnowledgeManagement ecosystem while providing a straightforward integration surface for developers.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter for persistence, which is implemented in the file integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts. This adapter provides a layer of abstraction between the component and the underlying graph database, allowing for flexible data storage and retrieval. The GraphDatabaseAdapter class uses Graphology and LevelDB to store and manage the knowledge graph, and it also provides an automatic JSON export sync feature. This ensures that the knowledge graph is always up-to-date and can be easily exported for further analysis or processing. For example, the CodeGraphAgent class, located in integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts, uses the GraphDatabaseAdapter to store and retrieve code graph data.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database
- [InsightGenerator](./InsightGenerator.md) -- InsightGenerator uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses Graphology to store and manage the knowledge graph
- [CodeGraphAgent](./CodeGraphAgent.md) -- CodeGraphAgent uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database


---

*Generated from 7 observations*

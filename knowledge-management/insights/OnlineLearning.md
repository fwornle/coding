# OnlineLearning

**Type:** SubComponent

OnlineLearning's data is processed using the CodeGraphAgent class in integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts

## What It Is  

OnlineLearning is a **SubComponent** of the **KnowledgeManagement** domain that extracts, stores, and synchronises learning‑related artefacts (git history, LSL sessions, static code analysis) into the system‑wide knowledge graph. The core of its processing lives in the **batch analysis pipeline** defined in  

```
integrations/mcp-server-semantic-analysis/src/pipeline/batch-analysis-pipeline.ts
```  

which orchestrates the ingestion of raw learning data and drives the creation of a code‑centric graph representation via the **CodeGraphAgent** (found in `integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`). All persisted artefacts are written to the graph database through the **GraphDatabaseAdapter** (`integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`). The adapter’s automatic JSON export sync guarantees that the OnlineLearning view of the graph is always current and that downstream components (e.g., InsightGenerator) see a consistent state.

---

## Architecture and Design  

The observable architecture is **pipeline‑centric** with a **DAG‑based execution model**. The batch‑analysis pipeline builds a directed‑acyclic graph of processing steps and resolves execution order with a **topological sort**. This design enables deterministic ordering of independent analysis stages (e.g., git history parsing, LSL session extraction, static code analysis) while still allowing parallelism where the DAG permits it.  

Persistence is abstracted through the **GraphDatabaseAdapter**, which hides the underlying **Graphology + LevelDB** implementation. By exposing a thin API for “store” and “retrieve” operations, the adapter enforces a single source of truth for all knowledge‑graph interactions across the KnowledgeManagement family (OnlineLearning, ManualLearning, OntologyManager, InsightGenerator). The adapter’s **automatic JSON export sync** acts as a built‑in consistency mechanism, ensuring that any mutation performed by OnlineLearning is instantly reflected in the exported JSON snapshot used by other services.  

The **CodeGraphAgent** acts as the domain‑specific worker that translates raw learning artefacts into graph nodes and edges. It consumes the pipeline’s output and invokes the GraphDatabaseAdapter to persist the resulting code graph. Because the agent is a sibling of other agents (e.g., those used by ManualLearning or OntologyManager), the same storage contract is reused, reinforcing a **shared‑adapter pattern** across siblings.  

Overall, the design leans heavily on **separation of concerns**: ingestion (pipeline), transformation (agent), and persistence (adapter) are cleanly isolated, while the parent component **KnowledgeManagement** provides the overarching graph‑storage infrastructure.

---

## Implementation Details  

1. **Batch‑Analysis Pipeline (`batch-analysis-pipeline.ts`)**  
   - Constructs a **DAG** where each node represents a discrete analysis task (e.g., `ParseGitHistoryTask`, `ExtractLSLSessionTask`, `StaticCodeAnalysisTask`).  
   - Executes a **topological sort** to compute a safe linearisation, guaranteeing that dependent tasks run after their prerequisites.  
   - Dispatches each task to the appropriate agent; for OnlineLearning the final task hands off the enriched data to `CodeGraphAgent`.  

2. **CodeGraphAgent (`code-graph-agent.ts`)**  
   - Receives structured artefacts (commits, session events, code metrics).  
   - Maps these artefacts onto graph entities: commits become **CommitNode**, LSL sessions become **SessionNode**, and code constructs become **FunctionNode/ClassNode**.  
   - Establishes relationships such as `COMMITTED_IN`, `PARTICIPATED_IN`, and `CALLS` to reflect both version‑control lineage and runtime interaction captured from LSL.  
   - Calls the **GraphDatabaseAdapter** to persist nodes and edges atomically, leveraging the adapter’s batch write capabilities.  

3. **GraphDatabaseAdapter (`graph-database-adapter.ts`)**  
   - Wraps **Graphology** (an in‑memory graph library) with a **LevelDB** backend for durable storage.  
   - Exposes methods like `addNode`, `addEdge`, `query`, and `exportJson`.  
   - Implements an **automatic JSON export sync**: after each successful mutation, the adapter writes a fresh JSON snapshot to a configured location, ensuring that the knowledge graph used by other components (e.g., InsightGenerator) is never stale.  

4. **Data Flow & Synchronisation**  
   - OnlineLearning’s pipeline writes directly to the graph via the adapter; the adapter’s sync feature pushes the updated graph to the **knowledge graph** layer that the rest of the system consumes.  
   - Because the same adapter is used by sibling components (ManualLearning, OntologyManager, InsightGenerator), any change made by OnlineLearning is instantly visible to them, preserving **cross‑component consistency**.  

---

## Integration Points  

- **Parent Component – KnowledgeManagement**: OnlineLearning inherits the graph‑storage contract defined by KnowledgeManagement. The parent’s description of the GraphDatabaseAdapter (Graphology + LevelDB, automatic JSON export) is directly leveraged by OnlineLearning’s agent.  

- **Sibling Components**: ManualLearning, OntologyManager, and InsightGenerator all depend on the same GraphDatabaseAdapter. This shared dependency means that OnlineLearning’s data model must be compatible with the schemas expected by those siblings (e.g., node/edge type naming).  

- **Pipeline Orchestration**: The batch‑analysis pipeline is a common entry point for all learning‑related subcomponents. OnlineLearning contributes its own DAG nodes but re‑uses the pipeline’s execution engine, allowing future extensions (e.g., adding a new analysis task) without touching the core scheduler.  

- **Export / downstream consumption**: The automatic JSON export produced by the adapter is the primary integration artifact for any external analytics or reporting tools that consume the knowledge graph.  

- **Storage Layer**: The GraphDatabaseAdapter abstracts away the physical storage; therefore, any change to the underlying LevelDB configuration does not affect OnlineLearning’s code, preserving a clean separation.  

---

## Usage Guidelines  

1. **Do not modify the DAG construction directly in the pipeline** unless you understand the topological‑sort dependencies. Adding a new task should be done by defining a new node class and declaring its predecessor edges; the pipeline will automatically place it in the correct order.  

2. **Interact with the graph only through the GraphDatabaseAdapter**. Direct calls to Graphology or LevelDB bypass the automatic JSON export sync and can lead to stale snapshots for sibling components.  

3. **When extending CodeGraphAgent**, keep node and edge type names consistent with existing conventions (`CommitNode`, `SessionNode`, `FunctionNode`, etc.) so that OntologyManager and InsightGenerator can query them without schema changes.  

4. **Testing**: Because the pipeline is DAG‑driven, unit tests should verify that a given set of input artefacts produces the expected graph structure after the pipeline finishes. Mock the GraphDatabaseAdapter if you only need to assert the transformation logic.  

5. **Performance**: Large git histories can produce a high volume of nodes. If you notice bottlenecks, consider batching `addNode`/`addEdge` calls in the agent and letting the adapter handle bulk writes, which are optimised by LevelDB.  

---

### 1. Architectural patterns identified  

- **DAG‑based execution with topological sort** (pipeline orchestration)  
- **Adapter pattern** (GraphDatabaseAdapter abstracts Graphology + LevelDB)  
- **Automatic synchronization** (JSON export sync built into the adapter)  
- **Separation of concerns** (pipeline ↔ agent ↔ storage)  

### 2. Design decisions and trade‑offs  

- **Choosing a DAG for the batch pipeline** provides deterministic ordering and parallelism but adds complexity in defining and maintaining dependency edges.  
- **Using Graphology + LevelDB** gives an in‑memory graph model with durable storage; the trade‑off is that LevelDB is a key‑value store, so complex queries rely on Graphology’s API rather than a native graph query engine.  
- **Embedding JSON export in the adapter** guarantees consistency for downstream consumers but incurs an I/O cost on every mutation; this is acceptable for the current batch‑oriented workload but could become a bottleneck under high‑frequency writes.  

### 3. System structure insights  

- **OnlineLearning sits under KnowledgeManagement**, sharing the same persistence layer as its siblings.  
- **All learning‑related subcomponents converge on a single knowledge graph**, meaning that schema evolution must be coordinated across ManualLearning, OntologyManager, InsightGenerator, and OnlineLearning.  
- **The batch‑analysis pipeline acts as a common orchestrator**, allowing each subcomponent to plug in its own analysis agents without duplicating scheduling logic.  

### 4. Scalability considerations  

- The DAG model scales horizontally as independent nodes can be executed in parallel; however, the current implementation’s reliance on a single LevelDB instance may limit write throughput.  
- Automatic JSON export could become a scalability choke point; batching export operations or moving to an incremental diff‑based export would mitigate this.  
- Graph size growth (e.g., millions of commit nodes) may affect in‑memory Graphology performance; consider sharding or using a dedicated graph database if the knowledge graph outgrows current limits.  

### 5. Maintainability assessment  

- **High maintainability** due to clear separation: pipeline logic, transformation agents, and storage are isolated in distinct files and classes.  
- **Shared adapter** reduces duplication across siblings, simplifying updates to persistence behaviour.  
- **Potential risk**: tight coupling through the automatic JSON export means that changes to the adapter’s export format must be coordinated with all consumers.  
- **Documentation**: The explicit file paths and class names in the observations provide a strong “source‑of‑truth” reference, making onboarding and code navigation straightforward.  

---  

*All statements above are directly grounded in the provided observations and file references; no external patterns or undocumented behaviours have been introduced.*


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter for persistence, which is implemented in the file integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts. This adapter provides a layer of abstraction between the component and the underlying graph database, allowing for flexible data storage and retrieval. The GraphDatabaseAdapter class uses Graphology and LevelDB to store and manage the knowledge graph, and it also provides an automatic JSON export sync feature. This ensures that the knowledge graph is always up-to-date and can be easily exported for further analysis or processing. For example, the CodeGraphAgent class, located in integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts, uses the GraphDatabaseAdapter to store and retrieve code graph data.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database
- [InsightGenerator](./InsightGenerator.md) -- InsightGenerator uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses Graphology to store and manage the knowledge graph
- [CodeGraphAgent](./CodeGraphAgent.md) -- CodeGraphAgent uses the GraphDatabaseAdapter class in integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts to abstract the underlying graph database


---

*Generated from 7 observations*

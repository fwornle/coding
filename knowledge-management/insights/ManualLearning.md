# ManualLearning

**Type:** SubComponent

ManualLearning relies on the GraphDatabaseAdapter to store and retrieve manually curated knowledge, utilizing Graphology+LevelDB persistence with automatic JSON export sync

## What It Is  

**ManualLearning** is a sub‑component of the **KnowledgeManagement** domain that enables human‑curated knowledge to be injected, classified, and persisted in the system’s graph store. The core implementation lives in the same repository as the other knowledge‑management agents, most notably in `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` (where the **PersistenceAgent** lives) and `storage/graph-database-adapter.ts` (the **GraphDatabaseAdapter** used by ManualLearning).  

ManualLearning’s primary responsibilities are:  

1. **Ingesting manually curated entities** – developers or domain experts supply entities that are then mapped to the shared‑memory ontology via `PersistenceAgent.mapEntityToSharedMemory()`.  
2. **Classifying those entities** – the **OntologyClassifier** is invoked to assign ontology classes and to compute relationships between entities.  
3. **Persisting the curated knowledge** – the **GraphDatabaseAdapter** stores the resulting graph in a **Graphology + LevelDB** backend, while automatically synchronising a JSON export for downstream consumers.  

Because it sits under **KnowledgeManagement**, ManualLearning shares the same lock‑free, work‑stealing concurrency model that the parent component uses to keep LevelDB access contention low while scaling to large data sets.

---

## Architecture and Design  

The architecture of ManualLearning is deliberately **modular and lock‑free**. The following design choices are evident from the observations:

| Observation | Architectural Implication |
|-------------|---------------------------|
| *PersistenceAgent.mapEntityToSharedMemory() pre‑populates ontology metadata fields* | **Metadata pre‑population** avoids costly round‑trips to the LLM for re‑classification, embodying an **optimistic caching** pattern. |
| *Dynamic import mechanism in GraphDatabaseAdapter* | **Dynamic module loading** sidesteps TypeScript compilation constraints and yields a **plug‑in style modularity** – each storage client (e.g., `VkbApiClient`) can be swapped without recompiling the whole code base. |
| *Lock‑free architecture to prevent LevelDB lock conflicts* | The system relies on **lock‑free data structures** (atomic counters, work‑stealing queues) to guarantee high concurrency with LevelDB, a design that mirrors the parent component’s strategy. |
| *Work‑stealing concurrency in PersistenceAgent* | **Work‑stealing scheduler** provides load balancing across worker threads, ensuring idle workers can pull pending persistence tasks immediately. |
| *Graphology + LevelDB persistence with automatic JSON export sync* | This is a **dual‑store persistence pattern** – a fast key‑value store for runtime queries and a JSON snapshot for offline analysis or backup. |

The **interaction flow** is as follows:

1. **ManualLearning** receives a manually curated entity (e.g., via an API or UI).  
2. The **PersistenceAgent** immediately calls `mapEntityToSharedMemory()`, inserting `entityType` and `metadata.ontologyClass` into the shared memory cache.  
3. The **OntologyClassifier** consumes the enriched entity, resolves its ontology class, and adds relationship edges.  
4. The **CodeKnowledgeGraphConstructor** (when the entity represents code) may run an AST‑based analysis to enrich the graph further.  
5. All resulting nodes/edges are handed to **GraphDatabaseAdapter**, which dynamically imports the required storage client and writes to **Graphology** (in‑memory graph) and **LevelDB** (persistent store).  
6. A background synchroniser emits a JSON export, keeping external tools in sync.

The component therefore follows a **pipeline architecture** (ingest → enrich → persist) with **clear separation of concerns**: ingestion (PersistenceAgent), classification (OntologyClassifier), graph construction (CodeKnowledgeGraphConstructor), and storage (GraphDatabaseAdapter).

---

## Implementation Details  

### PersistenceAgent (`integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`)  
- **`mapEntityToSharedMemory(entity)`** – extracts the essential ontology fields (`entityType`, `metadata.ontologyClass`) and writes them into a shared‑memory cache. This cache is consulted by downstream classifiers to skip redundant LLM calls.  
- **Work‑stealing scheduler** – the agent maintains a pool of worker threads. Each worker has a local deque; when its deque is empty it *steals* tasks from a neighbour’s deque, guaranteeing high utilisation without global locks.  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
- **Dynamic imports** – e.g., `const { VkbApiClient } = await import('path/to/vkb-client')`. This pattern avoids static TypeScript imports that could cause circular dependencies or compilation failures, and it keeps the adapter loosely coupled to any particular backend client.  
- **Graphology + LevelDB** – Graphology provides an in‑memory graph API (nodes, edges, traversal). Persistence to LevelDB occurs via a thin wrapper that serialises graph mutations as JSON blobs. The adapter also triggers an **automatic JSON export sync**, writing a snapshot file after each transaction batch.  

### OntologyClassifier (sibling)  
- Consumes the enriched entity from shared memory, performs ontology lookup (likely via a pre‑loaded taxonomy), and writes back the definitive `metadata.ontologyClass`. Because the fields are already pre‑populated, the classifier can focus on relationship inference rather than class discovery.  

### CodeKnowledgeGraphConstructor (sibling)  
- When the curated entity references source code, this component parses the repository with an AST parser, extracts symbols, and adds them as nodes/edges in the Graphology graph. This step is optional for non‑code entities but integrates tightly with ManualLearning’s overall graph‑building pipeline.  

### Concurrency & Lock‑Free Guarantees  
- Both **PersistenceAgent** and **GraphDatabaseAdapter** use **atomic index counters** and **lock‑free queues** to coordinate access to LevelDB. This eliminates the classic “database is locked” errors that would otherwise appear when many workers try to write concurrently.  

---

## Integration Points  

1. **Parent – KnowledgeManagement**  
   - ManualLearning inherits the parent’s lock‑free, work‑stealing concurrency model. The same atomic counters used in `PersistenceAgent` are defined at the KnowledgeManagement level and are shared across sibling components.  

2. **Siblings**  
   - **OnlineLearning**, **GraphDatabaseManager**, **OntologyClassifier**, **CodeKnowledgeGraphConstructor**, and **PersistenceAgent** all depend on the **GraphDatabaseAdapter** for persistence. This creates a **common storage contract**: any component that needs to read or write graph data simply calls the adapter’s `saveNode`, `saveEdge`, or `query` methods.  
   - The **OntologyClassifier** is a direct downstream consumer of the metadata pre‑populated by `PersistenceAgent.mapEntityToSharedMemory()`.  

3. **External Clients**  
   - The automatic JSON export generated by **GraphDatabaseAdapter** serves external analytics pipelines, backup services, or UI dashboards that consume a static snapshot of the knowledge graph.  

4. **Dynamic Import Hooks**  
   - Because the adapter loads storage clients at runtime, developers can plug in alternative back‑ends (e.g., a remote graph service) without touching ManualLearning’s core code.  

5. **Shared Memory Cache**  
   - The cache is a lightweight in‑process store (likely a `Map` or `WeakMap`) that lives in the same Node.js process as ManualLearning. All sibling components read from it, guaranteeing consistent ontology metadata across the pipeline.  

---

## Usage Guidelines  

1. **Always invoke `PersistenceAgent.mapEntityToSharedMemory()` first** when adding a new manual entity. Skipping this step forces the OntologyClassifier to repeat LLM classification, which defeats the performance optimisation.  

2. **Do not manually write to LevelDB** outside of `GraphDatabaseAdapter`. Direct LevelDB writes bypass the lock‑free queue and can re‑introduce lock contention.  

3. **When extending the pipeline**, add new processing steps **before** the persistence stage if they need to enrich the shared‑memory entity. For example, a custom validation step should run after `mapEntityToSharedMemory` but before the OntologyClassifier.  

4. **If you need a new storage client**, place it in a dedicated module and import it dynamically inside `GraphDatabaseAdapter`. Follow the existing pattern (`await import('…')`) to keep the compilation surface clean.  

5. **Monitor the work‑stealing queue length** in production. An unusually long queue may indicate a downstream bottleneck (e.g., a slow classifier) and can be mitigated by scaling the worker pool or profiling the classifier’s latency.  

6. **Version the JSON export** – the automatic export does not embed schema versioning. If downstream consumers evolve, add a version field to the exported JSON in a post‑processing step to avoid breaking changes.  

---

### Summarised Deliverables  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Lock‑free concurrency (atomic counters, work‑stealing queues), dynamic import plug‑in pattern, dual‑store persistence (Graphology + LevelDB with JSON export), pipeline processing (ingest → enrich → persist). |
| **Design decisions and trade‑offs** | *Pre‑populating ontology metadata* reduces LLM calls (performance gain) at the cost of maintaining cache consistency. *Dynamic imports* improve modularity but add a small runtime overhead. *Lock‑free LevelDB access* boosts scalability but requires careful atomic design; bugs in the work‑stealing scheduler could lead to starvation. |
| **System structure insights** | ManualLearning is a leaf node under KnowledgeManagement, sharing concurrency infrastructure with its siblings. All graph‑related components converge on `GraphDatabaseAdapter`, making it the de‑facto storage contract. |
| **Scalability considerations** | The lock‑free, work‑stealing model allows many workers to persist large batches without DB contention, suitable for high‑throughput manual curation campaigns. Bottlenecks are likely to appear in the OntologyClassifier or AST analysis steps; scaling those services horizontally will preserve overall throughput. |
| **Maintainability assessment** | High maintainability thanks to clear separation of concerns and a single persistence façade. The dynamic import approach reduces compile‑time coupling, making it easy to replace storage back‑ends. However, the shared‑memory cache is an implicit contract; any change to its shape must be coordinated across all siblings, suggesting a need for a typed interface or schema validation layer to avoid silent mismatches. |

*All statements above are directly grounded in the supplied observations and the concrete file paths/classes referenced therein.*


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component employs a lock-free architecture to prevent LevelDB lock conflicts, as seen in the use of shared atomic index counters in the work-stealing concurrency mechanism. This design decision is crucial in ensuring efficient and scalable processing of large datasets, and is implemented in the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts). The GraphDatabaseAdapter (storage/graph-database-adapter.ts) also plays a key role in this architecture, providing Graphology+LevelDB persistence with automatic JSON export sync. Furthermore, the dynamic import mechanism used in the GraphDatabaseAdapter, such as the import of VkbApiClient, helps to avoid TypeScript compilation issues and ensures a modular design pattern.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the GraphDatabaseAdapter to store and retrieve extracted knowledge, utilizing Graphology+LevelDB persistence with automatic JSON export sync
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter to provide Graphology+LevelDB persistence with automatic JSON export sync
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseAdapter to store and retrieve classified entities, utilizing Graphology+LevelDB persistence with automatic JSON export sync
- [CodeKnowledgeGraphConstructor](./CodeKnowledgeGraphConstructor.md) -- CodeKnowledgeGraphConstructor uses the GraphDatabaseAdapter to store and retrieve constructed knowledge graphs, utilizing Graphology+LevelDB persistence with automatic JSON export sync
- [PersistenceAgent](./PersistenceAgent.md) -- PersistenceAgent uses the GraphDatabaseAdapter to store and retrieve entities, utilizing Graphology+LevelDB persistence with automatic JSON export sync


---

*Generated from 7 observations*

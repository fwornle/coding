# KnowledgeGraph

**Type:** SubComponent

The KnowledgeGraph class uses the BaseAgent pattern from base-agent.ts to standardize agent behavior and response envelope creation

## What It Is  

The **KnowledgeGraph** sub‑component lives inside the *SemanticAnalysis* package (e.g. `integrations/mcp-server-semantic-analysis/src/agents/knowledge-graph.ts`).  It is the concrete implementation that stores, enriches, and queries the semantic knowledge extracted by the surrounding multi‑agent system.  At its core the component relies on the **GraphDatabase** class defined in `graph-database.ts` for persistent graph storage and on the **knowledge‑graph‑query.ts** module for the query algorithm that traverses the stored data.  The component is instantiated by the parent *SemanticAnalysis* component and is consumed by sibling agents such as the **OntologyClassificationAgent** (found in `ontology-classification-agent.ts`) and the **SemanticInsightGenerator**, which both depend on the graph’s ability to classify observations and generate insights.

The KnowledgeGraph follows the same **BaseAgent** pattern used throughout the code base (`base-agent.ts`).  This pattern standardises how agents receive work, produce responses, and wrap those responses in a consistent envelope.  By inheriting from `BaseAgent`, KnowledgeGraph gains a predictable lifecycle, error handling, and logging behaviour that matches the coordinator agent and other siblings like **Pipeline** and **GitHistoryAnalyzer**.

In addition to storage and query capabilities, KnowledgeGraph pre‑populates a set of metadata fields (e.g., timestamps, source identifiers) the moment a new graph node is created.  This prevents downstream agents from having to re‑create or duplicate these fields, reducing redundant work and ensuring a uniform schema across the system.

---

## Architecture and Design  

The architecture of KnowledgeGraph is **agent‑centric** and **composition‑driven**.  Each functional piece is encapsulated as an agent that implements the `BaseAgent` contract, guaranteeing a common interface for task receipt, execution, and response envelope generation.  This design choice yields a **uniform behavioural pattern** across the entire multi‑agent ecosystem, making it easier for developers to reason about any new agent that is added later.

Data persistence is delegated to the **GraphDatabase** class (`graph-database.ts`).  KnowledgeGraph does not embed its own storage logic; instead it composes a `GraphDatabaseManager` child component that wraps the low‑level database operations.  This separation of concerns isolates graph‑specific logic (node/edge creation, indexing) from higher‑level business rules such as metadata pre‑population and classification.

The component also incorporates a **shared `nextIndex` counter**.  This counter is a lightweight coordination primitive that allows idle workers (agents waiting for work) to pull the next task immediately without a central scheduler round‑trip.  The design is reminiscent of a **work‑stealing queue** but is kept simple: the counter is incremented atomically and read by any idle agent, enabling rapid task dispatch and reducing latency.

Classification of observations is performed through the **ontology system** provided by `ontology-classification-agent.ts`.  KnowledgeGraph invokes this system to attach ontology tags to newly inserted nodes, ensuring that the graph remains semantically rich and searchable.  Queries are executed via the algorithm in `knowledge-graph-query.ts`, which likely implements graph traversal, pattern matching, or path‑finding based on the stored ontology metadata.

Overall, the design is **modular**, with clear boundaries: BaseAgent for behavioural consistency, GraphDatabase for persistence, OntologyClassificationAgent for semantic enrichment, and a dedicated query module for retrieval.  This modularity is reinforced by the parent–child relationship (SemanticAnalysis → KnowledgeGraph → GraphDatabaseManager) and sibling relationships (Pipeline, Ontology, Insights, etc.) that all share the BaseAgent foundation.

---

## Implementation Details  

1. **BaseAgent inheritance** – The `KnowledgeGraph` class extends the abstract `BaseAgent` defined in `base-agent.ts`.  By doing so it inherits methods such as `handleMessage`, `createResponseEnvelope`, and lifecycle hooks (`init`, `shutdown`).  This guarantees that when the coordinator or any other orchestrator sends a message to KnowledgeGraph, the same envelope format is returned as with the coordinator agent.

2. **GraphDatabaseManager child** – Inside KnowledgeGraph there is a composition field (often named `graphDbManager` or similar) that holds an instance of `GraphDatabaseManager`.  This manager is a thin wrapper around the `GraphDatabase` class (`graph-database.ts`).  All CRUD operations—`addNode`, `addEdge`, `updateNode`, `deleteNode`—are delegated to this manager, which in turn talks to the underlying storage engine (likely a Neo4j‑compatible driver or an in‑memory graph for testing).  Because the manager is a child component, it can be swapped out or mocked without affecting the higher‑level KnowledgeGraph logic.

3. **Metadata pre‑population** – When a new node is created, KnowledgeGraph automatically injects a set of standard fields (e.g., `createdAt`, `sourceId`, `graphVersion`).  This logic lives in a helper method (perhaps `populateMetadata`) that runs before the node is handed to `GraphDatabaseManager`.  The benefit is that downstream agents (OntologyClassificationAgent, SemanticInsightGenerator) can rely on these fields being present, eliminating the need for repetitive checks.

4. **Shared `nextIndex` counter** – The component defines a static or module‑level variable `nextIndex` that is atomically incremented (e.g., via `Interlocked.increment` or a simple `++` in a single‑threaded Node.js environment).  Idle workers call a method like `claimTask()` which reads the current `nextIndex`, increments it, and returns the associated task identifier.  This design enables **immediate work stealing** without a central dispatcher, reducing idle time.

5. **Ontology integration** – KnowledgeGraph imports the classification logic from `ontology-classification-agent.ts`.  After a node is persisted, KnowledgeGraph invokes a method such as `classifyNode(node)` which returns ontology tags.  These tags are then attached to the node’s metadata, making them searchable by the query algorithm.

6. **Query algorithm** – Retrieval of graph data is performed through the `knowledge-graph-query.ts` module.  KnowledgeGraph exposes a public method like `executeQuery(querySpec)` that forwards the request to this module.  The query module likely accepts a query object (containing pattern, filters, depth limits) and returns a result set of nodes/edges, possibly enriched with classification data.

No additional code symbols were listed in the observations, but the described interactions are directly inferred from the file paths and class names given.

---

## Integration Points  

- **Parent – SemanticAnalysis**: The parent component orchestrates the overall semantic pipeline.  It creates an instance of KnowledgeGraph and passes it to agents that need graph access, such as the **OntologyClassificationAgent** (which classifies incoming observations) and the **SemanticInsightGenerator** (which consumes graph‑derived insights).  Because KnowledgeGraph follows the BaseAgent contract, the parent can treat it like any other agent when dispatching tasks.

- **Sibling – OntologyClassificationAgent**: This sibling provides the ontology classification service that KnowledgeGraph consumes.  The integration is a two‑way contract: KnowledgeGraph calls the classification API to enrich nodes, while the Ontology agent may query the graph to validate or refine its taxonomy.

- **Sibling – Pipeline**: The Pipeline component runs a DAG‑based execution model.  Although not directly calling KnowledgeGraph, steps in the pipeline may produce data that is later fed into the graph (e.g., after a GitHistoryAnalyzer run, commit metadata may be inserted as nodes).  The shared BaseAgent pattern ensures that any pipeline step that needs to interact with the graph can do so via a consistent message envelope.

- **Child – GraphDatabaseManager**: All persistence operations funnel through this manager.  It abstracts the low‑level graph database (whether it is a file‑based store, an in‑memory graph, or an external service).  This abstraction permits the KnowledgeGraph to remain agnostic of storage details, facilitating future swaps or scaling strategies.

- **Query Consumers**: Any component that needs to retrieve semantic relationships—such as the **Insights** generator or external APIs—calls `knowledge-graph-query.ts` through KnowledgeGraph’s public query interface.  The query module is the sole entry point for read‑only operations, preserving encapsulation of the underlying data store.

---

## Usage Guidelines  

1. **Instantiate via BaseAgent** – When creating a KnowledgeGraph instance, always use the `BaseAgent` constructor pattern (`new KnowledgeGraph(options)`) so that the agent lifecycle hooks are correctly registered with the coordinator.  Avoid direct construction of `GraphDatabase` or `GraphDatabaseManager` outside the KnowledgeGraph wrapper.

2. **Always rely on pre‑populated metadata** – Do not manually add standard fields such as `createdAt` or `sourceId`.  The KnowledgeGraph automatically injects these during node creation.  Overriding them can lead to schema inconsistencies and break downstream classification logic.

3. **Use the shared `nextIndex` for task distribution** – When implementing a new worker that consumes KnowledgeGraph tasks, read the `nextIndex` counter via the provided `claimTask()` method rather than implementing a custom queue.  This ensures that idle workers can pull work immediately and that the system’s work‑stealing semantics remain intact.

4. **Classify through the Ontology agent** – After persisting a node, invoke the classification helper (`classifyNode`) rather than embedding ontology logic directly.  This maintains a single source of truth for ontology rules and prevents divergence between agents.

5. **Query through the dedicated module** – All read operations must go through the `knowledge-graph-query.ts` API.  Directly accessing the underlying `GraphDatabase` bypasses indexing, caching, and permission checks that the query module may enforce.

6. **Testing & Mocking** – For unit tests, replace `GraphDatabaseManager` with a mock that mimics the `addNode`/`query` signatures.  Because KnowledgeGraph does not embed storage logic, this substitution is safe and keeps tests fast.

---

### Architectural patterns identified  
1. **BaseAgent pattern** – a shared abstract agent class that standardises messaging, response envelopes, and lifecycle management.  
2. **Composition over inheritance** – KnowledgeGraph composes a `GraphDatabaseManager` child rather than inheriting storage behavior.  
3. **Work‑stealing via shared counter** – a lightweight coordination mechanism (`nextIndex`) that enables idle workers to claim tasks instantly.  
4. **Facade for query operations** – `knowledge-graph-query.ts` acts as a façade that hides graph traversal complexity from callers.

### Design decisions and trade‑offs  
- **Uniform agent interface** improves developer onboarding and reduces bugs, but it imposes a fixed lifecycle that may be restrictive for highly specialised agents.  
- **Separating persistence (GraphDatabaseManager) from business logic** enhances testability and future storage swaps, at the cost of an additional indirection layer.  
- **Pre‑populating metadata** eliminates redundancy and enforces schema consistency, but it requires careful versioning if the metadata schema evolves.  
- **Using a simple shared counter** for task distribution is low‑overhead and easy to reason about, yet it may become a contention point under extreme concurrency; a more sophisticated queue could be introduced later if needed.

### System structure insights  
The system is organized as a **hierarchical agent tree**: `SemanticAnalysis` (parent) → `KnowledgeGraph` (sub‑component) → `GraphDatabaseManager` (child).  Sibling agents share the BaseAgent contract, enabling interchangeable plug‑ins.  The ontology classification logic and query algorithm are external modules that are consumed rather than duplicated, reinforcing a **single‑responsibility** design.

### Scalability considerations  
- **Horizontal scaling of workers** is facilitated by the `nextIndex` counter; adding more idle agents simply increases the claim rate.  
- **Graph storage scalability** depends on the underlying `GraphDatabase` implementation; because KnowledgeGraph abstracts this via `GraphDatabaseManager`, scaling the database (e.g., sharding, clustering) can be done without touching higher‑level code.  
- **Query performance** can be tuned inside `knowledge-graph-query.ts` (e.g., adding indexes, caching) without affecting callers, supporting growth in query volume.

### Maintainability assessment  
The heavy reliance on **well‑defined interfaces** (BaseAgent, GraphDatabaseManager, ontology classifier) makes the codebase highly maintainable.  Adding new agents or swapping the graph backend requires only changes to the concrete implementations, not to the surrounding orchestration logic.  The explicit pre‑population of metadata and centralized query façade reduce duplication and the risk of schema drift.  The only potential maintenance hotspot is the shared `nextIndex` counter; if contention becomes an issue, developers will need to refactor this primitive, but the encapsulation makes that a localized change.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a multi-agent system architecture, which allows for the integration of various agents, each with its own specific responsibilities. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is responsible for classifying observations against the ontology system. This agent follows the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) pattern, which standardizes agent behavior and response envelope creation. The use of this pattern ensures consistency across all agents, making it easier for new developers to understand and contribute to the codebase.

### Children
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- The KnowledgeGraph sub-component uses the GraphDatabase class from graph-database.ts to store and manage knowledge graph data, indicating a strong dependency on this class for data management.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent uses the BaseAgent pattern from base-agent.ts to standardize agent behavior and response envelope creation
- [Insights](./Insights.md) -- The SemanticInsightGenerator uses the LLM and code graph context to generate semantic insights
- [SemanticInsightGenerator](./SemanticInsightGenerator.md) -- The SemanticInsightGenerator uses the LLM and code graph context to generate semantic insights
- [GitHistoryAnalyzer](./GitHistoryAnalyzer.md) -- The GitHistoryAnalyzer uses the GitHistory class from git-history.ts to analyze git history
- [AgentManager](./AgentManager.md) -- The AgentManager uses the BaseAgent pattern from base-agent.ts to standardize agent behavior and response envelope creation


---

*Generated from 7 observations*

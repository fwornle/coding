# ManualLearning

**Type:** SubComponent

The CodeGraphAgent's constructCodeGraph function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) takes an AST as input and returns a constructed code graph, which is then stored in the graph database via the PersistenceAgent's storeEntity function (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts).

## What It Is  

**ManualLearning** is a sub‑component of the **KnowledgeManagement** system that creates and maintains code‑knowledge entities that are authored by humans rather than extracted automatically. The implementation lives in the same code‑base that houses the semantic‑analysis agents, most notably under the paths:  

* `integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts` – where the **CodeGraphAgent** builds a code graph from an abstract syntax tree (AST) and also updates existing entities.  
* `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` – where the **PersistenceAgent** persists the manually created or edited entities.  
* `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` – the **GraphDatabaseAdapter** that supplies a type‑safe façade for the underlying graph database.

ManualLearning’s workflow is: a developer writes a code entity (or observation) together with explicit type and metadata; the **CodeGraphAgent** maps that definition into the shared‑memory model via `mapEntityToSharedMemory`, constructs a graph representation with `constructCodeGraph` (taking the AST as input), and finally hands the resulting graph node to the **PersistenceAgent**’s `storeEntity` method, which writes it through the **GraphDatabaseAdapter**. Direct edits to previously stored entities are handled by `updateEntity` on the **CodeGraphAgent**.

---

## Architecture and Design  

The observed code reveals a **layered, agent‑driven architecture**. The *agent* classes (`CodeGraphAgent`, `PersistenceAgent`) encapsulate distinct responsibilities: graph construction and persistence, respectively. This separation mirrors a **separation‑of‑concerns** pattern, keeping the transformation of source code (AST → graph) independent from storage concerns.  

The **GraphDatabaseAdapter** acts as an **Adapter** (or façade) that translates the type‑rich domain objects produced by the agents into the concrete calls required by the graph database. Its placement in `src/storage` underscores a clear boundary between business logic (agents) and infrastructure (database access).  

Communication between layers is **synchronous and direct**: the `constructCodeGraph` function returns a graph object that is immediately passed to `storeEntity`. There is no message‑bus or asynchronous queue observed, indicating a **call‑through** integration style suitable for the relatively low‑latency, intra‑process operations required by manual knowledge entry.  

ManualLearning shares this architectural skeleton with its siblings—**OnlineLearning**, **CodeGraphConstructor**, **EntityPersistenceManager**, and **GraphDatabaseService**—all of which also rely on the same agents and adapter. This commonality suggests a **component family** that reuses the same core services while differing only in the source of entities (manual vs. automatic) or the consumer (report generation, trace analysis, etc.).

---

## Implementation Details  

1. **CodeGraphAgent (`code-graph-agent.ts`)**  
   * `constructCodeGraph(ast: AST): CodeGraph` – receives an AST, walks it, and builds a graph representation of code constructs.  
   * `mapEntityToSharedMemory(entity: ManualEntity): SharedMemoryEntity` – explicitly maps a manually authored entity, including its type and metadata, into the in‑memory model used by the rest of the system. This step guarantees that manual entries conform to the same schema as automatically extracted ones.  
   * `updateEntity(id: string, changes: Partial<ManualEntity>)` – applies hand‑crafted edits to an existing graph node, ensuring that manual corrections propagate to the persisted graph.

2. **PersistenceAgent (`persistence-agent.ts`)**  
   * `storeEntity(entity: SharedMemoryEntity): Promise<void>` – persists the supplied entity into the graph database. The method delegates the low‑level write to the **GraphDatabaseAdapter**, preserving type safety and encapsulating any transaction handling.  

3. **GraphDatabaseAdapter (`graph-database-adapter.ts`)**  
   * Provides a **type‑safe API** (e.g., `createNode<T>(data: T)`, `updateNode<T>(id: string, data: Partial<T>)`) that abstracts the underlying graph database driver. By centralising all database interactions here, the rest of the codebase remains agnostic to the specific graph store implementation, facilitating future swaps or upgrades.  

The overall flow for a manual entry is therefore:  
`ManualLearning → CodeGraphAgent.mapEntityToSharedMemory → CodeGraphAgent.constructCodeGraph → PersistenceAgent.storeEntity → GraphDatabaseAdapter`  

When a developer later edits the entry, the path becomes:  
`ManualLearning → CodeGraphAgent.updateEntity → PersistenceAgent.storeEntity → GraphDatabaseAdapter`.

---

## Integration Points  

* **Parent Component – KnowledgeManagement**: ManualLearning is a child of KnowledgeManagement, inheriting the same semantic‑analysis pipeline. KnowledgeManagement orchestrates the use of the **CodeGraphAgent** to build a unified code knowledge graph, of which ManualLearning contributes the manually authored slice.  

* **Sibling Components**:  
  * **OnlineLearning** follows the identical pipeline but supplies entities automatically extracted from source repositories.  
  * **CodeGraphConstructor** is a thin wrapper that also invokes `constructCodeGraph` but may be used by tools that need only the graph without persistence.  
  * **EntityPersistenceManager** mirrors the PersistenceAgent’s responsibilities, indicating a possible shared service or an alias used by other subsystems.  
  * **GraphDatabaseService** consumes the **GraphDatabaseAdapter** directly, exposing higher‑level database operations to external services such as the **UKBTraceReportGenerator**, which in turn calls `generateReport` on the **CodeGraphAgent**.  

* **External Interfaces**: The only outward‑facing contracts observed are the public methods of the agents and the adapter. No HTTP, RPC, or event‑driven interfaces are mentioned, reinforcing the intra‑process nature of the integration.

---

## Usage Guidelines  

1. **Always declare explicit types and metadata** when creating a manual entity. The `mapEntityToSharedMemory` function expects this information to correctly align the entity with the shared‑memory schema.  

2. **Pass a well‑formed AST** to `constructCodeGraph`. The function assumes a syntactically correct AST; malformed trees will result in incomplete or invalid graph nodes.  

3. **Persist immediately after construction**. Since the graph database does not automatically sync with in‑memory structures, developers should call `storeEntity` right after `constructCodeGraph` to avoid divergence between the live graph and persisted state.  

4. **Use `updateEntity` for edits** rather than re‑creating the entity from scratch. This method ensures that only the changed fields are written, reducing the risk of overwriting concurrent manual updates.  

5. **Do not bypass the GraphDatabaseAdapter**. Direct database calls would break the type‑safety guarantees and could introduce coupling to a specific graph store implementation.  

6. **Coordinate with KnowledgeManagement** when extending the manual schema. Because ManualLearning shares the same knowledge graph as other components, any new entity type must be reflected in the shared‑memory model used by the whole KnowledgeManagement hierarchy.

---

### Architectural patterns identified  

* **Layered architecture** – agents (business logic) sit above the storage adapter (infrastructure).  
* **Adapter / Façade pattern** – `GraphDatabaseAdapter` abstracts the graph database.  
* **Separation of concerns** – distinct agents for graph construction vs. persistence.  

### Design decisions and trade‑offs  

* **Synchronous, in‑process calls** provide low latency and simplicity but limit distribution across processes or machines.  
* **Explicit manual mapping** (`mapEntityToSharedMemory`) ensures data integrity at the cost of additional developer effort for metadata definition.  
* **Centralised persistence via an adapter** improves maintainability and testability, though it introduces a single point of change if the underlying database evolves.  

### System structure insights  

ManualLearning is one leaf in a family of knowledge‑graph builders under **KnowledgeManagement**. All members share the same core agents and adapter, forming a cohesive subsystem that can be reasoned about as a single “graph‑construction‑and‑persistence” pipeline, with the source of entities (manual, automatic, report‑driven) being the only differentiator.  

### Scalability considerations  

Because the current design is intra‑process and relies on direct method calls, scaling horizontally would require refactoring the agents into services or introducing asynchronous messaging. However, the clear separation between construction and storage means that the persistence layer could be scaled independently (e.g., by swapping the underlying graph database for a clustered solution) without touching the agent logic.  

### Maintainability assessment  

The use of well‑named agents and a dedicated adapter promotes readability and testability. The explicit mapping step (`mapEntityToSharedMemory`) centralises schema enforcement, making future schema changes easier to manage. The lack of hidden side‑effects (no implicit caching or background jobs observed) further aids maintainability. The primary maintenance burden lies in keeping the manual entity definitions synchronized with the shared‑memory model and ensuring the AST generation pipeline remains compatible with `constructCodeGraph`.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes the CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to construct a code knowledge graph based on Abstract Syntax Trees (ASTs). This allows for efficient semantic code search capabilities. The CodeGraphAgent is designed to work in conjunction with the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) to store and retrieve entities from the graph database. The GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) provides a type-safe interface for interacting with the graph database, ensuring seamless data persistence and retrieval. For instance, the CodeGraphAgent's constructCodeGraph function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) takes an AST as input and returns a constructed code graph, which is then stored in the graph database via the PersistenceAgent's storeEntity function (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts).

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the CodeGraphAgent's constructCodeGraph function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to create a code graph from automatically extracted entities.
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- CodeGraphConstructor uses the CodeGraphAgent's constructCodeGraph function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to create a code graph from an AST.
- [EntityPersistenceManager](./EntityPersistenceManager.md) -- EntityPersistenceManager uses the PersistenceAgent's storeEntity function (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) to store entities in the graph database.
- [GraphDatabaseService](./GraphDatabaseService.md) -- GraphDatabaseService uses the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) to provide a type-safe interface for interacting with the graph database.
- [UKBTraceReportGenerator](./UKBTraceReportGenerator.md) -- UKBTraceReportGenerator uses the CodeGraphAgent's generateReport function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to generate reports.
- [OntologyClassificationSystem](./OntologyClassificationSystem.md) -- OntologyClassificationSystem uses the CodeGraphAgent's classifyEntity function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to classify entities.


---

*Generated from 6 observations*

# OntologyModule

**Type:** SubComponent

OntologyModule relies on the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) to store and retrieve ontology data.

## What It Is  

**OntologyModule** is a sub‑component that lives inside the **KnowledgeManagement** component.  Its primary responsibility is to expose a *unified interface* for all interactions with the system‑wide ontology.  It receives raw entities from other sub‑components, runs them through the **OntologyClassifier**, persists the resulting classifications in the graph store via the **GraphDatabaseAdapter** (found at `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`), and keeps the ontology up‑to‑date when changes occur.  In addition, the module supplies downstream consumers—most notably **InsightGenerationModule** and **TraceReportModule**—with the classified ontology data they need to generate recommendations and detailed workflow trace reports.

The module therefore acts as the “gatekeeper” for ontology data: it shields the rest of the system from the low‑level storage details while guaranteeing that every entity is correctly classified and linked to the current version of the ontology.

---

## Architecture and Design  

The design of **OntologyModule** follows a *modular, adapter‑based* architecture.  The key design elements that emerge from the observations are:

1. **Adapter Pattern** – The module does **not** interact directly with the underlying graph database.  Instead it delegates all persistence concerns to **GraphDatabaseAdapter**, a concrete adapter located at `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`.  This isolates the ontology logic from storage implementation details (e.g., Graphology, LevelDB) and makes it possible to swap the storage backend without touching the classification code.

2. **Facade / Unified Interface** – By providing a single, well‑defined API for “accessing and updating ontology data”, OntologyModule acts as a façade for the rest of the KnowledgeManagement ecosystem.  Other sub‑components (e.g., **InsightGenerationModule**, **TraceReportModule**, **ManualLearning**, **CodeGraphModule**) call into this façade rather than dealing with the classifier or the graph adapter themselves.

3. **Separation of Concerns** – Classification, persistence, insight generation, and trace reporting are each handled by dedicated collaborators:
   * **OntologyClassifier** – encapsulates the logic that maps raw entities to ontology concepts.
   * **GraphDatabaseAdapter** – abstracts graph‑store CRUD operations.
   * **InsightGenerationModule** – consumes ontology data to produce improvement recommendations.
   * **TraceReportModule** – consumes ontology data to build detailed execution trace reports.

4. **Event‑like Update Flow** – When the ontology is updated, OntologyModule ensures that affected entities are *re‑classified* and *re‑linked*.  Although the observations do not explicitly name an event bus, the implicit flow is: update → re‑classification → persistence → notification to downstream modules (InsightGeneration, TraceReport).  This keeps the ontology consistent across the system.

Because the parent **KnowledgeManagement** component already uses the same **GraphDatabaseAdapter** for other graph‑related sub‑components (e.g., **CodeGraphModule**, **ManualLearning**), OntologyModule inherits a shared persistence contract, reinforcing a cohesive architectural style across siblings.

---

## Implementation Details  

### Core Collaborators  

| Symbol | Location / Role |
|--------|-----------------|
| **OntologyClassifier** | Not directly referenced by a file path, but it is the classification engine invoked by OntologyModule. |
| **GraphDatabaseAdapter** | `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` – provides `saveNode`, `getNode`, `updateNode`, and query utilities for the underlying graph store. |
| **InsightGenerationModule** | Consumes ontology data; its own implementation is outside the scope of the current observations but it is a sibling that calls OntologyModule’s read API. |
| **TraceReportModule** | Generates trace reports; similarly consumes OntologyModule’s read API. |

### Data Flow  

1. **Incoming Entity** – A caller (e.g., **PersistenceModule** after an entity is persisted) sends a raw entity to OntologyModule.  
2. **Classification** – OntologyModule forwards the entity to **OntologyClassifier**, which returns a set of ontology tags and a confidence score.  
3. **Persistence** – The module packages the classification result into a graph node and calls the **GraphDatabaseAdapter** methods (e.g., `saveNode` or `updateNode`). The adapter writes the node to the graph store, handling JSON export sync as described in the parent component’s documentation.  
4. **Update Propagation** – When the ontology definition itself changes, OntologyModule iterates over all affected nodes, re‑runs **OntologyClassifier**, and persists the new classifications. Downstream modules (InsightGeneration, TraceReport) are then invoked to refresh their cached views.  

### Interface Surface  

While the exact method signatures are not listed, the observations imply at least the following high‑level API:

* `classifyAndStore(entity: RawEntity): Promise<ClassificationResult>` – runs the classifier and persists the result.  
* `getClassification(entityId: string): Promise<ClassificationResult>` – reads a stored classification via the adapter.  
* `handleOntologyUpdate(updatedOntology: OntologyDefinition): Promise<void>` – triggers re‑classification of impacted entities.  

These functions hide the adapter and classifier internals, presenting a clean contract to sibling modules.

---

## Integration Points  

1. **GraphDatabaseAdapter** – The sole persistence dependency.  All read/write operations funnel through the adapter located at `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`.  Because other siblings (e.g., **CodeGraphModule**, **ManualLearning**) also rely on this adapter, OntologyModule benefits from a shared transaction model and consistent data‑export behavior.

2. **OntologyClassifier** – The classification engine is an internal collaborator.  Its implementation details are not exposed, but it is the only place where ontology‑specific heuristics live, keeping the rest of the system agnostic of classification rules.

3. **InsightGenerationModule** – Consumes the read API of OntologyModule to generate recommendations.  The sibling relationship means that InsightGeneration does not need to know about the graph store; it simply asks OntologyModule for the latest ontology data.

4. **TraceReportModule** – Similar to InsightGeneration, it calls OntologyModule to retrieve the ontology context required for building trace reports of workflow runs.

5. **Parent – KnowledgeManagement** – The parent component orchestrates the overall knowledge graph lifecycle.  OntologyModule fits into this hierarchy by providing the ontology‑specific slice of the graph, while the parent’s agents (e.g., **PersistenceAgent**, **CodeGraphAgent**) handle broader entity persistence and code‑graph construction.

6. **Sibling Modules** – The shared reliance on **GraphDatabaseAdapter** creates a natural coupling: any change in the adapter’s contract (e.g., a new query API) must be coordinated across OntologyModule, **CodeGraphModule**, and **ManualLearning**.  Conversely, this commonality simplifies testing and deployment because a single storage mock can satisfy multiple sub‑components.

---

## Usage Guidelines  

* **Always go through the OntologyModule façade** when you need to read or write ontology data. Direct use of the GraphDatabaseAdapter bypasses classification logic and can lead to inconsistent ontology states.  
* **When updating the ontology definition**, invoke `handleOntologyUpdate` (or the equivalent method) rather than manually editing graph nodes.  This ensures that all affected entities are re‑classified and that downstream modules receive fresh data.  
* **Prefer asynchronous calls** (`Promise`‑based) to the module’s API to avoid blocking the event loop, especially when large batches of entities are being classified.  
* **Cache results locally only if you invalidate the cache** after any ontology update.  Since OntologyModule may re‑classify many nodes in bulk, stale caches can cause InsightGeneration or TraceReport to work with outdated concepts.  
* **Do not modify GraphDatabaseAdapter directly** from within OntologyModule.  Treat the adapter as a black‑box persistence layer; any custom query logic should be encapsulated in the module’s own methods.  
* **Testing** – Mock `GraphDatabaseAdapter` and `OntologyClassifier` separately.  Because OntologyModule’s responsibilities are clearly split (classification vs. persistence), unit tests can focus on the orchestration logic without needing a real graph database.

---

### Architectural patterns identified  

* **Adapter pattern** – via `GraphDatabaseAdapter`.  
* **Facade pattern** – OntologyModule’s unified interface hides classification and storage details.  
* **Separation of Concerns** – distinct responsibilities for classification, persistence, insight generation, and trace reporting.  

### Design decisions and trade‑offs  

* **Centralised ontology handling** simplifies consistency but creates a single point of failure; the module must be highly available.  
* **Using a shared GraphDatabaseAdapter** reduces duplication across siblings but couples their release cycles; a breaking change in the adapter impacts multiple modules.  
* **Re‑classification on ontology updates** guarantees up‑to‑date semantics at the cost of potentially expensive batch processing; this trade‑off is acceptable because the system already processes large batches in the **OnlineLearning** pipeline.  

### System structure insights  

* OntologyModule sits at the heart of the **KnowledgeManagement** hierarchy, providing the ontology slice of the overall knowledge graph.  
* Its sibling modules (ManualLearning, CodeGraphModule, etc.) each manage different graph domains but all converge on the same storage backend, creating a cohesive data‑layer architecture.  

### Scalability considerations  

* Because persistence is delegated to the GraphDatabaseAdapter, scaling the ontology store follows the scaling characteristics of the underlying graph database (e.g., sharding, replication).  
* Batch re‑classification during ontology updates can be parallelised; the module should expose a streaming or chunked API to avoid memory pressure.  
* Read‑heavy workloads from InsightGeneration and TraceReport can be satisfied by adding a read‑through cache in front of OntologyModule, provided cache invalidation follows ontology updates.  

### Maintainability assessment  

* **High cohesion** – OntologyModule’s responsibilities are narrowly defined, making the codebase easier to understand and evolve.  
* **Loose coupling** – By depending only on abstract adapters and classifiers, the module can be tested in isolation and swapped for alternative implementations with minimal impact.  
* **Potential risk** – The tight coupling to a single storage adapter means that any refactor of `graph-database-adapter.ts` must be coordinated across all siblings, increasing the integration testing burden.  
* Overall, the design promotes maintainability through clear boundaries, but disciplined versioning of shared adapters is essential to keep the system stable.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) enables seamless integration with Graphology and LevelDB for graph data persistence. This allows for efficient storage and querying of the knowledge graph, with automatic JSON export sync ensuring data consistency across the system. The CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) plays a crucial role in constructing the code knowledge graph, leveraging AST-based analysis for semantic code search capabilities. Furthermore, the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) handles entity persistence, including ontology classification and content validation, ensuring that the knowledge graph remains accurate and up-to-date.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning relies on the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) to store and retrieve user-created entities.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis.
- [CodeGraphModule](./CodeGraphModule.md) -- CodeGraphModule uses the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) to store and retrieve the code knowledge graph.
- [PersistenceModule](./PersistenceModule.md) -- PersistenceModule uses the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) to handle entity persistence.
- [InsightGenerationModule](./InsightGenerationModule.md) -- InsightGenerationModule uses the CodeGraphModule to access the code knowledge graph and generate insights.
- [TraceReportModule](./TraceReportModule.md) -- TraceReportModule uses the CodeGraphModule to access the code knowledge graph and generate trace reports.


---

*Generated from 6 observations*

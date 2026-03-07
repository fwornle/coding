# ManualLearning

**Type:** SubComponent

ManualLearning's 'manualEntityValidation' function in manual-learning.ts ensures manually created entities adhere to the project's ontology

## What It Is  

ManualLearning is a **sub‑component** that lives under the `KnowledgeManagement` umbrella and is implemented primarily in the file **`manual-learning.ts`**.  All of its core behaviours—entity creation, editing, observation handling, querying, validation and the end‑to‑end orchestration pipeline—are defined in that module.  The component relies on the shared **`GraphDatabaseAdapter`** located at **`storage/graph-database-adapter.ts`** for low‑level graph persistence, and on the **`EntityPersistenceAgent`** (a sibling that itself uses the `GraphDatabaseManager`) to carry out higher‑level write operations.  ManualLearning also owns a child component, **`ManualEntityHandler`**, which again depends on the same `GraphDatabaseAdapter` for its CRUD work.  

In short, ManualLearning is the part of the system that lets human operators inject “hand‑crafted” knowledge—entities, observations, and relationships—directly into the project's knowledge graph while ensuring that those inserts respect the ontology defined for the overall platform.

---

## Architecture and Design  

The architecture exposed by the observations follows a **layered, adapter‑centric** style.  At the bottom sits the **`GraphDatabaseAdapter`** (`storage/graph-database-adapter.ts`), which abstracts the concrete graph store (Graphology + LevelDB) behind a simple API.  Above that, the **`EntityPersistenceAgent`** and **`GraphDatabaseManager`** act as service‑layer facades that coordinate transactions and expose richer domain‑specific operations.  ManualLearning sits on this service layer, invoking the `EntityPersistenceAgent` for creation (`createManualEntity`) and directly calling the adapter for updates (`manualEntityEdit`) and queries (`manualEntityQuery`).  

The **pipeline pattern** is evident in the `manualLearningPipeline` function.  It strings together a series of steps—validation (`manualEntityValidation`), persistence (`createManualEntity`), and possibly downstream triggers—into a deterministic flow that guarantees every manually added piece of knowledge passes through the same checks before being stored.  This orchestrated flow mirrors the pipelines used by sibling components such as **OnlineLearning**, reinforcing a consistent processing model across the knowledge‑management suite.  

Because ManualLearning’s child, **`ManualEntityHandler`**, also uses the `GraphDatabaseAdapter`, the design emphasizes **reuse of the persistence adapter** rather than re‑implementing graph logic.  This shared‑adapter approach reduces duplication and makes the graph‑access contract a single source of truth for all components that need to read or write manual entities.

---

## Implementation Details  

The heart of ManualLearning lives in **`manual-learning.ts`** and is composed of several exported functions:

| Function | Purpose | Key Interaction |
|----------|---------|-----------------|
| `createManualEntity` | Constructs a new entity object from user‑supplied data and hands it to the `EntityPersistenceAgent` for storage. | Calls `EntityPersistenceAgent.persistEntity` (or equivalent) which in turn uses `GraphDatabaseManager` → `GraphDatabaseAdapter`. |
| `manualEntityEdit` | Receives an entity identifier and a delta payload, then updates the corresponding node in the graph database. | Directly invokes methods on `GraphDatabaseAdapter` (e.g., `updateNode`). |
| `manualObservation` | Wraps a human‑crafted observation (often a relationship or attribute) into the graph model and persists it. | Persists via `GraphDatabaseAdapter` similar to `manualEntityEdit`. |
| `manualEntityQuery` | Executes read‑only queries against the graph to retrieve manually created entities, possibly filtered by type or ontology class. | Uses the adapter’s query interface (`findNodes`, `traverse`, etc.). |
| `manualEntityValidation` | Checks that a new or edited entity conforms to the ontology definitions maintained by the broader KnowledgeManagement system. | Likely calls into an ontology validation service (not explicitly listed, but inferred from the name). |
| `manualLearningPipeline` | Coordinates the whole manual‑learning workflow: validation → creation/edit → persistence → optional post‑processing. | Chains the above functions; may also emit events or logs for downstream components. |

The **`ManualEntityHandler`** child component, while not detailed in the observations, is described as “relying on the `GraphDatabaseAdapter` to store and retrieve manual entities.”  It therefore probably offers a higher‑level API (e.g., `addEntity`, `updateEntity`, `fetchEntity`) that wraps the lower‑level adapter calls, providing a convenient façade for any UI or CLI that interacts with manual knowledge entry.

All persistence paths converge on **`storage/graph-database-adapter.ts`**, which, according to the parent component description, includes a `syncJSONExport` routine to keep a JSON representation in sync with the LevelDB store.  This means every manual change automatically triggers a JSON export, preserving an audit‑friendly snapshot of the knowledge graph.

---

## Integration Points  

ManualLearning is tightly coupled to three primary integration points:

1. **`GraphDatabaseAdapter` (`storage/graph-database-adapter.ts`)** – The sole persistence gateway.  Every create, edit, or query operation funnels through this adapter, guaranteeing that manual entities share the same storage semantics as automatically harvested data (e.g., from **OnlineLearning**).  

2. **`EntityPersistenceAgent`** – Serves as the higher‑level service that ManualLearning calls when persisting new entities.  The agent itself depends on **`GraphDatabaseManager`**, which again uses the adapter, forming a chain of responsibility that isolates ManualLearning from direct transaction management.  

3. **Ontology / Validation Layer** – While not explicitly named, the `manualEntityValidation` function implies an interface to the system’s ontology definitions, likely provided by a component such as **`OntologyClassifier`** or a shared validation library.  This ensures that manually entered data does not violate the schema enforced across the knowledge graph.  

Sibling components (OnlineLearning, KnowledgeGraphAnalyzer, OntologyClassifier, etc.) all share the same graph‑access stack, meaning that any change made through ManualLearning is immediately visible to analytics, classification, and checkpoint tracking services.  Conversely, improvements to the adapter (e.g., performance tuning, new export formats) automatically benefit ManualLearning without code changes.

---

## Usage Guidelines  

* **Always validate before persisting** – Developers should invoke `manualEntityValidation` (or rely on `manualLearningPipeline`, which does it automatically) to guarantee ontology compliance. Skipping validation can corrupt the graph and break downstream classifiers.  

* **Prefer the pipeline for end‑to‑end operations** – The `manualLearningPipeline` encapsulates the correct order of steps. Directly calling `createManualEntity` or `manualEntityEdit` is acceptable only for very targeted scripts where the surrounding validation and post‑processing are intentionally bypassed.  

* **Treat the `GraphDatabaseAdapter` as read‑only** – ManualLearning should never modify the adapter’s internal state (e.g., swapping LevelDB instances). All persistence must go through the provided API methods; this preserves the `syncJSONExport` guarantees.  

* **Leverage `ManualEntityHandler` for UI/CLI layers** – When building front‑end tools that allow users to add or edit manual knowledge, wrap calls to the lower‑level functions inside the handler’s façade to keep UI code decoupled from storage specifics.  

* **Be mindful of concurrency** – Since the adapter backs both manual and automated pipelines, concurrent writes can occur. Ensure that any custom scripts acquire the appropriate locks or use the agent’s transaction helpers to avoid race conditions.

---

### Architectural patterns identified  

1. **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the concrete graph store (Graphology + LevelDB).  
2. **Facade/Service Layer** – `EntityPersistenceAgent` and `GraphDatabaseManager` provide simplified, domain‑specific interfaces over the adapter.  
3. **Pipeline/Orchestration Pattern** – `manualLearningPipeline` sequences validation, persistence, and post‑processing steps.  

### Design decisions and trade‑offs  

* **Direct adapter use vs. higher‑level service** – ManualLearning sometimes calls the adapter directly (`manualEntityEdit`, `manualEntityQuery`) for fine‑grained control, while creation goes through the `EntityPersistenceAgent`. This hybrid approach offers performance flexibility but introduces a slight inconsistency in abstraction levels.  
* **Manual vs. automated knowledge paths** – By keeping a dedicated manual pipeline, the system isolates human‑curated data from automatically extracted knowledge, simplifying auditing but requiring duplicate validation logic.  
* **Single source of persistence** – All components share the same adapter, reducing code duplication and ensuring uniform export behavior, at the cost of tighter coupling to the graph implementation.  

### System structure insights  

The component hierarchy is a classic **parent‑child composition**: `KnowledgeManagement` → `ManualLearning` → `ManualEntityHandler`.  Sibling components share the same storage stack, indicating a **vertical slice** architecture where each functional slice (online learning, graph analysis, manual entry) operates independently but converges on a common data layer.  

### Scalability considerations  

Scalability hinges on the performance of `GraphDatabaseAdapter`. Because it uses LevelDB, write throughput is generally good for sequential inserts, but random updates (as performed by `manualEntityEdit`) can become a bottleneck under heavy concurrent manual activity. The `syncJSONExport` routine adds I/O overhead; in large graphs, incremental export or background syncing would be advisable. The pipeline design allows future parallelisation (e.g., validation in a worker thread) without breaking existing contracts.  

### Maintainability assessment  

The clear separation between **persistence (adapter)**, **service (agent/manager)**, and **domain logic (ManualLearning functions)** makes the codebase relatively easy to maintain.  Adding new manual entity types only requires extending validation rules and possibly augmenting the handler, without touching the adapter.  However, the mixed use of direct adapter calls and agent‑mediated calls can create hidden dependencies; a refactor to consistently route all writes through the agent would improve traceability and reduce the risk of divergent transaction handling.  Overall, the component’s responsibilities are well‑scoped, and the shared adapter ensures that improvements to storage propagate uniformly across the system.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's reliance on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for persistence and automatic JSON export sync enables efficient data management. This is evident in the way the adapter leverages Graphology and LevelDB for robust graph database interactions. For instance, the 'syncJSONExport' function in graph-database-adapter.ts ensures that data remains consistent across different storage formats, thus supporting the project's data analysis goals.

### Children
- [ManualEntityHandler](./ManualEntityHandler.md) -- The ManualEntityHandler relies on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve manual entities, as indicated by the parent context.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the GraphDatabaseManager (storage/graph-database-manager.ts) to store extracted knowledge
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to interact with the graph database
- [EntityPersistenceAgent](./EntityPersistenceAgent.md) -- EntityPersistenceAgent uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [KnowledgeGraphAnalyzer](./KnowledgeGraphAnalyzer.md) -- KnowledgeGraphAnalyzer uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [CheckpointTracker](./CheckpointTracker.md) -- CheckpointTracker uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the LevelDB database (storage/leveldb.ts) to store graph data


---

*Generated from 7 observations*

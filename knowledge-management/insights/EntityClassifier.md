# EntityClassifier

**Type:** SubComponent

EntityClassifier's classification results are automatically exported to a JSON file using the automatic JSON export sync feature in graph-database-adapter.ts

## What It Is  

**EntityClassifier** is a sub‑component that lives under the **KnowledgeManagement** component. Its implementation is spread across three core source files:  

* `entity-classifier.ts` – defines the public `classifyEntity` method that drives the classification workflow.  
* `ontology.ts` – supplies the `getOntologyClass` helper used to map a raw entity to an ontology class.  
* `ontology-sources.ts` – contains the concrete ontology source definitions that guide the mapping logic.  

Once an entity has been classified, the result is persisted through the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`). That adapter not only writes to the underlying Graphology + LevelDB graph store but also automatically synchronises the updated graph to a JSON file via its built‑in “automatic JSON export sync” feature.  

The classification routine is invoked from two distinct learning pipelines: the **ManualLearning** component (when a user creates a new entity) and the **OnlineLearning** component (as part of the knowledge‑extraction batch). Thus, EntityClassifier acts as the bridge that turns newly‑ingested or discovered entities into semantically typed nodes inside the knowledge graph.

---

## Architecture and Design  

The observed code reveals a **layered, domain‑driven architecture**:

1. **Domain Layer (EntityClassificationEngine)** – The child component `EntityClassificationEngine` encapsulates the pure classification logic. It is called by `EntityClassifier` (the façade exposed to the rest of the system) and lives entirely in `entity-classifier.ts`.  
2. **Ontology Service Layer** – `ontology.ts` together with `ontology-sources.ts` form a small service that resolves an entity’s semantic type. This layer isolates ontology data from the classification algorithm, making it easy to swap or extend sources.  
3. **Infrastructure Layer (GraphDatabaseAdapter)** – All persistence concerns are funneled through `storage/graph-database-adapter.ts`. The adapter abstracts the underlying Graphology + LevelDB implementation and adds an automatic JSON export capability, effectively providing a **synchronisation façade** for downstream consumers.  

Interaction flow (as inferred from the observations):

* **Trigger** – Either `ManualLearning` (entity creation) or `OnlineLearning` (knowledge extraction) calls `EntityClassifier.classifyEntity`.  
* **Classification** – `classifyEntity` consults `getOntologyClass` (ontology service) which reads the definitions from `ontology-sources.ts`.  
* **Persistence** – The resulting classification is handed to `GraphDatabaseAdapter`, which writes the node/edge into the graph store and instantly mirrors the state to a JSON file.  

No explicit architectural patterns such as “microservices” or “event‑driven” are mentioned, but the **Facade** pattern is evident in the way `EntityClassifier` hides the complexity of ontology lookup and graph persistence behind a single method. The automatic JSON export behaves like an **Observer** (the adapter observes changes to the graph and reacts by writing a JSON snapshot).

---

## Implementation Details  

### Core Classification (`entity-classifier.ts`)  
The `classifyEntity` function receives a raw entity object. It first extracts the entity’s identifier and any relevant attributes, then delegates to `getOntologyClass` (from `ontology.ts`). The returned ontology class (e.g., `Person`, `Component`, `API`) is attached to the entity’s metadata, forming a fully typed graph node.

### Ontology Resolution (`ontology.ts` + `ontology-sources.ts`)  
`ontology.ts` provides the public API `getOntologyClass(entity)`. Internally it reads from the static data structures defined in `ontology-sources.ts`. These sources enumerate the mapping rules—typically a list of regexes, keyword sets, or type hierarchies—that associate raw entity signatures with ontology classes. Because the source file is a plain TypeScript module, adding or updating mappings is a matter of editing `ontology-sources.ts`, after which the classifier immediately picks up the new rules on the next run.

### Persistence (`storage/graph-database-adapter.ts`)  
`GraphDatabaseAdapter` abstracts Graphology’s API and LevelDB’s storage backend. The adapter exposes methods such as `addNode`, `addEdge`, and `upsertEntity`. When `classifyEntity` finishes, it calls the appropriate adapter method to store the classified node. The same file implements an **automatic JSON export sync**: after any successful write operation, a listener serialises the entire graph to a JSON file on disk. This file is the single source of truth for any external tool that needs a snapshot of the knowledge graph (e.g., visualization dashboards, downstream analytics pipelines).

### Trigger Points  
* **ManualLearning** – When a user manually creates an entity, the ManualLearning workflow invokes `EntityClassifier.classifyEntity` before persisting the entity.  
* **OnlineLearning** – The batch analysis pipeline defined in `batch-analysis.yaml` extracts entities from git history, LSL sessions, and code analysis. Each extracted entity is fed into the same `classifyEntity` entry point, ensuring consistent semantic typing across both manual and automated ingestion paths.

---

## Integration Points  

* **Parent – KnowledgeManagement** – The parent component aggregates the classification results into the broader knowledge graph. It relies on the GraphDatabaseAdapter’s JSON export to keep its persisted view synchronised.  
* **Siblings** – `ManualLearning`, `OnlineLearning`, `ObservationDeriver`, `InsightGenerator`, `CodeGraphConstructor`, and `TraceReportGenerator` all share the same `GraphDatabaseAdapter`. This common persistence layer guarantees that any node or relationship created by a sibling is immediately visible to EntityClassifier and vice‑versa.  
* **Child – EntityClassificationEngine** – The engine houses the pure algorithmic part of classification. It is invoked by `EntityClassifier` and can be unit‑tested in isolation because it does not depend on the graph adapter or ontology files.  
* **Ontology Service** – The classifier’s dependency on `ontology.ts` and `ontology-sources.ts` makes the ontology module a clear integration contract. Any consumer that wishes to extend the taxonomy only needs to modify the source file; no changes to the classifier logic are required.  
* **External Consumers** – The JSON file produced by the automatic export is the de‑facto integration point for any external system (e.g., UI visualisers, reporting services). Because the export is triggered on every classification, downstream consumers always see the latest classification state without polling the graph database directly.

---

## Usage Guidelines  

1. **Always invoke classification through the façade** – Call `EntityClassifier.classifyEntity` rather than directly using the `EntityClassificationEngine`. This ensures that ontology lookup and graph persistence happen atomically.  
2. **Keep ontology sources up‑to‑date** – When adding new entity types, edit `ontology-sources.ts` and, if necessary, extend `getOntologyClass` logic. After a change, rerun any pending classification jobs so the new rules are applied.  
3. **Do not bypass the GraphDatabaseAdapter** – All writes to the knowledge graph must go through the adapter to guarantee that the automatic JSON export remains consistent. Direct Graphology calls will break the export sync.  
4. **Respect the trigger contracts** – Manual entity creation should call the classifier *before* persisting the raw entity, mirroring the pattern used by `ManualLearning`. Automated extraction pipelines (`OnlineLearning`) must follow the same ordering to avoid orphaned un‑typed nodes.  
5. **Version the JSON export** – Because the JSON file is the integration artefact for other components, consider version‑naming the output (e.g., `graph-export-v{timestamp}.json`) if multiple concurrent processes may read it.

---

### Architectural patterns identified  

* **Facade** – `EntityClassifier` hides ontology lookup and persistence behind a single method.  
* **Adapter** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB, providing a uniform persistence API.  
* **Observer‑like sync** – The automatic JSON export reacts to graph mutations, keeping an external representation up‑to‑date.  

### Design decisions and trade‑offs  

* **Centralised classification entry point** – simplifies usage but creates a single point of failure; however, the clear separation of concerns (engine vs. façade) mitigates risk.  
* **Static ontology source file** – easy to edit and version, but requires a code change/re‑deployment to update mappings; a more dynamic source (e.g., DB‑backed) would improve flexibility at the cost of added complexity.  
* **Automatic JSON export** – guarantees downstream consistency, yet introduces I/O overhead on every classification; for very high‑throughput scenarios the sync could be throttled or made asynchronous.  

### System structure insights  

The system follows a **vertical slice** organization: each functional slice (classification, ontology, persistence) is co‑located in its own module, while cross‑cutting concerns (graph storage, export) are provided by a shared infrastructure component. Sibling components reuse the same storage adapter, reinforcing a **single source of truth** for the knowledge graph.

### Scalability considerations  

* **GraphDatabaseAdapter** scales with LevelDB’s on‑disk performance; horizontal scaling would require sharding the graph or moving to a distributed graph store.  
* **Classification throughput** is bounded by the synchronous JSON export – in high‑volume ingestion (e.g., massive online learning batches) the export could become a bottleneck. Decoupling the export into an asynchronous background worker would improve scalability.  
* **Ontology lookup** is O(1) for static in‑memory structures; expanding to a large, dynamic ontology may necessitate caching or indexed retrieval.  

### Maintainability assessment  

The current design is **highly maintainable**:  
* Clear separation between classification logic, ontology definitions, and persistence.  
* Small, focused files (`entity-classifier.ts`, `ontology.ts`, `ontology-sources.ts`, `graph-database-adapter.ts`) make code navigation straightforward.  
* The automatic JSON export removes the need for manual synchronisation scripts, reducing operational debt.  

Potential maintenance risks stem from the static nature of `ontology-sources.ts`; as the taxonomy grows, developers must remember to keep this file in sync with domain experts. Introducing unit tests around `getOntologyClass` and the adapter’s export hook will further safeguard against regressions.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving data from a graph database, which is implemented using Graphology and LevelDB. This allows for efficient querying and retrieval of entities and relationships within the knowledge graph. The automatic JSON export sync feature ensures that data is consistently updated across the system. For example, when a new entity is added to the graph, the GraphDatabaseAdapter will automatically export the updated graph data to a JSON file, which can then be used by other components or services.

### Children
- [EntityClassificationEngine](./EntityClassificationEngine.md) -- The EntityClassifier sub-component uses the classifyEntity method in entity-classifier.ts to classify entities in the graph, which is likely handled by the EntityClassificationEngine.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store manually created entities
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline in batch-analysis.yaml to extract knowledge from git history, LSL sessions, and code analysis
- [ObservationDeriver](./ObservationDeriver.md) -- ObservationDeriver uses the deriveObservations method in observation-deriver.ts to derive observations from entities and relationships in the graph
- [InsightGenerator](./InsightGenerator.md) -- InsightGenerator uses the generateInsights method in insight-generator.ts to generate insights from observations and entities in the graph
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- CodeGraphConstructor uses the constructCodeGraph method in code-graph-constructor.ts to construct the code graph
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the generateTraceReport method in trace-report-generator.ts to generate trace reports
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology library to interact with the graph database


---

*Generated from 7 observations*

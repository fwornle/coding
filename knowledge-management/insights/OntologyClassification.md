# OntologyClassification

**Type:** SubComponent

The adapter provides a layer of abstraction between OntologyClassification and the underlying graph database, allowing for seamless interaction with the database

## What It Is  

**OntologyClassification** is a sub‑component that lives inside the **KnowledgeManagement** module.  All of its persistence concerns are funneled through the **`GraphDatabaseAdapter`** class that resides in `storage/graph-database-adapter.ts`.  The adapter hides the concrete graph store (Graphology + LevelDB) behind a thin, purpose‑built API, allowing OntologyClassification to focus on its core responsibility: classifying entities and managing ontology metadata (class and type information).  The component also publishes an interface that other sub‑components—most notably **ManualLearning** and **OnlineLearning**—consume to obtain classified entities and ontology descriptors.  Internally it delegates any read/write operation to the adapter, which in turn guarantees that a JSON export is kept in sync automatically, so the classification data is always available in a portable, human‑readable form.

## Architecture and Design  

The architecture revolves around a **centralised persistence adapter**.  The observation that the adapter “provides a layer of abstraction between OntologyClassification and the underlying graph database” points directly to the **Adapter pattern**: OntologyClassification talks to `GraphDatabaseAdapter` rather than to Graphology or LevelDB APIs.  This abstraction is shared across many sibling components (ManualLearning, EntityPersistence, SemanticCodeSearch, UKBTraceReporting), creating a **single source of truth** for graph‑based storage and a **consistent interaction contract** throughout the KnowledgeManagement slice.

Because the adapter also performs an “automatic JSON export sync”, the design embeds a **synchronisation responsibility** inside the persistence layer.  This is effectively a **synchronisation façade** that keeps a serialized snapshot up‑to‑date without requiring each consumer to manage export logic.  The component hierarchy (KnowledgeManagement → OntologyClassification → OntologyMetadataManagement) further reflects a **compositional design**: OntologyClassification owns a child sub‑component that concentrates on metadata handling while re‑using the same adapter, reinforcing the “one‑adapter‑fits‑all” approach.

## Implementation Details  

- **`storage/graph-database-adapter.ts`** houses the **`GraphDatabaseAdapter`** class.  Its public surface exposes methods for creating, updating, and querying graph nodes/edges.  Internally it instantiates a **Graphology** graph object backed by **LevelDB**, which supplies persistent key‑value storage on disk.  The adapter’s constructor likely wires the LevelDB instance, while its methods translate domain‑level calls (e.g., “addEntity”, “linkClass”) into Graphology operations.

- **Automatic JSON export** is triggered inside the adapter after each mutating operation.  The adapter serialises the current graph state to a JSON file, ensuring that any external tool or downstream component can read a consistent snapshot without directly accessing LevelDB.

- **OntologyClassification** consumes the adapter by importing it from the above path.  Its own code (though not listed) would instantiate the adapter once (perhaps as a singleton) and then use it for:
  1. **Entity classification** – persisting classification results as graph nodes/edges.
  2. **Metadata handling** – storing class‑type definitions that are later exposed via the **OntologyMetadataManagement** child.
  3. **Interface provision** – exposing methods (e.g., `getClassification(entityId)`, `listClasses()`) that other sub‑components call.

- **OntologyMetadataManagement** is a child component that also imports `GraphDatabaseAdapter`.  It likely focuses on CRUD operations for ontology schema objects (classes, types, relationships) while delegating actual storage to the same adapter, ensuring schema and instance data live in the same graph.

## Integration Points  

- **Parent – KnowledgeManagement**: The parent component relies on OntologyClassification as the authoritative source for entity classification and ontology metadata.  KnowledgeManagement’s higher‑level workflows (e.g., knowledge extraction pipelines) query OntologyClassification to enrich raw entities with class/type tags.

- **Siblings – ManualLearning & OnlineLearning**: Both consume the public interface offered by OntologyClassification.  ManualLearning may feed human‑curated labels into the classification graph, while OnlineLearning may inject automatically derived classifications.  Because all siblings use the same `GraphDatabaseAdapter`, they share a unified data model and benefit from the same automatic JSON export.

- **Other siblings – EntityPersistence, SemanticCodeSearch, UKBTraceReporting**: These components also persist or query graph data via the same adapter, reinforcing a **shared persistence contract** across the KnowledgeManagement domain.

- **Child – OntologyMetadataManagement**: This sub‑component extends OntologyClassification’s capabilities by exposing fine‑grained metadata APIs.  It does not introduce a new storage mechanism; instead, it re‑uses the adapter, guaranteeing that any changes to ontology schema are instantly reflected in the classification graph.

## Usage Guidelines  

1. **Instantiate the adapter once** per process (preferably as a singleton) and pass the instance to OntologyClassification and any child components.  This avoids multiple LevelDB handles and ensures the JSON export remains coherent.

2. **Never bypass the adapter** when reading or writing graph data.  All direct Graphology or LevelDB calls would skip the automatic JSON export and break the consistency guarantees described in observation 4.

3. **Treat the classification interface as read‑only** for consumers such as ManualLearning and OnlineLearning unless they are explicitly responsible for mutating classification data.  Mutations should be funneled through well‑named methods that internally invoke the adapter’s write paths.

4. **When extending ontology metadata**, use the OntologyMetadataManagement child component.  Its APIs are built on top of the same adapter, guaranteeing that new class/type definitions are instantly available to the classification logic.

5. **Monitor the JSON export** size and frequency if the graph grows large.  The automatic sync can become a performance bottleneck; consider throttling or batch‑committing mutations if latency becomes an issue.

---

### 1. Architectural patterns identified  
- **Adapter pattern** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB.  
- **Facade for synchronisation** – automatic JSON export wrapped inside the adapter.  
- **Composable hierarchy** – parent‑child relationship (KnowledgeManagement → OntologyClassification → OntologyMetadataManagement).  

### 2. Design decisions and trade‑offs  
- **Single‑adapter persistence** simplifies code reuse and consistency but couples all graph‑related components to the same storage technology.  
- **Graphology + LevelDB** provides fast key‑value backed graph operations; however, LevelDB is an embedded store, limiting horizontal scaling across machines.  
- **Automatic JSON export** offers immediate portability but adds I/O overhead on every write.  

### 3. System structure insights  
- OntologyClassification sits at the core of the KnowledgeManagement domain, acting as both a **data producer** (classifications) and **metadata provider**.  
- Siblings share the same persistence layer, reinforcing a **domain‑wide graph model**.  
- The child component, OntologyMetadataManagement, extends the core without introducing new storage concerns, illustrating a **separation of concerns** within the same bounded context.  

### 4. Scalability considerations  
- Because LevelDB is local to the process, scaling out will require either sharding the graph across multiple instances or migrating to a distributed graph store.  
- The JSON export sync must be evaluated for large graphs; batching or asynchronous export could mitigate potential I/O saturation.  

### 5. Maintainability assessment  
- Centralising all graph interactions in `GraphDatabaseAdapter` greatly improves maintainability: changes to the underlying database or export format are isolated to a single file.  
- The clear contract between OntologyClassification and its children/siblings reduces duplication and eases onboarding for new developers.  
- The main maintainability risk lies in the tight coupling to LevelDB; any future need for a different backend will require careful refactoring of the adapter while preserving its external API.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a GraphDatabaseAdapter for persistence, leveraging Graphology and LevelDB for data storage. This is evident in the storage/graph-database-adapter.ts file, where the GraphDatabaseAdapter class is defined. The adapter provides a layer of abstraction between the KnowledgeManagement component and the underlying graph database, allowing for seamless interaction with the database. The use of Graphology and LevelDB enables efficient storage and querying of knowledge graphs, which is crucial for the component's functionality. Furthermore, the adapter's automatic JSON export sync feature ensures that data is consistently updated and available for use.

### Children
- [OntologyMetadataManagement](./OntologyMetadataManagement.md) -- The GraphDatabaseAdapter class in storage/graph-database-adapter.ts is utilized for persistence, suggesting a strong connection to metadata management.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [SemanticCodeSearch](./SemanticCodeSearch.md) -- SemanticCodeSearch utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- GraphDatabaseManagement utilizes the GraphDatabaseAdapter class in storage/graph-database-adapter.ts for persistence


---

*Generated from 7 observations*

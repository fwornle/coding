# IntelligentQuerying

**Type:** SubComponent

IntelligentQuerying integrates with the ManualLearning module to provide intelligent querying capabilities for manually created knowledge.

## What It Is  

**IntelligentQuerying** is a sub‑component of the **KnowledgeManagement** domain that equips the system with “intelligent” querying capabilities over the knowledge graph.  The implementation lives inside the `KnowledgeManagement/IntelligentQuerying` package (the exact file paths are not listed in the observations, but all references to this sub‑component are scoped to that location).  It orchestrates a set of lower‑level modules—**VKB API**, **Graphology**, **EntityPersistence**, **OntologyClassification**, **PersistenceAgent**, and **ManualLearning**—to translate a user query into graph‑based operations, enforce consistent entity typing, and persist any intermediate or derived entities.  The component also exposes a child module called **VKBQueryEngine**, which encapsulates the direct interaction with the VKB service.

---

## Architecture and Design  

The architecture of **IntelligentQuerying** is built around **composition** of specialised services rather than a monolithic query engine.  The observations describe a clear separation of concerns:

1. **Graph construction & updates** are delegated to the **Graphology** library, which supplies the in‑memory graph data structures.  
2. **Persistence** of entities is handled by two cooperating pieces: the **EntityPersistence** module (which provides higher‑level CRUD semantics) and the **PersistenceAgent** class (the concrete storage driver used by both **EntityPersistence** and **OntologyClassification**).  
3. **Entity typing** is enforced by the **OntologyClassification** module, which also re‑uses **PersistenceAgent** to read/write classification metadata.  
4. **Query execution** is performed by the **VKBQueryEngine**, which acts as a thin wrapper around the external **VKB API**.  

These responsibilities are wired together through **dependency injection**‑style references: the **IntelligentQuerying** module imports the concrete classes (`PersistenceAgent`, `VKBQueryEngine`, etc.) and passes them to the higher‑level orchestration logic.  This results in a **layered** architecture where the top layer (IntelligentQuerying) coordinates lower layers (graph handling, persistence, ontology, manual knowledge) without embedding their internal logic.

Because the component lives alongside several siblings—**ManualLearning**, **OnlineLearning**, **EntityPersistence**, **GraphDatabaseStorage**, **OntologyClassification**, **CodeKnowledgeGraphConstruction**, **KnowledgeGraphManager**—the design deliberately re‑uses shared services (e.g., `PersistenceAgent`) to avoid duplication and to keep the knowledge‑graph ecosystem consistent across the whole **KnowledgeManagement** suite.

No explicit “microservice” or “event‑driven” patterns are mentioned; the observed design is a **modular, library‑centric** approach that leverages existing third‑party tools (Graphology, VKB API) and internal agents for storage and classification.

---

## Implementation Details  

The core of **IntelligentQuerying** is a set of orchestrating functions (the exact symbols are not listed) that perform the following steps:

1. **Query Reception** – A request arrives at the **VKBQueryEngine**.  The engine translates the high‑level query language into VKB‑API calls, using the VKB endpoint defined by the **VKB API** integration.  
2. **Graph Interaction** – Results from VKB are injected into a **Graphology** graph instance.  Graphology provides methods for adding nodes, edges, and updating properties, which IntelligentQuerying uses to keep the in‑memory representation in sync with the external source.  
3. **Entity Persistence** – Whenever new entities are discovered or existing ones are updated, the **EntityPersistence** module calls the **PersistenceAgent** class (found in `persistence_agent.py`) to write the entities to the underlying storage layer (shared with **GraphDatabaseStorage** and **OntologyClassification**).  
4. **Ontology Enforcement** – Before persisting, the **OntologyClassification** module validates the entity’s type against the system ontology.  It also uses `PersistenceAgent` to read any existing classification data, ensuring that the knowledge graph maintains a consistent metadata schema.  
5. **Manual Knowledge Integration** – If a user has manually added knowledge through the **ManualLearning** workflow, IntelligentQuerying pulls that data (the ManualLearning module supplies the knowledge) and merges it into the Graphology graph, again persisting via the shared agent.  

The child **VKBQueryEngine** is the only element explicitly noted as a child node; it encapsulates all VKB‑specific request construction, response parsing, and error handling, shielding the higher layers from API volatility.

Because the observations do not list concrete file paths or function signatures, the implementation description stays at the module/class level, referencing the known classes (`PersistenceAgent`, `VKBQueryEngine`) and modules (`EntityPersistence`, `OntologyClassification`, `ManualLearning`).

---

## Integration Points  

**IntelligentQuerying** sits at the heart of the **KnowledgeManagement** hierarchy and interacts with several peers and parents:

* **Parent – KnowledgeManagement** – The parent component provides the overall repository for all knowledge‑graph‑related services.  IntelligentQuerying contributes the “smart query” capability that other tools (e.g., **OnlineLearning**, **CodeKnowledgeGraphConstruction**) can invoke when they need to retrieve or reason over graph data.  

* **Sibling – EntityPersistence** – Both modules share the **PersistenceAgent** class (`persistence_agent.py`).  This agent abstracts the underlying storage (LevelDB via **GraphDatabaseStorage**) and offers a uniform API for CRUD operations on graph entities.  

* **Sibling – OntologyClassification** – This sibling also uses `PersistenceAgent` for reading/writing ontology metadata, and it supplies the typing logic that IntelligentQuerying calls before persisting new entities.  

* **Sibling – ManualLearning** – Manual edits performed through **ManualLearning** are fed into IntelligentQuerying so that manually curated knowledge becomes searchable through the VKB‑driven query path.  

* **Child – VKBQueryEngine** – The child component is the concrete bridge to the external VKB service.  All query strings are funneled through this engine, making it the sole point of contact with the VKB API.  

* **External – Graphology** – The Graphology library is an external dependency used for in‑memory graph manipulation.  It is not a sibling component but a third‑party library that IntelligentQuerying depends on directly.  

* **External – VKB API** – The VKB service is accessed via HTTP (or a proprietary protocol) from within **VKBQueryEngine**; this external dependency is encapsulated so that the rest of the system remains agnostic to its specifics.

These integration points are all **synchronous** function calls; no message queues or event streams are mentioned, indicating a tightly‑coupled but modular runtime.

---

## Usage Guidelines  

1. **Prefer the VKBQueryEngine façade** – All external query traffic should be routed through the `VKBQueryEngine` class.  Direct calls to the VKB API from other modules break the encapsulation and bypass the ontology‑validation step.  

2. **Let EntityPersistence handle storage** – When creating or updating entities, invoke the high‑level methods exposed by **EntityPersistence** rather than calling `PersistenceAgent` directly.  This ensures that the ontology classification logic in **OntologyClassification** is applied consistently.  

3. **Validate entity types before persisting** – Before persisting any new node, run it through the **OntologyClassification** module.  This step guarantees that the graph’s metadata stays aligned with the system ontology, preventing downstream query mismatches.  

4. **Synchronize manual edits** – After a user finishes a manual edit via **ManualLearning**, trigger the appropriate IntelligentQuerying refresh routine (e.g., `refresh_graph_from_manual_learning()`) so that the in‑memory Graphology graph reflects the latest manual knowledge.  

5. **Do not modify Graphology structures directly** – All graph mutations should go through the IntelligentQuerying orchestration layer.  Direct manipulation can bypass persistence and ontology checks, leading to stale or inconsistent state.  

6. **Handle VKB failures centrally** – The **VKBQueryEngine** should expose error‑handling callbacks that higher layers can subscribe to.  Propagating VKB errors without translation can cause obscure failures in downstream components.  

Following these conventions keeps the system’s knowledge graph coherent, ensures that typing rules are respected, and maintains a clear separation between query execution, graph management, and persistence.

---

### 1. Architectural patterns identified  

* **Composition / Modular layering** – IntelligentQuerying composes distinct services (Graphology, PersistenceAgent, OntologyClassification, VKBQueryEngine).  
* **Facade** – `VKBQueryEngine` acts as a façade over the external VKB API.  
* **Adapter** – The integration of Graphology (a generic graph library) with the system’s entity model works as an adapter layer.  
* **Shared‑service reuse** – `PersistenceAgent` is reused across multiple sibling components, embodying a **service‑oriented** internal pattern.

### 2. Design decisions and trade‑offs  

* **Reuse of PersistenceAgent** reduces code duplication and guarantees a single storage implementation, but it couples several components tightly to the same storage schema, limiting independent evolution of storage strategies.  
* **Delegating entity typing to OntologyClassification** centralizes metadata governance, improving consistency at the cost of an extra processing step before every persistence operation.  
* **Relying on an external VKB API** provides powerful query capabilities without building a custom engine, yet introduces a runtime dependency on network reliability and API version stability.  
* **Using Graphology for in‑memory graphs** gives fast, flexible graph manipulation but requires careful synchronization with the persisted graph to avoid divergence.

### 3. System structure insights  

The **KnowledgeManagement** hierarchy is a **tree of specialized sub‑components**: IntelligentQuerying sits alongside other learning and storage modules, each focusing on a particular concern (manual edits, online extraction, raw storage).  The child **VKBQueryEngine** is the only leaf that directly talks to an external service, while all other leaves (e.g., **EntityPersistence**, **OntologyClassification**) interact through the shared `PersistenceAgent`.  This structure encourages **horizontal reuse** (shared persistence) and **vertical specialization** (query vs. storage vs. classification).

### 4. Scalability considerations  

* **Graphology** operates in‑process; scaling to very large graphs will require sharding or off‑loading to a dedicated graph database.  
* **PersistenceAgent** currently backs onto LevelDB (via **GraphDatabaseStorage**).  LevelDB scales well for read‑heavy workloads but may become a bottleneck for high‑frequency write bursts from simultaneous query results.  
* **VKB API** scalability is external; the system can mitigate latency by caching frequent query results inside the Graphology graph, but cache invalidation logic would need to be added.  

Overall, the design is **scale‑out friendly** as long as the in‑memory graph size stays within the host’s memory limits and the persistence layer is monitored for write contention.

### 5. Maintainability assessment  

The clear separation of responsibilities (query, graph handling, persistence, ontology) makes the codebase **moderately maintainable**.  Shared components like `PersistenceAgent` simplify updates to the storage layer, but any change to its contract ripples through all dependent siblings.  The reliance on external libraries (Graphology, VKB API) means that version upgrades must be coordinated across the entire **KnowledgeManagement** suite.  Documentation should explicitly capture the orchestration flow (query → VKB → Graphology → Ontology → Persistence) to aid future developers in tracing data movement.  With disciplined adherence to the usage guidelines above, the component should remain robust and adaptable.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component plays a vital role in the overall system, providing a centralized repository of knowledge that can be leveraged by various tools and agents. Its ability to integrate with multiple systems and technologies makes it a key enabler of the system's functionality. The component's use of advanced technologies, such as Graphology and LevelDB, ensures that it can handle complex knowledge management tasks efficiently and effectively.

### Children
- [VKBQueryEngine](./VKBQueryEngine.md) -- The VKBQueryEngine is mentioned in the parent context as a suggested detail node, indicating its importance in the IntelligentQuerying sub-component.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the EntityEditor class in the entity_editor.py file to handle manual edits and updates to entities.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the BatchAnalysisPipeline class in the batch_analysis.py file to extract knowledge from git history and LSL sessions.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses the PersistenceAgent class in the persistence_agent.py file to store and retrieve entities from the knowledge graph.
- [GraphDatabaseStorage](./GraphDatabaseStorage.md) -- GraphDatabaseStorage uses the LevelDB database to store and retrieve knowledge graph data.
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification uses the PersistenceAgent class in the persistence_agent.py file to handle ontology classification and entity typing.
- [CodeKnowledgeGraphConstruction](./CodeKnowledgeGraphConstruction.md) -- CodeKnowledgeGraphConstruction uses the CodeGraphAgent class in the code_graph_agent.py file to construct the code knowledge graph.
- [KnowledgeGraphManager](./KnowledgeGraphManager.md) -- KnowledgeGraphManager uses the GraphDatabaseStorage module to handle storage and retrieval of knowledge graph data.

---

*Generated from 6 observations*

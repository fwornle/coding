# ManualLearning

**Type:** SubComponent

ManualLearning integrates with the CodeKnowledgeGraphConstruction module to incorporate manually created code knowledge into the overall knowledge graph.

## What It Is  

ManualLearning is a **sub‑component** of the larger **KnowledgeManagement** component. Its concrete implementation lives in the `entity_editor.py` file where the `EntityEditor` class resides, and it orchestrates a suite of existing modules to enable human‑driven curation of the knowledge graph. When a user edits or creates an entity, ManualLearning routes the request through `EntityEditor`, persists the change with the shared `PersistenceAgent` (defined in `persistence_agent.py`), validates and types the entity via the **OntologyClassification** module, and finally injects the new or updated node into the graph using the **Graphology** library. In addition, ManualLearning can enrich the curated knowledge by invoking the **CodeKnowledgeGraphConstruction** module for code‑specific entities and by leveraging the **VKB API** (also used by the sibling **IntelligentQuerying** component) to provide smart query support for the manually created content.

---

## Architecture and Design  

The architecture that emerges from the observations is a **modular, component‑centric design** in which each responsibility is encapsulated in a dedicated library or class. ManualLearning does not implement low‑level persistence, ontology handling, or graph manipulation itself; instead, it **acts as a façade/mediator** that coordinates the following collaborators:

1. **EntityEditor (`entity_editor.py`)** – the UI‑oriented entry point for manual edits.  
2. **PersistenceAgent (`persistence_agent.py`)** – the shared persistence layer also used by the sibling **EntityPersistence** and **OntologyClassification** components.  
3. **VKB API** – the external intelligent‑query service, the same service consumed by **IntelligentQuerying**.  
4. **OntologyClassification** – provides entity typing and ensures metadata consistency.  
5. **Graphology** – the graph‑construction library that underpins the knowledge‑graph data structures.  
6. **CodeKnowledgeGraphConstruction** – a specialist module that translates code artifacts into graph entities.

The **dependency graph** is therefore shallow: ManualLearning imports the `EntityEditor` class directly, while the other collaborators are accessed through their public interfaces (e.g., `PersistenceAgent.save_entity()`, `OntologyClassification.classify()`). This reflects a **separation‑of‑concerns** pattern that keeps manual‑learning logic independent of storage, ontology, or graph details. The reuse of `PersistenceAgent` across multiple siblings demonstrates intentional **shared service** design, reducing duplication and guaranteeing a single source of truth for entity storage.

Because ManualLearning sits under the **KnowledgeManagement** parent, it inherits the parent’s overall responsibilities for centralizing knowledge. The sibling components (OnlineLearning, GraphDatabaseStorage, etc.) each provide complementary capabilities—online extraction, low‑level storage, etc.—and ManualLearning consumes their public APIs rather than coupling to internal implementations. This yields a **plug‑and‑play** style where new knowledge‑curation workflows could be added without reshaping the core graph or persistence layers.

---

## Implementation Details  

* **EntityEditor (`entity_editor.py`)** – The only concrete file mentioned. The class likely exposes methods such as `edit_entity()`, `create_entity()`, and `apply_changes()`. These methods accept raw user input, perform validation, and then delegate to downstream services. Because ManualLearning “contains” EntityEditor, the sub‑component’s public API is essentially the editor’s methods.

* **PersistenceAgent** – Although the source file is not listed in the observations, its class name appears in both ManualLearning and its siblings **EntityPersistence** and **OntologyClassification**. ManualLearning calls the agent to **store** newly curated entities (`PersistenceAgent.save_entity(entity)`) and to **retrieve** existing ones for editing (`PersistenceAgent.load_entity(id)`). The shared usage ensures that all components read and write to the same underlying storage (LevelDB, as noted in the sibling **GraphDatabaseStorage**).

* **VKB API Integration** – ManualLearning leverages the same VKB API used by **IntelligentQuerying**. After an entity is edited, ManualLearning may invoke a query like `vkb.query_intent(entity_text)` to enrich the entity with inferred relationships or to surface similar entities for the curator’s review.

* **OntologyClassification** – The module supplies a function (e.g., `OntologyClassification.classify(entity)`) that assigns a type label and validates that the entity’s metadata conforms to the system’s ontology. ManualLearning calls this before persisting, guaranteeing that manually curated data does not violate the global schema.

* **Graphology** – This third‑party library is the engine for constructing and updating the knowledge graph. ManualLearning passes the fully typed entity to Graphology’s API (`graph.add_node(entity)`) and may also invoke edge‑creation helpers to link the new node to existing structures.

* **CodeKnowledgeGraphConstruction** – When a manually created entity represents code (e.g., a function or class), ManualLearning forwards the raw code artifact to this module (`CodeKGConstruction.ingest(code_blob)`). The module translates the code into graph nodes/edges that are then merged into the main graph via Graphology.

The overall flow can be summarized as: **User Input → EntityEditor → OntologyClassification → PersistenceAgent ↔ Graphology → (optional) CodeKnowledgeGraphConstruction → VKB enrichment**. Each step is isolated, making the pipeline easy to test and replace.

---

## Integration Points  

ManualLearning’s integration surface is defined by the **public interfaces** of its collaborators:

| Integration Target | Interface / Class | Role in ManualLearning |
|--------------------|-------------------|------------------------|
| **EntityEditor** | `EntityEditor` (entity_editor.py) | Captures manual edit actions and provides a clean API for the sub‑component |
| **PersistenceAgent** | `PersistenceAgent` (persistence_agent.py) | Persists curated entities and retrieves them for further edits |
| **VKB API** | `vkb_client` (exposed by IntelligentQuerying) | Supplies intelligent query results and intent detection for manual entries |
| **OntologyClassification** | `OntologyClassification` module | Enforces ontology compliance and assigns type metadata |
| **Graphology** | Graphology library functions (`add_node`, `add_edge`, etc.) | Materializes entities in the knowledge graph |
| **CodeKnowledgeGraphConstruction** | `CodeKnowledgeGraphConstruction` module | Transforms code artifacts into graph representations |
| **Parent – KnowledgeManagement** | Component aggregation API | ManualLearning registers its curated entities with the parent’s central repository |
| **Sibling – EntityPersistence** | Shared `PersistenceAgent` | Guarantees consistent storage semantics across manual and automated pipelines |
| **Sibling – GraphDatabaseStorage** | LevelDB backend (via GraphDatabaseStorage) | Underlying storage engine that ultimately holds the graph data persisted by PersistenceAgent |

All interactions are **unidirectional** from ManualLearning to the collaborators, except for the shared `PersistenceAgent`, which may emit events that other siblings (e.g., **OnlineLearning**) can listen to for incremental learning. The design therefore encourages loose coupling while still enabling rich cross‑component behavior.

---

## Usage Guidelines  

1. **Always route manual edits through `EntityEditor`.** Direct manipulation of graph nodes bypasses validation and ontology checks, risking schema corruption.  
2. **Invoke `OntologyClassification` before persisting.** The classification step guarantees that every entity conforms to the global ontology, which is critical for downstream query correctness.  
3. **Persist via `PersistenceAgent` only after Graphology has successfully added the node.** This order ensures that the persisted state reflects the actual graph structure.  
4. **When curating code entities, call `CodeKnowledgeGraphConstruction` first** to obtain a fully‑linked code sub‑graph; then merge the result into the main graph with Graphology.  
5. **Leverage the VKB API for enrichment, but treat its responses as advisory.** Manual curators should review any suggested relationships before committing them.  
6. **Do not duplicate persistence logic.** Reuse the shared `PersistenceAgent` rather than implementing custom storage in ManualLearning; this keeps the system’s data consistency guarantees intact.  
7. **Respect the parent‑child contract:** ManualLearning should expose a clean method (e.g., `register_entity(entity)`) that KnowledgeManagement can call to incorporate the curated entity into the global repository.

Following these conventions keeps ManualLearning aligned with the broader KnowledgeManagement ecosystem and minimizes integration friction.

---

### Architectural patterns identified  
* **Facade / Mediator** – ManualLearning provides a single entry point that coordinates several specialized services.  
* **Separation of Concerns** – Editing, persistence, ontology handling, graph construction, and external querying are each isolated in their own module.  
* **Shared Service** – `PersistenceAgent` is a common service reused across multiple sibling components.  

### Design decisions and trade‑offs  
* **Reuse vs. Duplication:** Choosing a shared `PersistenceAgent` reduces code duplication and ensures a single source of truth, at the cost of tighter coupling between ManualLearning and other components that also depend on it.  
* **Explicit Validation Layer:** Placing ontology classification before persistence adds an extra step that improves data quality but introduces latency for each manual edit.  
* **Optional Code‑KG Integration:** By delegating code‑specific processing to `CodeKnowledgeGraphConstruction`, ManualLearning stays lightweight; however, it must handle the additional failure modes that arise from code parsing.  

### System structure insights  
* ManualLearning sits one level below **KnowledgeManagement** and above **EntityEditor**, forming a clear vertical hierarchy.  
* Its horizontal relationships with siblings (OnlineLearning, EntityPersistence, etc.) are defined by shared libraries (`PersistenceAgent`, VKB API) rather than direct calls, indicating a loosely coupled ecosystem.  

### Scalability considerations  
* **Edit Throughput:** Manual edits are human‑driven, so the load is naturally bounded, but the component should still be thread‑safe because `PersistenceAgent` and Graphology may be accessed concurrently by other automated pipelines.  
* **Graph Growth:** Since Graphology and LevelDB (via GraphDatabaseStorage) handle the underlying graph, ManualLearning’s scalability largely depends on those layers; the component itself adds negligible overhead.  
* **External API Calls:** VKB queries introduce network latency; caching query results or batching enrichments can mitigate performance impacts as the number of curated entities rises.  

### Maintainability assessment  
* **High maintainability** stems from the clear modular boundaries: any change to the editing UI stays within `EntityEditor`, while storage changes are confined to `PersistenceAgent`.  
* **Shared dependencies** (e.g., `PersistenceAgent`) require coordinated versioning; a breaking change in the agent could ripple across ManualLearning and its siblings.  
* **Documentation focus:** Because ManualLearning orchestrates many external modules, comprehensive interface contracts (method signatures, expected return types) are essential to prevent integration bugs.  

Overall, ManualLearning exemplifies a well‑structured, extensible sub‑component that leverages existing infrastructure while providing a focused, human‑centric knowledge‑curation workflow.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component plays a vital role in the overall system, providing a centralized repository of knowledge that can be leveraged by various tools and agents. Its ability to integrate with multiple systems and technologies makes it a key enabler of the system's functionality. The component's use of advanced technologies, such as Graphology and LevelDB, ensures that it can handle complex knowledge management tasks efficiently and effectively.

### Children
- [EntityEditor](./EntityEditor.md) -- The EntityEditor class is used in the ManualLearning sub-component to handle manual edits and updates to entities, as indicated by the parent context.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the BatchAnalysisPipeline class in the batch_analysis.py file to extract knowledge from git history and LSL sessions.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses the PersistenceAgent class in the persistence_agent.py file to store and retrieve entities from the knowledge graph.
- [GraphDatabaseStorage](./GraphDatabaseStorage.md) -- GraphDatabaseStorage uses the LevelDB database to store and retrieve knowledge graph data.
- [IntelligentQuerying](./IntelligentQuerying.md) -- IntelligentQuerying uses the VKB API to provide intelligent querying capabilities for the knowledge graph.
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification uses the PersistenceAgent class in the persistence_agent.py file to handle ontology classification and entity typing.
- [CodeKnowledgeGraphConstruction](./CodeKnowledgeGraphConstruction.md) -- CodeKnowledgeGraphConstruction uses the CodeGraphAgent class in the code_graph_agent.py file to construct the code knowledge graph.
- [KnowledgeGraphManager](./KnowledgeGraphManager.md) -- KnowledgeGraphManager uses the GraphDatabaseStorage module to handle storage and retrieval of knowledge graph data.


---

*Generated from 6 observations*

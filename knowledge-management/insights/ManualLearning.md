# ManualLearning

**Type:** SubComponent

The HandCraftedObservationManager in hand_crafted_observation_manager.py manages hand-crafted observations and integrates them into the knowledge graph.

## What It Is  

ManualLearning is the sub‑component that provides the “human‑in‑the‑loop” capabilities for KnowledgeManagement. Its implementation lives in a handful of focused Python modules under the KnowledgeManagement code‑base:

* `manual_learning/manual_learning_module.py` – the public entry point that orchestrates manual‑learning workflows.  
* `manual_learning/entity_authoring_tool.py` – supplies the **EntityAuthoringTool** used to create and edit entities.  
* `manual_learning/direct_edit_module.py` – houses the **DirectEditModule** for on‑the‑fly edits of existing entities.  
* `manual_learning/hand_crafted_observation_manager.py` – implements the **HandCraftedObservationManager**, which injects manually curated observations into the knowledge graph.  
* `manual_learning/knowledge_graph_updater.py` – provides the **KnowledgeGraphUpdater** that persists new or changed entities.  
* `manual_learning/entity_validation_service.py` – contains the **EntityValidationService**, responsible for checking the consistency and accuracy of every manual change.

Together these files deliver a tightly scoped “manual learning” pipeline: a user creates or modifies an entity, the change is validated, any hand‑crafted observations are attached, and the resulting graph updates are written through the shared **GraphDatabaseManager**. The sub‑component is explicitly listed as a child of **KnowledgeManagement**, and it groups three logical children – *EntityAuthoring*, *DirectEntityEditing*, and *HandCraftedObservationManagement* – each of which is represented by a dedicated class.

---

## Architecture and Design  

The architecture that emerges from the observations is a **modular, service‑oriented design** built around clear separation of concerns. Each functional responsibility lives in its own module:

* **Entity creation & editing** – `EntityAuthoringTool` and `DirectEditModule` encapsulate UI‑driven or programmatic authoring actions.  
* **Validation** – `EntityValidationService` acts as a gatekeeper, ensuring that manually supplied data conforms to the ontology and internal constraints before any persistence occurs.  
* **Observation handling** – `HandCraftedObservationManager` treats hand‑crafted observations as a distinct artefact, allowing them to be attached to entities without contaminating the core authoring flow.  
* **Graph persistence** – `KnowledgeGraphUpdater` abstracts the write‑path to the graph database, delegating the low‑level connection details to the sibling **GraphDatabaseManager** (which itself wraps `graph_db_client.py`).

The **ManualLearningModule** in `manual_learning_module.py` functions as a façade, exposing a concise API to the rest of the system while internally coordinating the above services. This mirrors the pattern used by other siblings such as **OnlineLearning** (which hides `GitHistoryAnalyzer`) and **TraceReportGenerator** (which hides `WorkflowRunner`).  

Interaction with the parent **KnowledgeManagement** component is mediated through shared infrastructure: the parent’s *intelligent routing* for database interactions is leveraged by `KnowledgeGraphUpdater`, and the *classification cache* and *data loss tracker* are available to any service that needs to avoid redundant LLM calls or monitor data flow. No new routing logic is introduced inside ManualLearning; it simply plugs into the existing mechanisms.

---

## Implementation Details  

### Entry point – `manual_learning_module.py`  
The `ManualLearningModule` class is instantiated by higher‑level orchestration code. Its public methods (e.g., `create_entity`, `edit_entity`, `add_observation`) accept domain‑specific DTOs, then delegate to the appropriate service classes. The module also wires the **EntityValidationService** into the workflow, guaranteeing that every mutation passes validation before any persistence call.

### Entity authoring – `entity_authoring_tool.py`  
`EntityAuthoringTool` provides a rich API for constructing entity objects from user input. It encapsulates field‑level handling, default value injection, and schema awareness. The class does **not** directly persist; it returns a fully‑populated entity instance to the caller.

### Direct editing – `direct_edit_module.py`  
`DirectEditModule` focuses on in‑place updates of existing entities. It retrieves the target entity via the **GraphDatabaseManager**, applies a patch‑style change set, and hands the modified entity back to the validation service. This module is deliberately lightweight, avoiding any UI concerns and allowing programmatic edits (e.g., batch scripts).

### Hand‑crafted observations – `hand_crafted_observation_manager.py`  
Observations are represented as separate graph nodes linked to entities. `HandCraftedObservationManager` offers methods such as `attach_observation(entity_id, observation_payload)`. By isolating observation logic, the system can evolve observation schemas without touching the core authoring code.

### Validation – `entity_validation_service.py`  
The validation service checks for ontology compliance, required attribute presence, and cross‑entity consistency. It raises domain‑specific exceptions that bubble up to `ManualLearningModule`, which can surface user‑friendly error messages. Validation is deliberately stateless, enabling easy unit testing and future replacement with more sophisticated rule engines.

### Graph updates – `knowledge_graph_updater.py`  
`KnowledgeGraphUpdater` receives a validated entity (or observation) and issues create/update queries through the shared **GraphDatabaseManager**. The updater respects the parent component’s *intelligent routing* – it can decide whether to use a direct driver call or an API endpoint based on configuration, but this decision logic is inherited rather than re‑implemented.

All modules import the central `GraphDatabaseManager` singleton, ensuring a single point of connection management and consistent transaction handling across siblings like **OnlineLearning** and **EntityPersistenceManager**.

---

## Integration Points  

1. **GraphDatabaseManager** – Every persistence operation (`KnowledgeGraphUpdater`) and every read‑back for editing (`DirectEditModule`) goes through this manager. The manager’s underlying `GraphDBClient` is shared across the entire KnowledgeManagement suite, guaranteeing consistent session handling and connection pooling.

2. **ClassificationCache** (parent pattern) – While ManualLearning does not directly invoke the cache, the validation service can query it to avoid re‑classifying entities that have already been processed, thereby aligning with the parent’s *classification cache* strategy.

3. **DataLossTracker** – The parent component’s data‑loss tracking hooks are automatically engaged when `KnowledgeGraphUpdater` writes to the graph. This ensures that any failure to persist a manual edit is recorded, supporting auditability.

4. **Sibling services** – ManualLearning co‑exists with **OnlineLearning**, **EntityPersistenceManager**, and others. Because each sibling follows the same façade‑style entry point (`*_module.py`) and relies on the shared database manager, they can be composed in higher‑level workflows (e.g., a pipeline that first runs online extraction, then allows a human to refine entities via ManualLearning).

5. **Child components** – The three child concepts—*EntityAuthoring*, *DirectEntityEditing*, and *HandCraftedObservationManagement*—are not separate packages but are embodied by the concrete classes listed above. External callers only need to interact with `ManualLearningModule`; the internal decomposition remains encapsulated.

---

## Usage Guidelines  

* **Always validate before persisting.** The `ManualLearningModule` automatically invokes `EntityValidationService`; developers should not bypass this step, as it guards the knowledge graph’s integrity.  
* **Prefer `EntityAuthoringTool` for new entities and `DirectEditModule` for modifications.** Mixing the two can lead to duplicated logic and harder‑to‑track change histories.  
* **Attach observations through `HandCraftedObservationManager`.** Directly linking observation data to entities without using the manager would skip any future enrichment pipelines that expect observations to follow a canonical node type.  
* **Respect the shared `GraphDatabaseManager`.** Do not instantiate separate database clients; rely on the manager’s singleton to benefit from connection pooling and the parent’s intelligent routing.  
* **Handle exceptions gracefully.** Validation and persistence raise domain‑specific errors; catch them at the `ManualLearningModule` level to present clear feedback to end users and to trigger the parent’s `DataLossTracker` when needed.  
* **Leverage the parent’s caching where possible.** If a validation rule requires classification, query the `ClassificationCache` first to avoid unnecessary LLM calls, aligning with the broader system’s performance goals.

---

### Architectural patterns identified  

1. **Modular decomposition** – distinct modules for authoring, editing, observation handling, validation, and persistence.  
2. **Facade pattern** – `ManualLearningModule` presents a simplified API while hiding internal service orchestration.  
3. **Service layer** – each functional area (validation, updating) is encapsulated in its own class, promoting single‑responsibility.  
4. **Shared infrastructure** – common `GraphDatabaseManager` and parent‑level routing/cache mechanisms are reused across components.

### Design decisions and trade‑offs  

* **Manual vs. automated learning** – By dedicating a sub‑component to manual edits, the system gains high fidelity and domain expert control at the cost of added human effort and potential bottlenecks.  
* **Stateless validation service** – Simplicity and testability are gained, but complex cross‑entity rules may require additional state‑ful services later.  
* **Separate observation manager** – Keeps observation logic clean, yet introduces an extra integration step for callers who must remember to attach observations explicitly.  
* **Reuse of GraphDatabaseManager** – Guarantees consistency and reduces duplicated connection code, but creates a single point of failure if the manager’s API changes.

### System structure insights  

ManualLearning sits under **KnowledgeManagement**, sharing the parent’s intelligent routing, classification cache, and data‑loss tracking. Its sibling components each expose a similar façade (`*_module.py`) and rely on the same `GraphDatabaseManager`, illustrating a consistent architectural language across the knowledge‑system ecosystem. The three logical children of ManualLearning are implemented as concrete classes rather than separate packages, reinforcing tight cohesion within the sub‑component.

### Scalability considerations  

* **Horizontal scaling of validation and update services** – Because each service is stateless and interacts with the database through a shared manager, multiple instances can run behind a load balancer without contention.  
* **Potential bottleneck in manual authoring** – Human‑driven entity creation cannot be parallelized automatically; scaling here depends on increasing the pool of domain experts or augmenting the UI for batch authoring.  
* **Cache utilization** – Leveraging the parent’s `ClassificationCache` reduces repeated LLM calls, improving throughput as the volume of manual edits grows.  
* **Database throughput** – All writes funnel through `KnowledgeGraphUpdater`; ensuring the underlying graph database can handle concurrent writes is essential for large‑scale manual learning campaigns.

### Maintainability assessment  

The clear separation of concerns and the use of well‑named, single‑purpose classes make the codebase approachable for new developers. The façade (`ManualLearningModule`) isolates callers from internal changes, allowing internal refactoring (e.g., swapping out the validation algorithm) without breaking external contracts. However, the reliance on a shared `GraphDatabaseManager` means that any modification to its API could ripple through all siblings, so versioned interfaces and thorough integration tests are advisable. Overall, the design balances readability with extensibility, supporting incremental evolution of manual‑learning capabilities.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct access modes. Additionally, the component utilizes a classification cache to avoid redundant LLM calls and implements data loss tracking to monitor data flow through the system.

### Children
- [EntityAuthoring](./EntityAuthoring.md) -- The EntityAuthoringTool class is used in the ManualLearning sub-component to create and edit entities manually, as indicated by the hierarchy context.
- [DirectEntityEditing](./DirectEntityEditing.md) -- The ManualLearning sub-component's focus on manual learning suggests that direct editing of entities is a crucial feature, as indicated by the hierarchy context.
- [HandCraftedObservationManagement](./HandCraftedObservationManagement.md) -- The ManualLearning sub-component's focus on manual learning implies that hand-crafted observations are an important aspect of the learning process, as indicated by the hierarchy context.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the GitHistoryAnalyzer class in git_history_analyzer.py to extract knowledge from git history.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDBClient class in graph_db_client.py to interact with the graph database.
- [EntityPersistenceManager](./EntityPersistenceManager.md) -- EntityPersistenceManager uses the EntityClassifier class in entity_classifier.py to classify entities.
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the WorkflowRunner class in workflow_runner.py to run workflows and capture data flow.
- [ClassificationCacheManager](./ClassificationCacheManager.md) -- ClassificationCacheManager uses the ClassificationCache class in classification_cache.py to store and retrieve classification results.
- [DataLossTracker](./DataLossTracker.md) -- DataLossTracker uses the DataFlowMonitor class in data_flow_monitor.py to monitor data flow and track data loss.
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the OntologyUpdater class in ontology_updater.py to update the ontology.
- [WorkflowManager](./WorkflowManager.md) -- WorkflowManager uses the WorkflowRunner class in workflow_runner.py to run workflows.


---

*Generated from 7 observations*

# ManualLearning

**Type:** SubComponent

The EntityValidator class in ManualLearning uses a set of predefined rules in the validation_rules.json file to validate manually created entities

## What It Is  

ManualLearning is a **sub‑component** of the larger **KnowledgeManagement** system that enables human curators to create, edit, and validate entities and observations that feed the knowledge graph. The core of the implementation lives under the `manual_learning/` directory. Inside this folder you will find an `entity_templates/` sub‑directory that houses ready‑made JSON/YAML templates used when manually constructing new entities, and a `validation_rules.json` file that drives the rule‑based checks performed by the `EntityValidator` class. The primary public classes exposed by the sub‑component are:

* `EntityValidator` – validates manually authored entities against the VKB API and the local rule set.  
* `EntityAuthor` – implements the `IEntityManager` interface to provide a consistent API for creating, updating, and deleting entities.  
* `ObservationEditor` – offers a CRUD‑style UI/logic layer for hand‑crafted observations and employs an internal caching mechanism to speed up repeated reads.  

Together these pieces give curators a controlled, reproducible workflow for injecting high‑quality, manually curated knowledge into the graph.

---

## Architecture and Design  

### Modular Sub‑Component within KnowledgeManagement  
ManualLearning is deliberately isolated as a **module** under the parent `KnowledgeManagement` component. This mirrors the sibling components (e.g., `OnlineLearning`, `EntityPersistence`, `OntologyClassification`) that each own a focused responsibility. The design follows a **separation‑of‑concerns** principle: ManualLearning focuses exclusively on human‑in‑the‑loop entity creation, while validation and classification are delegated to the sibling `OntologyClassification` component via its public API.

### Interface‑Based Consistency  
`EntityAuthor` implements the `IEntityManager` interface, a contract shared across other entity‑management modules (such as those in `EntityPersistence`). By conforming to a common interface, ManualLearning can be swapped or extended without breaking callers that rely on `IEntityManager` methods like `createEntity`, `updateEntity`, and `deleteEntity`. This reflects an **interface segregation** design decision that keeps each module’s public surface minimal and purpose‑specific.

### CRUD‑Style Observation Management  
`ObservationEditor` presents a classic **CRUD** pattern for observations: create, read, update, delete. The class abstracts persistence details behind its methods, allowing the UI or downstream agents to manipulate observations without knowing the underlying storage mechanism. This aligns with the **Repository** style often seen in the sibling `EntityPersistence` component, reinforcing a consistent data‑access idiom across the codebase.

### Rule‑Based Validation with External API  
`EntityValidator` combines two sources of truth: a static `validation_rules.json` file that defines local constraints, and the external **VKB API** that provides canonical ontology checks. The validator first applies the JSON‑defined rules (e.g., required fields, value ranges) and then invokes VKB endpoints to confirm that the entity conforms to the global ontology. This two‑layer approach implements a **defense‑in‑depth** validation strategy, reducing reliance on a single source of truth.

### Caching for Observation Reads  
To avoid repeated expensive fetches (potentially involving VKB calls or disk I/O), `ObservationEditor` incorporates an internal caching layer. While the exact cache implementation is not detailed, the presence of a caching mechanism indicates a **performance‑optimization** pattern akin to the **Cache‑Aside** strategy: reads first check the cache, and on a miss the data is retrieved and then stored for subsequent accesses.

---

## Implementation Details  

### File Structure  
```
manual_learning/
│
├─ entity_templates/          # Pre‑defined JSON/YAML templates for manual entity creation
│   └─ <template files>
│
├─ validation_rules.json     # JSON document describing rule set for EntityValidator
│
├─ EntityValidator.py        # Class that validates entities using VKB API + local rules
│
├─ EntityAuthor.py           # Implements IEntityManager, provides create/update/delete
│
└─ ObservationEditor.py      # CRUD interface for observations with an internal cache
```

### EntityValidator  
* **Inputs:** a manually created entity instance (usually produced from a template in `entity_templates/`).  
* **Process:**  
  1. Load `validation_rules.json` (parsed once, likely at class initialization).  
  2. Apply each rule to the entity – checks include mandatory attributes, type constraints, and cross‑field consistency.  
  3. If the local checks pass, the validator issues a request to the **VKB API** (the same API used by `OntologyClassification`) to confirm that the entity’s type, relationships, and identifiers exist in the central ontology.  
* **Outputs:** a validation result object (success/failure) and a collection of error messages.  

Because the validator directly contacts the VKB service, it is a **boundary component** that bridges ManualLearning with the broader knowledge ecosystem.

### EntityAuthor (IEntityManager)  
Implements the methods defined by `IEntityManager`:

* `createEntity(templateId, overrides)` – loads a template from `entity_templates/`, merges any curator‑provided overrides, runs the `EntityValidator`, and on success forwards the entity to the persistence layer (via `EntityPersistence` sibling).  
* `updateEntity(entityId, changes)` – fetches the existing entity, applies changes, re‑validates, and persists.  
* `deleteEntity(entityId)` – invokes the appropriate delete routine in the persistence sibling, ensuring any dependent observations are also cleaned up.

By delegating persistence to a sibling component, `EntityAuthor` stays lightweight and focused on **authoring logic**.

### ObservationEditor  
Provides the following CRUD methods:

* `createObservation(data)` – stores a new observation, populates the cache entry.  
* `readObservation(id)` – checks the internal cache first; on miss, retrieves the observation (likely via a repository in `ObservationManagement`) and caches it.  
* `updateObservation(id, data)` – updates the underlying store and refreshes the cache.  
* `deleteObservation(id)` – removes the observation from the store and evicts it from the cache.

The caching mechanism is transparent to callers, giving a performance boost for frequent read‑heavy workflows (e.g., UI panels that repeatedly display the same observation while a curator edits related entities).

### Interaction with OntologyClassification  
ManualLearning does **not** implement its own ontology logic; instead, it relies on the sibling `OntologyClassification` component. When `EntityValidator` calls the VKB API, the underlying service is the same one used by `OntologyClassifier`. This shared dependency reduces duplication and ensures that manual entities are classified using the same taxonomy as automatically extracted ones.

---

## Integration Points  

1. **Parent – KnowledgeManagement**  
   * ManualLearning is registered under the `KnowledgeManagement` umbrella, meaning its services are discoverable via the same dependency injection or service registry used by other sub‑components.  
   * Any global configuration (e.g., VKB API credentials, cache policies) defined at the KnowledgeManagement level propagates down to ManualLearning.

2. **Sibling – OntologyClassification**  
   * Validation of entities (`EntityValidator`) calls the VKB API, which is the same endpoint used by `OntologyClassifier`. This creates a tight coupling on the ontology service contract; any change to the VKB API version must be coordinated across both components.

3. **Sibling – EntityPersistence**  
   * After successful validation, `EntityAuthor` forwards entities to `EntityPersistence` (via the `GraphDatabaseConnector` in that sibling) for storage in the graph database. The interface between them is likely a simple DTO or a domain model object.

4. **Child Components**  
   * `EntityValidator`, `EntityAuthoring`, and `ObservationManagement` are exposed as child modules within ManualLearning. External callers (e.g., UI layers, workflow orchestrators) interact with these children rather than with ManualLearning directly.

5. **External – VKB API**  
   * Both validation and classification depend on the external VKB service. Network latency, rate limits, and authentication handling are therefore cross‑cutting concerns for ManualLearning.

6. **Caching Layer**  
   * The internal cache of `ObservationEditor` may be backed by an in‑process LRU store or a shared cache (e.g., Redis) if configured at the KnowledgeManagement level. The cache’s eviction policy influences how fresh observation data appears to users.

---

## Usage Guidelines  

* **Always validate before persisting.** Curators must invoke `EntityValidator` (implicitly through `EntityAuthor.createEntity` or `updateEntity`) to guarantee that both local rules and the global ontology are satisfied. Skipping validation can corrupt the knowledge graph.  

* **Leverage entity templates.** When creating a new entity, start from a file in `manual_learning/entity_templates/`. Templates encode the minimal required structure and reduce the chance of rule violations. Use the `overrides` argument to customize fields rather than editing the template directly.  

* **Respect the cache semantics.** `ObservationEditor` caches read observations; if an observation is modified outside the editor (e.g., via a batch import), explicitly call `ObservationEditor.evictCache(id)` or refresh the observation to avoid stale data.  

* **Handle VKB API failures gracefully.** Because validation reaches out to an external service, wrap calls in retry logic and surface meaningful error messages to the curator UI. Consider fallback to “offline validation” using only `validation_rules.json` if the VKB service is temporarily unavailable, but flag the entity for later re‑validation.  

* **Do not bypass the IEntityManager contract.** Directly manipulating the underlying persistence layer (e.g., calling GraphDatabaseConnector) from ManualLearning code circumvents the consistency checks performed by `EntityAuthor`. All entity lifecycle operations should go through the `IEntityManager` methods.  

* **Version control of templates and rules.** Both `entity_templates/` and `validation_rules.json` should be stored in source control. Any change to a template or rule set must be reviewed, as it can affect all downstream manual entities.  

* **Testing strategy.** Unit tests should mock the VKB API and verify that `EntityValidator` correctly applies the JSON rules. Integration tests should spin up a test instance of the VKB service (or a stub) to confirm end‑to‑end validation and classification.  

---

### Summary of Requested Deliverables  

| Item | Observation‑Based Insight |
|------|---------------------------|
| **Architectural patterns identified** | Interface segregation (`IEntityManager`), CRUD/Repository pattern (`ObservationEditor`), Rule‑based validation with external service (defense‑in‑depth), Cache‑Aside performance pattern, Modular sub‑component isolation within a parent component. |
| **Design decisions and trade‑offs** | *Decision*: Separate manual authoring from automated pipelines → *Trade‑off*: Requires explicit validation step and extra API calls. <br> *Decision*: Use shared VKB API for both validation and classification → *Trade‑off*: Tight coupling to external service; any downtime impacts manual workflows. <br> *Decision*: Cache observations locally → *Trade‑off*: Potential stale reads; must manage cache invalidation. |
| **System structure insights** | ManualLearning sits under `KnowledgeManagement`, shares the VKB API with `OntologyClassification`, and forwards persisted entities to `EntityPersistence`. Its children (`EntityValidator`, `EntityAuthoring`, `ObservationManagement`) expose focused responsibilities, mirroring the sibling components’ specialization. |
| **Scalability considerations** | Validation latency scales with VKB API performance; batching or async validation could be added if manual throughput grows. The observation cache can be expanded to a distributed cache if multiple curator instances run concurrently. Template and rule files are static; large numbers of templates may need indexing for quick lookup. |
| **Maintainability assessment** | High maintainability thanks to clear interface boundaries (`IEntityManager`) and isolated rule files (`validation_rules.json`). The reliance on external VKB API introduces a single point of failure, but centralizing ontology logic there also reduces duplicated code. Adding new validation rules is a matter of editing JSON, while extending authoring capabilities only requires conforming to `IEntityManager`. Overall, the module’s modular layout and explicit contracts support easy evolution. |


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and intelligent routing for database access. It utilizes various technologies such as Graphology, LevelDB, and VKB API to provide a comprehensive knowledge management system. The component's architecture is designed to support multiple agents, including CodeGraphAgent and PersistenceAgent, which work together to analyze code, extract concepts, and store entities in the graph database.

### Children
- [EntityValidator](./EntityValidator.md) -- The EntityValidator class utilizes the VKB API to validate entities, as seen in the EntityValidator class of the ManualLearning sub-component
- [EntityAuthoring](./EntityAuthoring.md) -- The EntityAuthoring module is a key component of the ManualLearning sub-component, enabling curators to create and edit entities
- [ObservationManagement](./ObservationManagement.md) -- The ObservationManagement module is a crucial part of the ManualLearning sub-component, allowing for the management of observations

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the LevelDB database to store extracted knowledge in the KnowledgeExtractor class
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses the Graphology library to interact with the graph database in the GraphDatabaseConnector class
- [GraphDatabaseInteraction](./GraphDatabaseInteraction.md) -- GraphDatabaseInteraction uses the VKB API to manage graph database interactions in the GraphDatabaseRouter class
- [CodeAnalysis](./CodeAnalysis.md) -- CodeAnalysis uses the AST-based approach to analyze code and extract concepts in the CodeAnalyzer class
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification uses the VKB API to manage ontology classification and entity validation in the OntologyClassifier class
- [TraceReporting](./TraceReporting.md) -- TraceReporting uses the VKB API to generate trace reports in the TraceReporter class
- [AgentManagement](./AgentManagement.md) -- AgentManagement uses the VKB API to manage agents in the AgentManager class
- [WorkflowManagement](./WorkflowManagement.md) -- WorkflowManagement uses the VKB API to manage workflows in the WorkflowManager class


---

*Generated from 7 observations*

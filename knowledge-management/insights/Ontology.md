# Ontology

**Type:** SubComponent

OntologyClassifier uses a hierarchical classification approach, with upper and lower ontology definitions in ontology-definitions.yaml

## What It Is  

**Ontology** is the sub‑component that encapsulates the definition, loading, validation, and runtime resolution of the knowledge‑domain model used throughout the **SemanticAnalysis** system. All of its concrete artefacts live in the configuration folder of the repository and are referenced by a handful of dedicated classes:

* `ontology-definitions.yaml` – stores the **upper** and **lower** ontology definitions that drive the hierarchical classification performed by `OntologyClassifier`.  
* `OntologyConfiguration.yaml` – declares the full ontology structure, enumerating entity types, their attributes, and the relationships between them.  
* `OntologyManager.loadOntology()` – the entry point that reads the YAML files, materialises the in‑memory model, and makes it available to the rest of the system.  

At runtime the component supplies three core services: **classification** (`OntologyClassifier`), **type resolution** (`EntityTypeResolver.resolveEntityType()`), and **validation** (`OntologyValidator.validateOntology()`). Utility helpers such as `OntologyUtils.getOntologyClass()` expose convenient look‑ups for other agents (e.g., the `EntityValidator` sibling or the `InsightGenerator` in the *Insights* module).

---

## Architecture and Design  

The Ontology sub‑system follows a **configuration‑driven, hierarchical classification** architecture. The design is centred on a small set of cohesive classes that each fulfil a single responsibility, a pattern that mirrors the broader **SemanticAnalysis** architecture where agents are isolated by concern (e.g., `PipelineController`, `LLMFacade`).  

* **Configuration‑Driven Initialization** – `OntologyManager` reads `OntologyConfiguration.yaml` and `ontology-definitions.yaml` to build a graph‑like representation of entity types. This mirrors the DAG‑based execution model used by the sibling *Pipeline* component, but here the graph represents **semantic relationships** rather than execution ordering.  

* **Strategy‑Like Resolution** – `EntityTypeResolver.resolveEntityType()` implements a pluggable resolution strategy that consults both the entity’s metadata and the loaded ontology definitions. The method’s signature suggests that alternative strategies could be swapped in without changing callers, a classic Strategy pattern applied to type inference.  

* **Validator Pattern** – `OntologyValidator.validateOntology()` encapsulates all consistency checks (e.g., duplicate identifiers, missing parent definitions) in a dedicated validator class. This isolates validation logic from loading and classification, allowing the system to reject malformed ontologies early.  

* **Utility/Factory Helper** – `OntologyUtils.getOntologyClass()` acts as a lightweight factory/lookup service, providing other components with a strongly‑typed reference to an ontology class based on a string key. By centralising this logic, the codebase avoids scattering string‑based look‑ups across agents such as `EntityValidator` or `InsightGenerator`.  

Interaction flow: the **SemanticAnalysis** parent orchestrates agents; when an entity is ingested, the **OntologyClassifier** consults the loaded hierarchy, the **EntityTypeResolver** determines the concrete type, and the **OntologyValidator** may be invoked during configuration reloads to guarantee integrity. All of these interactions are mediated through the in‑memory model populated by `OntologyManager`.

---

## Implementation Details  

1. **Ontology Definitions (`ontology-definitions.yaml`)** – This YAML file contains two distinct sections: an *upper* ontology that defines abstract super‑classes (e.g., `Concept`, `Artifact`) and a *lower* ontology that refines them into concrete domain entities (e.g., `SourceFile`, `Function`). The hierarchical nature enables `OntologyClassifier` to walk the tree from generic to specific when assigning a class to a new knowledge entity.

2. **Ontology Configuration (`OntologyConfiguration.yaml`)** – Beyond the class hierarchy, this file enumerates entity attributes (type, required fields) and relationship cardinalities (one‑to‑many, inheritance). The configuration is parsed by `OntologyManager.loadOntology()`, which builds a set of internal data structures (likely maps of class name → metadata, adjacency lists for parent/child links).

3. **`OntologyManager`** – The static or singleton `loadOntology()` method is the bootstrapper. It reads both YAML sources, validates them via `OntologyValidator.validateOntology()`, and registers the resulting model in a global registry (or dependency‑injection container) so that downstream agents can query it without re‑parsing files.

4. **`OntologyClassifier`** – Implements a hierarchical classification algorithm. Given an incoming raw entity, it first attempts a direct match against the lower ontology; if none is found, it ascends the hierarchy to the nearest matching upper‑ontology node. This approach ensures graceful degradation and aligns with the “upper‑lower” design described in observation 1.

5. **`EntityTypeResolver`** – The `resolveEntityType()` method receives an entity’s metadata (e.g., file path, language, extracted AST nodes) and cross‑references it with the ontology model. It may apply rule‑based heuristics (e.g., “if file extension is .java and contains a class declaration, map to `SourceFile`”) and returns the resolved ontology class identifier.

6. **`OntologyValidator`** – Performs static checks such as: (a) every lower‑ontology entry must have a defined parent in the upper ontology, (b) no cyclic inheritance, (c) required attributes are declared for each class. Validation is invoked both at startup (via `OntologyManager`) and potentially on‑demand when a developer updates the YAML files.

7. **`OntologyUtils`** – Provides `getOntologyClass(className: string)`, a thin wrapper that retrieves the pre‑loaded class definition from the global registry. This utility is used by sibling components like `EntityValidator` and the `InsightGenerator` to ensure they operate on a consistent view of the ontology.

Because the observations list **0 code symbols found**, the analysis relies on naming conventions and typical patterns rather than concrete method bodies, but the responsibilities are clearly delineated by class names and file locations.

---

## Integration Points  

* **Parent – SemanticAnalysis** – The Ontology sub‑component is a first‑class citizen of the parent’s modular agent ecosystem. When the **SemanticAnalysis** orchestrator boots, it triggers `OntologyManager.loadOntology()` before any agent that consumes knowledge entities (e.g., `PipelineController`, `InsightGenerator`). This guarantees that classification and resolution services are ready for downstream processing.

* **Sibling – EntityValidator** – `EntityValidator.validateEntity()` leverages the same metadata and ontology definitions that `EntityTypeResolver` uses. By sharing `OntologyUtils.getOntologyClass()`, both agents maintain a single source of truth for entity schemas, reducing duplication and potential drift.

* **Sibling – Insights** – The `InsightGenerator.generateInsights()` function queries the ontology to understand the semantic context of a knowledge entity before applying pattern‑based insight rules. For example, it may only generate “code‑complexity” insights for entities classified as `Function` in the lower ontology.

* **Sibling – Pipeline** – While the *Pipeline* component orchestrates execution order via a DAG defined in `pipeline-configuration.yaml`, the Ontology’s internal hierarchy is itself a DAG of class inheritance. Both share a common philosophy of declarative configuration driving runtime behaviour, which simplifies reasoning about dependencies across the system.

* **External – GraphDatabaseAdapter / MemgraphAdapter** – Persisted knowledge entities are stored with a reference to their ontology class. The adapters rely on the class identifiers supplied by `OntologyUtils` to create appropriate graph nodes and relationships, ensuring that the persisted graph respects the ontology’s constraints.

---

## Usage Guidelines  

1. **Never modify the YAML files without re‑loading** – After any change to `ontology-definitions.yaml` or `OntologyConfiguration.yaml`, invoke `OntologyManager.loadOntology()` (or restart the service) so that the in‑memory model and validators are refreshed. Failure to do so can lead to mismatched classifications or validation errors.

2. **Prefer the utility for look‑ups** – When a component needs to retrieve an ontology class, call `OntologyUtils.getOntologyClass(className)` rather than parsing the YAML directly. This guarantees that the lookup respects the current loaded state and any runtime augmentations.

3. **Respect the hierarchical classification flow** – When adding new entity types, place them in the appropriate section (upper vs. lower) and define a clear parent. `OntologyClassifier` will automatically fall back to the nearest ancestor if a direct match is unavailable.

4. **Leverage the validator during CI** – Integrate `OntologyValidator.validateOntology()` into the CI pipeline to catch malformed ontology definitions before they reach production. This mirrors the validation step performed by the `EntityValidator` sibling.

5. **Keep resolution logic declarative** – If you need to extend `EntityTypeResolver.resolveEntityType()`, do so by adding rule definitions (e.g., pattern‑to‑class mappings) in a separate configuration file rather than hard‑coding them. This maintains the component’s configurability and aligns with the overall design philosophy of the system.

---

### Architectural Patterns Identified  

1. **Configuration‑Driven Architecture** – YAML files drive the ontology structure.  
2. **Strategy Pattern** – `EntityTypeResolver` encapsulates a pluggable resolution algorithm.  
3. **Validator Pattern** – `OntologyValidator` isolates consistency checks.  
4. **Factory/Utility Lookup** – `OntologyUtils.getOntologyClass()` centralises class retrieval.  
5. **Hierarchical Classification** – `OntologyClassifier` traverses an inheritance DAG.

### Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Store ontology in YAML | Human‑readable, easy to version‑control, aligns with other config‑driven components (e.g., pipeline) | Parsing overhead at startup; limited expressiveness compared to a dedicated DSL |
| Separate validator from loader | Early detection of malformed definitions, reusable by CI | Requires an extra step during initialization |
| Hierarchical classification rather than flat lookup | Supports abstraction (upper ontology) and graceful degradation | Slightly more complex algorithm; classification may be slower for deep hierarchies |
| Central utility for class retrieval | Guarantees a single source of truth, reduces duplication | Introduces a global registry that must be kept in sync |

### System Structure Insights  

* The Ontology sub‑component sits at the semantic core of **SemanticAnalysis**, providing the schema that all downstream agents rely on.  
* Its internal model mirrors the DAG used by the *Pipeline* sibling, reinforcing a consistent “graph‑of‑concerns” mindset across the codebase.  
* Siblings such as *EntityValidator* and *Insights* treat the ontology as a contract, consuming it via the same utility functions, which simplifies cross‑component compatibility.

### Scalability Considerations  

* **Load‑time scalability** – Because the ontology is loaded once at startup, the size of the YAML files directly impacts boot time. For very large ontologies, consider lazy loading of rarely used branches or splitting the definitions into modular files.  
* **Runtime classification** – `OntologyClassifier` walks the inheritance hierarchy; the cost is O(depth). Keeping the hierarchy shallow (few inheritance levels) mitigates latency when classifying high‑throughput streams of entities.  
* **Concurrent access** – The in‑memory model is read‑only after loading, enabling safe concurrent reads by multiple agents (e.g., parallel pipeline steps) without synchronization overhead.

### Maintainability Assessment  

The component exhibits **high maintainability** due to:

* **Clear separation of concerns** – Loading, validation, classification, and resolution are each encapsulated in dedicated classes.  
* **Declarative configuration** – Changes to the ontology are made in YAML, which is straightforward for non‑engineers to edit and review.  
* **Reusable utilities** – `OntologyUtils` prevents code duplication and centralises future schema‑evolution logic.  

Potential risks include **configuration drift** if developers edit YAML files without running the validator, and **tight coupling** to the global registry if many modules start to depend on the exact in‑memory representation. Mitigation strategies are CI validation and documenting the registry’s public API.

---


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It features a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The system utilizes a range of technologies, including GraphDatabaseAdapter for persistence, LLMService for language model integration, and Wave agents for concurrent execution.

### Siblings
- [Pipeline](./Pipeline.md) -- PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges
- [Insights](./Insights.md) -- InsightGenerator.generateInsights() uses a pattern-based approach to generate insights from knowledge entities
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph
- [EntityValidator](./EntityValidator.md) -- EntityValidator.validateEntity() implements a validation strategy based on entity metadata and definitions
- [LLMFacade](./LLMFacade.md) -- LLMFacade.getLLMModel() retrieves the LLM model instance based on configuration and provider
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- WorkflowOrchestrator.runWorkflow() executes the workflow with the given input and parameters
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter.persistEntity() persists the entity to the graph database
- [MemgraphAdapter](./MemgraphAdapter.md) -- MemgraphAdapter.persistCodeEntity() persists the code entity to Memgraph


---

*Generated from 6 observations*

# KnowledgeGraph

**Type:** SubComponent

GraphQueryBuilder builds queries to retrieve knowledge entities and their relationships using the GraphQueryBuilder class in knowledge-graph/query-builder.ts

## What It Is  

The **KnowledgeGraph** sub‑component lives under the `knowledge-graph/` directory of the code base. Its core responsibilities are to persist knowledge entities, construct queries that traverse the graph, and enforce data integrity. The three concrete classes that give the component its functionality are:

* `GraphDatabase` – defined in `knowledge-graph/database.ts`, this class encapsulates the low‑level storage operations for the graph.  
* `GraphQueryBuilder` – defined in `knowledge-graph/query-builder.ts`, it assembles graph‑oriented queries (e.g., node‑lookup, relationship traversal) in a programmatic way.  
* `GraphValidator` – defined in `knowledge-graph/validator.ts`, it checks incoming or mutated graph data against domain‑specific rules before it is persisted.

KnowledgeGraph is a child of the **SemanticAnalysis** component, which orchestrates a broader pipeline for extracting meaning from code and natural‑language artifacts. Within that hierarchy, KnowledgeGraph supplies the structured graph store that downstream agents (e.g., InsightGenerator, OntologyManager) can query for contextual information.

---

## Architecture and Design  

The observations reveal a **layered, separation‑of‑concerns** architecture. Each major responsibility—persistence, query composition, and validation—is isolated in its own class and file, allowing the sub‑component to evolve independently. This design mirrors a classic *Repository*‑like approach: `GraphDatabase` acts as the gateway to the underlying graph store, while `GraphQueryBuilder` provides a fluent, type‑safe way to express retrieval intent without leaking storage specifics to callers. `GraphValidator` sits as a guard layer, ensuring that only well‑formed entities enter the graph.

Interaction between the layers follows a straightforward call‑chain pattern:

1. A consumer (often a higher‑level service in **SemanticAnalysis**) creates or updates a knowledge entity.  
2. The entity is first passed to `GraphValidator` to enforce schema or business rules.  
3. Upon successful validation, the consumer invokes `GraphDatabase` to write the entity.  
4. For reads, the consumer builds a query with `GraphQueryBuilder`, then hands the resulting query object to `GraphDatabase` for execution.

No explicit architectural patterns such as micro‑services or event‑driven messaging are mentioned; the design is purely in‑process and class‑centric. However, the clear modular boundaries make the component amenable to future refactoring (e.g., swapping the storage engine) without disturbing the query‑building or validation logic.

---

## Implementation Details  

### `GraphDatabase` (`knowledge-graph/database.ts`)  
`GraphDatabase` encapsulates all CRUD operations on the graph. Although the source code is not shown, the naming suggests methods such as `createNode`, `createRelationship`, `findNodeById`, and `executeQuery`. By centralising these operations, the class hides the specific graph database technology (Neo4j, JanusGraph, an in‑memory adjacency list, etc.) from the rest of the system.

### `GraphQueryBuilder` (`knowledge-graph/query-builder.ts`)  
The builder pattern is evident from the class name. `GraphQueryBuilder` likely provides a fluent API—e.g., `new GraphQueryBuilder().matchNode('Person').where('age > $age').return('name')`—that assembles a query object or string. This abstraction enables callers to construct complex traversals without hand‑crafting raw query language (Cypher, Gremlin, etc.). The separation from `GraphDatabase` means the same builder can be reused across different storage back‑ends.

### `GraphValidator` (`knowledge-graph/validator.ts`)  
`GraphValidator` is responsible for domain validation. Typical responsibilities include checking that required properties exist on a node, that relationship types conform to the ontology, and that cyclic dependencies are avoided where prohibited. By isolating validation, the component ensures that data quality checks are not scattered throughout the code base.

Together, these three classes form a thin, well‑defined API surface: validation → persistence, and query building → execution. The lack of additional symbols in the observations suggests that the sub‑component does not expose a higher‑level façade; instead, callers interact directly with the three classes.

---

## Integration Points  

**Parent – SemanticAnalysis**  
SemanticAnalysis contains KnowledgeGraph, meaning that the graph is the canonical store for entities extracted during semantic processing (e.g., code symbols, natural‑language concepts). Agents such as `OntologyClassificationAgent` (found in `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) likely query the KnowledgeGraph to resolve ontology terms or to verify classification results. The DAG‑based execution model described for SemanticAnalysis ensures that KnowledgeGraph operations occur at deterministic points in the pipeline, preventing race conditions.

**Sibling Components**  
- **Pipeline**: Uses a DAG with topological sorting to orchestrate steps; KnowledgeGraph may be queried as part of a pipeline stage that needs relational context.  
- **Ontology**: Holds the ontology definitions that the `GraphValidator` may reference when checking relationship types.  
- **Insights**: The `InsightGenerator` (in `insights/generator.ts`) can retrieve patterns from the graph via `GraphQueryBuilder` to produce higher‑level observations.  
- **CodeGraphConstructor** and **SemanticInsightGenerator**: Both produce data that ultimately ends up as nodes or edges in the KnowledgeGraph, feeding it through the same validation and persistence path.

**External Interfaces**  
The only explicit external dependencies are the three class files themselves. Because the component is self‑contained, any consumer only needs to import `knowledge-graph/database.ts`, `knowledge-graph/query-builder.ts`, or `knowledge-graph/validator.ts`. The design therefore encourages loose coupling: swapping out a sibling (e.g., replacing the current `InsightGenerator` with a newer version) does not require changes inside KnowledgeGraph.

---

## Usage Guidelines  

1. **Validate before persisting** – Always pass new or updated entities through `GraphValidator` first. The validator encapsulates the ontology‑aware rules that keep the graph consistent. Skipping this step can lead to silent corruption that downstream agents (e.g., OntologyClassificationAgent) may not detect.  
2. **Prefer the query builder for reads** – Construct queries with `GraphQueryBuilder` rather than writing raw query strings. This maintains compatibility with any future changes to the underlying query language or database driver.  
3. **Keep persistence calls confined to `GraphDatabase`** – Directly accessing the storage engine (e.g., via a driver or raw connection) bypasses the abstraction and undermines the modular design. All create, update, delete, and read operations should route through the `GraphDatabase` methods.  
4. **Respect the execution order defined by SemanticAnalysis** – Since the parent component uses a DAG‑based topological sort, ensure that any KnowledgeGraph mutation occurs in a step that is scheduled before consumers that rely on the new data. This prevents transient inconsistencies.  
5. **Version the ontology and validation rules** – When the ontology evolves, update any constants or rule sets used by `GraphValidator`. Because validation logic lives in a single class, versioning changes here will automatically propagate to all callers.

---

### Architectural Patterns Identified  

* **Separation of Concerns / Layered Architecture** – distinct classes for storage, query building, and validation.  
* **Builder Pattern** – `GraphQueryBuilder` provides a fluent interface for assembling queries.  
* **Repository‑like Abstraction** – `GraphDatabase` acts as the sole gateway to the persistence layer.

### Design Decisions and Trade‑offs  

* **Explicit Validation Layer** – Guarantees data integrity but adds an extra step before persistence, potentially impacting write latency.  
* **Query Builder Isolation** – Improves portability and readability; however, it may hide performance‑critical query optimizations that are only possible with raw query language.  
* **In‑Process Component** – Simplicity and low overhead, but limits horizontal scalability unless the underlying graph database itself supports clustering.

### System Structure Insights  

KnowledgeGraph sits as a leaf node under SemanticAnalysis, providing a reusable graph store for multiple sibling components. Its three‑class API forms a narrow contract, making it easy for other parts of the system to adopt without deep knowledge of the storage details. The component’s placement within a DAG‑driven pipeline ensures deterministic data flow.

### Scalability Considerations  

Scalability hinges on the capabilities of the underlying graph database accessed by `GraphDatabase`. Because the component itself is thin, scaling out can be achieved by configuring a clustered graph store (e.g., Neo4j Enterprise). The validation step could become a bottleneck under heavy write loads; profiling and possibly parallelising independent validation checks would mitigate this. Query building remains lightweight, but complex traversals may need pagination or streaming support from the database.

### Maintainability Assessment  

The clear modular split makes the sub‑component highly maintainable. Changes to storage (e.g., switching databases) affect only `GraphDatabase`. Adjustments to query syntax are confined to `GraphQueryBuilder`. Validation rule updates are isolated in `GraphValidator`. The lack of cross‑cutting concerns and the adherence to a narrow public API reduce the risk of regressions. Documentation should emphasize the three‑step workflow (validate → build query → execute) to keep future contributors aligned with the intended usage pattern.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component's utilization of a DAG-based execution model with topological sort allows for efficient processing of git history and LSL sessions. This is evident in the OntologyClassificationAgent, which leverages the OntologyConfigManager, OntologyManager, and OntologyValidator classes to classify observations against the ontology system, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file. The topological sort ensures that the agents are executed in a specific order, preventing any potential circular dependencies or inconsistencies in the knowledge entities extraction process.

### Siblings
- [Pipeline](./Pipeline.md) -- PipelineAgent uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- OntologyConfigManager loads the ontology configuration from the ontology-config.yaml file in the integrations/mcp-server-semantic-analysis/src/config directory
- [Insights](./Insights.md) -- InsightGenerator generates insights from the processed observations using the InsightGenerator class in insights/generator.ts
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- CodeGraphConstructor uses the ASTParser class in code-graph/parser.ts to parse the abstract syntax tree of the code
- [SemanticInsightGenerator](./SemanticInsightGenerator.md) -- SemanticInsightGenerator uses the NLPProcessor class in semantic-insight-generator/nlp-processor.ts to process the natural language text
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses the LLMServiceFactory class in llm-service-manager/factory.ts to create LLM services
- [OntologyRepository](./OntologyRepository.md) -- OntologyRepository uses the OntologyDatabase class in ontology-repository/database.ts to store the ontology definitions and their relationships


---

*Generated from 3 observations*

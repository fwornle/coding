# CodeKnowledgeGraph

**Type:** SubComponent

CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph

## What It Is  

`CodeKnowledgeGraph` is the sub‑component that materialises a graph representation of source‑code artefacts for the **SemanticAnalysis** system. The core of the implementation lives in a dedicated module that exposes a small, well‑defined public API: `CodeKnowledgeGraphBuilder.buildGraph()`, `CodeEntityMapper.mapCodeEntity()`, `CodeKnowledgeGraphQuery.queryGraph()`, `CodeKnowledgeGraphManager.loadGraph()` and the supporting utility `CodeKnowledgeGraphUtils.getNodeClass()`. The shape of the graph—its node types, edge types and property schema—is declared declaratively in **CodeKnowledgeGraphConfiguration.yaml**. Together, these pieces turn raw source files into an AST, map the resulting entities onto graph nodes, persist the structure in Memgraph, and provide a query façade for downstream agents. Because `SemanticAnalysis` “contains” `CodeKnowledgeGraph`, the graph is a central knowledge store that other sibling components (e.g., **Insights**, **Ontology**, **EntityValidator**) consume when they need a structural view of the code base.

## Architecture and Design  

The design follows a **configuration‑driven, layered architecture**. At the bottom lies the **AstParser** child component, which the `CodeKnowledgeGraphBuilder` invokes to obtain an abstract syntax tree for each source file. The builder then orchestrates a **Builder pattern** (`CodeKnowledgeGraphBuilder.buildGraph()`) that assembles the graph by delegating to `CodeEntityMapper.mapCodeEntity()`. The mapper embodies a classic **Mapper/Transformer** pattern: it converts AST nodes into domain‑specific graph nodes, consulting `CodeKnowledgeGraphUtils.getNodeClass()` to resolve the concrete class that matches a node definition from the YAML configuration.

Persistence is handled by a thin **Adapter** layer—implicit in the observations but evident from the sibling `MemgraphAdapter`—which abstracts the underlying **Memgraph** in‑memory graph database. The `CodeKnowledgeGraphManager.loadGraph()` method reads **CodeKnowledgeGraphConfiguration.yaml**, creates the schema in Memgraph, and materialises the graph data produced by the builder. Finally, `CodeKnowledgeGraphQuery.queryGraph()` offers a **Query Interface** that shields callers from the raw Cypher (or equivalent) syntax, exposing higher‑level methods that sibling components can invoke.

All interactions are explicit and decoupled: the configuration file defines the contract, the builder respects that contract, the mapper enforces it, and the manager and query façade provide lifecycle and access services. This separation mirrors the modular philosophy of the parent **SemanticAnalysis** component, where each agent (ontology classification, content validation, etc.) works against well‑specified interfaces.

## Implementation Details  

1. **Graph Construction (`CodeKnowledgeGraphBuilder.buildGraph`)** – The builder iterates over source files, calls the **AstParser** (its child) to obtain an AST, and walks the tree. For each relevant AST node it invokes `CodeEntityMapper.mapCodeEntity()`. The mapper uses `CodeKnowledgeGraphUtils.getNodeClass()` to look up the concrete node class defined in **CodeKnowledgeGraphConfiguration.yaml** (e.g., `FunctionNode`, `ClassNode`). Once a node instance is created, the builder adds it to the Memgraph session, establishing edges according to the edge definitions in the same YAML file.

2. **Entity Mapping (`CodeEntityMapper.mapCodeEntity`)** – This class encapsulates the translation logic. It extracts identifier names, visibility modifiers, type annotations, and relationships (e.g., “calls”, “inherits”) from the AST node, then populates the corresponding graph node properties. The mapper is deliberately stateless; it receives the raw AST node and the target node class, returning a fully‑initialised graph object ready for persistence.

3. **Configuration (`CodeKnowledgeGraphConfiguration.yaml`)** – The YAML file is the single source of truth for the graph schema. It lists node types with their expected properties, edge types with source/target constraints, and any default indexing hints. Because the schema lives outside the code, adding a new node type (for example, a `MacroNode`) only requires a YAML entry and a matching Python class; no changes to the builder or mapper are needed.

4. **Lifecycle Management (`CodeKnowledgeGraphManager.loadGraph`)** – On system start‑up, the manager reads the configuration, creates the graph schema in Memgraph (creating indexes, constraints, etc.), and optionally pre‑loads any static entities. It also provides a hook for re‑loading the graph when the underlying source changes, ensuring the knowledge graph stays in sync with the repository.

5. **Query Facade (`CodeKnowledgeGraphQuery.queryGraph`)** – This class abstracts Cypher queries behind domain‑specific methods such as `findFunctionsByName`, `listClassesImplementingInterface`, or generic traversal helpers. Internally it builds Cypher strings using the node/edge definitions from the configuration, guaranteeing that queries remain compatible even if the schema evolves.

## Integration Points  

`CodeKnowledgeGraph` sits at the heart of **SemanticAnalysis**. Its primary inputs are source files supplied by the **Pipeline** component (which orchestrates git‑history extraction). The **AstParser** child consumes those files, producing ASTs that the builder consumes. Once the graph is populated, sibling components such as **Insights** (via `InsightGenerator.generateInsights()`), **Ontology** (via `OntologyClassifier`), and **EntityValidator** query the graph through `CodeKnowledgeGraphQuery`. The persistence layer is the **MemgraphAdapter**, which aligns with the system‑wide `GraphDatabaseAdapter` abstraction used by other components (e.g., `WorkflowOrchestrator`). Configuration changes flow through the same YAML mechanism used by the **Pipeline** (`pipeline-configuration.yaml`) and **Ontology** (`ontology-definitions.yaml`), reinforcing a consistent, declarative approach across the code base.

## Usage Guidelines  

1. **Never modify the graph schema directly in code** – always edit **CodeKnowledgeGraphConfiguration.yaml** and add a matching node class if needed. This keeps the builder and mapper agnostic to schema changes.  
2. **Invoke the builder through `CodeKnowledgeGraphManager.loadGraph()`** rather than calling `buildGraph()` directly; the manager ensures the Memgraph schema is prepared and that any required indexes are in place.  
3. **Use the query façade (`CodeKnowledgeGraphQuery`) for all reads**. Direct Cypher execution bypasses the abstraction and can lead to brittle code that breaks when the YAML schema evolves.  
4. **Treat `CodeEntityMapper` as a pure function** – it should not retain state between calls. If you need custom mapping logic, subclass the mapper and register the subclass in the configuration rather than patching the original class.  
5. **Keep AST parsing lightweight** – if the code base is large, consider parallelising the `AstParser` calls at the pipeline level; the builder itself is single‑threaded but is fast once it receives an AST.  

---

### Architectural patterns identified  
- **Builder pattern** (`CodeKnowledgeGraphBuilder`)  
- **Mapper/Transformer pattern** (`CodeEntityMapper`)  
- **Configuration‑driven schema** (YAML file)  
- **Adapter pattern** for Memgraph persistence (`MemgraphAdapter`)  
- **Facade/Query Interface** (`CodeKnowledgeGraphQuery`)  

### Design decisions and trade‑offs  
- **Declarative schema** via YAML gives flexibility but adds a runtime dependency on correct configuration parsing.  
- **Separation of builder, mapper, manager, and query** improves testability and maintainability at the cost of more classes and indirection.  
- **In‑memory graph (Memgraph)** offers high query performance but requires sufficient RAM for large codebases; swapping to a persistent graph store would need a different adapter.  

### System structure insights  
- `CodeKnowledgeGraph` is a **knowledge‑store sub‑component** nested under **SemanticAnalysis**, sharing the same modular execution model as its siblings.  
- The **AstParser** child provides the only direct source‑code analysis; all other components interact with the graph rather than raw code.  
- Configuration files across the system (pipeline, ontology, graph) follow a uniform declarative style, reinforcing a **configuration‑as‑code** discipline.  

### Scalability considerations  
- Memgraph’s in‑memory nature scales well for medium‑size projects; for very large repositories, sharding or streaming graph construction may be required.  
- The builder’s linear walk over ASTs can be parallelised upstream (e.g., by the **Pipeline**), allowing horizontal scaling across CPU cores.  
- Adding new node/edge types does not affect runtime complexity because the mapper looks up classes in O(1) via the utility function.  

### Maintainability assessment  
- High maintainability due to **clear separation of concerns**, **stateless mapper**, and **configuration‑driven schema**.  
- The main risk is **schema drift**: if the YAML definition and the Python node classes diverge, runtime errors will surface; automated validation of the configuration against the code base is advisable.  
- The reliance on a single graph database (Memgraph) simplifies the code path but creates a **single point of failure**; abstracting it behind `GraphDatabaseAdapter` mitigates future migration effort.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It features a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The system utilizes a range of technologies, including GraphDatabaseAdapter for persistence, LLMService for language model integration, and Wave agents for concurrent execution.

### Children
- [AstParser](./AstParser.md) -- The CodeKnowledgeGraphBuilder uses AST parsing to construct the graph, as hinted by the parent context of SemanticAnalysis and the mention of CodeKnowledgeGraphBuilder.buildGraph()

### Siblings
- [Pipeline](./Pipeline.md) -- PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification approach, with upper and lower ontology definitions in ontology-definitions.yaml
- [Insights](./Insights.md) -- InsightGenerator.generateInsights() uses a pattern-based approach to generate insights from knowledge entities
- [EntityValidator](./EntityValidator.md) -- EntityValidator.validateEntity() implements a validation strategy based on entity metadata and definitions
- [LLMFacade](./LLMFacade.md) -- LLMFacade.getLLMModel() retrieves the LLM model instance based on configuration and provider
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- WorkflowOrchestrator.runWorkflow() executes the workflow with the given input and parameters
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter.persistEntity() persists the entity to the graph database
- [MemgraphAdapter](./MemgraphAdapter.md) -- MemgraphAdapter.persistCodeEntity() persists the code entity to Memgraph


---

*Generated from 6 observations*

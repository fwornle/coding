# GraphBuilder

**Type:** Detail

The GraphBuilder enables the CodeGraphConstructor to provide a comprehensive and accurate representation of the code, which can be used for various analysis and visualization purposes.

## What It Is  

The **GraphBuilder** component lives inside the code‑graph subsystem that powers the knowledge‑graph generation for the project. Although the exact file location is not listed in the observations, we know that it is a child of **CodeGraphConstructor**, which itself resides in the same package as the *CodeGraphAgent* (`src/agents/code-graph-agent.ts`). GraphBuilder’s sole responsibility is to **create nodes and edges** that model the structure of a code base. These graph elements are then consumed by the `CodeGraphConstructor` to produce a complete, query‑able knowledge graph that downstream tools can analyse or visualise.

In practice, the flow works like this: an **AstParser** (a sibling component) parses source files with Tree‑sitter and hands the resulting abstract syntax tree (AST) to `CodeGraphConstructor`. The constructor delegates the low‑level graph‑building work to GraphBuilder, which materialises the AST‑derived concepts as graph primitives. The resulting graph captures classes, functions, imports, inheritance relationships, and any other code‑level connections that the system wishes to expose.

---

## Architecture and Design  

The architecture follows a **clear separation of concerns**. The AST parsing logic lives in the `AstParser` sibling, while the transformation from parsed AST nodes to a graph representation is split between two cooperating components:

* **CodeGraphConstructor** – orchestrates the overall construction process, owns the higher‑level workflow, and integrates the final graph with the rest of the system (e.g., the `CodeGraphAgent`).  
* **GraphBuilder** – encapsulates the primitive operations for graph creation: instantiating node objects, wiring edge objects, and maintaining internal collections.

This relationship is expressed through **composition**: *CodeGraphConstructor contains GraphBuilder*. The parent (`CodeGraphConstructor`) drives the process, and the child (`GraphBuilder`) provides the concrete implementation of “how” the graph is built. The design avoids a monolithic constructor that would need to understand both AST traversal and graph manipulation, thereby reducing coupling and making each component easier to test in isolation.

Although the name “GraphBuilder” hints at the classic *Builder* design pattern, the observations only describe its functional role (node/edge creation) and do not explicitly confirm a formal pattern implementation. Consequently, the safest description is that the system uses **component composition** to delegate responsibilities rather than a formally declared pattern.

---

## Implementation Details  

The implementation hinges on three key classes:

1. **CodeGraphConstructor** – receives a parsed AST (produced by the sibling `AstParser`) and coordinates the conversion into a knowledge graph. It holds an instance of **GraphBuilder** and calls its methods whenever a new graph element is required.  
2. **GraphBuilder** – provides methods such as `createNode(type, identifier, metadata)` and `createEdge(sourceNode, targetNode, relationshipType)`. These methods encapsulate the low‑level details of the underlying graph data structure (whether it is an adjacency list, a library‑provided graph object, or a custom model). By centralising node/edge creation, GraphBuilder ensures that all graph elements share a consistent schema and that any future changes to the graph representation need only be made in one place.  
3. **CodeGraphAgent** (`src/agents/code-graph-agent.ts`) – sits one level above the constructor, exposing the finished knowledge graph to the rest of the application (e.g., analysis pipelines, visualisers). While the observations do not detail its API, its placement in the hierarchy indicates that it likely consumes the output of `CodeGraphConstructor`.

The workflow can be summarised as:

* `AstParser` parses source files → produces an AST.  
* `CodeGraphConstructor` walks the AST, identifies entities (classes, functions, imports, etc.).  
* For each entity, `CodeGraphConstructor` calls `GraphBuilder.createNode`.  
* For each relationship (e.g., “calls”, “inherits”, “imports”), it calls `GraphBuilder.createEdge`.  
* Once the full traversal is complete, `CodeGraphConstructor` hands the assembled graph to `CodeGraphAgent`.

Because the observations mention “knowledge graph” rather than a simple tree, we can infer that the graph model supports **multiple edge types** and possibly **bidirectional navigation**, though the exact data structures are not disclosed.

---

## Integration Points  

GraphBuilder is tightly coupled to its parent, `CodeGraphConstructor`, and indirectly to the `AstParser` sibling via the AST it receives. The only explicit external dependency mentioned is the `CodeGraphAgent` located at `src/agents/code-graph-agent.ts`, which consumes the final graph. This suggests the following integration contracts:

* **Input contract** – GraphBuilder expects calls that supply semantic information about code entities (type, identifier, optional metadata). The caller (CodeGraphConstructor) must translate raw AST nodes into these parameters.  
* **Output contract** – GraphBuilder returns opaque node and edge objects that the constructor aggregates. The exact shape of these objects is defined within GraphBuilder and is not exposed elsewhere, preserving encapsulation.  
* **Downstream contract** – `CodeGraphAgent` likely provides an API such as `getGraph()`, `queryGraph(criteria)`, or similar, enabling other system parts (analysis modules, UI visualisers) to interact with the knowledge graph.

No other modules are referenced, so GraphBuilder’s surface area appears deliberately narrow, which aids both testing and future replacement if a different graph library is desired.

---

## Usage Guidelines  

1. **Always invoke GraphBuilder through CodeGraphConstructor** – Direct use of GraphBuilder bypasses the orchestration logic (AST traversal, entity classification) that the constructor provides. Keeping the call hierarchy intact ensures that the graph remains a faithful representation of the parsed code.  
2. **Supply complete metadata** – When calling `createNode` or `createEdge`, include any contextual information (e.g., source file path, line numbers, visibility modifiers). This enriches the knowledge graph and enables more powerful downstream queries.  
3. **Treat node/edge objects as immutable after creation** – Since GraphBuilder is the sole factory, mutating graph elements elsewhere can lead to inconsistencies. If updates are needed, create new nodes/edges via GraphBuilder rather than editing existing ones.  
4. **Limit GraphBuilder’s responsibilities** – Do not embed AST‑parsing logic inside GraphBuilder; keep it focused on graph manipulation. If new kinds of relationships arise (e.g., runtime dependencies), extend the constructor’s mapping logic, not the builder’s core API.  
5. **Unit‑test GraphBuilder in isolation** – Because it encapsulates the low‑level graph API, tests can verify that given a set of inputs it produces correctly linked nodes and edges, independent of the AST parsing layer.

Following these conventions preserves the clean separation between parsing, graph construction, and graph consumption, making the subsystem easier to evolve.

---

### Architectural Patterns Identified
* **Component composition** – `CodeGraphConstructor` *contains* `GraphBuilder`.
* **Separation of concerns** – parsing (AstParser), graph orchestration (CodeGraphConstructor), low‑level graph creation (GraphBuilder), and graph exposure (CodeGraphAgent) are distinct.

### Design Decisions and Trade‑offs
* **Delegating node/edge creation** to a dedicated builder reduces duplication and centralises schema changes, at the cost of an extra indirection layer.
* **Keeping GraphBuilder lightweight** (no AST logic) simplifies testing but requires the constructor to correctly translate AST details, placing more responsibility on that component.
* **Using a single GraphBuilder instance** promotes consistency but may become a bottleneck if the graph grows very large; however, the current observations do not indicate any concurrency model.

### System Structure Insights
* Hierarchy: `CodeGraphAgent` → `CodeGraphConstructor` → `GraphBuilder`.  
* Sibling relationship: `AstParser` works in parallel, feeding the AST to the constructor.  
* The knowledge graph is the central artefact produced, serving as the integration point for analysis and visualisation tools.

### Scalability Considerations
* Because GraphBuilder is responsible for every node and edge, its performance and memory footprint directly affect the size of the knowledge graph that can be handled. If the code base scales to millions of symbols, the underlying graph data structure (not described) must support efficient insertion and traversal.
* The clear separation allows future optimisation—e.g., swapping GraphBuilder’s internal storage for a more scalable graph database—without touching the AST parsing or higher‑level orchestration layers.

### Maintainability Assessment
* **High maintainability**: responsibilities are well‑encapsulated, and the composition model makes it straightforward to locate and modify the logic for node/edge creation.  
* **Potential risk**: the lack of explicit interfaces in the observations means that contracts are enforced by convention rather than type‑level guarantees; adding TypeScript interfaces could further improve robustness.  
* **Extensibility**: adding new relationship types or node attributes only requires changes in the mapping code inside `CodeGraphConstructor`, leaving `GraphBuilder` unchanged, which aligns with the open/closed principle.

Overall, the design captured in the observations reflects a modular, purpose‑driven approach that balances clarity with flexibility, laying a solid foundation for future growth of the GraphBuilder‑driven knowledge‑graph pipeline.


## Hierarchy Context

### Parent
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- CodeGraphConstructor utilizes the CodeGraphAgent (src/agents/code-graph-agent.ts) for constructing knowledge graphs.

### Siblings
- [AstParser](./AstParser.md) -- The CodeGraphConstructor class uses Tree-sitter AST parsing to construct the knowledge graph, as mentioned in the parent context.


---

*Generated from 3 observations*

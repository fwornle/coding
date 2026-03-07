# GraphQueryEngine

**Type:** Detail

The queryEngine function in query-engine.ts supports multiple query languages, including a custom domain-specific language (DSL) and standard SPARQL, to accommodate diverse user needs and preferences

## What It Is  

`GraphQueryEngine` lives in **`src/query-engine.ts`** and is the core component responsible for turning user‑supplied queries into efficient traversals over the code‑base knowledge graph.  The class implements a **query‑optimization technique** that reorders individual query operations so that the total number of graph traversals is minimized, directly improving execution latency.  It is also the gateway for **multiple query languages**: a custom domain‑specific language (DSL) designed for the product’s primary use‑cases, and the standard **SPARQL** syntax for users who prefer a widely‑known semantic‑web query model.  By integrating tightly with the **`KnowledgeGraphConstructor`** (see `knowledge-graph.ts`), the engine always works against the most recent, canonical representation of the code graph that is built by the parent component **`CodeKnowledgeGraph`**.

---

## Architecture and Design  

The architecture follows a **modular, layered design** where the query engine is a distinct service layer sitting atop the graph construction layer.  `GraphQueryEngine` depends on the **`KnowledgeGraphConstructor`** (its sibling) to obtain a ready‑to‑query graph instance; this relationship is an explicit **dependency injection** style coupling – the engine does not build the graph itself, preserving a single responsibility for each module.  

The support for multiple query languages suggests the use of a **Strategy pattern**: the `queryEngine` function (exported from `query-engine.ts`) likely selects a concrete parser/executor based on the incoming query’s type (DSL vs. SPARQL).  This design enables the engine to be extended with additional languages without touching the core optimization logic.  

The **query‑reordering optimizer** can be viewed as an implementation of the **Pipeline pattern**.  Incoming query clauses are first parsed, then passed through an optimization stage that rearranges operations (e.g., pushing selective filters early) before the final traversal plan is handed to the underlying graph API.  This separation keeps the optimizer isolated from language‑specific parsing and from the low‑level graph execution engine.

Because `GraphQueryEngine` is a child of **`CodeKnowledgeGraph`**, it inherits the lifecycle guarantees of the parent: the graph is (re)constructed via `KnowledgeGraphConstructor.constructGraph()` and kept up‑to‑date by the sibling **`EntityRelationshipUpdater`**, which applies delta‑based updates.  Consequently, the engine always queries a **consistent snapshot** of the graph, avoiding stale‑data bugs.

---

## Implementation Details  

The central class **`GraphQueryEngine`** is defined in `query-engine.ts`.  Its public entry point is the **`queryEngine`** function, which accepts a query string and a language identifier.  Internally the function performs three major steps:

1. **Parsing** – The DSL parser and the SPARQL parser are invoked based on the language flag.  Each parser produces an intermediate representation (IR) of the query, typically an abstract syntax tree (AST) that captures filters, projections, and graph pattern matches.  

2. **Optimization** – The IR is handed to the optimizer component embedded in `GraphQueryEngine`.  The optimizer analyses the graph statistics (node/edge counts, type cardinalities) provided by the `KnowledgeGraphConstructor` and **reorders operations** so that the most selective filters are evaluated first.  By reducing the intermediate result set early, the number of required graph traversals drops dramatically.  The optimizer does not rewrite the semantic meaning of the query; it only reshapes the execution plan.  

3. **Execution** – The reordered plan is translated into a series of calls against the underlying graph data structure (the code knowledge graph).  Because the graph is built from **`ClassEntity`**, **`MethodEntity`**, and **`FieldEntity`** node types (see `knowledge-graph.ts`), the execution engine can directly address these typed nodes, leveraging any indexes that the constructor may have created for fast look‑ups.

The class holds a reference to the **`KnowledgeGraphConstructor`** instance, enabling it to request the latest graph snapshot or to query metadata such as type distributions.  This tight coupling is intentional: the optimizer’s decisions depend on accurate graph statistics, and the engine must never operate on an out‑of‑date graph.

---

## Integration Points  

- **Parent – `CodeKnowledgeGraph`**: The engine is instantiated as part of the larger `CodeKnowledgeGraph` component.  `CodeKnowledgeGraph` orchestrates the lifecycle: it first calls `KnowledgeGraphConstructor.constructGraph()` to build the graph, then supplies the resulting graph object to `GraphQueryEngine`.  This ensures that every query sees the most recent code model.  

- **Sibling – `KnowledgeGraphConstructor` (`knowledge-graph.ts`)**: Provides the graph instance, node‑type definitions, and statistical metadata used by the optimizer.  The constructor also defines the initial set of node types (ClassEntity, MethodEntity, FieldEntity), which directly influence how queries can be expressed and optimized.  

- **Sibling – `EntityRelationshipUpdater` (`entity-updater.ts`)**: Performs delta‑based updates to the graph when the underlying code changes.  Because `GraphQueryEngine` always works against the graph reference supplied by the constructor, any updates applied by the updater are immediately visible to subsequent queries, preserving consistency without requiring a full graph rebuild.  

- **External – Query Consumers**: Clients (e.g., UI components, CLI tools, or other services) invoke the exported `queryEngine` function, passing a query string and a language identifier.  The function’s signature and language‑selection logic constitute the public API contract.

---

## Usage Guidelines  

1. **Prefer the DSL for internal tooling** – The custom DSL is tuned to the domain’s most common patterns and benefits from the optimizer’s heuristics.  When performance is critical, use the DSL rather than SPARQL unless interoperability with external semantic‑web tools is required.  

2. **Never mutate the graph directly** – All changes to the knowledge graph must go through `EntityRelationshipUpdater`.  Direct mutation would bypass the delta‑based update mechanism and could leave the optimizer’s statistics out of sync, leading to sub‑optimal plans or stale results.  

3. **Provide accurate language identifiers** – The `queryEngine` function selects the parser based on the supplied language flag.  Supplying an incorrect identifier will cause the wrong parser to run, potentially resulting in parsing errors or mis‑interpreted queries.  

4. **Leverage type‑specific filters** – Because the graph contains explicit node types (ClassEntity, MethodEntity, FieldEntity), queries that filter on these types early allow the optimizer to prune large portions of the graph quickly.  

5. **Monitor graph statistics** – If you add new node types or significantly alter the distribution of existing types, consider extending `KnowledgeGraphConstructor` to expose updated statistics so that the optimizer can continue to make informed reordering decisions.

---

### Summary of Requested Items  

1. **Architectural patterns identified**  
   * Modular layered architecture (query layer over graph construction layer)  
   * Strategy pattern for multi‑language support (DSL vs. SPARQL)  
   * Pipeline pattern for parsing → optimization → execution  
   * Dependency injection / inversion of control between `GraphQueryEngine` and `KnowledgeGraphConstructor`

2. **Design decisions and trade‑offs**  
   * **Separation of concerns** – keeping graph building, updating, and querying in distinct modules improves clarity but adds runtime coupling (engine must wait for a fresh graph).  
   * **Language flexibility** – supporting both a DSL and SPARQL broadens usability but requires maintaining two parsers and ensuring the optimizer works for both representations.  
   * **Query reordering optimizer** – gains performance at the cost of additional preprocessing overhead; the trade‑off is justified for complex queries over large code graphs.  
   * **Delta‑based updates** (via `EntityRelationshipUpdater`) reduce recomputation but demand that the optimizer’s statistics be refreshed after each delta.

3. **System structure insights**  
   * `CodeKnowledgeGraph` is the orchestrator; it constructs the graph, updates it, and exposes the query engine.  
   * `KnowledgeGraphConstructor` defines the graph schema and supplies statistical metadata.  
   * `EntityRelationshipUpdater` ensures the graph stays current with minimal recomputation.  
   * `GraphQueryEngine` sits at the top of this stack, providing a language‑agnostic, optimized query interface.

4. **Scalability considerations**  
   * The optimizer’s effectiveness grows with graph size because early selective filters dramatically cut traversal work.  
   * Supporting SPARQL opens the door to federated queries, but may require additional indexing or query planning extensions as the graph scales.  
   * Delta‑based updates help keep update latency low, allowing the system to handle frequent code changes without full rebuilds.  

5. **Maintainability assessment**  
   * Clear module boundaries (construction, updating, querying) simplify independent evolution.  
   * The strategy‑based language handling makes adding new query languages straightforward—just plug in a new parser/executor pair.  
   * The optimizer is centralized; any changes to its heuristics affect all query paths, which is beneficial for consistency but requires careful testing.  
   * Reliance on accurate graph statistics means that any change to the schema or data distribution must be reflected in `KnowledgeGraphConstructor` to avoid optimizer regression.


## Hierarchy Context

### Parent
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- KnowledgeGraphConstructor.constructGraph() constructs a knowledge graph from code entities and relationships

### Siblings
- [KnowledgeGraphConstructor](./KnowledgeGraphConstructor.md) -- GraphConstructor in knowledge-graph.ts initializes the graph with a set of predefined node types, including ClassEntity, MethodEntity, and FieldEntity, to support various code analysis tasks
- [EntityRelationshipUpdater](./EntityRelationshipUpdater.md) -- EntityRelationshipUpdater in entity-updater.ts employs a delta-based approach to update the graph, only modifying the affected nodes and relationships to minimize computational overhead and preserve graph integrity


---

*Generated from 3 observations*

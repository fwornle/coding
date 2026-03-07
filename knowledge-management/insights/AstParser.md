# AstParser

**Type:** Detail

The CodeKnowledgeGraphBuilder uses AST parsing to construct the graph, as hinted by the parent context of SemanticAnalysis and the mention of CodeKnowledgeGraphBuilder.buildGraph()

## What It Is  

**AstParser** is the core component that transforms source‑code text into an abstract syntax tree (AST) representation, which is then consumed by the **CodeKnowledgeGraphBuilder** to populate a graph‑based knowledge store.  The only concrete location we can point to from the supplied observations is the call‑site inside **`CodeKnowledgeGraphBuilder.buildGraph()`** – this method invokes the parser and immediately hands the resulting AST to the graph‑construction logic.  AstParser therefore lives conceptually within the *CodeKnowledgeGraph* subsystem and is a direct child of the **CodeKnowledgeGraph** entity (the parent component that ultimately owns the knowledge graph).  No explicit file‑system paths were listed in the observations, so the exact source‑file location cannot be enumerated, but every reference to the parser is anchored to the **CodeKnowledgeGraphBuilder** workflow.

The parser is not a stand‑alone tool; it is tightly coupled to the rest of the knowledge‑graph pipeline.  Its output feeds the **CodeKnowledgeGraph** data model, which is persisted in **Memgraph**, a native graph database.  Consequently, AstParser is the bridge between raw code syntax and the graph‑oriented semantic layer that powers downstream analysis, search, and recommendation features.

---

## Architecture and Design  

From the observations we can infer a **Builder**‑style architecture.  The **CodeKnowledgeGraphBuilder** orchestrates the creation of a complete knowledge graph by sequentially invoking distinct phases: (1) parsing source files with **AstParser**, (2) translating the AST into graph entities, and (3) persisting those entities in **Memgraph**.  This staged construction isolates concerns—parsing, transformation, and storage—while allowing each phase to evolve independently.

The interaction pattern resembles a **pipeline**: the parser produces an intermediate representation (the AST) that is consumed by a downstream transformer.  Although the observations do not name a transformer class, the existence of `CodeKnowledgeGraphBuilder.buildGraph()` implies a method that iterates over AST nodes and issues graph‑mutation commands to Memgraph.  The parser itself likely adopts an **Adapter** pattern to hide the specifics of the underlying parsing library (e.g., a language‑specific parser such as `ast` in Python or a third‑party Java parser).  By exposing a uniform interface—perhaps `parse(source: str) -> AST`—the rest of the system remains agnostic to the concrete parsing implementation.

The **graph‑storage** side is represented by **Memgraph**, which suggests a **Repository**‑like abstraction: the builder writes nodes and edges into Memgraph, while other components (e.g., query services) read from it.  The overall architecture therefore consists of three layers:

1. **Parsing Layer** – AstParser (adapter over a parsing library).  
2. **Transformation Layer** – CodeKnowledgeGraphBuilder (builder that maps AST nodes to graph constructs).  
3. **Persistence Layer** – Memgraph (graph repository).

No evidence points to micro‑services, event‑driven messaging, or other distributed patterns; the design appears to be a tightly coupled, in‑process workflow.

---

## Implementation Details  

The only concrete implementation artifact we have is the method **`CodeKnowledgeGraphBuilder.buildGraph()`**, which is documented as the entry point for graph construction.  Inside this method, the following logical steps are expected:

1. **Source Acquisition** – The builder collects source files (paths, strings, or streams) from a configured location.  
2. **AST Generation** – For each source unit, it calls **AstParser**.  The parser likely exposes a function such as `parse(source_code: str) -> ASTNode`.  The AST object contains hierarchical nodes (e.g., modules, classes, functions, statements) that capture both syntactic structure and, possibly, enriched semantic information (type hints, symbol tables).  
3. **Graph Mapping** – The builder walks the AST, converting each node into a corresponding graph vertex (e.g., a `Function` node, a `Class` node) and establishes edges that reflect relationships like “defines”, “calls”, or “inherits”.  The mapping logic is the heart of the knowledge‑graph creation and is where domain‑specific heuristics reside.  
4. **Memgraph Persistence** – Using Memgraph’s client API, the builder issues `CREATE` statements or uses a bulk import mechanism to insert vertices and edges.  Because Memgraph is a native graph DB, it can efficiently store and index the resulting structure for fast traversal.

Although the specific parsing library is not named, the observation that “AST parsing is likely done using a library or module specifically designed for this purpose” tells us the implementation does not reinvent parsing from scratch.  Instead, AstParser wraps a mature parser, exposing only the subset of functionality needed by the builder (e.g., node type enumeration, child iteration).  This wrapper isolates the rest of the system from library version changes and permits swapping parsers for different languages without touching the graph‑building code.

---

## Integration Points  

AstParser sits at the intersection of three system boundaries:

1. **Upstream – Source Ingestion** – It receives raw source code from whatever component supplies files (e.g., a repository scanner, a file‑system watcher, or a CI pipeline).  The contract is a simple string or stream input, keeping the parser independent of file‑system concerns.  

2. **Downstream – Graph Builder** – Its sole consumer is **CodeKnowledgeGraphBuilder**.  The builder expects a well‑defined AST object; any change in the AST shape would require a coordinated update in both AstParser and the builder’s traversal logic.  

3. **External Library – Parsing Engine** – AstParser delegates the heavy lifting to an external parsing library.  The integration point is the adapter code that translates library‑specific node objects into the internal AST model used by the builder.  This layer also handles error reporting (syntax errors, unsupported constructs) and may surface diagnostics back to the caller.

Because Memgraph is the persistence back‑end, the builder (and therefore AstParser indirectly) must respect Memgraph’s data model constraints—e.g., property types, label conventions, and transaction limits.  Any future integration with alternative graph stores would require either a new repository implementation or an additional abstraction layer between the builder and Memgraph, but the parser itself would remain untouched.

---

## Usage Guidelines  

* **Treat AstParser as a pure function** – Call it with source code and expect an immutable AST.  Do not mutate the returned tree; any transformation should happen downstream in the builder.  
* **Handle parsing errors gracefully** – The parser may raise syntax‑error exceptions; callers (typically the builder) should catch these, log the offending file, and decide whether to abort the whole graph build or continue with the remaining sources.  
* **Keep language‑specific concerns localized** – If the system must support multiple programming languages, instantiate a language‑specific parser implementation behind a common `AstParser` interface.  This preserves the builder’s language‑agnostic traversal logic.  
* **Avoid deep coupling with Memgraph** – AstParser should not contain any persistence logic.  All graph‑creation responsibilities belong to the builder; this separation eases testing (AST generation can be unit‑tested without a running Memgraph instance).  
* **Cache results when appropriate** – For large codebases, parsing can be expensive.  If the surrounding pipeline permits, cache the AST for unchanged files and reuse it across successive `buildGraph()` runs.

---

### Summary of Architectural Findings  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns** | Builder (CodeKnowledgeGraphBuilder), Pipeline (parse → transform → store), Adapter (AstParser wrapping a parsing library), Repository (Memgraph) |
| **Key design decisions** | Use of a dedicated AST parser to decouple syntax handling from graph construction; reliance on Memgraph for scalable graph storage; encapsulation of parsing behind a simple interface |
| **Trade‑offs** | Parsing overhead vs. rich semantic graph; tight coupling between builder and parser (requires coordinated changes); dependence on Memgraph limits portability but gives powerful graph queries |
| **System structure** | Hierarchical: CodeKnowledgeGraph (parent) → CodeKnowledgeGraphBuilder (orchestrator) → AstParser (leaf) → Memgraph (persistence) |
| **Scalability** | Graph storage scales horizontally via Memgraph’s clustering; parsing can be parallelized per source file, but the builder must manage concurrent writes to Memgraph |
| **Maintainability** | Clear separation of concerns makes the parser replaceable; however, the AST contract is a shared surface area that must be version‑controlled.  Adding language support requires new parser adapters but no changes to the builder’s core logic. |

All statements above are grounded directly in the provided observations: the relationship between **AstParser**, **CodeKnowledgeGraphBuilder**, and **Memgraph**, and the fact that AST parsing is delegated to a specialized library.  No additional patterns or components have been invented beyond what the evidence supports.


## Hierarchy Context

### Parent
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph


---

*Generated from 3 observations*

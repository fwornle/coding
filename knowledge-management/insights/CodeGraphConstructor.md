# CodeGraphConstructor

**Type:** SubComponent

MemgraphQueryExecutor executes Memgraph queries to retrieve the code graph data using the MemgraphQueryExecutor class in code-graph/query-executor.ts

## What It Is  

`CodeGraphConstructor` is the sub‑component responsible for turning raw source‑code artefacts into a structured **code graph** that can be stored and queried in Memgraph. The implementation lives entirely under the **`code-graph/`** directory:  

* **`code-graph/parser.ts`** – hosts the **`ASTParser`** class that walks the abstract syntax tree of a file.  
* **`code-graph/query-executor.ts`** – defines **`MemgraphQueryExecutor`**, the thin wrapper that issues Cypher‑style queries against a running Memgraph instance.  
* **`code-graph/builder.ts`** – contains **`CodeGraphBuilder`**, which assembles nodes and edges from the AST data together with any existing graph data fetched by the executor.  
* **`code-graph/validator.ts`** – implements **`CodeGraphValidator`**, a post‑construction sanity‑check that guarantees structural invariants before the graph is persisted.  

`CodeGraphConstructor` is a child of the larger **`SemanticAnalysis`** component, which orchestrates a DAG‑based execution model (topological sort) for the whole analysis pipeline. Within its own scope, `CodeGraphConstructor` further contains the **`AstParserUtil`** helper, exposing low‑level parsing utilities to the rest of the sub‑component.

---

## Architecture and Design  

The observed code reveals a **pipeline‑oriented architecture** that proceeds through four well‑defined stages: **Parse → Query → Build → Validate**. Each stage is encapsulated in its own class, promoting **separation of concerns** and making the flow easy to reason about.  

* **Parsing Layer** – `ASTParser` (in `parser.ts`) isolates the syntactic analysis of source files. By delegating the AST walk to a dedicated class, the system can swap the underlying parser (e.g., TypeScript, JavaScript, Python) without touching downstream logic.  
* **Data‑Access Layer** – `MemgraphQueryExecutor` (in `query-executor.ts`) abstracts the details of communicating with the Memgraph database. It presents a simple method interface (e.g., `executeQuery`, `fetchSubgraph`) that higher layers treat as a black box. This is effectively a **Gateway/Adapter** pattern for the graph store.  
* **Construction Layer** – `CodeGraphBuilder` (in `builder.ts`) follows a **Builder**‑style approach: it incrementally creates graph entities (nodes, edges) based on parsed AST fragments and any supplemental data returned by the query executor. The builder maintains internal collections and emits a completed graph object once all inputs are processed.  
* **Validation Layer** – `CodeGraphValidator` (in `validator.ts`) implements a **Validator** pattern, enforcing domain‑specific invariants such as unique identifiers, proper edge directionality, and required node properties.  

The component is orchestrated by its parent, **`SemanticAnalysis`**, which schedules `CodeGraphConstructor` as one node in a broader DAG of agents. This aligns the sub‑component with sibling agents like **`Pipeline`**, **`Ontology`**, **`Insights`**, and **`LLMServiceManager`**, all of which also follow a “single‑responsibility, plug‑in” style and are triggered in topologically sorted order.

---

## Implementation Details  

### 1. AST Parsing (`code-graph/parser.ts`)  
`ASTParser` exposes a method such as `parseFile(filePath: string): ParsedAST`. Internally it leverages the language‑specific parser (e.g., `@babel/parser` for JavaScript) to generate an abstract syntax tree. The class normalises the tree into a **canonical representation** (e.g., `ParsedASTNode` objects) that downstream components can consume without caring about language nuances.  

### 2. Graph Query Execution (`code-graph/query-executor.ts`)  
`MemgraphQueryExecutor` wraps the native Memgraph client. Typical public APIs include:  

* `runQuery(cypher: string, params?: object): Promise<QueryResult>` – sends a Cypher statement and returns raw rows.  
* `fetchExistingGraph(fragmentIds: string[]): Promise<GraphFragment>` – pulls any pre‑existing nodes/edges that may be needed for incremental updates.  

The executor handles connection pooling, error translation, and retry logic, keeping the rest of the pipeline free from database plumbing.  

### 3. Graph Building (`code-graph/builder.ts`)  
`CodeGraphBuilder` receives two inputs: a `ParsedAST` from the parser and optional `GraphFragment` data from the executor. Its core routine iterates over the AST nodes, mapping each to a **graph node** (e.g., functions become `FunctionNode`, classes become `ClassNode`). Edges are derived from syntactic relationships (calls, inheritance, imports). The builder maintains internal maps (`nodeId → Node`, `edgeId → Edge`) to deduplicate entities and to resolve cross‑references. Once the iteration completes, `builder.build(): CodeGraph` returns an immutable graph object ready for validation.  

### 4. Validation (`code-graph/validator.ts`)  
`CodeGraphValidator` runs a series of checks:  

* **Structural integrity** – every edge must reference existing node IDs.  
* **Uniqueness constraints** – no duplicate function signatures within the same module.  
* **Domain rules** – e.g., a `ClassNode` must have at most one `extends` edge.  

If any rule fails, the validator throws a typed `CodeGraphValidationError`, which propagates up to the parent `SemanticAnalysis` DAG, causing the current run to be aborted or retried based on the overarching error‑handling policy.  

### 5. Supporting Utility (`AstParserUtil`)  
`AstParserUtil` supplies helper functions such as `extractIdentifiers(astNode)`, `normalizePath(filePath)`, and reusable type guards. These utilities are consumed by both `ASTParser` and `CodeGraphBuilder`, reducing code duplication and ensuring consistent handling of language constructs across the sub‑component.

---

## Integration Points  

`CodeGraphConstructor` sits at the intersection of **source‑code ingestion** and **graph persistence**. Its primary external dependencies are:  

* **Parent – `SemanticAnalysis`**: The DAG scheduler invokes `CodeGraphConstructor` as a discrete step, passing in a list of source files derived from the git history or LSL session. The parent also collects the final `CodeGraph` and forwards it to downstream agents such as **`KnowledgeGraph`** or **`Insights`** for further processing.  
* **Sibling – `Pipeline` & `Ontology`**: While `Pipeline` defines the overall execution order, `Ontology` may provide schema definitions (node/edge types) that `CodeGraphBuilder` respects when constructing the graph. The validator can reference ontology constraints to guarantee compliance.  
* **Child – `AstParserUtil`**: Directly used by `ASTParser` and `CodeGraphBuilder` for low‑level AST manipulation.  
* **External Service – Memgraph**: Communicated through `MemgraphQueryExecutor`. The executor abstracts the network protocol, allowing the rest of the system to remain agnostic of the graph database’s specifics.  

The component also emits a **well‑typed `CodeGraph`** object that conforms to the contract expected by the **`KnowledgeGraph`** sibling, which aggregates multiple sub‑graphs into a unified knowledge base.  

---

## Usage Guidelines  

1. **Invoke Through the DAG** – Developers should never call `ASTParser` or `CodeGraphBuilder` directly. Instead, schedule `CodeGraphConstructor` as a node in the `SemanticAnalysis` DAG to guarantee that prerequisite steps (e.g., source checkout, configuration loading) have completed.  
2. **Provide Complete File Lists** – The constructor expects a deterministic list of absolute file paths. Use the `AstParserUtil.normalizePath` helper to ensure consistency across operating systems.  
3. **Handle Validation Errors Gracefully** – `CodeGraphValidator` throws `CodeGraphValidationError`. Catch this at the DAG level to either retry with a cleaned input set or log detailed diagnostics for developers.  
4. **Do Not Bypass the Query Executor** – Even if the graph is being built from scratch, `MemgraphQueryExecutor` should still be invoked (with a no‑op query) so that connection pooling and logging remain consistent.  
5. **Extend with New Languages via `ASTParser`** – To support additional programming languages, implement a new parser class that conforms to the `ASTParser` interface and register it in `AstParserUtil`. The rest of the pipeline will automatically pick up the new parser without changes to the builder or validator.  

---

### Architectural patterns identified  
* **Pipeline / Staged Processing** – Parse → Query → Build → Validate.  
* **Builder Pattern** – `CodeGraphBuilder` incrementally constructs the graph object.  
* **Gateway/Adapter** – `MemgraphQueryExecutor` abstracts the Memgraph client.  
* **Validator Pattern** – `CodeGraphValidator` enforces domain invariants.  
* **Separation of Concerns** – each class owns a single responsibility (parsing, querying, building, validating).  

### Design decisions and trade‑offs  
* **Explicit stage separation** improves testability and allows independent scaling of each phase, but introduces extra data‑transfer objects (AST, query results) that may increase memory usage for very large codebases.  
* **Using a dedicated query executor** decouples the graph store technology; however, it adds an additional abstraction layer that could hide performance‑critical details (e.g., batch query optimisation).  
* **Validator placed after building** ensures the graph is complete before checks, simplifying rule definitions; the downside is that errors are discovered later in the pipeline, potentially requiring a full rebuild to fix a single structural issue.  

### System structure insights  
`CodeGraphConstructor` is a leaf sub‑component in the `SemanticAnalysis` hierarchy, yet it bridges the static analysis world (AST) with the dynamic graph store (Memgraph). Its child utility (`AstParserUtil`) supplies reusable parsing helpers, while its parent DAG orchestrator guarantees deterministic execution order alongside siblings that handle pipeline orchestration, ontology management, insight generation, and LLM service provisioning.  

### Scalability considerations  
* **Horizontal scaling** can be achieved by parallelising the parsing stage across files, as `ASTParser` instances are stateless.  
* **Memgraph query load** may become a bottleneck; the `MemgraphQueryExecutor` could be extended with batching or connection‑pool tuning to handle high‑throughput scenarios.  
* **Builder memory footprint** grows with the size of the codebase; streaming or incremental graph construction could be introduced if the current in‑memory approach proves limiting.  

### Maintainability assessment  
The clear separation into four focused classes, each with a narrowly defined public API, yields high maintainability. Adding support for a new language or a new graph schema requires changes only in `ASTParser` or `CodeGraphValidator`, leaving the rest of the pipeline untouched. The reliance on explicit file paths and the deterministic DAG execution model further reduces hidden coupling. The main maintenance risk lies in the tight coupling between the builder’s node‑type expectations and the ontology definitions maintained by the sibling `Ontology` component; any schema drift must be synchronised manually or via shared type definitions.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component's utilization of a DAG-based execution model with topological sort allows for efficient processing of git history and LSL sessions. This is evident in the OntologyClassificationAgent, which leverages the OntologyConfigManager, OntologyManager, and OntologyValidator classes to classify observations against the ontology system, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file. The topological sort ensures that the agents are executed in a specific order, preventing any potential circular dependencies or inconsistencies in the knowledge entities extraction process.

### Children
- [AstParserUtil](./AstParserUtil.md) -- The CodeGraphConstructor sub-component relies on the ASTParser class in code-graph/parser.ts to parse the abstract syntax tree of the code.

### Siblings
- [Pipeline](./Pipeline.md) -- PipelineAgent uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- OntologyConfigManager loads the ontology configuration from the ontology-config.yaml file in the integrations/mcp-server-semantic-analysis/src/config directory
- [Insights](./Insights.md) -- InsightGenerator generates insights from the processed observations using the InsightGenerator class in insights/generator.ts
- [SemanticInsightGenerator](./SemanticInsightGenerator.md) -- SemanticInsightGenerator uses the NLPProcessor class in semantic-insight-generator/nlp-processor.ts to process the natural language text
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses the LLMServiceFactory class in llm-service-manager/factory.ts to create LLM services
- [KnowledgeGraph](./KnowledgeGraph.md) -- KnowledgeGraph uses the GraphDatabase class in knowledge-graph/database.ts to store the knowledge entities and their relationships
- [OntologyRepository](./OntologyRepository.md) -- OntologyRepository uses the OntologyDatabase class in ontology-repository/database.ts to store the ontology definitions and their relationships


---

*Generated from 4 observations*

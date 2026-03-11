# Idioms

**Type:** SubComponent

The GraphDatabaseAdapter in storage/graph-database-adapter.ts facilitates the storage and retrieval of idioms, allowing for efficient data management and querying.

## What It Is  

**Idioms** is a sub‑component that lives inside the **CodingPatterns** domain.  All of its concrete artefacts are anchored in the same code base that powers the broader semantic‑analysis pipeline.  The core entry points for idiom handling are found in the **mcp‑server‑semantic‑analysis** module:

* **Workflow creation** – `mcp-server-semantic-analysis/src/workflows/createWorkflow.ts` contains the `createWorkflow` function that builds and registers the processing pipelines used for idiom extraction, evaluation and enrichment.  
* **Graph persistence** – `mcp-server-semantic-analysis/storage/graph-database-adapter.ts` implements the `GraphDatabaseAdapter` class together with the `queryDatabase` helper, which together store idiom definitions as graph nodes and retrieve them on demand.  
* **Configuration** – The directory `mcp-server-semantic-analysis/src/config/workflows` holds JSON/YAML‑style workflow configuration files that describe which idiom‑specific steps are enabled for a given analysis run.  
* **Semantic analysis** – `mcp-server-semantic-analysis/src/config/semantic-analysis.ts` wires the workflow definitions into the analysis engine, exposing metrics that indicate how often particular idioms appear and how effective they are in real code.

In short, **Idioms** is the collection of reusable linguistic or syntactic “patterns” that the system discovers, stores, and re‑applies during code‑base semantic analysis.  It leverages the same workflow infrastructure that the sibling sub‑components (DesignPatterns, BestPractices, CodingConventions, AntiPatterns) use, but its data model and query surface are specialised for idiom‑level granularity.

---

## Architecture and Design  

The observations reveal a **modular, workflow‑driven architecture**.  The central design revolves around a **pipeline factory** (`createWorkflow`) that assembles a series of processing stages defined in configuration files under `src/config/workflows`.  Each stage is a pluggable module, allowing the system to add or remove idiom‑specific logic without touching the core engine.  This mirrors the **Pipeline** (or “Chain of Responsibility”) pattern: data flows through a deterministic series of handlers, each responsible for a narrow concern (e.g., tokenisation, idiom detection, scoring).

Persistence is handled by the **GraphDatabaseAdapter**, which abstracts the underlying graph store (likely Neo4j or a similar property‑graph DB).  The adapter follows the **Repository** pattern: it provides a clean API (`queryDatabase`, plus implied CRUD methods) that shields the rest of the code from query language specifics.  Storing idioms as graph entities enables natural relationship modelling (e.g., “idiom‑A is a specialization of idiom‑B”) and fast traversals when the analysis engine needs to resolve hierarchy or similarity.

Interaction between components is **explicitly decoupled** through interfaces: workflow configuration files reference adapters by name, and the semantic‑analysis module imports the adapter as a dependency.  This design promotes **low coupling / high cohesion**—the workflow manager knows nothing about how the graph is queried, and the graph adapter knows nothing about the shape of a workflow.

Because the same `createWorkflow` function is cited by all sibling components (DesignPatterns, BestPractices, etc.), the architecture enforces **reusability** across the entire CodingPatterns family.  Each sibling simply supplies its own configuration payload, re‑using the shared workflow engine and persistence layer.

---

## Implementation Details  

### Workflow Construction (`createWorkflow.ts`)  
The `createWorkflow` function receives a workflow definition (likely a JSON object) and iterates over the declared stages.  For each stage it resolves a handler module (e.g., an idiom detector) and composes them into an executable pipeline object.  The function probably returns an object exposing a `run(input)` method that streams code artefacts through each handler, accumulating results in a context object.

### Graph Persistence (`graph-database-adapter.ts`)  
`GraphDatabaseAdapter` encapsulates the driver for the underlying graph DB.  Its public surface includes:

* **`queryDatabase(query: string, params?: object)`** – a thin wrapper that executes a parameterised Cypher (or similar) query and returns a promise of results.  This method is used by the idiom‑lookup logic to fetch definitions, relationships, and usage statistics.  
* Implicit CRUD helpers (not explicitly mentioned but logically present) for inserting new idiom nodes, updating scores, and deleting obsolete entries.

The adapter likely implements connection pooling and error handling internally, ensuring that high‑frequency queries from the analysis engine do not overwhelm the database.

### Configuration (`src/config/workflows/*`)  
Each workflow file declares a list of stages, their ordering, and any stage‑specific parameters (e.g., confidence thresholds for idiom detection).  Because the same directory is referenced by the parent component **CodingPatterns**, the configuration schema is shared across siblings, guaranteeing a consistent execution model.

### Semantic Analysis Integration (`semantic-analysis.ts`)  
The `semantic-analysis.ts` module imports the workflow factory and the graph adapter, then builds a concrete workflow for idiom analysis.  It orchestrates the flow: source code → workflow → graph look‑ups → aggregated metrics.  The module also exposes the final insight payload (e.g., “Idioms used: 42, top idiom: ‘callback hell’ with effectiveness 0.78”), which downstream consumers (report generators, IDE plugins) can consume.

---

## Integration Points  

1. **Parent – CodingPatterns**  
   The parent component invokes the idiom workflow via the same `createWorkflow` mechanism used for other pattern families.  It also relies on the `GraphDatabaseAdapter` to store and retrieve *all* pattern‑type entities, so idioms share the same persistence namespace as design patterns, best practices, etc.

2. **Sibling Components**  
   DesignPatterns, BestPractices, CodingConventions, AntiPatterns, and WorkflowManager each reference `createWorkflow` and the graph adapter.  The only variation is the workflow configuration file they point to, meaning any improvement to the workflow engine (e.g., adding a new error‑handling stage) automatically benefits all siblings.

3. **External Consumers**  
   While not directly observed, the semantic‑analysis module likely exposes an HTTP or RPC endpoint (typical for an MCP server) that returns idiom insights.  Consumers such as documentation generators or developer tooling can query these endpoints to surface idiom usage statistics.

4. **Database Layer**  
   The `GraphDatabaseAdapter` is the sole bridge to the persistent store.  All other components interact with idiom data exclusively through this adapter, ensuring a single source of truth and simplifying future migrations (e.g., swapping Neo4j for an alternative graph DB).

---

## Usage Guidelines  

* **Define workflows declaratively** – When adding a new idiom detection step, create a configuration entry in `src/config/workflows` rather than modifying `createWorkflow`.  This keeps the pipeline assembly logic untouched and preserves compatibility with sibling components.  
* **Leverage the adapter for all data access** – Direct queries against the graph DB should never be embedded in workflow handlers.  Use `GraphDatabaseAdapter.queryDatabase` (or higher‑level repository methods) to fetch idiom definitions, relationships, or usage metrics.  This guarantees consistent error handling and connection management.  
* **Respect the graph schema** – Idiom nodes are expected to carry at least a unique identifier, a textual representation, and metadata such as “effectiveness”.  Adding new properties should follow the existing schema conventions to avoid breaking downstream analytics.  
* **Monitor performance** – Because idiom look‑ups can be frequent during large‑scale analysis runs, consider caching frequently accessed idiom definitions at the workflow level.  The adapter’s internal connection pooling helps, but application‑level caching reduces round‑trips.  
* **Version workflow configurations** – Since siblings share the same engine, any change to a workflow file can affect multiple pattern families.  Store configurations under version control and, when possible, tag releases that introduce breaking changes.

---

### Architectural patterns identified  

* **Pipeline / Chain of Responsibility** – assembled by `createWorkflow`.  
* **Repository (GraphDatabaseAdapter)** – abstracts persistence operations.  
* **Configuration‑driven composition** – workflow definitions live in `src/config/workflows`.  

### Design decisions and trade‑offs  

* **Centralised workflow factory** – promotes reuse across many pattern families but creates a single point of failure; a bug in `createWorkflow` propagates to all siblings.  
* **Graph storage for idioms** – enables rich relationship queries (e.g., “idiom hierarchy”) at the cost of requiring a graph DB and its operational overhead.  
* **Declarative configuration** – maximises flexibility; however, overly complex config files can become hard to read and validate without schema enforcement.  

### System structure insights  

The system is layered:  
1. **Configuration layer** (`src/config/*`) describes *what* should run.  
2. **Workflow engine** (`createWorkflow`) builds the *how* at runtime.  
3. **Persistence layer** (`GraphDatabaseAdapter`) supplies the *data* needed by the workflow.  
4. **Semantic analysis orchestrator** (`semantic-analysis.ts`) ties the layers together and produces consumable insights.  

All siblings sit on the same three‑tier stack, sharing code and storage but diverging only in their configuration payloads.

### Scalability considerations  

* **Horizontal scaling of the analysis service** is straightforward because the workflow engine is stateless; multiple instances can process different codebases in parallel.  
* **Graph DB scaling** must be addressed explicitly – large numbers of idiom nodes or high query concurrency may require sharding or read‑replica setups.  
* **Caching** idiom look‑ups at the workflow level can dramatically reduce database load during batch analyses.  

### Maintainability assessment  

The design’s heavy reliance on configuration and a single adapter class yields **high maintainability**: new idioms or analysis steps are added by editing JSON/YAML files, not by touching core logic.  The clear separation between workflow construction and data access simplifies unit testing (mock the adapter, feed a stubbed workflow config).  The main risk is **configuration drift** across siblings; a shared schema validator and automated tests for each workflow file would mitigate this.  Overall, the architecture balances reuse with clear boundaries, making future evolution manageable.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component utilizes the mcp-server-semantic-analysis module for semantic analysis and insight generation. This is evident in the mcp-server-semantic-analysis/src/config/workflows directory, where workflow configurations are defined. For instance, the createWorkflow function in workflows/createWorkflow.ts demonstrates how workflows are created and managed. Furthermore, the use of the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for graph database interactions facilitates the storage and retrieval of coding patterns and conventions. This modular design allows for efficient data management and querying, as seen in the queryDatabase function in storage/graph-database-adapter.ts.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- The createWorkflow function in workflows/createWorkflow.ts demonstrates how workflows are created and managed, which is essential for design pattern implementation.
- [BestPractices](./BestPractices.md) -- The createWorkflow function in workflows/createWorkflow.ts demonstrates how workflows are created and managed, which is essential for best practice implementation.
- [CodingConventions](./CodingConventions.md) -- The createWorkflow function in workflows/createWorkflow.ts demonstrates how workflows are created and managed, which is essential for coding convention implementation.
- [AntiPatterns](./AntiPatterns.md) -- The createWorkflow function in workflows/createWorkflow.ts demonstrates how workflows are created and managed, which is essential for anti-pattern identification.
- [WorkflowManager](./WorkflowManager.md) -- The createWorkflow function in workflows/createWorkflow.ts demonstrates how workflows are created and managed.


---

*Generated from 5 observations*

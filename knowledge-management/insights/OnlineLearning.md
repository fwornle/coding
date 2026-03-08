# OnlineLearning

**Type:** SubComponent

The CodeKnowledgeGraphConstructor class provides a key interface for OnlineLearning to construct the code knowledge graph

## What It Is  

OnlineLearning is the **sub‑component** that drives automatic knowledge extraction for the broader *KnowledgeManagement* domain. Its implementation lives inside the **batch‑analysis pipeline** – the same pipeline that powers the sibling components *CodeKnowledgeGraphConstructor* and *TraceReportGenerator*. The concrete orchestration is described in the **`batch-analysis.yaml`** file, where OnlineLearning declares its own steps and the explicit `depends_on` edges that tie those steps together. The core runtime logic is provided by the **`CodeKnowledgeGraphConstructor`** class, which performs an AST‑based analysis of source code, and by the **`TraceReportGenerator`**, which produces detailed trace reports of workflow runs and data‑flow provenance. In short, OnlineLearning is the glue that pulls raw artefacts (git history, LSL session logs, static code) into a structured knowledge graph that the parent *KnowledgeManagement* component can persist via the shared *GraphDatabaseAdapter*.

## Architecture and Design  

The architecture that emerges from the observations is a **pipeline‑oriented, DAG‑driven batch processing system**. The `batch-analysis.yaml` file defines a series of steps, each annotated with `depends_on` edges; this explicit dependency graph is then materialised at runtime through a **topological sort** (Observation 5). The resulting execution order guarantees that upstream artefacts—such as the raw git history or LSL session dumps—are fully processed before downstream consumers, like the code‑knowledge graph constructor, begin their work.  

The design follows a **pipeline pattern** (a linear series of transformation stages) combined with a **directed‑acyclic‑graph (DAG) execution model**. The DAG approach gives OnlineLearning fine‑grained control over parallelism: independent steps can be scheduled concurrently, while dependent steps wait for their prerequisites. This is evident from the explicit `depends_on` edges declared in `batch-analysis.yaml` (Observation 4).  

Interaction between components is **interface‑driven**. OnlineLearning does not embed persistence logic; instead, it relies on the sibling *CodeKnowledgeGraphConstructor* and *TraceReportGenerator* to produce artefacts that are later handed off to the *GraphDatabaseAdapter* (used by all siblings, including *ManualLearning*, *PersistenceManager*, and *OntologyClassifier*). This shared adapter provides a **type‑safe façade** over the underlying Graphology+LevelDB store, keeping the batch pipeline agnostic to storage details.

## Implementation Details  

1. **Batch‑analysis.yaml** – This YAML manifest is the entry point for OnlineLearning’s execution. Each step is a declarative block that names a command (e.g., “run‑code‑kg‑constructor”) and lists its `depends_on` relationships. The pipeline engine reads the file, builds the dependency graph, and performs a topological sort to produce a deterministic run order.  

2. **CodeKnowledgeGraphConstructor** – The class is the primary engine for constructing the *code knowledge graph*. It walks the source tree, parses each file into an **Abstract Syntax Tree (AST)**, and extracts entities such as functions, classes, imports, and type annotations. These entities become nodes in the graph, while relationships (calls, inheritance, module imports) become edges. Because the class is shared with the sibling component of the same name, OnlineLearning re‑uses its public API to trigger the construction phase.  

3. **TraceReportGenerator** – After the code graph is built, this component traverses the execution traces of workflow runs (including data‑flow information) and emits a *trace report*. The report is a structured document that links runtime artefacts back to the static graph nodes, enabling provenance queries downstream.  

4. **Integration with KnowledgeManagement** – The parent component *KnowledgeManagement* persists the final graph using the **`GraphDatabaseAdapter`** (implemented in `graph-database-adapter.ts`). OnlineLearning does not call the adapter directly; instead, the output artefacts (graph files, trace reports) are handed off to the *PersistenceAgent* (via the *PersistenceManager* sibling) which invokes the adapter. This separation keeps the batch pipeline pure and testable.  

5. **Automatic Knowledge Extraction** – OnlineLearning’s responsibility “to handle automatic knowledge extraction from various sources” (Observation 7) is realized by orchestrating three data‑feeds:  
   - **Git history** – parsed for commit metadata, file‑change diffs, and author information.  
   - **LSL sessions** – logged learning sessions that provide contextual tags and user actions.  
   - **Static code analysis** – performed by the AST engine in `CodeKnowledgeGraphConstructor`.  

   Each feed is ingested in a dedicated step of the DAG, ensuring that failures in one source do not corrupt the others.

## Integration Points  

- **Parent – KnowledgeManagement**: OnlineLearning supplies the *code knowledge graph* and *trace reports* that become part of the central graph stored by KnowledgeManagement. The parent component’s persistence layer (`GraphDatabaseAdapter`) is the ultimate sink for these artefacts.  

- **Siblings – CodeKnowledgeGraphConstructor & TraceReportGenerator**: OnlineLearning directly invokes the public interfaces of these siblings. Because they share the same batch pipeline, they also share configuration (e.g., the same `batch-analysis.yaml` file) and runtime environment (Node.js/TypeScript).  

- **Siblings – ManualLearning, PersistenceManager, OntologyClassifier**: While not directly called by OnlineLearning, these components consume the same persisted graph via the *GraphDatabaseAdapter*. This common data‑store ensures that knowledge extracted automatically is immediately available to manual curation, ontology classification, and persistence services.  

- **External Data Sources**: Git repositories and LSL session logs are external inputs. The pipeline expects them to be staged in predefined directories (the exact paths are defined elsewhere in the repository but are referenced implicitly by the batch steps).  

- **Configuration**: All dependencies are declared in `batch-analysis.yaml`. No hard‑coded file paths appear in the source observations, so the pipeline remains flexible; changing a data source or adding a new analysis step only requires editing the YAML manifest.

## Usage Guidelines  

1. **Declare Dependencies Explicitly** – When extending OnlineLearning with a new analysis step (e.g., a new static‑analysis tool), add a corresponding entry in `batch-analysis.yaml` and list any required `depends_on` edges. This preserves the DAG’s topological integrity and enables the pipeline engine to schedule the step correctly.  

2. **Keep Graph Construction Pure** – The `CodeKnowledgeGraphConstructor` should remain a pure function of its inputs (source files). Avoid embedding persistence calls or side‑effects; let the downstream *PersistenceManager* handle storage. This separation simplifies unit testing and allows the constructor to be reused in other contexts (e.g., interactive tooling).  

3. **Leverage the Shared GraphDatabaseAdapter** – Any component that needs to read or write the knowledge graph must go through the adapter. This guarantees type safety and ensures that lock‑free semantics (as described in the parent component) are preserved across the system.  

4. **Monitor DAG Execution** – Because the pipeline uses a topological sort, a cycle in the `depends_on` graph will cause a runtime failure. Validate the YAML file with a linting step before committing changes.  

5. **Version Control of Input Artefacts** – Since OnlineLearning extracts knowledge from git history, ensure that the repository being analysed is at a stable commit (e.g., a tagged release). This prevents nondeterministic graph generation caused by in‑flight changes.  

---

### Architectural Patterns Identified  

1. **Pipeline / Batch‑Processing Pattern** – A series of declarative steps orchestrated via `batch-analysis.yaml`.  
2. **Directed‑Acyclic‑Graph (DAG) Execution Model** – Explicit `depends_on` edges and topological sort guarantee correct ordering and enable parallelism.  
3. **Adapter / Façade Pattern** – `GraphDatabaseAdapter` provides a uniform, type‑safe interface to the underlying Graphology+LevelDB store.  

### Design Decisions and Trade‑offs  

- **Explicit Dependency Declaration** – Improves readability and predictability but requires careful maintenance of the YAML manifest.  
- **Separation of Concerns (Construction vs. Persistence)** – Enhances testability and modularity; however, it introduces an extra hand‑off step (via *PersistenceManager*).  
- **AST‑Based Static Analysis** – Provides rich, fine‑grained graph data but incurs a processing cost proportional to code‑base size; the DAG permits parallelisation to mitigate this.  

### System Structure Insights  

OnlineLearning sits at the intersection of *source‑code ingestion* and *knowledge‑graph population*. It is a leaf in the *KnowledgeManagement* hierarchy, yet it shares the same **graph‑database‑adapter** dependency as its siblings, forming a tightly‑coupled knowledge‑extraction ecosystem. The batch pipeline acts as the backbone that synchronises all sibling activities.  

### Scalability Considerations  

- **Parallel Execution**: Independent DAG branches can run concurrently, allowing the system to scale with additional CPU cores or distributed workers.  
- **Incremental Updates**: The current observations do not mention incremental graph building; a full re‑run of the batch pipeline may be required after each change, which could become a bottleneck for very large repositories. Introducing incremental diff processing would improve scalability.  
- **Storage Layer**: The lock‑free Graphology+LevelDB backend (as described for the parent) is designed for high‑throughput writes, supporting the volume of nodes/edges generated by large code bases.  

### Maintainability Assessment  

The use of a **declarative YAML pipeline** and **well‑named classes** (`CodeKnowledgeGraphConstructor`, `TraceReportGenerator`) makes the codebase approachable for new contributors. The clear separation between analysis (OnlineLearning) and persistence (GraphDatabaseAdapter) reduces coupling, aiding refactoring. The main maintenance risk lies in the **YAML dependency graph**: accidental cycles or missing edges can break the entire batch run. Regular validation and automated tests that assert DAG correctness are advisable to keep the system maintainable over time.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [PersistenceManager](./PersistenceManager.md) -- PersistenceManager uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseAdapter class in the graph-database-adapter.ts file to provide a type-safe interface for agents to interact with the central knowledge graph
- [CodeKnowledgeGraphConstructor](./CodeKnowledgeGraphConstructor.md) -- CodeKnowledgeGraphConstructor uses the batch analysis pipeline to construct the code knowledge graph
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the batch analysis pipeline to generate detailed trace reports of workflow runs and data flow
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology+LevelDB database for persistence


---

*Generated from 7 observations*

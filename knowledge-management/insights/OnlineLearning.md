# OnlineLearning

**Type:** SubComponent

OnlineLearning's 'extractedKnowledgeValidator' function in online-learning.ts ensures extracted knowledge adheres to the project's ontology

## What It Is  

**OnlineLearning** is a sub‑component of the **KnowledgeManagement** domain that automatically extracts, validates, and persists knowledge gathered from a developer’s workflow. The core implementation lives in `online-learning.ts`, where a set of focused analyzers (`gitHistoryAnalyzer`, `lslSessionAnalyzer`, `codeAnalyzer`) feed extracted facts into the **GraphDatabaseManager** (`storage/graph-database-manager.ts`). The orchestrator function `onlineLearningPipeline` strings these steps together, ending with a call to `extractKnowledge` that writes the validated knowledge into the graph store. A dedicated `extractedKnowledgeValidator` guarantees that every piece of newly‑created knowledge conforms to the project‑wide ontology before it is persisted.

## Architecture and Design  

The observable design follows a **pipeline / orchestration** pattern. Individual analysis functions act as independent stages that each produce a slice of knowledge. `onlineLearningPipeline` composes these stages in a deterministic order, allowing the system to be extended with additional analyzers without touching the orchestration logic. This modularity mirrors the sibling components (e.g., **ManualLearning**, **KnowledgeGraphAnalyzer**) that also rely on the same underlying **GraphDatabaseManager**, indicating a shared data‑access layer across the KnowledgeManagement family.

Persistence is abstracted through **GraphDatabaseManager** (found in `storage/graph-database-manager.ts`). All sub‑components that need to write or read graph data—including **OnlineLearning**, **EntityPersistenceAgent**, **OntologyClassifier**, and **KnowledgeGraphAnalyzer**—delegate to this manager, which itself wraps the lower‑level **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`). This two‑tier data‑access approach isolates business logic from storage concerns and enables consistent JSON export via the adapter’s `syncJSONExport` capability (as described in the parent component documentation).

Validation is performed by `extractedKnowledgeValidator` before any write operation. By placing validation as a separate, reusable function, the design enforces a **separation of concerns**: extraction logic does not need to be aware of ontology rules, and the validator can be unit‑tested in isolation.

## Implementation Details  

1. **Analyzers** – Each analyzer lives in `online-learning.ts`:
   * `gitHistoryAnalyzer` walks the Git commit history, parses commit messages, diff metadata, and extracts domain‑specific concepts (e.g., newly introduced APIs or bug‑fix patterns).
   * `lslSessionAnalyzer` consumes logs from LSL (Live Session Logging) sessions, translating runtime events into declarative knowledge objects.
   * `codeAnalyzer` parses source files, identifies architectural motifs, and surfaces refactoring opportunities.

   All three return a common “knowledge payload” that the pipeline can merge.

2. **Knowledge Extraction & Persistence** – The `extractKnowledge` function receives the merged payload, invokes `extractedKnowledgeValidator` to ensure ontology compliance, and finally calls methods on **GraphDatabaseManager** (e.g., `addNode`, `addEdge`) to persist the data. Because the manager is imported from `storage/graph-database-manager.ts`, the persistence path is consistent with other components that interact with the graph store.

3. **Pipeline Orchestration** – `onlineLearningPipeline` is the entry point for the automated learning flow. It sequentially:
   * Triggers each analyzer,
   * Aggregates their outputs,
   * Calls `extractKnowledge`,
   * Handles any validation errors (typically by logging and aborting the current cycle).

   This deterministic flow makes the component easy to invoke from CI jobs, background workers, or interactive developer tools.

4. **Validator** – `extractedKnowledgeValidator` checks that every node and edge respects the ontology defined at the KnowledgeManagement level. It likely inspects required properties, type hierarchies, and relationship constraints before allowing the manager to write.

## Integration Points  

* **Parent – KnowledgeManagement** – OnlineLearning is a child of the broader KnowledgeManagement component, inheriting the ontology and data‑sync expectations described for the parent (e.g., the `syncJSONExport` routine in the adapter). The validator aligns extracted knowledge with the ontology enforced at the parent level.

* **Sibling – GraphDatabaseManager** – OnlineLearning directly consumes the manager (`storage/graph-database-manager.ts`). This is the same manager used by **EntityPersistenceAgent**, **KnowledgeGraphAnalyzer**, and **OntologyClassifier**, providing a unified API for graph operations. Any change to the manager’s contract propagates uniformly across these siblings.

* **Sibling – ManualLearning** – While ManualLearning writes manually curated entities via the **GraphDatabaseAdapter**, OnlineLearning writes automatically extracted entities via the manager. Both ultimately store data in the same underlying graph, ensuring that manual and automated knowledge coexist seamlessly.

* **External Triggers** – The pipeline can be invoked by scheduled jobs, Git hooks, or IDE extensions that monitor developer activity. Because the pipeline is a pure function composition, it can be called programmatically without side‑effects beyond the validated persistence step.

## Usage Guidelines  

1. **Do not bypass the validator** – All knowledge must flow through `extractedKnowledgeValidator`. Direct calls to GraphDatabaseManager from new code should be avoided unless the caller replicates the same validation logic.

2. **Extend via new analyzers** – When adding a new source of knowledge (e.g., issue‑tracker mining), implement a function in `online-learning.ts` that returns a payload compatible with existing ones and register it inside `onlineLearningPipeline`. This respects the established pipeline pattern and avoids invasive changes.

3. **Keep the pipeline deterministic** – The order of analyzer execution matters only insofar as later stages may depend on earlier outputs (e.g., code analysis might reference git‑derived module names). Document any such dependencies clearly in the pipeline code.

4. **Unit‑test each stage** – Because the design isolates extraction, validation, and persistence, developers should write unit tests for each analyzer, for the validator against the ontology, and for the manager’s interaction contract. This mirrors the testing approach used by sibling components such as **OntologyClassifier**.

5. **Monitor performance** – Extraction can be I/O‑heavy (reading Git history, parsing large codebases). If latency becomes a concern, consider batching the work or running the pipeline asynchronously, but retain the same function signatures to keep the integration surface stable.

---

### Architectural Patterns Identified
* **Pipeline / Orchestration** – `onlineLearningPipeline` composes independent analysis stages.
* **Facade (GraphDatabaseManager)** – Provides a simplified API over the lower‑level GraphDatabaseAdapter.
* **Validator (Specification)** – `extractedKnowledgeValidator` enforces ontology rules before persistence.
* **Separation of Concerns** – Extraction, validation, and persistence are cleanly separated into distinct functions/modules.

### Design Decisions & Trade‑offs
* **Centralised Graph Access** – Using a single manager reduces duplication but creates a single point of failure; any performance bottleneck in the manager impacts all siblings.
* **Synchronous Pipeline** – Simplicity and deterministic ordering are gained at the cost of potential latency for large repositories.
* **Explicit Validation** – Guarantees data integrity but adds overhead; however, the cost is justified by the need to keep the knowledge graph consistent across manual and automated inputs.

### System Structure Insights
* **Hierarchical** – OnlineLearning sits under KnowledgeManagement, sharing ontology and export mechanisms.
* **Sibling Cohesion** – Multiple components (ManualLearning, EntityPersistenceAgent, etc.) converge on the same persistence layer, promoting data consistency.
* **No Child Components** – OnlineLearning does not expose further sub‑components; its responsibilities are fully encapsulated within the pipeline and its helper functions.

### Scalability Considerations
* **Graph Database Scaling** – Since all knowledge funnels through GraphDatabaseManager, scaling the underlying graph store (via LevelDB or Graphology configuration) directly benefits OnlineLearning.
* **Parallel Analyzer Execution** – The current pipeline is sequential; future scalability could be achieved by running independent analyzers in parallel threads or worker processes, provided the validator remains thread‑safe.
* **Incremental Extraction** – To avoid re‑processing the entire Git history on each run, an incremental checkpoint (potentially managed by **CheckpointTracker**) could be introduced.

### Maintainability Assessment
* **High Modularity** – Clear functional boundaries make the codebase approachable; adding new analyzers or tweaking validation rules does not ripple through unrelated parts.
* **Shared Dependencies** – Heavy reliance on GraphDatabaseManager means changes to its API require coordinated updates across all siblings, demanding careful versioning and thorough integration testing.
* **Documentation Alignment** – Because the component’s purpose and interactions are explicitly described in the observations, developers can quickly locate the relevant files (`online-learning.ts`, `storage/graph-database-manager.ts`) and understand the data flow, supporting long‑term maintainability.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's reliance on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for persistence and automatic JSON export sync enables efficient data management. This is evident in the way the adapter leverages Graphology and LevelDB for robust graph database interactions. For instance, the 'syncJSONExport' function in graph-database-adapter.ts ensures that data remains consistent across different storage formats, thus supporting the project's data analysis goals.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store manually created entities
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to interact with the graph database
- [EntityPersistenceAgent](./EntityPersistenceAgent.md) -- EntityPersistenceAgent uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [KnowledgeGraphAnalyzer](./KnowledgeGraphAnalyzer.md) -- KnowledgeGraphAnalyzer uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [CheckpointTracker](./CheckpointTracker.md) -- CheckpointTracker uses the GraphDatabaseManager (storage/graph-database-manager.ts) to interact with the graph database
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the LevelDB database (storage/leveldb.ts) to store graph data


---

*Generated from 7 observations*

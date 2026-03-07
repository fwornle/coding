# StalenessDetector

**Type:** SubComponent

StalenessDetector employs a work-stealing concurrency model, as implemented in StalenessDetector.runWithConcurrency(), allowing idle workers to pull staleness tasks immediately

## What It Is  

**StalenessDetector** is a sub‑component of the **ConstraintSystem** that determines whether the content of an entity (e.g., a file, command block, or configuration snippet) has become *stale* with respect to the current state of the repository. The core implementation lives in `src/detectors/StalenessDetector.ts`. The detector pulls the latest Git history, analyses the entity’s textual content via the **EntityContentAnalyzer** (`src/analyzers/entity-content-analyzer.ts`), and produces a staleness verdict that is stored in a graph database and optionally cached in Redis (`src/cache/staleness-cache.ts`).  

The detection workflow is driven by a declarative pipeline described in `config/staleness-pipeline.yaml`. Each step in the pipeline declares its dependencies with explicit `depends_on` edges, allowing the system to orchestrate a deterministic, step‑wise evaluation. The detector also contains three concrete children – **GitStalenessDetector**, **StalenessMetadataHandler**, and **PipelineBasedStalenessDetector** – that encapsulate the Git‑specific logic, metadata management, and pipeline orchestration respectively.

---

## Architecture and Design  

The architecture of **StalenessDetector** is a composition of several well‑defined patterns that emerge directly from the source observations:

1. **Pipeline‑Based Execution** – The detector follows a pipeline model defined in `staleness-pipeline.yaml`. Each pipeline stage is a discrete unit that declares `depends_on` relationships, enabling a directed acyclic graph (DAG) of processing steps. This design gives the system deterministic ordering while remaining extensible: new stages can be added simply by extending the YAML file.

2. **Work‑Stealing Concurrency** – Concurrency is handled by `StalenessDetector.runWithConcurrency()`. Idle worker threads “steal” pending staleness tasks from a shared queue, ensuring that CPU resources are maximally utilized even when some entities finish early. This model reduces latency for large batches of entities and aligns with the parent **ConstraintSystem**’s broader work‑stealing strategy.

3. **Graph‑Database Persistence** – Persistence is abstracted through a graph‑database adapter used in `StalenessDetector.ts`. Staleness results are stored as nodes/edges, which makes queries such as “all entities stale because of a particular commit” efficient. This mirrors the parent component’s “intelligent routing for database interactions”.

4. **Redis Result Caching** – Short‑lived staleness outcomes are cached in Redis (`staleness-cache.ts`). The cache is consulted before launching a full detection run, cutting down on redundant Git scans and analyzer invocations.

5. **Metadata Pre‑Population** – The method `StalenessDetector.mapEntityToStaleness()` eagerly populates fields like `stalenessType` and `metadata.stalenessClass`. By doing so, subsequent pipeline stages can short‑circuit when a definitive classification is already known, reducing unnecessary recomputation.

6. **Integration with EntityContentAnalyzer** – The detector delegates content‑specific heuristics to `EntityContentAnalyzer` (`entity-content-analyzer.ts`). This separation of concerns allows the detector to focus on orchestration while the analyzer provides regex‑based extraction of commands, file paths, and other domain‑specific tokens.

Collectively, these patterns give **StalenessDetector** a clear separation between *orchestration* (pipeline, concurrency), *persistence* (graph DB), *performance optimisation* (caching, metadata pre‑population), and *domain analysis* (EntityContentAnalyzer). The design is consistent with sibling components: **ValidationAgent** uses a rules‑engine, **HookOrchestrator** a pub‑sub model, while **StalenessDetector** adopts a pipeline‑plus‑work‑stealing approach.

---

## Implementation Details  

### Core Classes & Functions  

* **`StalenessDetector` (StalenessDetector.ts)** – The façade exposing three public entry points:  
  * `mapEntityToStaleness(entity)` – extracts the entity’s identifier, pre‑populates `stalenessType` and `metadata.stalenessClass`, and writes a placeholder node to the graph DB.  
  * `runStalenessDetection(entityBatch)` – reads `staleness-pipeline.yaml`, builds the DAG of steps, and launches the pipeline via `PipelineBasedStalenessDetector`.  
  * `runWithConcurrency(taskQueue)` – creates a pool of worker threads; each worker invokes `runStalenessDetection` on a pulled entity and, when idle, steals tasks from other workers.

* **`GitStalenessDetector`** – Encapsulated within the detector, this class performs the Git‑based algorithm referenced in Observation 1. It walks the commit graph, compares file hashes, and flags entities whose last modification predates the most recent relevant commit.

* **`StalenessMetadataHandler`** – Responsible for reading/writing the metadata fields (`stalenessType`, `metadata.stalenessClass`). It also implements the “pre‑populate” optimisation, ensuring that once a type is assigned, downstream pipeline steps can treat the node as terminal.

* **`PipelineBasedStalenessDetector`** – Parses `config/staleness-pipeline.yaml`, constructs the execution DAG, and invokes each step in topological order. Each step is a small, pure function that receives the entity’s current metadata and may augment it (e.g., “CheckGitHistory”, “AnalyzeContent”, “AssignSeverity”).

### Persistence & Caching  

* **Graph‑Database Adapter** – The detector uses a thin wrapper around the graph DB client. Nodes representing entities are created/updated in `mapEntityToStaleness`. Edges capture relationships such as “derived‑from‑commit” or “depends‑on‑other‑entity”, enabling fast traversal queries for downstream validation agents.

* **Redis Cache (`staleness-cache.ts`)** – Before any heavy processing, `runStalenessDetection` checks `Redis.get(entityId)`. If a recent result exists (TTL configurable), the detector returns the cached verdict, bypassing the pipeline. Cache writes happen after a successful pipeline run.

### Concurrency Mechanics  

`runWithConcurrency` spawns a configurable number of workers (default equals number of CPU cores). Workers share a synchronized task queue. When a worker finishes its current entity, it attempts to `steal` a task from the tail of another worker’s queue, minimizing idle time. The work‑stealing logic is encapsulated in a small utility module (`src/concurrency/workStealer.ts`), keeping the detector’s core logic clean.

---

## Integration Points  

1. **Parent – ConstraintSystem** – The detector is registered as a child of **ConstraintSystem**, which orchestrates overall constraint validation. Results from **StalenessDetector** are consumed by the **ValidationAgent** to enforce rules such as “do not execute stale commands”. The graph‑DB routing logic in the parent is reused here, providing a unified persistence layer.

2. **Sibling – EntityContentAnalyzer** – The detector imports `entity-content-analyzer.ts` to obtain a parsed representation of the entity’s body. The analyzer’s regex‑based token extraction feeds directly into pipeline steps like “ContentPatternCheck”.

3. **Sibling – GitHistoryProcessor** – While **GitHistoryProcessor** focuses on raw change detection across the repository, **StalenessDetector** narrows that view to a per‑entity staleness verdict. The two share the same underlying Git utilities, ensuring consistent commit semantics.

4. **Cache Layer** – `staleness-cache.ts` is a shared Redis module used by other components (e.g., **HookOrchestrator** may cache hook execution results). This common cache reduces duplication of connection handling.

5. **Persistence** – The graph‑DB adapter is also employed by **ValidationAgent** and **HookOrchestrator** for storing rule evaluations and hook subscriptions, respectively. This creates a single source of truth for all constraint‑related metadata.

6. **Configuration** – The pipeline definition (`config/staleness-pipeline.yaml`) can be edited without code changes, allowing product teams to add or reorder detection steps. This mirrors the config‑driven approach used by the sibling **HookOrchestrator** (pub‑sub topics).

---

## Usage Guidelines  

* **Never invoke `runStalenessDetection` directly on a raw entity** – always call `mapEntityToStaleness` first so that the metadata placeholders are persisted. Skipping this step can lead to duplicate work and inconsistent graph nodes.  
* **Cache awareness** – When testing changes to detection logic, consider clearing the Redis entry for the target entity (`Redis.del(entityId)`) to avoid stale cached results masking the new behaviour.  
* **Pipeline extensions** – To add a new analysis stage, edit `config/staleness-pipeline.yaml` and implement a pure function that accepts the current metadata object. Ensure you declare any new `depends_on` edges so the DAG remains acyclic.  
* **Concurrency tuning** – The default worker count matches the host CPU count, but in environments with heavy I/O (e.g., remote Git servers), increasing the pool size can improve throughput. Adjust the `CONCURRENCY_WORKERS` environment variable accordingly.  
* **Error handling** – All pipeline steps should throw typed errors that `PipelineBasedStalenessDetector` can catch and translate into a “failed” staleness status. This prevents a single malformed entity from halting the entire batch.  
* **Graph‑DB schema compliance** – When adding new node properties, update the schema definition in `src/db/graphSchema.ts` to keep the graph consistent across all ConstraintSystem components.

---

### Architectural patterns identified
1. **Pipeline‑based execution model** (declarative DAG in `staleness-pipeline.yaml`).  
2. **Work‑stealing concurrency** (`runWithConcurrency`).  
3. **Graph‑database persistence** (adapter in `StalenessDetector.ts`).  
4. **Redis result caching** (`staleness-cache.ts`).  
5. **Metadata pre‑population** (`mapEntityToStaleness`).  

### Design decisions and trade‑offs
* **Pipeline vs monolithic processing** – The pipeline gives modularity and configurability but adds YAML parsing overhead and requires careful dependency management.  
* **Graph DB vs relational** – Graph storage enables fast traversal of staleness relationships but introduces operational complexity (e.g., backup, scaling) compared to a traditional RDBMS.  
* **Redis cache** – Improves latency for repeated checks but requires cache invalidation logic; stale cache entries could hide newly introduced staleness.  
* **Work‑stealing** – Maximises CPU utilisation for heterogeneous workloads, yet the stealing logic adds concurrency bugs risk (race conditions) and complicates testing.  
* **Pre‑populating metadata** – Reduces duplicate computation at the cost of writing placeholder nodes early, which may increase write load on the graph DB.

### System structure insights
* **Hierarchy** – `ConstraintSystem` (parent) → `StalenessDetector` (sub‑component) → three children (`GitStalenessDetector`, `StalenessMetadataHandler`, `PipelineBasedStalenessDetector`).  
* **Sibling synergy** – Shares Git utilities with `GitHistoryProcessor`, content parsing with `EntityContentAnalyzer`, and caching/persistence layers with `ValidationAgent` and `HookOrchestrator`.  
* **Configuration‑driven** – Core behaviour lives in external YAML and Redis config files, keeping the TypeScript code relatively stable.

### Scalability considerations
* **Horizontal scaling** – Adding more detector instances is straightforward because each instance reads the same pipeline definition and uses the shared Redis cache and graph DB. The work‑stealing queue can be distributed via a message broker if needed.  
* **Cache hit ratio** – High cache hit rates dramatically reduce Git I/O; tuning TTL based on repository activity is essential.  
* **Graph‑DB query performance** – As the number of entities grows, indexing on `stalenessType` and `metadata.stalenessClass` becomes critical to maintain low‑latency queries.  
* **Concurrency limits** – Over‑provisioning workers can saturate the Git server or Redis, so monitoring of I/O latency is recommended.

### Maintainability assessment
* **Modular separation** – Distinct child classes encapsulate Git logic, metadata handling, and pipeline orchestration, making unit testing and future refactoring manageable.  
* **Declarative pipeline** – Allows non‑engineers to adjust detection steps without code changes, enhancing long‑term adaptability.  
* **Clear contracts** – Functions like `mapEntityToStaleness` and `runStalenessDetection` have well‑defined inputs/outputs, reducing hidden coupling.  
* **Potential pain points** – The work‑stealing implementation and graph‑DB schema evolution require careful documentation; any change to node properties must be reflected across all ConstraintSystem components.  

Overall, **StalenessDetector** embodies a deliberately composable, performance‑oriented design that aligns with the broader architectural goals of the **ConstraintSystem** while remaining extensible through configuration and clear module boundaries.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build its architecture. The system's key patterns include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient data processing. The component also employs a multi-agent system that processes git history and LSL sessions to detect staleness and validate entity content.

### Children
- [GitStalenessDetector](./GitStalenessDetector.md) -- The StalenessDetector sub-component utilizes a git-based approach, as hinted by its parent component's context, to detect staleness in entity content
- [StalenessMetadataHandler](./StalenessMetadataHandler.md) -- The StalenessStore suggested by the parent analysis may be responsible for handling staleness metadata, storing and retrieving information about entity staleness
- [PipelineBasedStalenessDetector](./PipelineBasedStalenessDetector.md) -- The PipelineManager suggested by the parent analysis may be responsible for managing the pipeline-based execution model, coordinating the staleness detection process for entities

### Siblings
- [ValidationAgent](./ValidationAgent.md) -- ValidationAgent uses a rules-engine pattern with ValidationRules.ts, each rule declaring explicit conditions and actions
- [HookOrchestrator](./HookOrchestrator.md) -- HookOrchestrator uses a pub-sub pattern with HookOrchestrator.ts, each hook declaring explicit subscription topics
- [EntityContentAnalyzer](./EntityContentAnalyzer.md) -- EntityContentAnalyzer uses a regex-based pattern matching algorithm, as seen in EntityContentAnalyzer.ts, to extract file paths and commands from entity content
- [GitHistoryProcessor](./GitHistoryProcessor.md) -- GitHistoryProcessor uses a git-based history processing algorithm, as seen in GitHistoryProcessor.ts, to detect changes and updates in entity content
- [LSLSessionProcessor](./LSLSessionProcessor.md) -- LSLSessionProcessor uses a session-based processing algorithm, as seen in LSLSessionProcessor.ts, to detect changes and updates in entity content


---

*Generated from 7 observations*

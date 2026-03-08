# DataIngestion

**Type:** SubComponent

The DataIngestion sub-component relies on the ontology metadata fields (entityType, metadata.ontologyClass) to prevent redundant LLM re-classification, as seen in the PersistenceAgent.mapEntityToSharedMemory() function.

## What It Is  

**DataIngestion** is a sub‑component that lives inside the **CodingPatterns** hierarchy.  Its implementation is spread across a handful of core artefacts that are referenced directly in the source observations: the component talks to the **GraphDatabaseAdapter** defined in `storage/graph-database-adapter.ts`, it relies on ontology metadata fields such as `entityType` and `metadata.ontologyClass` (used by `PersistenceAgent.mapEntityToSharedMemory()`), and it orchestrates work through a DAG‑based batch definition found in `batch-analysis.yaml`.  In addition, the runtime execution model is driven by the work‑stealing logic of `WaveController.runWithConcurrency()`, while consistency of persisted data is guaranteed by the `JsonExportSync` mechanism.  All of these pieces together enable DataIngestion to pull raw knowledge artefacts, classify them (or skip classification when ontology metadata is already present), store them efficiently in a LevelDB‑backed graph store, and keep the JSON export up‑to‑date for downstream consumers.

---

## Architecture and Design  

The architecture of **DataIngestion** is deliberately compositional.  At its core it follows a **pipeline‑oriented DAG execution model** – each step in `batch-analysis.yaml` declares explicit `depends_on` edges, allowing the BatchScheduler‑style topological sort to determine a safe execution order.  This mirrors the pattern used elsewhere in the system (e.g., the generic BatchScheduler) and gives DataIngestion a deterministic, reproducible processing flow.  

Concurrency is handled through a **work‑stealing scheduler** implemented in `WaveController.runWithConcurrency()`.  A shared `nextIndex` counter is atomically incremented by any idle worker, which immediately “steals” the next pending task.  This design eliminates the need for a central task queue and reduces contention, providing a lightweight form of dynamic load balancing that scales with the number of available workers.  

Persistence is abstracted behind the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`).  The adapter hides the details of the underlying LevelDB storage engine while exposing a clean, typed API for creating, reading, and updating knowledge entities.  Because the same adapter is used by sibling components **OntologyIntegration** and **GraphDatabaseManagement**, DataIngestion benefits from a shared contract and can evolve its storage strategy without touching its own business logic.  

Finally, the component leverages **ontology‑driven short‑circuiting**.  By inspecting `entityType` and `metadata.ontologyClass` before invoking any large language model (LLM) re‑classification, the `PersistenceAgent.mapEntityToSharedMemory()` function prevents unnecessary compute, which is a clear optimisation decision baked into the design.

---

## Implementation Details  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)** – This class encapsulates LevelDB operations (open, read, write, batch) and presents methods such as `saveEntity`, `fetchEntity`, and `deleteEntity`.  The adapter also triggers the **JsonExportSync** routine after each mutating operation, ensuring that a JSON snapshot of the graph is always current.  Because LevelDB provides ordered key‑value storage, queries that need range scans or prefix matches are highly performant, which is critical for the high‑throughput ingestion pipeline.  

2. **Ontology‑aware Mapping (`PersistenceAgent.mapEntityToSharedMemory()`)** – Before an entity is handed off to downstream processing, this function checks the fields `entityType` and `metadata.ontologyClass`.  If they are already populated, the function bypasses the LLM classifier, directly writes the entity into shared memory, and records the mapping in the graph via the adapter.  This conditional path reduces latency and CPU usage, especially when the upstream source already supplies ontology information.  

3. **DAG Execution (`batch-analysis.yaml`)** – The YAML file lists steps such as *fetch‑raw*, *normalize*, *enrich*, and *store*.  Each step includes a `depends_on` list that the BatchScheduler parses to produce a topological order.  The scheduler then spawns workers that execute steps in parallel where dependencies allow.  Because the DAG is declarative, adding or re‑ordering steps does not require code changes—only a modification to the YAML definition.  

4. **Work‑Stealing Scheduler (`WaveController.runWithConcurrency()`)** – Workers share a mutable `nextIndex` integer.  When a worker finishes its current task, it atomically increments `nextIndex` and claims the next batch index.  This pattern avoids the classic producer‑consumer queue bottleneck and enables near‑linear scaling up to the number of CPU cores, provided that the underlying I/O (LevelDB writes, JSON export) does not become a contention point.  

5. **JsonExportSync** – Integrated inside the GraphDatabaseAdapter, this utility serialises the entire graph (or incremental deltas) to a JSON file after each successful transaction.  Downstream components that consume a static snapshot—such as reporting tools or external APIs—can rely on a consistent view without needing to query LevelDB directly.

---

## Integration Points  

DataIngestion sits under the **CodingPatterns** parent component, which itself standardises graph access through the shared **GraphDatabaseAdapter**.  This common adapter means that DataIngestion, **OntologyIntegration**, and **GraphDatabaseManagement** all speak the same persistence language, simplifying cross‑component data sharing and reducing duplication of storage logic.  

The component’s DAG definition (`batch-analysis.yaml`) is a contract that other subsystems can extend.  For example, a new enrichment step that pulls data from an external API could be added simply by inserting a new node with appropriate `depends_on` edges.  Because the BatchScheduler processes the DAG uniformly, the integration cost is minimal.  

On the runtime side, the work‑stealing scheduler (`WaveController.runWithConcurrency()`) expects any worker to conform to a simple `executeTask(taskId)` interface.  This makes it straightforward for external services—such as a cloud‑based job orchestrator—to plug in their own workers, provided they respect the shared `nextIndex` counter semantics.  

Finally, the ontology metadata check performed by `PersistenceAgent.mapEntityToSharedMemory()` creates an implicit contract with upstream data producers.  Any producer that can supply `entityType` and `metadata.ontologyClass` will automatically benefit from reduced classification overhead, encouraging a broader ecosystem of well‑annotated data sources.

---

## Usage Guidelines  

1. **Declare DAG steps declaratively** – When extending the ingestion pipeline, edit `batch-analysis.yaml` and add new steps with explicit `depends_on` relationships.  Avoid hard‑coding ordering in code; let the BatchScheduler compute the topological sort.  

2. **Leverage ontology metadata** – Ensure that incoming entities include `entityType` and `metadata.ontologyClass` whenever possible.  This allows `PersistenceAgent.mapEntityToSharedMemory()` to skip redundant LLM classification, improving throughput and reducing cost.  

3. **Respect the GraphDatabaseAdapter contract** – All persistence operations should go through the adapter’s public methods.  Direct LevelDB access bypasses `JsonExportSync` and can lead to stale JSON snapshots.  

4. **Tune concurrency via WaveController** – The number of concurrent workers can be configured at startup.  For CPU‑bound workloads, match the worker count to the number of physical cores; for I/O‑bound ingestion (e.g., many LevelDB writes), a higher worker count may be beneficial, but monitor LevelDB lock contention.  

5. **Validate JSON export** – After major schema changes, run a quick sanity check on the exported JSON file to confirm that all entities are correctly serialized.  This helps catch mismatches between the graph store and the export layer early.

---

### Architectural Patterns Identified  

* **DAG‑based batch orchestration** (declarative pipeline in `batch-analysis.yaml`)  
* **Work‑stealing concurrency** (`WaveController.runWithConcurrency()`)  
* **Adapter pattern** (GraphDatabaseAdapter abstracts LevelDB)  
* **Metadata‑driven short‑circuiting** (ontology fields guard LLM re‑classification)  

### Design Decisions & Trade‑offs  

* **LevelDB as storage** – Chosen for its high‑performance key‑value semantics; trade‑off is limited support for complex graph queries compared with a native graph DB.  
* **JSON export sync** – Guarantees a readily consumable snapshot but adds write‑amplification after every mutation.  
* **Work‑stealing vs. central queue** – Reduces contention and improves scaling, at the cost of requiring atomic counter management and careful handling of side‑effects.  

### System Structure Insights  

DataIngestion is a thin orchestration layer that delegates persistence to a shared adapter, relies on ontology metadata to optimise classification, and uses a declarative DAG to express processing order.  Its sibling components reuse the same storage adapter, reinforcing a **single source of truth** for knowledge entities across the CodingPatterns domain.  

### Scalability Considerations  

* **Horizontal scaling** is facilitated by the work‑stealing scheduler; adding more workers linearly increases throughput until LevelDB I/O becomes the bottleneck.  
* **DAG parallelism** allows independent steps to run concurrently, but steps with many dependencies can become serialisation points.  
* **JSON export** may become a scalability choke point for very large graphs; incremental export strategies could be introduced if growth outpaces current sync speed.  

### Maintainability Assessment  

The use of well‑named adapters, declarative YAML pipelines, and isolated concurrency logic makes the codebase **highly maintainable**.  Changes to storage (e.g., swapping LevelDB for another KV store) are confined to `storage/graph-database-adapter.ts`.  Adding new ingestion steps does not require touching core logic, only updating the DAG definition.  The only maintenance risk lies in the tight coupling between the adapter’s write path and `JsonExportSync`; any modification to persistence must preserve the export trigger to avoid stale data for downstream consumers.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving knowledge entities. This adapter provides a standardized interface for interacting with the graph database, which is built on top of LevelDB for efficient data storage and retrieval. The use of LevelDB allows for high-performance data storage and querying, making it an ideal choice for the CodingPatterns component. Furthermore, the GraphDatabaseAdapter also provides automatic JSON export sync, ensuring that data is consistently up-to-date and readily available for use within the component.

### Siblings
- [OntologyIntegration](./OntologyIntegration.md) -- OntologyIntegration uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve knowledge entities, providing a standardized interface for interacting with the graph database.
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- GraphDatabaseManagement uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to provide a standardized interface for interacting with the graph database.


---

*Generated from 7 observations*

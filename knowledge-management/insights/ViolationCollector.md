# ViolationCollector

**Type:** SubComponent

The ViolationCollector provides a flexible architecture for handling different types of violations, including entity-level and graph-level violations

## What It Is  

The **ViolationCollector** is a sub‑component of the `ConstraintSystem` that is responsible for gathering, buffering, filtering, and persisting validation‑related violations. Although the source snapshot does not expose concrete file locations, the observations make clear that the collector lives alongside its siblings – `ContentValidator`, `HookManager`, and `GraphDatabaseAccessor` – inside the same logical layer that the `ConstraintSystem` orchestrates. Its primary role is to receive violation data from the `ContentValidator`, apply optional filtering (by entity type or severity), and then write the results to the graph database through the `GraphDatabaseAccessor`. By offering both synchronous and asynchronous collection modes, as well as entity‑level and graph‑level violation handling, the collector provides a versatile entry point for any component that needs to report validation problems.

## Architecture and Design  

The design of **ViolationCollector** follows a *buffer‑and‑flush* architectural approach. Incoming violations are first placed into an in‑memory buffer; the buffer is later flushed to the persistent store in bulk, which reduces the number of write operations against the `GraphDatabaseAccessor`. This buffering strategy is complemented by a **caching** layer that keeps recently accessed violation data in memory, thereby avoiding repeated reads from the underlying LevelDB‑backed graph database.  

The collector’s support for **multiple collection modes** (synchronous vs. asynchronous) indicates a *strategy*‑like separation of execution paths: in synchronous mode the caller blocks until the violation is buffered, while in asynchronous mode the collector likely queues the work onto an event loop or background worker. Likewise, the **multiple filtering modes** (by entity type, severity) act as configurable *policy* objects that determine which violations survive the buffer before persistence.  

Interaction with other components is straightforward: the `ContentValidator` produces validation results and hands them to the collector; the collector, in turn, delegates persistence to the `GraphDatabaseAccessor`. Both the collector and the validator share the same underlying persistence mechanism (the graph database), which is also used by other siblings such as `HookManager` for event storage. This shared dependency on `GraphDatabaseAccessor` reinforces a **single‑source‑of‑truth** model for all graph‑related data.

## Implementation Details  

* **Buffering Mechanism** – The collector maintains an internal data structure (likely an array or map) that accumulates violation objects. When a configurable threshold (size or time‑based) is reached, the buffer is flushed in a single batch write to the `GraphDatabaseAccessor`. This reduces write amplification on LevelDB and improves throughput.  

* **Caching Mechanism** – A read‑through cache sits in front of the `GraphDatabaseAccessor`. When the collector needs to query existing violations (e.g., to de‑duplicate or to apply severity‑based filters), it first checks the cache; a miss triggers a fetch from the graph database, after which the result is stored in the cache for future accesses.  

* **Collection Modes** –  
  * *Synchronous*: The caller invokes a method (e.g., `collectViolationSync`) that immediately buffers the violation and may optionally trigger an immediate flush if the buffer is full.  
  * *Asynchronous*: The caller invokes a non‑blocking method (e.g., `collectViolationAsync`) that enqueues the violation onto an internal task queue. A background worker periodically processes the queue, applying buffering and flushing logic.  

* **Violation Types** – The collector distinguishes between **entity‑level violations** (tied to a specific node or edge) and **graph‑level violations** (concerned with overall graph properties). This distinction likely manifests as different payload schemas or type tags that the collector uses to route the violation to the appropriate persistence path.  

* **Filtering Modes** – Before a violation is persisted, the collector evaluates configured filters:  
  * *Entity‑type filter*: Allows only violations affecting certain entity categories (e.g., “User”, “Document”).  
  * *Severity filter*: Allows only violations above a configurable severity threshold (e.g., “ERROR” vs. “WARN”).  

* **Integration with ContentValidator** – The `ContentValidator` calls into the collector after completing its validation logic. Because both components rely on the same `GraphDatabaseAccessor`, the collector can store validation results in the same graph structure that the validator reads from, ensuring consistency across the validation pipeline.

## Integration Points  

1. **GraphDatabaseAccessor** – The collector’s sole persistence contract is the `GraphDatabaseAccessor`. All writes (buffer flushes) and reads (cache misses) are funneled through this accessor, which abstracts the LevelDB‑backed graph database.  

2. **ContentValidator** – Acts as the primary producer of violation objects. The collector expects the validator to supply violations in a format that includes at least an entity identifier, violation type, and severity.  

3. **ConstraintSystem (Parent)** – The `ConstraintSystem` owns the collector and likely coordinates its lifecycle (initialization, shutdown, configuration). Because the parent also uses the `GraphDatabaseAdapter` for broader persistence, the collector benefits from shared configuration (e.g., database paths, serialization settings).  

4. **HookManager (Sibling)** – While not directly referenced in the observations, the `HookManager`’s registry‑based event system could be used to emit events when a buffer flush occurs or when a violation is filtered out, enabling other parts of the system to react (e.g., logging, alerting).  

5. **Other Siblings** – `ContentValidator` and `GraphDatabaseAccessor` share the same storage backend, which simplifies transaction boundaries and reduces the risk of data divergence between validation results and stored violations.

## Usage Guidelines  

* **Choose the appropriate collection mode** – For low‑latency contexts (e.g., real‑time user feedback), use the synchronous API to guarantee that a violation is buffered before the call returns. For high‑throughput batch processing, prefer the asynchronous API to avoid blocking the validation thread.  

* **Configure buffering thresholds wisely** – A small buffer size leads to more frequent writes, reducing latency but increasing write overhead on LevelDB. Conversely, a large buffer improves write efficiency but may delay persistence, which could affect downstream processes that rely on up‑to‑date violation data.  

* **Leverage filtering wisely** – Apply entity‑type and severity filters early to keep the buffer lean and to avoid unnecessary storage of low‑importance violations. Ensure that filter configuration is aligned with the overall compliance or monitoring policies of the system.  

* **Respect cache invalidation** – When external processes modify violation data directly in the graph database (bypassing the collector), make sure to invalidate or refresh the collector’s cache to prevent stale reads.  

* **Monitor flush events** – Integrate with the `HookManager` or a logging subsystem to emit metrics on buffer size, flush frequency, and write latency. This visibility helps in tuning the collector for the target workload.

---

### Architectural patterns identified  

* **Buffer‑and‑Flush (Batching) pattern** – Reduces write frequency to the graph database.  
* **Caching (Read‑Through) pattern** – Minimises repeated reads from LevelDB.  
* **Strategy pattern for collection modes** – Synchronous vs. asynchronous execution paths.  
* **Policy/Filter pattern** – Configurable filtering by entity type and severity.

### Design decisions and trade‑offs  

* **Performance vs. immediacy** – Buffering improves throughput but introduces latency for persistence. Providing both sync and async modes lets callers pick the trade‑off that fits their use case.  
* **Complexity of caching** – Adding a cache speeds up read‑heavy paths but requires careful invalidation to avoid stale data.  
* **Flexibility in violation handling** – Supporting both entity‑level and graph‑level violations makes the collector reusable across different validation scenarios, at the cost of a slightly more complex internal schema.  

### System structure insights  

* The collector sits in a **validation‑centric sub‑tree** under `ConstraintSystem`, sharing persistence (`GraphDatabaseAccessor`) with its siblings.  
* It acts as a **bridge** between the validation logic (`ContentValidator`) and the persistent graph store, encapsulating performance optimisations (buffering, caching) that are transparent to its callers.  

### Scalability considerations  

* **Horizontal scaling** – Because the collector relies on an in‑process buffer and cache, scaling out would require either partitioning the violation stream (e.g., sharding by entity) or externalising the buffer (e.g., using a message queue).  
* **Write amplification control** – The batch‑write approach scales well with increasing violation volume, as LevelDB handles bulk inserts more efficiently than many small writes.  

### Maintainability assessment  

* The collector’s responsibilities are well‑encapsulated: buffering, caching, filtering, and persistence are clearly delineated, which aids readability and testing.  
* Dependence on a single accessor (`GraphDatabaseAccessor`) reduces coupling to the underlying storage implementation, making future swaps of the persistence layer (e.g., moving from LevelDB to another graph store) less invasive.  
* However, the dual collection modes and multiple filter configurations increase the surface area for bugs; comprehensive unit tests for each mode and filter combination are essential to maintain reliability.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes the GraphDatabaseAdapter for persistence, which is implemented in the storage/graph-database-adapter.ts file. This adapter provides a robust mechanism for storing and retrieving data in a graph database, leveraging the capabilities of Graphology and LevelDB. The automatic JSON export sync feature ensures that data is consistently updated and available for further processing. For instance, the ContentValidationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, relies on this adapter to store and retrieve validation results.

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator uses the GraphDatabaseAccessor to retrieve entity data for validation, as seen in the storage/graph-database-adapter.ts file
- [HookManager](./HookManager.md) -- HookManager uses a registry-based approach to manage hooks, allowing for efficient registration and dispatching of events
- [GraphDatabaseAccessor](./GraphDatabaseAccessor.md) -- GraphDatabaseAccessor uses the LevelDB database to store and retrieve graph data


---

*Generated from 7 observations*

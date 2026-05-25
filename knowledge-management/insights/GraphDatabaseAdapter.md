# GraphDatabaseAdapter

**Type:** SubComponent

The dual-mode pattern means that if the VKB HTTP server goes down after startup, the adapter continues attempting HTTP calls rather than falling back to direct access, making server liveness monitoring operationally important

# GraphDatabaseAdapter — Technical Insight Document

## What It Is

`GraphDatabaseAdapter` is implemented in `storage/graph-database-adapter.ts` as a `SubComponent` within the broader `KnowledgeManagement` parent component. It serves as a routing layer that abstracts graph database access by selecting between two distinct execution paths at initialization time: a "live" mode that proxies all operations through the `VkbApiClient` HTTP interface, and a "direct" mode that invokes `GraphDatabaseService` (which holds the LevelDB file handle) directly in-process.

The adapter's defining characteristic is its single-evaluation routing decision. It calls `VkbApiClient.isServerAvailable()` exactly once during initialization and caches the boolean result as the permanent routing mode for the lifetime of that adapter instance. No per-operation re-evaluation occurs, which makes the live/direct decision effectively immutable after construction. This single-decision behavior is implemented through its child component, `RoutingModeInitializer`, which is responsible for executing the availability check and locking in the mode.

![GraphDatabaseAdapter — Architecture](images/graph-database-adapter-architecture.png)

The adapter exists specifically to solve a concurrency constraint inherent in LevelDB: LevelDB enforces a single-writer lock at the filesystem level, meaning only one process can hold the database handle at a time. By routing through an HTTP server when one is available, the adapter serializes all writers through that server and sidesteps the lock collision problem entirely.

## Architecture and Design

The architectural pattern at play is a **dual-mode adapter** with **startup-time strategy selection**. Rather than implementing dynamic failover or per-call routing decisions, the design favors a deterministic, one-shot decision that creates a stable execution profile for the adapter's lifetime. The trade-off is explicit: simplicity and predictability are gained at the cost of runtime resilience — if the VKB HTTP server becomes unavailable after the adapter has selected live mode, the adapter will continue to attempt HTTP calls rather than fall back to direct access.

In **live mode**, the adapter delegates every read and write operation to `VkbApiClient`, which talks to the VKB HTTP server. This delegation is what enables multi-process safety: any number of processes can run concurrently in live mode because they all funnel their LevelDB interactions through a single backend process holding the LevelDB handle. In **direct mode**, the adapter calls `GraphDatabaseService` directly, which is only safe when exactly one process is running in direct mode against that LevelDB instance. Two processes simultaneously attempting direct mode against the same database will collide on LevelDB's lock.

The pattern is essentially a **process-level serialization strategy**: the HTTP server, when present, acts as a serialization point for distributed writers. The adapter's job is to detect that opportunity at startup and route accordingly. This contrasts with sibling components like `GraphKnowledgeExporter`, which uses a decoupled event-based pattern (subscribing to `entity:stored` events emitted after each successful graph write), and `CheckpointManager` (at `src/utils/checkpoint-manager.ts`), which manages persistent state markers for the `OnlineLearning` pipeline. Where those siblings use loose coupling and event-driven flow, `GraphDatabaseAdapter` is a tight, synchronous routing facade.

## Implementation Details

The technical mechanics center on three interacting elements. First, the `RoutingModeInitializer` child component encapsulates the call to `VkbApiClient.isServerAvailable()`. Because this call happens exactly once at adapter construction, the initializer effectively snapshots the system state and produces a routing decision that becomes a property of the adapter instance.

Second, in live mode, every operation invocation passes through `VkbApiClient`. The adapter does not maintain any direct relationship with LevelDB at runtime in this mode — it never touches `GraphDatabaseService`, never opens the database file, and never holds a LevelDB lock. This is what makes multi-process operation safe: each process spawns its own adapter, each adapter independently determines that the HTTP server is available, and all of them route through the same shared `VkbApiClient` → VKB server → `GraphDatabaseService` chain.

Third, in direct mode, the adapter holds a reference to `GraphDatabaseService` and invokes its methods synchronously. `GraphDatabaseService` owns the LevelDB file handle in this configuration. The implication is that direct mode is fundamentally a single-process configuration; it is intended for situations where the VKB HTTP server is not running and where the operator has confirmed no other process will contend for the same LevelDB files.

![GraphDatabaseAdapter — Relationship](images/graph-database-adapter-relationship.png)

The absence of dynamic failback logic is itself an implementation choice. The adapter does not retry, does not poll for server availability, and does not transition between modes mid-flight. This keeps the routing layer thin and predictable but pushes operational responsibility onto monitoring infrastructure: the system must independently watch VKB HTTP server liveness, because the adapter will not detect or react to mid-run server failures.

## Integration Points

`GraphDatabaseAdapter` sits within `KnowledgeManagement` and acts as the canonical gateway to graph storage for most write paths in the system. Its upstream dependency is `VkbApiClient`, on which it depends both for the initial availability probe (`isServerAvailable()`) and, in live mode, for the execution of every graph operation. Its alternative downstream dependency is `GraphDatabaseService`, used only in direct mode and only when the HTTP server is unavailable.

Among siblings, the most important integration is with `ManualLearning`, which writes directly through `GraphDatabaseAdapter`. This means `ManualLearning` inherits the dual-mode behavior: in live mode its writes are HTTP-mediated and safe to run alongside other writers; in direct mode it acquires the LevelDB lock and excludes all other direct-mode writers. `OnlineLearning` uses `CheckpointManager` to track commit hashes and session counts for incremental processing, but its graph writes (when they occur) should follow the same adapter discipline. `GraphKnowledgeExporter` integrates indirectly by subscribing to `entity:stored` events emitted after writes succeed through the adapter — meaning the adapter's mode selection has no direct effect on exports, since exports react to events rather than calling storage themselves.

The child component `RoutingModeInitializer` is the internal integration point for the routing decision itself, isolating the `VkbApiClient.isServerAvailable()` call and the mode-locking behavior from the rest of the adapter's logic.

## Usage Guidelines

**New write paths must integrate through `GraphDatabaseAdapter`'s routing layer.** This is the single most important convention. Bypassing the adapter to call `GraphDatabaseService` directly creates an unmonitored second writer that can collide with any other process running in direct mode on the LevelDB lock. Even when the VKB HTTP server is running and most writes are safely serialized through it, an out-of-band direct call to `GraphDatabaseService` undermines the entire serialization guarantee that the dual-mode design exists to provide.

**Treat VKB HTTP server availability at startup as a critical operational dependency.** Because the adapter probes availability exactly once and never re-evaluates, the routing mode chosen at process start determines the safety profile of the entire run. If the server is intended to be the serialization point, operators must ensure it is up *before* any adapter instances initialize. Conversely, if the server goes down mid-run, the adapter will continue making HTTP calls that will fail — there is no automatic fallback to direct mode, by design.

**Implement liveness monitoring at the operational layer, not in application code.** The adapter intentionally does not attempt server health monitoring or mode transitions. External monitoring (process supervisors, health checks, alerting) is the correct place to detect VKB HTTP server outages. Application code should assume the adapter's mode is fixed for the run.

**Reserve direct mode for single-process scenarios.** Direct mode is only safe when exactly one process is running against the LevelDB instance. In any environment where multiple processes might initialize a `GraphDatabaseAdapter` against the same data directory, the VKB HTTP server should be running so that all adapters select live mode and serialize through it.

---

### Summary of Key Insights

1. **Architectural patterns identified:** Dual-mode adapter with startup-time strategy selection; HTTP-mediated serialization to circumvent LevelDB's single-writer lock; thin synchronous routing facade.

2. **Design decisions and trade-offs:** Single-evaluation routing (simplicity and predictability vs. no mid-run resilience); no dynamic failback (clean semantics vs. operational fragility if the server dies post-startup); centralized routing through the adapter (lock safety vs. requirement that all writers comply).

3. **System structure insights:** The adapter is the chokepoint for graph writes within `KnowledgeManagement`; `RoutingModeInitializer` isolates the mode-selection concern; siblings like `ManualLearning` depend on adapter compliance, while `GraphKnowledgeExporter` is decoupled via events.

4. **Scalability considerations:** Live mode enables multi-process scalability by funneling all writers through the VKB HTTP server; direct mode is intrinsically single-process. Horizontal scaling of writers requires the HTTP server to be running and reachable at every adapter initialization.

5. **Maintainability assessment:** The adapter itself is simple and predictable, which aids maintainability. However, the convention that "all new write paths must route through this adapter" is a discipline that must be enforced through code review and documentation — there is no language-level mechanism preventing direct calls to `GraphDatabaseService`, which makes the system's safety dependent on developer awareness.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.

### Children
- [RoutingModeInitializer](./RoutingModeInitializer.md) -- Based on the parent context, GraphDatabaseAdapter invokes VkbApiClient.isServerAvailable() a single time at initialization — never again during normal operation — making the live/direct decision immutable for the adapter instance.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning writes directly through GraphDatabaseAdapter, which means it must route through the VKB HTTP API (live mode) or risk LevelDB lock collisions in direct mode when other writers are active
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning feeds CheckpointManager with commit hashes and session counts so incremental runs skip already-analyzed history, as tracked in src/utils/checkpoint-manager.ts
- [VkbApiClient](./VkbApiClient.md) -- VkbApiClient.isServerAvailable() is called once at GraphDatabaseAdapter initialization to determine routing mode — live vs direct — and the result is never re-evaluated, making server availability at startup a critical operational dependency
- [GraphKnowledgeExporter](./GraphKnowledgeExporter.md) -- GraphKnowledgeExporter subscribes to entity:stored events emitted after each successful graph write, decoupling export from the write path itself
- [CheckpointManager](./CheckpointManager.md) -- CheckpointManager at src/utils/checkpoint-manager.ts stores commit hashes as markers so the OnlineLearning pipeline can skip already-processed git history on subsequent runs


---

*Generated from 5 observations*

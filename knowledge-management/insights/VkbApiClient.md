# VkbApiClient

**Type:** SubComponent

VkbApiClient.isServerAvailable() is called once at GraphDatabaseAdapter initialization to determine routing mode — live vs direct — and the result is never re-evaluated, making server availability at startup a critical operational dependency

# VkbApiClient — Technical Insight Document

## What It Is

`VkbApiClient` is implemented at `lib/ukb-unified/core/VkbApiClient.js`, placing it deliberately in the unified library layer (`ukb-unified/core`) rather than inside the feature-specific knowledge-management directory. This location signals its role as a foundational, shared utility consumed across multiple parts of the system rather than a feature-bound helper. Structurally, it is a SubComponent contained within `KnowledgeManagement`, alongside siblings such as `GraphDatabaseAdapter`, `ManualLearning`, `OnlineLearning`, `GraphKnowledgeExporter`, and `CheckpointManager`.

Functionally, `VkbApiClient` is the HTTP-based client that bridges in-process code to an out-of-process VKB HTTP server. Its critical responsibility is to enable lock-free, multi-process access to the underlying LevelDB store by serializing all reads and writes through a single HTTP endpoint. Without it, concurrent writers would collide on LevelDB's single-writer file lock.

![VkbApiClient — Architecture](images/vkb-api-client-architecture.png)

## Architecture and Design

The architecture centers on a **dual-mode routing strategy** implemented by the parent-adjacent sibling `GraphDatabaseAdapter` (at `storage/graph-database-adapter.ts`). At initialization, `GraphDatabaseAdapter` calls `VkbApiClient.isServerAvailable()` exactly once to probe whether a VKB HTTP server is reachable. The boolean result is cached as the adapter's permanent operating mode — either `live` (route through `VkbApiClient` over HTTP) or `direct` (access `GraphDatabaseService` and the LevelDB handle directly). This decision is never re-evaluated, making the state of the HTTP server at adapter startup a critical operational dependency.

The design pattern is best described as a **proxy/gateway with implicit write serialization**. Because all writers in `live` mode funnel through a single HTTP layer, `VkbApiClient` implicitly acts as a write queue: concurrent writers block on the HTTP layer's request handling rather than on the filesystem-level LevelDB lock. This trades filesystem-level contention (which would produce hard lock failures across processes) for application-layer contention (which can be managed gracefully on the server side).

The key trade-off is **availability vs. simplicity**: the system gains the ability for multiple processes to coexist as writers, but the cost is that the HTTP server becomes a hard prerequisite for multi-process scenarios, and the once-only availability check means runtime changes in server state are not detected.

## Implementation Details

The primary entry point exposed by `VkbApiClient` is `isServerAvailable()`, which returns a boolean indicating whether the HTTP API can be reached. This method is invoked exactly once during `GraphDatabaseAdapter` construction, and its return value determines the entire downstream routing behavior for the lifetime of the adapter instance. There is no retry, no periodic re-probe, and no fallback recovery if the server later becomes unavailable while the adapter is in `live` mode (or becomes available while it is in `direct` mode).

In `live` mode, all read and write operations are translated into HTTP requests against the VKB API. This is the only safe path for multi-process write scenarios. The HTTP layer between client and server provides the natural serialization point: requests queue at the HTTP server, which holds the sole `LevelDB` handle internally and applies writes sequentially. This is what allows multiple processes to coexist without colliding on LevelDB's single-writer lock.

In `direct` mode, `VkbApiClient` is bypassed entirely; `GraphDatabaseAdapter` reaches into `GraphDatabaseService` to manipulate LevelDB directly. This mode is only safe when exactly one process is performing writes — any second process attempting `direct` mode simultaneously will fail on the LevelDB lock.

![VkbApiClient — Relationship](images/vkb-api-client-relationship.png)

## Integration Points

`VkbApiClient`'s most important integration is with its sibling `GraphDatabaseAdapter`, which is its sole known caller for the mode-selection probe and the routing target in `live` mode. `GraphDatabaseAdapter` in turn fronts `GraphDatabaseService`, the holder of the LevelDB handle, in `direct` mode. This forms a clear three-layer dependency: callers → `GraphDatabaseAdapter` → (`VkbApiClient` over HTTP) or (`GraphDatabaseService` directly).

Other siblings within `KnowledgeManagement` interact with `VkbApiClient` indirectly. `ManualLearning` writes directly through `GraphDatabaseAdapter`, which means it inherits whichever mode the adapter selected at startup — if `live`, its writes flow through `VkbApiClient`; if `direct`, they bypass it entirely. `GraphKnowledgeExporter` is decoupled from the write path; it subscribes to `entity:stored` events emitted after successful graph writes regardless of the underlying mode. `OnlineLearning` and `CheckpointManager` (the latter at `src/utils/checkpoint-manager.ts`) operate on commit-hash bookkeeping that is independent of the routing mode but still ultimately persists through `GraphDatabaseAdapter`.

The external integration point is the **VKB HTTP server itself**. `VkbApiClient` is meaningless without a running server on the expected endpoint. Server availability at adapter initialization time is a hard architectural dependency for multi-process deployments.

## Usage Guidelines

**Treat `VkbApiClient` as the only sanctioned multi-writer path.** Any new write path that bypasses it and goes straight to LevelDB risks lock collisions with concurrent writers. When integrating additional write functionality — for example, extending `ManualLearning` or building a new sibling under `KnowledgeManagement` — route through `GraphDatabaseAdapter` so that the mode selection is respected, and ensure the deployment runs the VKB HTTP server so `live` mode is selected.

**Be aware that `isServerAvailable()` is evaluated exactly once.** Operators must guarantee the HTTP server is up *before* `GraphDatabaseAdapter` initializes. Starting the server later will not promote the adapter from `direct` to `live`, and conversely, stopping the server after a `live`-mode adapter has initialized will cause subsequent HTTP calls to fail with no automatic fallback. Initialization ordering is therefore an operational invariant, not an implementation detail.

**Never run two processes in `direct` mode simultaneously.** This is the failure case the dual-mode design exists to prevent. If you anticipate multi-process scenarios — concurrent learners, exporters, or analyzers — the VKB HTTP server must be available at startup so all adapters initialize into `live` mode and serialize their writes through `VkbApiClient`.

**Remember the implicit queue.** Because the HTTP layer serializes all writers, `VkbApiClient` is also where contention manifests under load. Bursts of concurrent writes will queue at the HTTP server rather than fail outright, which is preferable to lock collisions but can introduce latency. Designs that issue large numbers of small writes should consider batching at the call site rather than relying on the implicit queue to absorb them.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning writes directly through GraphDatabaseAdapter, which means it must route through the VKB HTTP API (live mode) or risk LevelDB lock collisions in direct mode when other writers are active
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning feeds CheckpointManager with commit hashes and session counts so incremental runs skip already-analyzed history, as tracked in src/utils/checkpoint-manager.ts
- [GraphKnowledgeExporter](./GraphKnowledgeExporter.md) -- GraphKnowledgeExporter subscribes to entity:stored events emitted after each successful graph write, decoupling export from the write path itself
- [CheckpointManager](./CheckpointManager.md) -- CheckpointManager at src/utils/checkpoint-manager.ts stores commit hashes as markers so the OnlineLearning pipeline can skip already-processed git history on subsequent runs
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter calls VkbApiClient.isServerAvailable() exactly once at initialization and caches the result as the permanent routing mode — no per-operation re-evaluation occurs


---

*Generated from 5 observations*

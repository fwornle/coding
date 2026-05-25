# OnlineLearning

**Type:** SubComponent

The batch analysis pipeline produces entities that are written through GraphDatabaseAdapter; because the adapter's live/direct mode is set once at startup, long-running pipeline jobs must account for server availability at launch time

# OnlineLearning — Technical Insight Document

## What It Is

OnlineLearning is a SubComponent within the `KnowledgeManagement` parent component, functioning as the batch analysis pipeline responsible for processing codebase history and producing graph entities at scale. While the observations do not pin down a single source file for OnlineLearning itself (no code symbols were enumerated), its operational footprint is defined by its interactions with three concrete artifacts: `src/utils/checkpoint-manager.ts` (CheckpointManager), `src/knowledge-management/GraphKnowledgeExporter.js` (GraphKnowledgeExporter), and the GraphDatabaseAdapter abstraction it writes through.

Functionally, OnlineLearning is the only write path in `KnowledgeManagement` that operates at batch scale. It ingests git history, derives entities from incremental commit ranges, and persists them through the graph layer while emitting `entity:stored` events that downstream consumers react to. Its role is distinct from its sibling `ManualLearning`, which performs single-shot, developer-driven writes through the same adapter but does not generate sustained throughput.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

## Architecture and Design

The architecture exhibits a clear **pipeline + event-emitter** composition layered over a **dual-mode storage adapter**. OnlineLearning sits at the top of the pipeline, feeding `CheckpointManager` with commit hashes and session counts so that subsequent runs can resume incrementally rather than re-analyze already-covered history. This checkpointing introduces a stateful resumability contract: progress is durable across runs, and partial coverage is observable via completeness scores that CheckpointManager tracks.

Writes flow from OnlineLearning through `GraphDatabaseAdapter`, which inherits from its parent `KnowledgeManagement` a critical design constraint: the adapter calls `VkbApiClient.isServerAvailable()` exactly once at initialization and permanently caches the result as either `live` (HTTP-routed) or `direct` (LevelDB-handle) mode. Because OnlineLearning is a long-running batch process, its routing mode is fixed at launch and never re-evaluated. This is a deliberate trade-off: a single decision point keeps the hot write path branch-free, but it places the burden of correctness on launch-time environment validation.

On the read-side of the write event, `GraphKnowledgeExporter` subscribes to `entity:stored` events and debounces writes to per-domain JSON export files. This **publish-subscribe with debouncing** pattern decouples export latency from write throughput — OnlineLearning can flood the graph at batch speed while the exporter coalesces bursts into manageable file-system operations.

## Implementation Details

The incremental analysis mechanism is anchored in `src/utils/checkpoint-manager.ts`. OnlineLearning passes commit hashes and session counts to CheckpointManager, which persists them as markers indicating which portions of git history have been processed. On subsequent runs, OnlineLearning <USER_ID_REDACTED> these markers to skip already-analyzed commit ranges, making the pipeline idempotent across restarts and efficient against large repositories.

Completeness scoring lives alongside the checkpoint markers. CheckpointManager tracks coverage metrics that let the pipeline report what fraction of the codebase has been analyzed, enabling consumers to prioritize under-covered areas for focused re-runs. This turns the pipeline from a one-shot analyzer into a measurable, iteratively-improving knowledge source.

Entity persistence is implemented as a pass-through to `GraphDatabaseAdapter`. Each successful write emits an `entity:stored` event, which `GraphKnowledgeExporter` at `src/knowledge-management/GraphKnowledgeExporter.js` consumes. The exporter applies per-domain debouncing — entities targeting the same domain export file are batched together — so high-throughput batches from OnlineLearning do not translate into proportional disk I/O. This is essential because batch runs can produce entities at a rate that would otherwise saturate filesystem syncs.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

## Integration Points

OnlineLearning sits at the intersection of four collaborators in the `KnowledgeManagement` subsystem:

- **CheckpointManager** (`src/utils/checkpoint-manager.ts`): The state <COMPANY_NAME_REDACTED>. OnlineLearning writes commit hashes and session counts here and reads them back on startup to decide what to skip. CheckpointManager also surfaces completeness scores upward.
- **GraphDatabaseAdapter**: The write conduit. Whether the adapter is in `live` or `direct` mode was determined at adapter initialization by `VkbApiClient.isServerAvailable()`, and OnlineLearning inherits whichever mode was selected. In `live` mode writes go through the VKB HTTP API; in `direct` mode they hit `GraphDatabaseService` and the LevelDB handle directly.
- **VkbApiClient**: Not called by OnlineLearning directly, but its availability at the moment of adapter initialization is the silent determinant of OnlineLearning's runtime characteristics. If the VKB HTTP server starts up after the adapter, OnlineLearning will not benefit — it remains in direct mode.
- **GraphKnowledgeExporter** (`src/knowledge-management/GraphKnowledgeExporter.js`): The downstream listener. It is fully decoupled from OnlineLearning, communicating only through `entity:stored` events.

The sibling `ManualLearning` shares the same `GraphDatabaseAdapter` write path, which means OnlineLearning and ManualLearning compete for the same routing-mode decision. If both run in `direct` mode concurrently, they will collide on the LevelDB single-writer lock — a constraint inherited from the parent `KnowledgeManagement` design.

## Usage Guidelines

**Always validate VKB HTTP server availability before launching OnlineLearning.** Because the routing mode is locked at `GraphDatabaseAdapter` initialization and never re-evaluated, starting a long-running batch job without the server up means the pipeline will run in `direct` mode for its entire duration. This is the most likely source of concurrent-writer collisions in the entire system: OnlineLearning is the only batch-scale writer, so any other process attempting direct LevelDB access during a batch run will be locked out.

**Trust the checkpoint, but verify completeness.** CheckpointManager will faithfully skip already-processed commits, which is desirable for incrementality but can mask gaps if checkpoint state was corrupted or partially written in a previous failed run. Use the completeness scores it exposes to identify under-analyzed areas rather than assuming a successful run implies full coverage.

**Do not assume `entity:stored` consumers see every write synchronously.** GraphKnowledgeExporter debounces per-domain writes, so JSON export files lag behind graph state during active batches. Tools that read export files immediately after a batch completes must either wait for the debounce window to flush or query the graph directly.

**Treat OnlineLearning as the canonical batch writer.** When introducing new write paths into `KnowledgeManagement`, route them through the VKB HTTP API (live mode) rather than direct adapter access. The dual-mode design exists precisely to serialize writers through the HTTP server, and OnlineLearning's batch profile makes it the dominant consumer of that serialization guarantee.

---

### Summary of Key Findings

1. **Architectural patterns identified**: Incremental checkpoint-driven pipeline; dual-mode storage adapter (inherited from parent); publish-subscribe with debouncing for export decoupling.
2. **Design decisions and trade-offs**: Routing mode locked at startup trades runtime adaptability for hot-path simplicity; debounced exports trade export freshness for write throughput; checkpoint-based resumability trades storage state complexity for restart efficiency.
3. **System structure insights**: OnlineLearning is the sole batch-scale writer in `KnowledgeManagement`, making it the gravitational center of concurrency concerns; it shares the adapter with `ManualLearning` and emits to `GraphKnowledgeExporter` via events.
4. **Scalability considerations**: The exporter's debouncing absorbs batch throughput; CheckpointManager's commit-hash skipping ensures runtime scales with new history rather than total history; the LevelDB single-writer lock is the primary scalability ceiling and is the reason live mode exists.
5. **Maintainability assessment**: Event-driven decoupling from GraphKnowledgeExporter keeps the export path independently evolvable. The startup-once routing decision is a sharp edge — any future maintainer adding write paths must understand the live/direct distinction or risk introducing lock collisions.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning writes directly through GraphDatabaseAdapter, which means it must route through the VKB HTTP API (live mode) or risk LevelDB lock collisions in direct mode when other writers are active
- [VkbApiClient](./VkbApiClient.md) -- VkbApiClient.isServerAvailable() is called once at GraphDatabaseAdapter initialization to determine routing mode — live vs direct — and the result is never re-evaluated, making server availability at startup a critical operational dependency
- [GraphKnowledgeExporter](./GraphKnowledgeExporter.md) -- GraphKnowledgeExporter subscribes to entity:stored events emitted after each successful graph write, decoupling export from the write path itself
- [CheckpointManager](./CheckpointManager.md) -- CheckpointManager at src/utils/checkpoint-manager.ts stores commit hashes as markers so the OnlineLearning pipeline can skip already-processed git history on subsequent runs
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter calls VkbApiClient.isServerAvailable() exactly once at initialization and caches the result as the permanent routing mode — no per-operation re-evaluation occurs


---

*Generated from 5 observations*

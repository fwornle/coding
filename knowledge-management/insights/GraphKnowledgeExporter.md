# GraphKnowledgeExporter

**Type:** SubComponent

Because GraphKnowledgeExporter reacts to entity:stored events regardless of whether the write came from ManualLearning or OnlineLearning, it provides a unified export view of the entire knowledge graph

# GraphKnowledgeExporter — Technical Insight Document

## What It Is

GraphKnowledgeExporter is a SubComponent within the `KnowledgeManagement` parent module responsible for projecting the live knowledge graph into file-based JSON artifacts on disk. Rather than sitting on the critical write path, it operates as an asynchronous observer: it subscribes to `entity:stored` events that are emitted after each successful graph write, and it materializes the resulting state into per-domain export files. This positions it as the system's bridge between the internal graph storage (LevelDB, accessed via the routing layer described in `GraphDatabaseAdapter`) and external consumers that lack the ability to query the database directly.

The exporter exists specifically to serve downstream integrations — most notably RAG (Retrieval-Augmented Generation) pipelines — that need a stable, file-based representation of the knowledge graph. These consumers cannot speak to LevelDB or even the VKB HTTP API, so a flattened JSON projection on disk becomes the canonical hand-off format.

![GraphKnowledgeExporter — Architecture](images/graph-knowledge-exporter-architecture.png)

## Architecture and Design

The architectural cornerstone of GraphKnowledgeExporter is **event-driven decoupling from the write path**. By subscribing to `entity:stored` events rather than being invoked inline during writes, the exporter introduces no latency or failure risk into the storage operation itself. A graph write succeeds or fails on its own merits; the export is a downstream consequence handled asynchronously. This is a deliberate separation-of-concerns choice: persistence and projection are independent concerns with independent failure modes.

A second key design decision is **per-domain file partitioning**. The exporter maintains an internal mapping from entity domain to output file path, so each event only triggers an update to the specific file that owns the affected entity. This avoids the cost of rewriting the entire knowledge graph on every change and keeps export files reasonably scoped — domain consumers can subscribe to (or watch) only the files they care about.

The third architectural pattern is **debouncing for write coalescing**. Because sibling component `OnlineLearning` can produce bursts of entity updates during batch operations (e.g., processing a span of git history coordinated via `CheckpointManager`), naive event handling would generate excessive file I/O. The debouncing mechanism collapses many rapid events targeting the same domain into a single write per export cycle, trading a small delay for substantial I/O efficiency.

Finally, because GraphKnowledgeExporter listens for `entity:stored` events regardless of their origin, it provides a **unified export view**. Writes from `ManualLearning` and `OnlineLearning` are indistinguishable from the exporter's perspective — both flow through `GraphDatabaseAdapter`, both emit the same event, and both land in the same export files. This gives downstream consumers a single source of truth.

## Implementation Details

The exporter's runtime behavior is structured around three concrete mechanics. First, an event subscription is established against the `entity:stored` event channel; this is the sole input trigger for the component. Second, an in-memory mapping from domain identifier to output file path is consulted on each event to determine the target file. Third, a debouncer per domain accumulates pending updates and flushes them to disk after a quiescence interval, producing one JSON write per domain per burst.

When an `entity:stored` event arrives, the exporter inspects the entity's domain, locates the corresponding file path in its mapping, and schedules a write. If subsequent events arrive for the same domain within the debounce window, they coalesce into the same pending write. When the window expires, a single serialization pass produces the JSON output for that domain.

Because the exporter does not perform graph writes itself, it inherits none of the LevelDB locking concerns that constrain its siblings. It is purely a reader and projector of state — though crucially, since the `entity:stored` event presumably carries enough payload (or triggers a read through the live infrastructure), the exporter remains insulated from the dual-mode routing tension between live and direct access that `GraphDatabaseAdapter` mediates.

![GraphKnowledgeExporter — Relationship](images/graph-knowledge-exporter-relationship.png)

## Integration Points

GraphKnowledgeExporter sits inside `KnowledgeManagement` alongside `ManualLearning`, `OnlineLearning`, `VkbApiClient`, `CheckpointManager`, and `GraphDatabaseAdapter`. Its upstream dependency is the `entity:stored` event stream, which is emitted by the graph storage layer downstream of `GraphDatabaseAdapter`. This means the exporter benefits from the adapter's routing decisions transparently — whether a write originated in `live` mode (through the VKB HTTP API) or `direct` mode (against the LevelDB handle held by `GraphDatabaseService`), the resulting `entity:stored` event reaches the exporter identically.

The two principal write producers in the system are siblings of the exporter. `ManualLearning` writes directly through `GraphDatabaseAdapter` and thus generates events that the exporter consumes. `OnlineLearning`, which is coordinated against git history via `CheckpointManager` (located at `src/utils/checkpoint-manager.ts`), produces the high-frequency batch writes that justify the debouncing design — without debouncing, an incremental run over many commits would translate into a storm of file rewrites.

Downstream, GraphKnowledgeExporter integrates with consumers that cannot reach into LevelDB or the HTTP API. RAG integrations are the explicitly cited example: they ingest the partitioned JSON files as their knowledge source. This file-based interface gives external systems a stable, version-controllable contract that does not require runtime coupling to the VKB infrastructure.

## Usage Guidelines

Developers introducing new write paths into the knowledge graph should ensure their writes flow through `GraphDatabaseAdapter` so that `entity:stored` events are emitted; bypassing the adapter would also bypass the exporter and create silently stale JSON files on disk. The same operational dependency that constrains the rest of `KnowledgeManagement` applies here: writes should route through the VKB HTTP API (live mode) when available, since the adapter's mode is fixed at initialization based on a one-time `VkbApiClient.isServerAvailable()` check.

When adding a new domain, the domain-to-file-path mapping inside GraphKnowledgeExporter must be updated; otherwise writes for that domain will lack a destination and the unified export view will be incomplete. Consumers reading the exported JSON should be aware that updates are debounced — there is a small but non-zero window between a successful graph write and its appearance in the file. For RAG pipelines and similar consumers, this is generally acceptable, but anything requiring strict read-after-write consistency should query the graph through the HTTP API instead.

Finally, because the exporter coalesces events per domain, batch operations from `OnlineLearning` will not generate proportional I/O — but operations spanning many domains in parallel will still produce one write per affected domain. Developers planning very large multi-domain ingestion runs should anticipate that the export step, while debounced, still scales with the number of distinct domains touched.

---

**Summary of analysis dimensions:**

1. **Architectural patterns identified:** event-driven observer subscribing to `entity:stored`, write-path decoupling, per-domain partitioning, debounced write coalescing, unified projection across heterogeneous write sources.
2. **Design decisions and trade-offs:** asynchronous export trades read-after-write consistency for write-path isolation; debouncing trades latency for I/O efficiency; per-domain files trade global atomicity for incremental update cost.
3. **System structure insights:** the exporter is a pure consumer of events emitted by `GraphDatabaseAdapter`-mediated writes, making it agnostic to whether `ManualLearning` or `OnlineLearning` produced the change, and insulated from the live/direct routing concerns of its siblings.
4. **Scalability considerations:** debouncing absorbs `OnlineLearning` burst load; per-domain partitioning bounds the size of any single export write; scaling is linear in the number of distinct domains touched per burst rather than in the number of entities written.
5. **Maintainability assessment:** clear single responsibility (event-to-file projection), minimal coupling (one event subscription, one file-mapping table), and stable downstream contract (JSON files) make this component low-risk to extend, with the main maintenance hotspot being the domain-to-path mapping that must be kept in sync with the broader domain taxonomy.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning writes directly through GraphDatabaseAdapter, which means it must route through the VKB HTTP API (live mode) or risk LevelDB lock collisions in direct mode when other writers are active
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning feeds CheckpointManager with commit hashes and session counts so incremental runs skip already-analyzed history, as tracked in src/utils/checkpoint-manager.ts
- [VkbApiClient](./VkbApiClient.md) -- VkbApiClient.isServerAvailable() is called once at GraphDatabaseAdapter initialization to determine routing mode — live vs direct — and the result is never re-evaluated, making server availability at startup a critical operational dependency
- [CheckpointManager](./CheckpointManager.md) -- CheckpointManager at src/utils/checkpoint-manager.ts stores commit hashes as markers so the OnlineLearning pipeline can skip already-processed git history on subsequent runs
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter calls VkbApiClient.isServerAvailable() exactly once at initialization and caches the result as the permanent routing mode — no per-operation re-evaluation occurs


---

*Generated from 5 observations*

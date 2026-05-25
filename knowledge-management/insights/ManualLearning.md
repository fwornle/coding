# ManualLearning

**Type:** SubComponent

Because GraphDatabaseAdapter's routing mode is fixed at initialization, ManualLearning operations issued after a server state change continue using the mode selected at startup, requiring operational awareness when deploying

# ManualLearning

## What It Is

ManualLearning is a SubComponent within the KnowledgeManagement domain that represents the human-curated write path into the knowledge graph. Unlike its sibling OnlineLearning, which feeds automated commit-hash tracked analysis into the system, ManualLearning provides a direct authoring channel where humans explicitly create and modify entities and observations. Its writes flow through GraphDatabaseAdapter (defined in `storage/graph-database-adapter.ts`), which routes operations either through the VKB HTTP API or directly against the LevelDB-backed GraphDatabaseService depending on the mode selected at initialization.

![ManualLearning — Architecture](images/manual-learning-architecture.png)

As the highest-trust write path in the KnowledgeManagement system, ManualLearning carries a privileged status: manually authored entities and observations are not overwritten by automated analysis without explicit conflict resolution. This makes it the authoritative source when the curated intent of a human disagrees with what automated pipelines might infer.

## Architecture and Design

ManualLearning's architecture is shaped by the dual-mode routing strategy of its underlying adapter. Because GraphDatabaseAdapter resolves its routing mode exactly once at startup via `VkbApiClient.isServerAvailable()` and caches that decision permanently, ManualLearning operations inherit a fixed transport: either every write goes over HTTP to the VKB server (live mode), or every write goes directly against the LevelDB handle held by GraphDatabaseService (direct mode). There is no per-operation re-evaluation, which means ManualLearning's behavior is deterministic for the lifetime of the process but cannot adapt to mid-flight server availability changes.

This design embodies a deliberate trade-off between simplicity and dynamism. The single-writer constraint of LevelDB makes concurrent direct-mode writers unsafe, so the dual-mode design exists specifically to serialize writes through the HTTP server when it is available. ManualLearning, being one such writer, must therefore be aware of this serialization contract — if the VKB HTTP server is up at adapter initialization, ManualLearning's writes are safely multiplexed alongside other writers; if it is not, ManualLearning holds the LevelDB lock directly and any other direct-mode process will collide.

A second architectural pattern visible here is event-based decoupling for downstream consumers. After a successful graph write, an `entity:stored` event is emitted, which GraphKnowledgeExporter subscribes to in order to regenerate debounced JSON export files for the affected domain. ManualLearning does not need to know about export concerns — it simply writes through the adapter and the event bus carries the side effects to GraphKnowledgeExporter without coupling the write path to the export path.

## Implementation Details

ManualLearning writes flow through `GraphDatabaseAdapter` in `storage/graph-database-adapter.ts`. When a manual edit is issued, the adapter consults its cached routing mode and either forwards the operation to VkbApiClient over HTTP or invokes GraphDatabaseService methods directly. Once the write succeeds at the storage layer, the system emits an `entity:stored` event. GraphKnowledgeExporter, listening for this event, schedules a debounced JSON re-export for the domain that owns the affected entity, ensuring filesystem artifacts stay consistent with graph state.

A critical implementation detail is what ManualLearning does *not* do: it does not participate in the batch analysis pipeline used by OnlineLearning, and consequently it is not tracked by CheckpointManager (located at `src/utils/checkpoint-manager.ts`). CheckpointManager exists to record commit hashes and session counts so that incremental analysis runs of OnlineLearning skip already-processed git history. Because manual edits have no commit hash or git provenance, they fall outside that tracking model entirely — they are simply applied directly to the graph as authoritative human input.

![ManualLearning — Relationship](images/manual-learning-relationship.png)

The trust hierarchy is enforced by convention rather than by a separate code path: automated pipelines that produce competing observations must perform conflict resolution before overwriting manually authored content. This positions ManualLearning as a kind of "pinned" layer in the data model — durable against the churn of repeated automated re-analysis.

## Integration Points

ManualLearning integrates with three principal collaborators in the KnowledgeManagement domain. First, it depends on GraphDatabaseAdapter as its sole write conduit; the adapter abstracts away whether the write travels over HTTP or directly against LevelDB. Second, through the adapter, ManualLearning indirectly depends on VkbApiClient — specifically on `VkbApiClient.isServerAvailable()`, whose return value at startup determines the routing mode for the entire process lifetime. Third, ManualLearning produces `entity:stored` events that GraphKnowledgeExporter consumes to keep exported JSON in sync with graph state.

ManualLearning is deliberately decoupled from OnlineLearning and CheckpointManager. While OnlineLearning feeds CheckpointManager with commit hashes and session counts so incremental runs can skip already-analyzed history, ManualLearning has no such bookkeeping requirement. This separation cleanly distinguishes the two write paths: OnlineLearning is incremental, git-aware, and batch-oriented; ManualLearning is immediate, ad-hoc, and authoritative.

Within the broader KnowledgeManagement parent component, ManualLearning sits alongside its siblings as one of several writers that must all respect the LevelDB single-writer constraint mediated by GraphDatabaseAdapter. Any future write path added to KnowledgeManagement must follow the same rule: either route through the VKB HTTP API or guarantee exclusive direct-mode access.

## Usage Guidelines

Developers using or extending ManualLearning should treat the adapter's routing mode as an operational concern that must be settled before the process starts. Because GraphDatabaseAdapter calls `VkbApiClient.isServerAvailable()` exactly once at initialization and never re-evaluates, ManualLearning operations issued after a server state change continue using the mode selected at startup. If the VKB HTTP server is started or stopped while the process is running, ManualLearning will not detect or react to the change — restart is required to pick up the new routing.

When deploying environments where multiple writers may be active (for example, an OnlineLearning batch job and an interactive ManualLearning session), ensure the VKB HTTP server is running and available at the moment ManualLearning's process initializes. This guarantees the adapter selects live mode and serializes writes through the HTTP API, avoiding LevelDB lock collisions. Running two direct-mode processes concurrently — even briefly — risks corrupt state and write failures.

Because manually authored content represents the highest-trust path, treat it as the source of truth when reconciling with automated analysis. Automated pipelines that would otherwise update an entity should check for human-curated provenance and either skip the write or invoke an explicit conflict resolution step rather than silently overwriting.

Finally, remember that every successful ManualLearning write triggers a debounced JSON export through GraphKnowledgeExporter. This means rapid sequences of manual edits will be batched into a single export pass per domain, which is efficient for normal authoring but should be considered when scripting bulk imports — large bulk operations may be better served by the OnlineLearning batch pipeline, which integrates with CheckpointManager for incremental tracking.

---

**Architectural patterns identified:** dual-mode routing through GraphDatabaseAdapter (live HTTP vs direct LevelDB); event-driven decoupling via `entity:stored` events consumed by GraphKnowledgeExporter; trust-tiered write paths with ManualLearning as the highest-priority authoring channel.

**Design decisions and trade-offs:** startup-time routing resolution sacrifices runtime adaptability for deterministic behavior and simpler concurrency reasoning; bypassing the batch analysis pipeline and CheckpointManager simplifies the manual write path but requires explicit conflict resolution to protect human input from automated overwrites.

**System structure insights:** ManualLearning is one of several sibling writers (OnlineLearning, others) within KnowledgeManagement, all funneling through GraphDatabaseAdapter; the HTTP server's availability at startup is a critical, process-wide dependency that affects every write originating from this component.

**Scalability considerations:** concurrent writer scalability is mediated by the VKB HTTP API serving as a serialization point; direct mode does not scale beyond one process because of the LevelDB single-writer lock; debounced exports prevent write-amplification on the filesystem under rapid editing.

**Maintainability assessment:** the clear separation between manual and automated write paths keeps responsibilities legible; however, the once-only routing-mode evaluation is an operational footgun that requires documentation and deployment discipline — new developers adding write paths must explicitly choose between the HTTP API and single-process direct access to remain safe.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning feeds CheckpointManager with commit hashes and session counts so incremental runs skip already-analyzed history, as tracked in src/utils/checkpoint-manager.ts
- [VkbApiClient](./VkbApiClient.md) -- VkbApiClient.isServerAvailable() is called once at GraphDatabaseAdapter initialization to determine routing mode — live vs direct — and the result is never re-evaluated, making server availability at startup a critical operational dependency
- [GraphKnowledgeExporter](./GraphKnowledgeExporter.md) -- GraphKnowledgeExporter subscribes to entity:stored events emitted after each successful graph write, decoupling export from the write path itself
- [CheckpointManager](./CheckpointManager.md) -- CheckpointManager at src/utils/checkpoint-manager.ts stores commit hashes as markers so the OnlineLearning pipeline can skip already-processed git history on subsequent runs
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter calls VkbApiClient.isServerAvailable() exactly once at initialization and caches the result as the permanent routing mode — no per-operation re-evaluation occurs


---

*Generated from 5 observations*

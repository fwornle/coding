# OnlineLearning

**Type:** SubComponent

Git history ingestion, LSL session analysis, and code analysis are distinct extraction sources that all converge into the single 'graph' LevelDB blob via GraphDatabaseService.js, with no per-source isolation

# OnlineLearning — Technical Insight Document

## What It Is

OnlineLearning is a SubComponent of KnowledgeManagement responsible for automated, pipeline-driven knowledge extraction and ingestion into the shared graph store. Unlike its sibling ManualLearning — which accepts direct, human-authored graph mutations — OnlineLearning orchestrates structured extraction from multiple automated sources: Git history ingestion, LSL session analysis, and code analysis. All of these pipelines converge their output into the single Graphology in-memory graph managed by `GraphDatabaseService.js`, which persists the entire graph state as one JSON blob under the LevelDB key `'graph'`.

OnlineLearning contains CodeAnalysisPipeline as a child component, which represents one of the primary extraction sources within this automated learning domain. No dedicated source files or class symbols were directly identified within OnlineLearning's own boundary, suggesting it operates primarily as a coordinative layer whose logic is distributed across its pipeline children and the shared infrastructure of `GraphDatabaseService.js`.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

---

## Architecture and Design

The central architectural pattern in OnlineLearning is a **DAG-structured batch analysis pipeline**, as reflected in `batch-analysis.yaml` configuration patterns documented in the project. Each step in this DAG produces graph mutations — adding nodes, edges, or metadata — that accumulate in the Graphology in-memory graph. Rather than persisting after each individual write, mutations are deferred and batched until an explicit flush is triggered via `GraphDatabaseService.js`'s `isDirty`/`_persistGraphToLevel()` cycle. This is a deliberate write-deferral design optimized for high-throughput batch extraction where the cost of serializing the full graph blob on every edge write would be prohibitive.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

The multiple extraction sources — Git history, LSL sessions, and code analysis — are architecturally treated as peers. They all write into the same undifferentiated graph namespace with no per-source isolation. There is no partitioning, namespacing, or separate subgraph per extraction source. This keeps the integration model simple (all sources speak the same Graphology mutation API through `GraphDatabaseService.js`) but means that extraction artifacts from different sources are indistinguishable at the storage level once merged.

The child component CodeAnalysisPipeline contributes a well-typed edge vocabulary — `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, `DEPENDS_ON_EXTERNAL` — reflecting a hierarchical containment and dependency model that structures the graph's semantic layer. This typed edge schema represents the most explicitly documented aspect of OnlineLearning's output contract.

---

## Implementation Details

The mechanics of OnlineLearning's persistence flow are entirely mediated through `GraphDatabaseService.js`. Extraction pipelines write nodes and edges into the Graphology in-memory graph instance managed by that service. Each mutation sets the `isDirty` flag to `true`, signaling that the in-memory state has diverged from what is stored in LevelDB. The actual write to disk — serializing the full Graphology graph to JSON and storing it under the single key `'graph'` — occurs only when a flush is explicitly triggered by calling `_persistGraphToLevel()`.

In the batch pipeline context, this means the typical execution model is: run all DAG steps, accumulate all graph mutations in memory, then flush once at the end. This is efficient but introduces a critical atomicity gap: if the process crashes between the first mutation and the eventual flush, all extracted knowledge from that run is silently lost. There is no incremental checkpointing mechanism — the single-key LevelDB design inherited from the parent KnowledgeManagement architecture does not support partial graph snapshots.

All graph entities written by OnlineLearning's pipelines are expected to carry UUIDv7 identifiers, consistent with the convention enforced across the sibling KmCoreStore. UUIDv7's time-ordered structure means nodes extracted in sequence will have naturally ordered identifiers, which can be useful for debugging extraction runs, though there is no explicit ordering guarantee documented in the pipeline outputs.

---

## Integration Points

OnlineLearning integrates directly with `GraphDatabaseService.js` as its sole persistence interface — all extraction sources funnel through this service rather than writing to LevelDB independently. This creates a clean single-writer model where `GraphDatabaseService.js` owns the canonical graph state, but it also means all pipelines share the same flush lifecycle and the same risk surface for data loss.

The relationship to ManualLearning is architecturally symmetric at the persistence layer: both write to the same Graphology graph via `GraphDatabaseService.js` and both set `isDirty` without automatically triggering a flush. However, OnlineLearning's batch pipeline nature makes the flush gap more dangerous — a manual edit might represent seconds of work, while a failed batch run could represent hours of extraction. There is no documented coordination mechanism between OnlineLearning and ManualLearning to prevent concurrent mutation conflicts in the shared graph.

The child CodeAnalysisPipeline's typed edge vocabulary (`DEFINES`, `DEPENDS_ON_EXTERNAL`, `CONTAINS_FILE`, etc.) represents OnlineLearning's most explicit output contract with downstream consumers. Any component that <USER_ID_REDACTED> the graph for structural code relationships depends on this pipeline having completed successfully and its mutations having been flushed.

---

## Usage Guidelines

**Always ensure flush is triggered after pipeline completion.** Because `GraphDatabaseService.js` defers persistence via `isDirty`, any batch pipeline that exits without explicitly calling `_persistGraphToLevel()` will discard all extracted knowledge silently. This is the single most critical operational rule for OnlineLearning pipelines. There is no safety net — LevelDB will retain the last successfully flushed state with no indication that newer data was lost.

**Treat the batch pipeline as an atomic unit.** Given the lack of incremental checkpointing, a partially completed DAG run that crashes mid-execution leaves the graph in its pre-run state (assuming no flush occurred). Operators should be aware that re-running a pipeline from scratch is the only recovery path, and they should design DAG steps to be idempotent where possible to make full reruns safe.

**Be aware of no per-source isolation.** Because Git history ingestion, LSL session analysis, and code analysis all write into the same undifferentiated graph, there is no mechanism to roll back or reprocess a single extraction source without risk of affecting graph state contributed by others. When debugging extraction issues, developers should not assume that re-running one pipeline step is safe without understanding the full mutation surface of that step.

**Follow the UUIDv7 identifier convention.** Consistent with KmCoreStore's identifier policy, all nodes and edges introduced by OnlineLearning pipelines should use UUIDv7. Deviating from this (e.g., using content-addressed hashes or sequential integers) would break the uniform identity model assumed across the KnowledgeManagement system.

---

### Scalability Considerations

The single-key LevelDB blob design creates a hard scalability ceiling: as the graph grows (more Git history ingested, more code analyzed, more sessions processed), the serialization and deserialization cost of every flush and load grows linearly with graph size. There is no sharding or lazy-loading mechanism. For large codebases or long-running projects, this could become a significant bottleneck. Addressing this would require rearchitecting `GraphDatabaseService.js` at the parent KnowledgeManagement level, not within OnlineLearning itself.

### Maintainability Assessment

OnlineLearning's design is maintainable at small-to-medium scale due to its simplicity: one graph, one flush, one persistence service. However, the absence of checkpointing, source isolation, and crash recovery makes it brittle for long-running or high-stakes extraction workloads. The typed edge schema from CodeAnalysisPipeline is a positive maintainability signal — explicit relationship types make the graph's semantic structure legible and queryable — but this discipline needs to be consistently applied across all extraction sources to remain useful.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The primary persistence mechanism in KnowledgeManagement is a single-key LevelDB strategy implemented in `src/knowledge-management/GraphDatabaseService.js`. Rather than storing each graph entity as a separate LevelDB key (which would enable partial reads and atomic per-entity updates), the entire Graphology in-memory graph is serialized as one JSON blob stored under the key `'graph'`. This blob contains all nodes, edges, and metadata. Writes are deferred using an `isDirty` flag — mutations to the graph set `isDirty = true`, and `_persistGraphToLevel()` is only called when a flush is explicitly triggered. This design optimizes for read-heavy, batch-write workloads but creates a risk of data loss if the process crashes between mutations and the next flush. New developers should be aware that any code path that modifies graph nodes or edges must ensure the flush cycle is triggered, or changes will silently remain only in memory.

### Children
- [CodeAnalysisPipeline](./CodeAnalysisPipeline.md) -- The pipeline produces typed edges documented in project references including CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, CONTAINS_MODULE, DEFINES, DEFINES_METHOD, and DEPENDS_ON_EXTERNAL, indicating a hierarchical containment and dependency model.

### Siblings
- [ManualLearning](./ManualLearning.md) -- Manual edits write directly to the Graphology in-memory graph via GraphDatabaseService.js, setting the isDirty flag but not automatically triggering _persistGraphToLevel(), meaning unsaved manual edits are at risk of loss if flush is not explicitly called
- [KmCoreStore](./KmCoreStore.md) -- All entities in the graph blob stored by GraphDatabaseService.js are expected to carry UUIDv7 identifiers, providing time-ordered, globally unique keys without a central ID authority
- [GraphDatabaseService](./GraphDatabaseService.md) -- GraphDatabaseService.js implements a single-key LevelDB strategy storing the entire Graphology graph as one JSON blob under key 'graph', trading partial-read capability for simplicity


---

*Generated from 5 observations*

# BatchGraphWriter

**Type:** Detail

As the terminal stage of the pipeline described in the sub-component definition ('before writing to GraphDatabaseService'), BatchGraphWriter must handle both create and update semantics for all six canonical entity types, since repeated pipeline runs over the same codebase should produce idempotent graph state rather than duplicate nodes.

# BatchGraphWriter

## What It Is

BatchGraphWriter is the terminal write stage of the batch analysis pipeline within the `OnlineLearning` parent component. While no direct code symbols were enumerated for it, its operational footprint is documented through the `MEMGRAPH_BATCH_SIZE` configuration knob and its position in the pipeline described as occurring "before writing to GraphDatabaseService." The downstream target is documented in `integrations/code-graph-rag/README.md` under the project banner "Graph-Code: A Graph-Based RAG System for Any Codebases," which confirms that `GraphDatabaseService` is a Memgraph instance serving graph-based Retrieval-Augmented Generation <USER_ID_REDACTED>.

In functional terms, BatchGraphWriter is responsible for persisting the canonical typed entity set — `Project`, `Component`, `SubComponent`, `Pattern`, `Detail`, and `System` — into Memgraph, batching multiple entity upserts into single transactions for throughput while preserving graph correctness. Because the graph it produces is consumed directly by a RAG retrieval layer, write correctness is not an isolated storage concern: it directly shapes the <USER_ID_REDACTED> of downstream retrieval.

## Architecture and Design

The writer implements a **batched transactional write** pattern against `GraphDatabaseService`. The defining architectural decision is the externalization of batch sizing into the `MEMGRAPH_BATCH_SIZE` configuration variable, making throughput-versus-safety a deployment-time tuning choice rather than a code-level constant. Larger batches reduce per-transaction overhead and improve write throughput, while smaller batches limit the blast radius if any transaction fails — a classic durability-versus-performance trade-off surfaced explicitly to operators.

The writer also implements **idempotent upsert semantics**. Because the pipeline (as defined in the `OnlineLearning` parent) is expected to run repeatedly over the same codebase — ingesting git history, LSL sessions, and code analysis outputs — BatchGraphWriter must produce the same graph state regardless of how many times it is invoked. This requires the writer to differentiate between create and update operations for every one of the six canonical entity types, rather than blindly inserting nodes that would produce duplicates.

Architecturally, BatchGraphWriter sits at a pipeline boundary: upstream stages within `OnlineLearning` produce typed entity records mapped to the canonical set, and BatchGraphWriter translates those into transactional graph mutations. This clean separation isolates retrieval-layer concerns (Memgraph semantics, transaction boundaries, Cypher generation) from analysis-layer concerns (entity extraction, mapping, classification).

## Implementation Details

While the specific class and function symbols were not enumerated in the observations, the implementation can be characterized along three axes. First, **batch accumulation**: entity records flowing from upstream pipeline stages are buffered until the count reaches `MEMGRAPH_BATCH_SIZE`, at which point a transaction is opened against `GraphDatabaseService` and all buffered upserts are flushed. This implies an internal buffer or queue keyed by — or at minimum aware of — entity type, since the canonical six types (`Project`, `Component`, `SubComponent`, `Pattern`, `Detail`, `System`) may require distinct upsert templates.

Second, **upsert resolution**: each entity must be matched against existing graph state by some stable identifier before being written, in order to preserve idempotency across repeated runs. This is typically realized in Memgraph via Cypher `MERGE` clauses keyed on a unique property per entity type, combined with `ON CREATE SET` and `ON MATCH SET` branches to apply both create-time and update-time properties.

Third, **transactional scope**: by grouping multiple entity upserts into a single transaction, the writer reduces network round-trips and commit overhead against Memgraph. The trade-off, made explicit by the `MEMGRAPH_BATCH_SIZE` knob, is that a transaction failure rolls back the entire batch — so the configured size implicitly defines the unit of write atomicity.

## Integration Points

BatchGraphWriter integrates upward with its parent `OnlineLearning`, which provides the batch analysis pipeline that ingests git history, LSL sessions, and code analysis outputs and maps findings into the canonical typed entity set. BatchGraphWriter consumes those mapped entities as its input contract, meaning any change to the canonical entity schema in `OnlineLearning` propagates directly into the writer's upsert logic.

Downstream, it integrates with `GraphDatabaseService`, the Memgraph instance documented through `integrations/code-graph-rag/README.md`. This is not merely a storage dependency: the graph populated by BatchGraphWriter is the substrate for the Graph-Code RAG system's retrieval <USER_ID_REDACTED>, so the writer's correctness contract extends into retrieval semantics. Mis-typed nodes, duplicate entities, or missing edges manifest as degraded RAG answer <USER_ID_REDACTED> rather than as visible storage errors.

Configuration-wise, the principal integration surface is `MEMGRAPH_BATCH_SIZE`, identified as a key documented component of the project. This single environment-level setting couples the writer to its operational profile and is the primary lever for tuning the pipeline against the capacity and latency characteristics of the target Memgraph deployment.

## Usage Guidelines

When operating BatchGraphWriter, tune `MEMGRAPH_BATCH_SIZE` deliberately. Higher values favor throughput and are appropriate for bulk ingestion of large codebases or backfill runs against `GraphDatabaseService`; lower values favor safety and finer-grained recovery, which is preferable in incremental or production-style update flows where a failed batch should not invalidate hours of analysis work. The setting is a runtime knob, so it can be adjusted per environment without code changes.

Treat repeated pipeline executions as **expected and safe**. Because BatchGraphWriter is designed for idempotent writes across all six canonical entity types, developers should not implement external deduplication layers or "clear-then-rewrite" workflows above it. Re-running the `OnlineLearning` pipeline over an unchanged codebase should produce a stable graph; re-running it over an evolved codebase should yield incremental updates rather than parallel duplicate substructures.

When extending the canonical entity set or modifying entity schemas at the `OnlineLearning` level, ensure BatchGraphWriter's upsert logic is updated in lockstep. A new entity type added upstream without a corresponding upsert path here will either silently drop data or break batch transactions. Similarly, identifier-property changes must be coordinated with the writer's `MERGE` keys, since the idempotency contract depends entirely on stable identification of existing nodes.

Finally, remember that this writer is the **only** documented path into the RAG-facing graph. Bypassing it — for instance, writing directly to Memgraph from ad-hoc scripts — will produce graph state that does not honor the canonical typing contract enforced by `OnlineLearning`, degrading the retrieval <USER_ID_REDACTED> of the Graph-Code RAG system that consumes it.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- The batch analysis pipeline ingests git history, LSL sessions, and code analysis outputs, mapping findings to the canonical typed entity set (Project, Component, SubComponent, Pattern, Detail, System) before writing to GraphDatabaseService


---

*Generated from 3 observations*

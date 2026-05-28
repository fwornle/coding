# ManualLearning

**Type:** SubComponent

Manual edits write directly to the Graphology in-memory graph via GraphDatabaseService.js, setting the isDirty flag but not automatically triggering _persistGraphToLevel(), meaning unsaved manual edits are at risk of loss if flush is not explicitly called

# ManualLearning — Technical Insight Document

## What It Is

ManualLearning is a SubComponent of KnowledgeManagement responsible for human-authored contributions to the knowledge graph. Unlike its sibling OnlineLearning, which feeds the graph through automated extraction pipelines, ManualLearning represents the code paths by which developers or end users directly write entities and relationships into the Graphology in-memory graph managed by `GraphDatabaseService.js`. There are no dedicated source files isolated to ManualLearning — it operates as a logical concern layered over the same `GraphDatabaseService.js` infrastructure that automated writes use, meaning manual edits share every constraint and behavior of that underlying service.

![ManualLearning — Architecture](images/manual-learning-architecture.png)

## Architecture and Design

The central architectural reality of ManualLearning is that it has no privileged write path. Human-authored nodes and edges enter the graph through the same single-key LevelDB blob as automated data, stored under the key `'graph'` in `GraphDatabaseService.js`. There is no separate namespace, partition, or secondary store for manually curated content. This means provenance — whether an entity was hand-authored or machine-extracted — is not structurally enforced by the persistence layer itself; any such distinction must be carried in the entity's own metadata if the calling code chooses to record it.

![ManualLearning — Relationship](images/manual-learning-relationship.png)

The design follows the same deferred-write pattern that governs all mutations in the system: a manual edit sets the `isDirty` flag to `true` via the `IsDirtyFlagMutation` child concern, but `_persistGraphToLevel()` is not automatically invoked. This is the single most consequential design decision for ManualLearning — it means a human curator can author a node, believe it to be saved, and lose that work silently if the process exits before an explicit flush is triggered. The pattern is documented more fully in the parent KnowledgeManagement context and in GraphDatabaseService, but its impact falls most heavily on manual edits because automated pipelines are typically architected to batch and flush predictably, whereas ad-hoc human edits may not be.

## Implementation Details

Because the entire graph is serialized as one JSON blob, every manual edit — no matter how small — requires a full deserialize/mutate/reserialize cycle. There is no mechanism for atomic partial updates to a single node or edge. This is an inherent consequence of the single-key LevelDB strategy in `GraphDatabaseService.js` and applies equally to OnlineLearning writes, but it creates a particular cost for interactive manual workflows where a user might expect lightweight, incremental saves.

The `IsDirtyFlagMutation` child component encapsulates the state transition that marks the in-memory graph as modified. Any manual write operation routes through this mechanism, setting `isDirty = true` on the GraphDatabaseService instance. The flag gates whether `_persistGraphToLevel()` will serialize and write the blob on the next flush cycle. Developers working on ManualLearning code paths must treat this flag as a necessary but insufficient condition for durability — the flag being set guarantees only that the next explicit flush will include the change, not that the change will survive without one.

Schema conformance is another implementation concern. KmCoreStore establishes the canonical format for all graph entities — UUIDv7 identifiers, ontology classification — and manually authored entities are expected to meet this contract. However, `GraphDatabaseService.js` does not enforce this at a schema gate. Validation is entirely the responsibility of the calling code in the ManualLearning path. A manually authored node that omits a UUIDv7 ID or lacks ontology classification will be accepted into the blob without complaint, potentially corrupting downstream consumers that assume canonical format.

## Integration Points

ManualLearning sits at the intersection of two sibling concerns: GraphDatabaseService, which owns the persistence mechanics, and KmCoreStore, which owns the canonical entity schema. Every manual write must satisfy both — routed correctly through `GraphDatabaseService.js` to land in the graph, and formatted correctly per KmCoreStore's UUIDv7 and ontology conventions to be interpretable by the rest of the system. The absence of a shared schema enforcement layer between these siblings is a notable integration gap.

The relationship with OnlineLearning is purely structural rather than functional — both write to the same graph blob with no coordination mechanism between them. A manual edit and an automated extraction could theoretically overwrite each other's in-memory state if both are in-flight before a flush, though the specifics of that concurrency risk depend on the runtime environment.

## Usage Guidelines

**Always trigger an explicit flush after manual writes.** The `isDirty` deferred-write pattern means that calling any manual edit method and returning without triggering `_persistGraphToLevel()` leaves changes exclusively in memory. Any process restart, crash, or unhandled exception between the write and the flush will silently discard the manual curation. Developers must not assume write-through persistence.

**Conform to KmCoreStore canonical format at the call site.** Because `GraphDatabaseService.js` applies no schema validation, the burden of generating correct UUIDv7 identifiers and proper ontology classification falls on whichever code constructs the manually authored entity before passing it to the graph. Establishing a factory or validation helper at the ManualLearning boundary — rather than trusting each call site independently — would reduce the risk of non-canonical entities entering the blob.

**Treat the graph blob as a single critical resource.** Because the entire graph serializes as one JSON structure, manual edits should be considered high-impact operations. There is no partial rollback, no atomic per-node write, and no way to read or update a manually authored entity without touching the full graph. In workflows with high edit frequency or large graph sizes, this has meaningful performance and reliability implications that should be factored into any tooling built on top of ManualLearning.

**Record provenance explicitly in entity metadata.** Since the persistence layer applies no structural separation between manual and automated entities, any system behavior that needs to distinguish human-authored content from machine-extracted content must rely on metadata fields set by the calling code. Establishing a convention for a provenance field on manual nodes — and enforcing it at the ManualLearning call boundary — is advisable given the shared blob architecture.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The primary persistence mechanism in KnowledgeManagement is a single-key LevelDB strategy implemented in `src/knowledge-management/GraphDatabaseService.js`. Rather than storing each graph entity as a separate LevelDB key (which would enable partial reads and atomic per-entity updates), the entire Graphology in-memory graph is serialized as one JSON blob stored under the key `'graph'`. This blob contains all nodes, edges, and metadata. Writes are deferred using an `isDirty` flag — mutations to the graph set `isDirty = true`, and `_persistGraphToLevel()` is only called when a flush is explicitly triggered. This design optimizes for read-heavy, batch-write workloads but creates a risk of data loss if the process crashes between mutations and the next flush. New developers should be aware that any code path that modifies graph nodes or edges must ensure the flush cycle is triggered, or changes will silently remain only in memory.

### Children
- [IsDirtyFlagMutation](./IsDirtyFlagMutation.md) -- Based on parent context, GraphDatabaseService.js is the central service through which manual graph mutations are routed, setting isDirty to true on any write operation.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- Automated extraction pipelines write nodes and edges into the Graphology graph managed by GraphDatabaseService.js, relying on the isDirty/flush cycle for durability rather than per-write persistence
- [KmCoreStore](./KmCoreStore.md) -- All entities in the graph blob stored by GraphDatabaseService.js are expected to carry UUIDv7 identifiers, providing time-ordered, globally unique keys without a central ID authority
- [GraphDatabaseService](./GraphDatabaseService.md) -- GraphDatabaseService.js implements a single-key LevelDB strategy storing the entire Graphology graph as one JSON blob under key 'graph', trading partial-read capability for simplicity


---

*Generated from 5 observations*

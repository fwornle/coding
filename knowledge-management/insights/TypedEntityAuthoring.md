# TypedEntityAuthoring

**Type:** Detail

Manual entities share the same ontology classification fields as automated entities (per the SubComponent description), meaning TypedEntityAuthoring must populate fields like type, hierarchy level, and classification metadata even for human-authored nodes — enforcing parity between automated and manual knowledge ingestion.

# TypedEntityAuthoring — Technical Insight Document

## What It Is

TypedEntityAuthoring is a sub-component of the **ManualLearning** subsystem responsible for the creation of human-authored knowledge nodes that conform to the project's fixed entity ontology. It enforces that manually created entities are not freeform text fragments but rather first-class, typed graph nodes indistinguishable in shape from those produced by automated ingestion pipelines.

The component operates against the same persistence target as its parent, ManualLearning — namely a **GraphDatabaseService**-backed graph store, with a **LevelDB** fallback path inherited from the parent's resilience model. While the observations do not reference specific source files for this Detail-level component, its responsibilities are scoped to the authoring boundary: accepting user-supplied content and emitting validated, fully-classified node records into the persistence layer.

In the broader ManualLearning architecture, TypedEntityAuthoring is the entity-side counterpart to its sibling **EmbeddingLinkedObservationRecord**, which handles the observation-record side of manual knowledge ingestion. Together these two sub-components cover the two halves of manual contribution: typed nodes (TypedEntityAuthoring) and the observation records attached to them (EmbeddingLinkedObservationRecord).

## Architecture and Design

The dominant architectural pattern is **schema-enforced ontology authoring**. The system supports exactly six node types — `Project`, `Component`, `SubComponent`, `Pattern`, `Detail`, and `System` — and TypedEntityAuthoring must reject or constrain inputs that fall outside this enumeration. This is a closed-world type system: developers cannot extend the type set at authoring time, ensuring the graph's structural invariants hold across both manual and automated insertion paths.

A second key pattern is **persistence abstraction with transparent failover**. Because the parent ManualLearning entity describes GraphDatabaseService as the primary backend with a LevelDB fallback, TypedEntityAuthoring's write path must operate against an abstract storage interface rather than a concrete driver. The caller of the authoring API does not — and should not — observe which backend is active; resilience logic swaps persistence layers underneath without altering the authoring contract.

The third design principle, made explicit in the observations, is **parity between automated and manual ingestion**. Manual entities share the same ontology classification fields (type, hierarchy level, classification metadata) as automated entities. This means TypedEntityAuthoring cannot take a shortcut by producing thinner records; it must populate the full classification surface so downstream consumers — graph traversal, retrieval, ranking — cannot tell the provenance of a node from its shape alone.

## Implementation Details

TypedEntityAuthoring's implementation centers on three responsibilities: **type validation**, **classification field population**, and **persistence delegation**. Type validation gates the input against the fixed enum of six supported node types. Any attempt to author with a value outside `{Project, Component, SubComponent, Pattern, Detail, System}` must be rejected before reaching the storage layer; this preserves the closed ontology that the rest of the system relies on for type-driven <USER_ID_REDACTED> and rendering.

Classification field population is where TypedEntityAuthoring earns the "Typed" in its name. Each emitted node must carry the same metadata that automated pipelines produce — minimally the node type, hierarchy level (Project > Component > SubComponent > Detail, etc.), and any classification metadata that the ontology layer expects. The component is effectively a constructor for a normalized node record, not a passthrough for arbitrary user JSON.

Persistence delegation hands the validated, classified record to GraphDatabaseService. The fallback behavior to LevelDB, inherited from ManualLearning, suggests the implementation either composes against a service-locator-style abstraction or wraps GraphDatabaseService calls in try/fallback logic. Either way, the caller of TypedEntityAuthoring should not need awareness of the active backend.

Because the code structure section reports zero discovered code symbols and no key files, the precise class and function names are not enumerated in the observations. This Detail entity is best understood as a **role and contract** within ManualLearning rather than as a specific file — its responsibilities are well-defined even where its symbol surface is not yet indexed.

## Integration Points

The primary downstream integration is **GraphDatabaseService**, which receives the typed node records produced by this component. This is a hard dependency: TypedEntityAuthoring exists to feed the graph store. The secondary downstream integration is **LevelDB**, engaged only via the parent ManualLearning resilience path when GraphDatabaseService is unavailable.

The horizontal integration is with the sibling **EmbeddingLinkedObservationRecord**. Where TypedEntityAuthoring produces nodes, EmbeddingLinkedObservationRecord produces observation records that attach to those nodes and additionally carry ontology classification plus embedding vectors for the project's vector-search retrieval infrastructure. In practice a manual learning operation will often invoke both: create or look up a typed entity via TypedEntityAuthoring, then attach observations to it via EmbeddingLinkedObservationRecord.

The upward integration is with the **ManualLearning** parent, which orchestrates the manual ingestion workflow and owns the resilience and persistence configuration that TypedEntityAuthoring inherits. ManualLearning likely composes TypedEntityAuthoring and EmbeddingLinkedObservationRecord into a unified manual-learning API exposed to higher layers of the application.

Implicit integration also exists with whatever ontology-classification subsystem defines the six node types and their associated metadata schemas. Since manual entities must match automated entities field-for-field, any change to the automated classification fields must propagate here as well.

## Usage Guidelines

**Always use one of the six supported types.** When authoring an entity through this component, the `type` field must be exactly `Project`, `Component`, `SubComponent`, `Pattern`, `Detail`, or `System`. Do not invent intermediate types; if the conceptual fit is poor, choose the closest match within the existing ontology or escalate to a schema change rather than working around the enum.

**Populate the full classification surface.** Do not treat manual authoring as a lightweight path. Because downstream consumers assume parity with automated entities, omitting hierarchy level or classification metadata creates silent inconsistencies in the graph. Treat TypedEntityAuthoring's input contract as identical in completeness to the automated ingestion pipeline's output.

**Do not bypass to GraphDatabaseService directly.** The fallback-to-LevelDB resilience and the field validation logic live in this authoring layer. Direct writes to GraphDatabaseService skip both, risking malformed nodes and failed writes when the primary store is unavailable.

**Pair authoring with observations deliberately.** When a manual contribution includes both a new node and supporting observations, route the node through TypedEntityAuthoring and the observations through the sibling EmbeddingLinkedObservationRecord. Keeping these responsibilities separate preserves the architectural distinction between typed nodes and the embedding-linked observation records that hang off them.

**Treat the component as the canonical manual-node constructor.** Any tooling, CLI, or UI surface that creates entities by hand should funnel through TypedEntityAuthoring rather than reimplementing type validation and classification population. Centralizing this logic is what allows ManualLearning to guarantee that manual and automated knowledge are interchangeable from the graph's perspective.

---

### Summary of Architectural Assessment

- **Architectural patterns identified:** schema-enforced closed ontology, persistence abstraction with transparent failover, automated/manual ingestion parity, separation of node authoring from observation authoring (TypedEntityAuthoring vs. EmbeddingLinkedObservationRecord).
- **Design decisions and trade-offs:** Fixing the type set to six values trades extensibility for query and rendering simplicity; requiring full classification metadata on manual inputs trades author convenience for downstream uniformity; routing through an abstraction layer trades a small indirection cost for backend resilience.
- **System structure insights:** TypedEntityAuthoring is one of two peer sub-components under ManualLearning, dedicated to nodes while EmbeddingLinkedObservationRecord handles observations; both ultimately write into the GraphDatabaseService-backed graph.
- **Scalability considerations:** As a thin authoring/validation layer, scalability is bounded by GraphDatabaseService throughput rather than by TypedEntityAuthoring itself; the LevelDB fallback provides degraded-mode availability rather than horizontal scale.
- **Maintainability assessment:** The component's contract is clear and narrow, which aids maintainability, but its correctness is coupled to the ontology schema — changes to the six-type enum or classification fields must be reflected here in lockstep with the automated ingestion path.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are stored as typed nodes (Project, Component, SubComponent, Pattern, Detail, System) in the GraphDatabaseService-backed graph, using the same ontology classification fields as automated entities

### Siblings
- [EmbeddingLinkedObservationRecord](./EmbeddingLinkedObservationRecord.md) -- The SubComponent description specifies 'ontology classification and embedding vector assignment' as explicit fields on hand-crafted observation records, distinguishing ObservationCuration from simple text annotation and coupling it to the project's vector-search retrieval infrastructure.


---

*Generated from 3 observations*

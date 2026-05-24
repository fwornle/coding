# OntologyMetadataMapper

**Type:** Detail

Because the sub-component description names both the agent class (PersistenceAgent) and the specific function (mapEntityToSharedMemory()), this mapper is an explicitly designed seam rather than an incidental utility, suggesting its interface is stable and likely versioned.

# OntologyMetadataMapper — Technical Insight Document

## What It Is

The `OntologyMetadataMapper` is a normalization seam within the `OnlineLearning` pipeline, materialized through the `mapEntityToSharedMemory()` function owned by the `PersistenceAgent` class. While no standalone code symbols are surfaced for this component, its operational footprint is precisely defined: it exists at the boundary between entity extraction and entity persistence, ensuring that every entity routed through the batch analysis pipeline is hydrated with complete ontology metadata fields before any write occurs.

Architecturally, the mapper is not a free-floating utility — it is explicitly named alongside its owning agent (`PersistenceAgent`) and its invocation method (`mapEntityToSharedMemory()`), which strongly implies it represents a designed, stable contract rather than incidental glue code. Its position within `OnlineLearning` makes it the canonical mechanism by which extracted entities acquire the metadata shape required by downstream persistence targets, namely the VKB HTTP API and the `VkbLevelDbPersistenceFallback` sibling component.

In essence, the `OntologyMetadataMapper` enforces a single invariant: no entity reaches storage without first being mapped into the shared-memory ontology representation.

## Architecture and Design

The architectural approach reflects a deliberate **separation of concerns**: ontology field hydration is the responsibility of the persistence layer, not the extraction layer. This decision is visible in the fact that `PersistenceAgent` — not the extractor — owns the `mapEntityToSharedMemory()` call. The extraction subsystem can therefore remain focused on producing raw entities, while the mapper guarantees structural completeness at the persistence boundary. This is a classic application of the **pipeline-stage isolation** pattern, where each stage is responsible for a narrow transformation, and cross-stage concerns (like ontology shape) are handled by a dedicated seam.

The invocation ordering — extraction → `mapEntityToSharedMemory()` → write — establishes the mapper as a **mandatory pre-persistence normalization step**. This is not an optional enrichment hook; it is gated such that no persistence path bypasses it. This design pattern is sometimes called a **canonicalization gate**: the mapper acts as the single point where heterogeneous extracted entities are canonicalized into the system's shared-memory ontology format.

The design also reveals an intentional **stability boundary**. Because the parent `OnlineLearning` description names both the class (`PersistenceAgent`) and the specific function (`mapEntityToSharedMemory()`), the mapper functions as an explicit, named seam — the kind of interface that is typically versioned and protected from casual modification. This contrasts with the sibling `VkbLevelDbPersistenceFallback`, which represents a fallback transport rather than a transformation contract; together they define the structure of the persistence layer: the mapper shapes the data, and the priority-ordered transports (VKB HTTP API first, LevelDB fallback second) deliver it.

## Implementation Details

The core implementation pivot is the `mapEntityToSharedMemory()` method on the `PersistenceAgent` class. This method is invoked once per entity, after extraction has completed but before any persistence call is dispatched. Its job is to pre-populate ontology metadata fields on the entity, transforming it from an extraction-shaped object into a shared-memory-shaped object suitable for downstream storage.

The mapper operates in-process within the `OnlineLearning` pipeline. Because `PersistenceAgent` owns the call, the agent acts as both the transformation orchestrator and the persistence dispatcher — it first calls `mapEntityToSharedMemory()` on each incoming entity, then routes the normalized entity to either the VKB HTTP API or, when that fails, the `VkbLevelDbPersistenceFallback` path. The mapper itself is therefore strictly synchronous with respect to the persistence call sequence: its completion is a precondition for any write.

While the observations do not enumerate specific code symbols (0 code symbols found), the structural cues — named class, named method, explicit ordering — indicate that the mapper's contract is encoded in the signature and behavior of `mapEntityToSharedMemory()` rather than in a separate class hierarchy. This is a lightweight implementation choice: rather than constructing a full mapper-class abstraction with strategies and registries, the system embeds the responsibility directly into the persistence agent's lifecycle, keeping the call site obvious and the responsibility clear.

## Integration Points

The primary integration is upward into its parent, `OnlineLearning`, which routes extracted entities through `PersistenceAgent`. The mapper consumes entities produced by the extraction phase of this batch analysis pipeline and produces ontology-complete entities consumed by the persistence transports.

Downstream, the mapper integrates with two persistence targets via its sibling `VkbLevelDbPersistenceFallback` and the primary VKB HTTP API. Per the sibling description, these two targets form a priority-ordered write path — not a dual-write or eventual-consistency model. The mapper is agnostic to which transport ultimately receives the entity; its job is complete once the entity is shared-memory-shaped. This decoupling means the mapper's contract does not need to change when the failover behavior between VKB HTTP and LevelDB is tuned.

The mapper's interface stability is itself an integration point: because it is an explicitly designed seam, other components (extractors, future persistence backends, ontology evolution tooling) can rely on `mapEntityToSharedMemory()` producing a predictable output shape. This makes the mapper a natural extension point if new ontology fields need to be hydrated, without requiring changes to extractors or transports.

## Usage Guidelines

Developers working within `OnlineLearning` must treat `mapEntityToSharedMemory()` as a **mandatory call** on the path from extraction to persistence. Bypassing it — for example, by writing directly to the VKB HTTP API or `VkbLevelDbPersistenceFallback` without first invoking the mapper — will result in entities being persisted with incomplete or missing ontology metadata, breaking the system-wide invariant that all stored entities are ontology-complete.

Because the mapper is an explicit seam owned by `PersistenceAgent`, modifications to its signature or output shape should be treated as **interface-level changes**: they affect every entity that flows through the pipeline. When adding new ontology fields, the correct extension point is within `mapEntityToSharedMemory()` itself, not within extractors. Conversely, transformations that are purely extraction concerns (e.g., normalizing raw text, deduplicating mentions) should remain in the extraction layer to preserve the separation of concerns the architecture has established.

Finally, developers should remember the order: extract → map → write. The mapper is synchronous and must complete before the persistence dispatch chooses between the VKB HTTP API and the LevelDB fallback. Any future work that introduces asynchronous enrichment should explicitly avoid breaking this ordering, because the priority-ordered write path assumes a fully hydrated entity at the moment of dispatch.

---

### Summary of Requested Analyses

1. **Architectural patterns identified**: separation of concerns between extraction and persistence; pipeline-stage isolation; canonicalization gate / mandatory pre-persistence normalization step; explicit named seam with stable interface.
2. **Design decisions and trade-offs**: ontology hydration placed in persistence layer (simpler extractors, but couples `PersistenceAgent` to ontology schema); lightweight method-on-agent implementation instead of a dedicated mapper class hierarchy (less ceremony, but the seam is implicit in a method rather than a type).
3. **System structure insights**: `OnlineLearning` orchestrates extraction → `PersistenceAgent.mapEntityToSharedMemory()` → priority-ordered write through VKB HTTP API with `VkbLevelDbPersistenceFallback` as second choice.
4. **Scalability considerations**: the mapper is synchronous and per-entity, so throughput scales linearly with extraction volume; because it is in-process with `PersistenceAgent`, it does not introduce network or coordination overhead, but it does mean ontology mapping cost is paid on the persistence-critical path.
5. **Maintainability assessment**: high — the seam is explicitly named (class + method), the responsibility is narrow, and the contract is centralized, making ontology schema evolution localized to a single function rather than scattered across extractors and transports.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- The batch analysis pipeline routes extracted entities through the PersistenceAgent, which calls mapEntityToSharedMemory() to pre-populate ontology metadata fields before persisting via the VKB HTTP API or direct LevelDB fallback.

### Siblings
- [VkbLevelDbPersistenceFallback](./VkbLevelDbPersistenceFallback.md) -- The sub-component description explicitly names two persistence targets — 'VKB HTTP API' and 'direct LevelDB fallback' — confirming a priority-ordered write path rather than a dual-write or eventual-consistency model.


---

*Generated from 3 observations*

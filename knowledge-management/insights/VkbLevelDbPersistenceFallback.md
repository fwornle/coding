# VkbLevelDbPersistenceFallback

**Type:** Detail

This fallback pattern, as described in the OnlineLearning sub-component, means the batch analysis pipeline can complete a full run without blocking on API availability, deferring reconciliation or re-hydration to a later sync cycle.

# VkbLevelDbPersistenceFallback

## What It Is

VkbLevelDbPersistenceFallback is a Detail-level sub-component of the OnlineLearning batch analysis pipeline that defines the persistence resilience strategy for extracted entities. It is not a standalone module but rather a documented behavior pattern realized within the PersistenceAgent, which owns the entity persistence flow in OnlineLearning. The fallback specifically pairs two persistence targets — the **VKB HTTP API** as the primary write destination and a **direct LevelDB** write path as the local fallback — establishing a priority-ordered write strategy rather than a dual-write or eventual-consistency arrangement.

The component's purpose is to guarantee that entities produced by the batch analysis pipeline are durably persisted even when the remote VKB HTTP API is unavailable. Because LevelDB is embedded or locally accessible to the PersistenceAgent, the agent can bypass the HTTP layer entirely and write directly to disk, preserving data through extended API outages. This makes the persistence layer fault-tolerant at the boundary of network-dependent infrastructure.

## Architecture and Design

The architectural pattern at work is a **primary/fallback (failover) write strategy** layered into a single persistence responsibility. Rather than attempting simultaneous writes to two stores (dual-write) or relying on an asynchronous queue with eventual consistency, the design enforces a deterministic priority order: the VKB HTTP API is attempted first, and LevelDB is engaged only when the API path cannot complete. This keeps the consistency model simple — there is one authoritative write per entity at any moment — while still preventing data loss.

This design decision aligns with the broader separation of concerns visible in the OnlineLearning hierarchy. The sibling component **OntologyMetadataMapper** documents that ontology field hydration (via `mapEntityToSharedMemory()`) is the responsibility of the PersistenceAgent rather than the extraction layer. VkbLevelDbPersistenceFallback extends this same philosophy: persistence-related concerns — including failure handling, transport selection, and durability guarantees — are concentrated inside the PersistenceAgent and kept out of upstream extraction logic. The batch analysis pipeline does not need to reason about whether the VKB API is reachable; it simply hands entities to the PersistenceAgent and trusts the agent to durably persist them.

The trade-off here is explicit: by deferring reconciliation rather than enforcing it at write time, the system gains availability (the pipeline never blocks on API outages) at the cost of needing a later sync cycle to re-hydrate locally fallback-written entities back into VKB. This is a classic availability-over-immediate-consistency choice appropriate for batch analysis workloads where pipeline completion is more valuable than real-time API parity.

## Implementation Details

The mechanics, as evidenced by the parent OnlineLearning description, flow as follows: the batch analysis pipeline routes extracted entities through the PersistenceAgent. The agent first invokes `mapEntityToSharedMemory()` to pre-populate ontology metadata fields — this is the OntologyMetadataMapper responsibility — and then attempts persistence via the VKB HTTP API. If the API path is unavailable or fails, the agent falls back to a direct LevelDB write.

Because LevelDB is embedded or locally accessible, the fallback write does not depend on any remote infrastructure. This means the PersistenceAgent can hold disk-level durability guarantees without needing network connectivity, message brokers, or intermediate buffers. The fallback path is synchronous and local, which keeps the failure-handling code path simple and predictable.

No code symbols or specific file paths were surfaced in the observations for this sub-component, suggesting the fallback logic is currently documented as a behavior pattern of the PersistenceAgent rather than encapsulated in a dedicated class or module. Future implementation work would likely formalize this into a strategy or transport abstraction inside the PersistenceAgent.

## Integration Points

VkbLevelDbPersistenceFallback integrates with three principal collaborators:

1. **PersistenceAgent** — the owning component that executes the fallback logic. The agent is the single point where the VKB HTTP API call and the LevelDB write are coordinated.
2. **OntologyMetadataMapper** (sibling) — runs the `mapEntityToSharedMemory()` step that prepares entities before either persistence target is invoked. Both the primary and fallback writes therefore persist entities in the same hydrated form.
3. **OnlineLearning** (parent) — the batch analysis pipeline that routes extracted entities into the PersistenceAgent. The pipeline benefits from the fallback by being able to complete runs end-to-end without API availability dependencies.

Externally, the component depends on the VKB HTTP API as the canonical store and on a local LevelDB instance as the durable fallback. A downstream concern — not implemented inline but implied — is a reconciliation or re-hydration sync cycle that moves locally fallback-persisted entities back into VKB once the API is reachable again.

## Usage Guidelines

Developers working with this component should treat the VKB HTTP API as the authoritative store and LevelDB strictly as a durability safety net. The fallback should never be used as a primary write target by convention, and any direct LevelDB writes from outside the PersistenceAgent would violate the separation of concerns this design establishes — all persistence logic, including transport selection, belongs inside the agent.

When extending the batch analysis pipeline, do not add availability checks or retry loops upstream of the PersistenceAgent. The fallback pattern explicitly exists so that the pipeline can run to completion without blocking; introducing upstream availability checks would defeat that property and re-couple extraction to API health.

Finally, any consumer relying on VKB as the source of truth must account for the possibility that recently processed entities may live only in the local LevelDB fallback until a reconciliation cycle completes. Read paths and consistency-sensitive operations should be designed with this deferred-sync window in mind, especially during or shortly after periods of API unavailability.

---

### Summary of Key Insights

1. **Architectural pattern**: Priority-ordered primary/fallback (failover) persistence — not dual-write, not eventual-consistency-by-queue.
2. **Design decision**: Concentrate transport selection and durability handling inside PersistenceAgent, consistent with the sibling OntologyMetadataMapper's separation of concerns.
3. **Trade-off**: Availability and pipeline completion are prioritized over immediate VKB consistency, requiring a deferred reconciliation cycle.
4. **System structure**: A single persistence touchpoint (PersistenceAgent) within the OnlineLearning pipeline, fronting two storage targets.
5. **Scalability**: The local LevelDB path scales with disk rather than network capacity, removing API throughput as a pipeline bottleneck during outages; however, reconciliation throughput becomes a future scaling consideration.
6. **Maintainability**: Currently documented as a behavior pattern rather than a discrete code module (zero code symbols surfaced). Formalizing the fallback into an explicit strategy/transport abstraction inside the PersistenceAgent would improve testability and make the failover policy easier to evolve.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- The batch analysis pipeline routes extracted entities through the PersistenceAgent, which calls mapEntityToSharedMemory() to pre-populate ontology metadata fields before persisting via the VKB HTTP API or direct LevelDB fallback.

### Siblings
- [OntologyMetadataMapper](./OntologyMetadataMapper.md) -- PersistenceAgent (referenced in the OnlineLearning sub-component description) owns the mapEntityToSharedMemory() call, meaning ontology field hydration is a responsibility of the persistence layer, not the extraction layer — a deliberate separation of concerns.


---

*Generated from 3 observations*

# KnowledgeDecayTracker

**Type:** SubComponent

The migration tooling referenced in the parent description implies KnowledgeDecayTracker performs bulk provenance re-stamping when moving legacy LevelDB entities to GraphKMStore, normalizing timestamps that may have been absent in the source store

# KnowledgeDecayTracker — Technical Insight Document

## What It Is

KnowledgeDecayTracker is a SubComponent of KnowledgeManagement responsible for the temporal lifecycle of knowledge entities within the Graphology-backed graph store. It operates as the system's primary mechanism for expressing that knowledge has an expiration — not by destroying records, but by stamping each entity with `validFrom` and `validUntil` fields that define a validity window. This soft-expiry model allows the graph to retain a historical record of what was known and when, while ensuring that stale knowledge is invisible to live <USER_ID_REDACTED>.

The component sits at a cross-cutting position within KnowledgeManagement: it is invoked on both the write path (when entities are created or migrated) and the read path (where expired nodes must be excluded from query results). Its child component, ValidityWindowEnforcer, carries the read-path responsibility, checking `validFrom`/`validUntil` at query time rather than eagerly pruning the graph. The broader architectural mandate for this lifecycle-first approach is documented in `docs/architecture/memory-systems.md`, which identifies lifecycle management as a first-class concern of the knowledge graph.

![KnowledgeDecayTracker — Relationship](images/knowledge-decay-tracker-relationship.png)

## Architecture and Design

The central design decision behind KnowledgeDecayTracker is **soft deletion via temporal bounding** rather than physical removal. Every entity in the graph carries a `validFrom`/`validUntil` pair, turning the graph into a bitemporal store where the question "is this knowledge current?" is answered by a range check, not by the presence or absence of a node. This eliminates the risk of cascading deletes breaking graph topology and preserves an audit trail of knowledge provenance over time.

A second significant design decision is the separation of **write-time stamping** from **read-time enforcement**. KnowledgeDecayTracker handles stamping (setting `validFrom`, and potentially `validUntil` based on decay policy) at entity creation, while ValidityWindowEnforcer handles filtering at query time. This separation keeps each concern isolated: decay policy logic does not need to be embedded in query infrastructure, and query infrastructure does not need to understand policy rules.

![KnowledgeDecayTracker — Architecture](images/knowledge-decay-tracker-architecture.png)

The architecture also expresses a deliberate **provenance-aware decay model**. Because both ManualLearning and OnlineLearning entities pass through KnowledgeDecayTracker, the component can apply different decay rates depending on how an entity entered the graph. Human-curated ManualLearning facts — which carry provenance metadata distinguishing them from pipeline-generated knowledge — can be assigned longer validity windows, reflecting the higher confidence and deliberate intent behind them. Automatically extracted OnlineLearning entities (sourced from git history, LSL sessions, and code analysis per `docs/architecture/memory-systems.md`) may decay faster, acknowledging that automatically inferred knowledge is more likely to become stale. This policy differentiation is a direct consequence of ManualLearning's design guarantee that hand-curated facts are not overwritten by pipeline observations.

## Implementation Details

At the entity level, KnowledgeDecayTracker stamps two metadata fields onto each graph node: `validFrom`, representing the moment the entity's knowledge claim became authoritative, and `validUntil`, representing when that claim should be considered expired. These fields are attached within the Graphology in-memory graph, meaning they are stored as node attributes alongside the entity's typed data (System, Project, Pattern, and similar types used by KnowledgeManagement).

The child component ValidityWindowEnforcer operationalizes the `validUntil` field at query time. Rather than eagerly removing expired nodes from the graph, it intercepts read operations and excludes any node whose validity window does not cover the current timestamp. This lazy enforcement strategy is well-suited to the Graphology in-memory model: the graph remains structurally intact, relationships are never orphaned by expiry, and historical <USER_ID_REDACTED> (asking what was known at a past point in time) remain possible by adjusting the reference timestamp passed to ValidityWindowEnforcer.

The **provenance re-stamping** behavior during migration deserves specific attention. When legacy entities are moved from the LevelDB-backed GraphDatabaseService to GraphKMStore, KnowledgeDecayTracker performs bulk re-stamping to normalize timestamps that may have been absent or inconsistently formatted in the source store. This is a non-trivial operation: GraphKMStore uses UUIDv7 time-ordered entity IDs (unlike the legacy IDs used by GraphDatabaseService), so migration involves not only ID translation but also the establishment of canonical `validFrom` values that correctly represent when each entity's knowledge was originally recorded. The result is an audit trail — provenance metadata on every entity — that makes the canonical store queryable for both current and historical knowledge states.

## Integration Points

KnowledgeDecayTracker integrates with the write path of both ManualLearning and OnlineLearning, acting as a mandatory stamping layer before entities are committed to the graph. This makes it a shared dependency for all knowledge ingestion: neither provenance type bypasses it. The provenance metadata stamped by KnowledgeDecayTracker is the mechanism by which decay policies are later differentiated — the component reads provenance type to select the appropriate validity duration.

On the read side, the integration point is ValidityWindowEnforcer, which must be composed into every query path that should respect temporal validity. Because GraphKMStore is the canonical store, and because it is the target of migration from GraphDatabaseService, ValidityWindowEnforcer's enforcement logic is specifically relevant to GraphKMStore <USER_ID_REDACTED>. <USER_ID_REDACTED> against the legacy store during the migration window may need to handle entities that lack `validUntil` fields until re-stamping is complete.

The migration tooling bridging GraphDatabaseService and GraphKMStore creates a transient integration surface where KnowledgeDecayTracker operates in bulk mode. This is architecturally distinct from its normal per-entity write-path behavior and implies that the component must handle both single-entity stamping and batch re-stamping without violating consistency guarantees on `validFrom` values.

## Usage Guidelines

**Decay policy configuration should be provenance-driven.** When adding new knowledge sources beyond ManualLearning and OnlineLearning, developers must ensure that the new source provides a clear provenance type that KnowledgeDecayTracker can use to select a validity duration. Assigning a default, undifferentiated decay window to all new entity types undermines the system's ability to treat high-confidence knowledge differently from automatically inferred knowledge.

**Do not bypass KnowledgeDecayTracker on the write path.** Since `docs/architecture/memory-systems.md` establishes lifecycle management as a first-class concern, any entity written directly to the Graphology graph without passing through KnowledgeDecayTracker will lack `validFrom`/`validUntil` fields. This creates nodes that ValidityWindowEnforcer cannot reason about, potentially causing them to be incorrectly excluded or incorrectly included in query results depending on how the enforcer handles missing fields.

**During migration, treat re-stamping as a blocking step.** The normalization of timestamps when moving entities from LevelDB to GraphKMStore is not cosmetic — it is what makes the canonical store's temporal <USER_ID_REDACTED> meaningful. Running <USER_ID_REDACTED> against a partially migrated GraphKMStore before re-stamping is complete will yield unreliable results, as some entities will have correct validity windows and others will have legacy or absent timestamps.

**Historical <USER_ID_REDACTED> are a supported use case.** Because ValidityWindowEnforcer checks validity at query time against a reference timestamp (rather than pruning expired nodes), the system supports asking "what did we know at time T?" by parameterizing that timestamp. Developers building query interfaces on top of KnowledgeManagement should expose this capability rather than hardcoding "now" as the only valid reference point.

---

### Key Architectural Patterns and Trade-offs Summary

| Concern | Decision | Trade-off |
|---|---|---|
| Expiry model | Soft deletion via `validFrom`/`validUntil` | Graph grows over time; historical record preserved |
| Enforcement timing | Read-time filtering (ValidityWindowEnforcer) | Expired nodes consume memory; <USER_ID_REDACTED> gain temporal flexibility |
| Policy differentiation | Per-provenance decay rates | Requires provenance metadata on every entity |
| Migration | Bulk re-stamping in KnowledgeDecayTracker | Migration is a blocking dependency for reliable temporal <USER_ID_REDACTED> |
| ID scheme | UUIDv7 in GraphKMStore (inherited context) | Enables chronological ordering without coordination overhead |


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing entity storage, querying, and lifecycle management. It uses a Graphology in-memory graph backed by LevelDB for persistence, storing entities with typed attributes (System, Project, Pattern) and relationships. The system supports multiple knowledge stores: a local LevelDB/Graphology store (GraphDatabaseService) and a canonical km-core shape store (GraphKMStore), with migration tooling to move between them.

### Children
- [ValidityWindowEnforcer](./ValidityWindowEnforcer.md) -- Based on the KnowledgeDecayTracker sub-component description, each entity in the GraphKMStore carries validFrom and validUntil fields that this enforcer checks at query time rather than at write time.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are distinguished from automatically extracted knowledge by provenance metadata, ensuring human-curated facts are not overwritten by pipeline-generated observations during merge operations
- [OnlineLearning](./OnlineLearning.md) -- docs/architecture/memory-systems.md identifies git history, LSL sessions, and code analysis as the three automatic extraction sources feeding OnlineLearning, each producing typed graph entities
- [GraphKMStore](./GraphKMStore.md) -- GraphKMStore uses UUIDv7 entity IDs (time-ordered UUIDs) rather than the legacy IDs used by GraphDatabaseService/LevelDB, enabling chronological ordering and distributed ID generation without coordination


---

*Generated from 5 observations*

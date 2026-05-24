# OnlineLearning

**Type:** SubComponent

The GraphDatabaseAdapter in integrations/mcp-server-semantic-analysis implements a fallback strategy: writes go to the VKB HTTP API when the server is running, or directly to LevelDB otherwise, preventing lock conflicts during batch runs.

# OnlineLearning — Technical Insight Document

## What It Is

OnlineLearning is a SubComponent of the `KnowledgeManagement` parent component, implemented primarily within `integrations/mcp-server-semantic-analysis` — the MCP semantic analysis server that acts as the orchestration layer for automated entity extraction. It is the automated counterpart to its sibling `ManualLearning`: where ManualLearning produces typed nodes through human authoring, OnlineLearning ingests from multiple programmatic sources — git history, LSL sessions, and code analysis — and produces typed nodes that conform to the same `GraphDatabaseService` schema (Graphology+LevelDB) used by manually authored entities.

The sub-component is responsible for the full pipeline that turns raw signals into persisted, semantically enriched knowledge graph nodes. This includes routing extracted entities through a `PersistenceAgent`, hydrating ontology metadata fields, attaching embedding vectors for semantic similarity <USER_ID_REDACTED>, and applying bi-temporal staleness tracking so the broader lifecycle management layer can detect when knowledge needs refreshing. The integration patterns are documented in `agents.md` within the MCP server directory, which describes how the `PersistenceAgent` and `GraphDatabaseAdapter` cooperate.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

## Architecture and Design

The architecture follows a **pipeline-with-fallback** pattern. The batch analysis pipeline ingests from heterogeneous sources, normalizes extracted entities, routes them through a `PersistenceAgent` for metadata enrichment, and finally writes them via the `GraphDatabaseAdapter`. The adapter implements a **priority-ordered write path** rather than a dual-write or eventual-consistency model: writes target the VKB HTTP API when the server is running, and fall back to direct LevelDB access when it is not. This explicit prioritization — surfaced in the child component `VkbLevelDbPersistenceFallback` — is a deliberate design decision that prevents lock conflicts during batch runs, since LevelDB enforces single-process access to its data directory.

A second key architectural decision is the **separation of concerns between extraction and persistence**. The child component `OntologyMetadataMapper` reflects this: the `mapEntityToSharedMemory()` function is owned by the `PersistenceAgent`, not by the extraction logic. Extractors emit raw typed entities; the persistence layer is solely responsible for hydrating ontology fields before write. This keeps source-specific extractors (git history, LSL sessions, code analysis) small and decoupled from the evolving ontology schema.

The third architectural pillar is **schema unification**. By writing into the same `GraphDatabaseService` schema used by `ManualLearning`, OnlineLearning ensures that downstream consumers — <USER_ID_REDACTED>, lifecycle management, semantic similarity searches — can treat automated and manual knowledge homogeneously. The shared entity types (System, Project, Component, SubComponent, Pattern, Detail) come directly from the parent `KnowledgeManagement` ontology.

## Implementation Details

The pipeline begins with source-specific extractors that produce typed entity candidates. These candidates flow into the `PersistenceAgent`, which invokes `mapEntityToSharedMemory()` to pre-populate ontology metadata fields. This call is the canonical entry point for ontology hydration and is owned by the persistence layer rather than any individual extractor. After mapping, the agent hands the enriched entity to the `GraphDatabaseAdapter`.

The `GraphDatabaseAdapter`, located in `integrations/mcp-server-semantic-analysis`, encapsulates the fallback logic. It first attempts to write through the **VKB HTTP API**; if the VKB server process is not running, it opens LevelDB directly. This is a runtime-detected fallback, not a configuration toggle, which means batch jobs can be launched without coordinating with a running VKB server while still benefiting from the HTTP path when one is present.

Two enrichment steps are applied at write time. First, **embedding vectors are attached to automatically extracted entities**, enabling semantic similarity <USER_ID_REDACTED> against the Graphology+LevelDB store through the VKB HTTP API. Second, **bi-temporal staleness tracking** writes both valid-time and transaction-time fields onto every automatically extracted entity, allowing the lifecycle management layer to distinguish "when the fact was true" from "when we recorded it" and to schedule refreshes accordingly.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

## Integration Points

OnlineLearning sits at the intersection of several systems. Upstream, it consumes from **git history**, **LSL sessions**, and **code analysis** — three distinct signal sources, each feeding the same downstream extraction-to-persistence pipeline. Downstream, it depends on the parent `KnowledgeManagement` component's `GraphDatabaseService` and the VKB HTTP API for persistence.

The primary integration contract is documented in `agents.md` within `integrations/mcp-server-semantic-analysis`, which describes the `PersistenceAgent` and `GraphDatabaseAdapter` patterns. The `PersistenceAgent` is the integration seam for extractors — anything that produces an entity must route through it to get ontology fields, embeddings, and bi-temporal stamps applied consistently. The `GraphDatabaseAdapter` is the integration seam for storage — it abstracts whether the underlying write goes over HTTP to VKB or directly to LevelDB.

OnlineLearning shares its storage substrate and entity-type vocabulary with the sibling `ManualLearning`, meaning the two sub-components are interchangeable from a query-consumer perspective. It also coexists with the sibling `EntityMigrationScripts` (notably `migrate-graph-db-entity-types.js`), which handles type-label consolidation across both automatically and manually authored entities without distinguishing their provenance.

## Usage Guidelines

Developers extending OnlineLearning should respect the **separation between extraction and persistence**. New source-specific extractors should emit raw typed entities and delegate all ontology field population to the `PersistenceAgent.mapEntityToSharedMemory()` call — they should not attempt to set ontology metadata themselves. This keeps extractors stable when the ontology evolves.

When running batch analyses, rely on the `GraphDatabaseAdapter` fallback rather than manually selecting a persistence target. The adapter's runtime detection is the supported mechanism for avoiding LevelDB lock conflicts; bypassing it risks corrupting the store if a VKB server is concurrently active. Conversely, when the VKB server is running, prefer routing writes through the HTTP API so that any in-process caches or hooks on the server side stay consistent.

Always ensure that **embeddings and bi-temporal fields** are produced for automatically extracted entities. These are not optional enrichments — they are required for the downstream semantic similarity <USER_ID_REDACTED> and lifecycle staleness detection to function. If a new extractor cannot produce content suitable for embedding, this should be treated as a gap in the extractor rather than a reason to skip the field.

Finally, because OnlineLearning writes into the same schema as `ManualLearning`, treat the graph as a shared namespace. Coordinate with manual authoring conventions for entity naming and typing, and rely on `EntityMigrationScripts` (e.g., `migrate-graph-db-entity-types.js`) for any cross-cutting type consolidation rather than implementing ad-hoc renames in extractors.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides knowledge graph storage, query, and lifecycle management for the Coding project. It centers on a Graphology+LevelDB graph database (GraphDatabaseService) that stores entities as typed nodes with rich metadata, exposed through both a direct-access path and a VKB HTTP API. The component supports multiple entity types (System, Project, Component, SubComponent, Pattern, Detail) with ontology classification, bi-temporal staleness tracking, embedding vectors, and hierarchical parent/child relationships. It integrates with the MCP semantic analysis server via PersistenceAgent and GraphDatabaseAdapter, which route writes through the VKB API when the server is running or fall back to direct LevelDB access to avoid lock conflicts.

### Children
- [OntologyMetadataMapper](./OntologyMetadataMapper.md) -- PersistenceAgent (referenced in the OnlineLearning sub-component description) owns the mapEntityToSharedMemory() call, meaning ontology field hydration is a responsibility of the persistence layer, not the extraction layer — a deliberate separation of concerns.
- [VkbLevelDbPersistenceFallback](./VkbLevelDbPersistenceFallback.md) -- The sub-component description explicitly names two persistence targets — 'VKB HTTP API' and 'direct LevelDB fallback' — confirming a priority-ordered write path rather than a dual-write or eventual-consistency model.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are typed nodes in the GraphDatabaseService (Graphology+LevelDB) with entity types including System, Project, Component, SubComponent, Pattern, and Detail, each carrying rich metadata fields set at authoring time.
- [EntityMigrationScripts](./EntityMigrationScripts.md) -- migrate-graph-db-entity-types.js handles type consolidation—renaming or merging entity type labels in the Graphology+LevelDB store without full data reconstruction.


---

*Generated from 6 observations*

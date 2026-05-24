# ManualLearning

**Type:** SubComponent

ManualLearning entities are typed nodes in the GraphDatabaseService (Graphology+LevelDB) with entity types including System, Project, Component, SubComponent, Pattern, and Detail, each carrying rich metadata fields set at authoring time.

# ManualLearning

## What It Is

ManualLearning is a SubComponent of the KnowledgeManagement system that represents the pathway for human-authored knowledge to enter the graph database. It is implemented as a set of conventions and write paths over the `GraphDatabaseService` (Graphology+LevelDB), where hand-crafted entities are persisted as typed nodes alongside automatically extracted knowledge. The entities created through this pathway carry the same rich metadata fields as machine-generated ones, including entity type classifications (System, Project, Component, SubComponent, Pattern, Detail), `metadata.ontologyClass`, bi-temporal staleness tracking fields, and hierarchical edges.

Unlike its sibling OnlineLearning—which routes extracted entities through the `PersistenceAgent` and `mapEntityToSharedMemory()` for ontology pre-population—ManualLearning bypasses extraction entirely. The entity author directly specifies `entityType` and `metadata.ontologyClass` at authoring time, which prevents redundant LLM re-classification when the `PersistenceAgent` routes the write through the VKB HTTP API. This makes ManualLearning the canonical path for curated, authoritative knowledge that does not need to be inferred from source material.

![ManualLearning — Architecture](images/manual-learning-architecture.png)

## Architecture and Design

The architectural approach centers on a **dual-write strategy** mediated by the `GraphDatabaseAdapter`. Manual edits can be written along two routes: (1) the VKB HTTP API path, used when the MCP semantic analysis server is running, or (2) direct LevelDB access, used as a fallback when the server is not running. The adapter selects the route based on server availability, which is a deliberate design choice to **avoid LevelDB lock conflicts** that would otherwise occur if two processes attempted to open the same database simultaneously.

This adapter pattern provides a uniform interface to authors and tools while abstracting away the underlying transport. The design treats hand-curated and automatically extracted entities as **first-class peers** in the graph: they share the same schema, the same persistence routes, and the same lifecycle. Parent/child hierarchical relationships—such as Component → SubComponent → Detail—are stored as typed edges in the Graphology graph, making manually authored hierarchies traversable via either the direct-access or VKB API paths without any special-casing.

A second key design decision is **pre-classified metadata**. By requiring authors to fill in `entityType` and `metadata.ontologyClass` up front, the system avoids the cost and non-determinism of LLM re-classification when the `PersistenceAgent` processes the write. This is in deliberate contrast to OnlineLearning, where `mapEntityToSharedMemory()` must populate these fields from raw extraction output.

## Implementation Details

The implementation hinges on three concrete mechanisms found across the KnowledgeManagement component. First, the `GraphDatabaseService` stores entities as typed nodes in a Graphology graph backed by LevelDB. Each node carries metadata such as `entityType`, `metadata.ontologyClass`, embedding vectors, and bi-temporal staleness fields. For ManualLearning entries, these fields are populated explicitly by the human author rather than derived computationally.

Second, the `GraphDatabaseAdapter` performs runtime detection of MCP server availability and routes accordingly. When the MCP server is live, writes flow over HTTP to the VKB API, which in turn invokes `GraphDatabaseService` operations inside the server process. When the server is offline, the adapter opens LevelDB directly. This two-path implementation ensures that ad-hoc tooling, scripts, and editor integrations can persist manual entries regardless of whether the long-running semantic analysis service is active.

Third, hierarchical relationships are encoded as **typed edges** in the Graphology layer. A manually authored Component can link to its SubComponent children, which in turn link to Detail nodes, all using the same edge schema as any other knowledge. This means traversal <USER_ID_REDACTED>—whether for visualization, query expansion, or staleness propagation—work identically on manual and extracted content.

![ManualLearning — Relationship](images/manual-learning-relationship.png)

## Integration Points

ManualLearning integrates most directly with its parent, KnowledgeManagement, by writing into the same `GraphDatabaseService` graph store. It shares the `PersistenceAgent` and `GraphDatabaseAdapter` with its sibling OnlineLearning, which means both human-curated and automatically extracted entries land in the same physical LevelDB store and become indistinguishable to downstream consumers (except by inspection of their provenance metadata).

The bi-temporal staleness tracking integration is particularly notable: by populating staleness fields on manually authored entities, ManualLearning ensures that **human-curated knowledge participates in the same lifecycle management** as machine-extracted knowledge. Curated entities are not exempt from staleness review; instead, they age and require revalidation through the same mechanisms.

ManualLearning also intersects with EntityMigrationScripts, the other sibling SubComponent. Scripts such as `migrate-graph-db-entity-types.js` operate over the same Graphology+LevelDB store and can rename or merge entity type labels for both manual and extracted entries. This means manually authored type classifications must remain compatible with the canonical type vocabulary or be updated by migration runs.

## Usage Guidelines

When authoring manual entries, populate `entityType` and `metadata.ontologyClass` explicitly using values from the canonical vocabulary (System, Project, Component, SubComponent, Pattern, Detail). Skipping these fields defeats the optimization that prevents redundant LLM re-classification in the `PersistenceAgent` and may cause inconsistent downstream behavior.

Prefer the VKB HTTP API path when the MCP server is running. Direct LevelDB writes should be reserved for cases where the server is genuinely offline, such as bootstrapping, offline editing, or recovery scenarios. The `GraphDatabaseAdapter` handles selection automatically, but tools that bypass the adapter risk **LevelDB lock conflicts** if they open the database while the MCP server holds it.

Construct hierarchies using typed parent/child edges rather than embedding child data inside parent nodes. The Component → SubComponent → Detail pattern is the convention, and conforming to it ensures that traversal <USER_ID_REDACTED>, visualization tooling, and migration scripts all behave correctly. Finally, remember that manually authored entities are subject to the same bi-temporal staleness lifecycle as extracted ones—plan to revisit and refresh them, and treat manual authorship as a contribution to a living graph rather than a one-time write.

### Architectural Patterns Identified
- **Adapter pattern** (`GraphDatabaseAdapter`) selecting between HTTP and direct-access transports
- **Dual-write fallback** to handle process-level lock contention on LevelDB
- **Uniform schema across provenance** so manual and extracted entries are peers
- **Typed-edge hierarchy** for parent/child relationships in Graphology

### Design Decisions and Trade-offs
- Requiring authors to pre-classify entities trades a small authoring burden for avoidance of LLM re-classification cost and nondeterminism.
- Allowing direct LevelDB writes increases flexibility but requires careful coordination to avoid lock conflicts—mitigated by the adapter's availability check.
- Treating manual entries as full lifecycle citizens (including staleness) increases maintenance overhead but prevents drift between curated and extracted knowledge.

### System Structure Insights
ManualLearning is structurally thin: it is less a separate module and more a **set of conventions and write routes** layered over shared KnowledgeManagement infrastructure. Its identity comes from how entities are authored (by humans, with pre-filled metadata) rather than from a distinct code path.

### Scalability Considerations
Scalability is bounded by the underlying Graphology+LevelDB store, which is a single-writer embedded database. The adapter's HTTP route effectively serializes writes through the MCP server, which is the appropriate scaling boundary. High-volume manual ingestion should batch writes and prefer the VKB API path to centralize lock ownership.

### Maintainability Assessment
Maintainability is strong because manual and automatic paths share schema, persistence, and lifecycle. The same migration scripts (e.g., `migrate-graph-db-entity-types.js`) maintain both. The main maintenance hazard is **schema drift**: if authors hand-craft entries with stale or non-canonical `entityType` values, migration scripts must absorb the cleanup. Encouraging adapter-mediated writes and canonical vocabulary use keeps the system coherent over time.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides knowledge graph storage, query, and lifecycle management for the Coding project. It centers on a Graphology+LevelDB graph database (GraphDatabaseService) that stores entities as typed nodes with rich metadata, exposed through both a direct-access path and a VKB HTTP API. The component supports multiple entity types (System, Project, Component, SubComponent, Pattern, Detail) with ontology classification, bi-temporal staleness tracking, embedding vectors, and hierarchical parent/child relationships. It integrates with the MCP semantic analysis server via PersistenceAgent and GraphDatabaseAdapter, which route writes through the VKB API when the server is running or fall back to direct LevelDB access to avoid lock conflicts.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- The batch analysis pipeline routes extracted entities through the PersistenceAgent, which calls mapEntityToSharedMemory() to pre-populate ontology metadata fields before persisting via the VKB HTTP API or direct LevelDB fallback.
- [EntityMigrationScripts](./EntityMigrationScripts.md) -- migrate-graph-db-entity-types.js handles type consolidation—renaming or merging entity type labels in the Graphology+LevelDB store without full data reconstruction.


---

*Generated from 5 observations*

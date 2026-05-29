# ManualLearning

**Type:** SubComponent

docs/architecture/cross-project-knowledge.md describes hand-crafted observations as a discrete input channel separate from git-history or LSL-session extraction, implying ManualLearning has its own write path into the GraphDatabaseService

# ManualLearning — Technical Insight Document

## What It Is

ManualLearning is a SubComponent of KnowledgeManagement responsible for providing a dedicated write path through which human-curated knowledge enters the graph database. Unlike its sibling OnlineLearning — which ingests from automatic extraction sources such as git history, LSL sessions, and code analysis — ManualLearning represents a discrete, intentional input channel where a developer or operator directly authors entities and observations into the knowledge graph. The distinction is not merely procedural: it is enforced at the data level through ProvenanceMetadataStamping, the child component that attaches provenance metadata to every manually authored entity, marking its origin as human-curated and protecting it from being silently overwritten by automated pipeline output.

The component is documented across `docs/architecture/memory-systems.md`, `docs/architecture/cross-project-knowledge.md`, and `docs/architecture-report.md`. No dedicated source files were identified in the current code structure, suggesting ManualLearning's behavior is primarily defined through its interactions with the surrounding infrastructure — GraphDatabaseService, the Graphology in-memory graph, and KnowledgeDecayTracker — rather than through a standalone implementation module.

## Architecture and Design

![ManualLearning — Architecture](images/manual-learning-architecture.png)

The central architectural decision in ManualLearning is **provenance-driven write isolation**. The knowledge graph within KnowledgeManagement stores entities of typed categories — System, Project, Pattern — and both manual and automated entities inhabit these same typed slots. What separates them is provenance metadata applied at creation time by ProvenanceMetadataStamping. This metadata acts as a guard: during merge operations, the pipeline respects the human-provenance stamp and does not overwrite manually authored facts with automatically extracted observations. This design enables a heterogeneous graph where automated and human knowledge coexist without the latter being eroded over time by pipeline churn.

A second key design decision is the **bypass of the batch analysis pipeline**. As described in `docs/architecture-report.md`, the standard OnlineLearning path routes through a scheduled batch analysis pipeline before entities reach the Graphology in-memory graph. ManualLearning skips this layer entirely, writing directly to the Graphology in-memory graph layer via GraphDatabaseService. This means manual edits achieve immediate consistency — a human correction or insight is available to graph <USER_ID_REDACTED> as soon as it is committed, without waiting for a batch cycle. The trade-off is that manual writes do not benefit from whatever normalization or enrichment the batch pipeline applies; the author bears responsibility for correctness and completeness at write time.

The relationship between ManualLearning and its siblings reflects a deliberate separation of concerns in KnowledgeManagement. OnlineLearning handles volume and automation; ManualLearning handles authority and precision. GraphKMStore, which uses UUIDv7 time-ordered entity IDs, provides the shared persistence substrate that both paths write into, ensuring all entities — regardless of origin — are addressable and chronologically ordered.

![ManualLearning — Relationship](images/manual-learning-relationship.png)

## Implementation Details

The primary mechanism ManualLearning relies on is **ProvenanceMetadataStamping**, its sole child component. At entity creation time, every manually authored entity must receive a provenance stamp that identifies it as human-curated. This stamp is the runtime signal used during merge conflict resolution to prevent automated pipeline writes from overwriting human edits. Without this stamp, a manually authored entity would be indistinguishable from an automatically extracted one and could be overwritten on the next pipeline run.

ManualLearning entities are also subject to the **KnowledgeDecayTracker** lifecycle model. KnowledgeDecayTracker attaches `validFrom` and `validUntil` fields to each entity in the graph, and this applies equally to manually authored entities. This means that when a developer authors a manual entity, they must either supply explicit validity timestamps or accept whatever defaults the system assigns. Practically, this implies that manual knowledge is not permanently immune to decay — a human-authored fact can expire if its `validUntil` boundary is reached, and time-range <USER_ID_REDACTED> issued by KnowledgeDecayTracker will exclude it from results without physically deleting it from the Graphology graph. Authors of manual entities should treat timestamp assignment as a first-class concern, not an afterthought.

The direct write path into the Graphology in-memory graph layer means ManualLearning operates on the same graph object that all other KnowledgeManagement components read from. There is no separate manual-knowledge store; the distinction is carried entirely in metadata fields on the entities themselves. This keeps the graph unified but places correctness pressure on the provenance stamping logic.

## Integration Points

ManualLearning's primary runtime dependency is **GraphDatabaseService**, the service that manages the Graphology in-memory graph backed by LevelDB. Manual writes go directly to this layer, making GraphDatabaseService the immediate integration boundary. The canonical shape store, GraphKMStore — which uses UUIDv7 entity IDs — is the broader persistence target that GraphDatabaseService writes through, and manual entities ultimately land there alongside automatically extracted ones.

The relationship with **KnowledgeDecayTracker** is a lifecycle integration: every entity ManualLearning creates enters the `validFrom`/`validUntil` tracking system. This is non-optional; KnowledgeDecayTracker's time-range query model applies uniformly across all entity origins. Manual entity authors must be aware that their edits will age and may require explicit refresh or extension of validity windows.

The sibling boundary with **OnlineLearning** is the clearest integration concern. Both components write typed entities (System, Project, Pattern) into the same graph. The separation is enforced only by provenance metadata during merge operations, as documented in `docs/architecture/cross-project-knowledge.md`. If provenance stamping is incomplete or inconsistent, the protection against pipeline overwrite breaks down. ProvenanceMetadataStamping as a child component is therefore a critical correctness dependency for the entire ManualLearning subsystem.

## Usage Guidelines

When authoring manual entities, developers must ensure ProvenanceMetadataStamping is invoked correctly at write time. The provenance stamp is not advisory — it is the mechanism that protects human-curated facts from being overwritten by OnlineLearning pipeline output during merge operations. Omitting or incorrectly applying provenance metadata renders a manual edit vulnerable to automated overwrite, defeating the purpose of manual curation.

Timestamp hygiene is equally important. Because KnowledgeDecayTracker governs all entities through `validFrom`/`validUntil` fields, manually authored entities must carry meaningful validity windows. Authors should explicitly set `validUntil` to a duration appropriate for the fact being recorded — open-ended or overly short windows will cause either unbounded accumulation or premature expiry. When updating a manual entity, the validity window should be refreshed alongside the content change.

Because ManualLearning writes bypass the batch analysis pipeline and commit directly to the Graphology in-memory graph, manual edits are immediately visible to all graph consumers. This is an advantage for urgency but a risk for <USER_ID_REDACTED>: there is no pipeline normalization pass to catch structural errors. Authors should validate entity type assignments (System, Project, Pattern) and relationship structure before committing, since corrections will require a subsequent manual write rather than a pipeline rerun.

Finally, when migrating entities between GraphDatabaseService/LevelDB and GraphKMStore (using the migration tooling referenced in the KnowledgeManagement parent context), provenance metadata must be preserved across the migration boundary. UUIDv7 ID reissuance during migration should not strip the human-provenance stamp, as doing so would expose previously protected manual entities to pipeline overwrite in the post-migration graph.

---

**Architectural Patterns Identified:** Provenance-driven write isolation; direct in-memory graph write bypass; uniform lifecycle metadata across heterogeneous entity origins.

**Key Design Trade-offs:** Immediate consistency via pipeline bypass at the cost of no automated normalization for manual writes; shared graph namespace with automated entities with conflict protection delegated entirely to metadata rather than storage separation.

**Scalability Consideration:** Because manual entities share the Graphology graph with all automated output, graph size growth is driven primarily by OnlineLearning volume; ManualLearning does not introduce a distinct scaling concern, but provenance-aware merge logic must remain efficient as graph cardinality grows.

**Maintainability Assessment:** The design is maintainable so long as ProvenanceMetadataStamping remains consistently applied — it is a single point of correctness for a critical invariant. The absence of identified source files suggests the implementation may be distributed across infrastructure layers, which warrants explicit documentation of the write contract to prevent future contributors from introducing unguarded manual writes.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing entity storage, querying, and lifecycle management. It uses a Graphology in-memory graph backed by LevelDB for persistence, storing entities with typed attributes (System, Project, Pattern) and relationships. The system supports multiple knowledge stores: a local LevelDB/Graphology store (GraphDatabaseService) and a canonical km-core shape store (GraphKMStore), with migration tooling to move between them.

### Children
- [ProvenanceMetadataStamping](./ProvenanceMetadataStamping.md) -- Referenced in the ManualLearning sub-component description: provenance metadata is the key distinguishing factor between human-curated facts and automatically extracted knowledge in the GraphKMStore (documented in docs/architecture/memory-systems.md as 'Graph-Based Knowledge Storage Architecture')

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- docs/architecture/memory-systems.md identifies git history, LSL sessions, and code analysis as the three automatic extraction sources feeding OnlineLearning, each producing typed graph entities
- [GraphKMStore](./GraphKMStore.md) -- GraphKMStore uses UUIDv7 entity IDs (time-ordered UUIDs) rather than the legacy IDs used by GraphDatabaseService/LevelDB, enabling chronological ordering and distributed ID generation without coordination
- [KnowledgeDecayTracker](./KnowledgeDecayTracker.md) -- KnowledgeDecayTracker attaches validFrom and validUntil fields to each entity, enabling time-range <USER_ID_REDACTED> that exclude expired knowledge without physically deleting records from the Graphology graph


---

*Generated from 5 observations*

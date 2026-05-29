# ManualLearning

**Type:** SubComponent

Agent Integration Guide (docs/agent-integration-guide.md) references direct observation injection, suggesting ManualLearning exposes an API for agents to assert facts without triggering the automated analysis pipeline

# ManualLearning — Technical Reference

## What It Is

ManualLearning is a SubComponent of KnowledgeManagement responsible for ingesting human-authored knowledge into the shared knowledge graph. Rather than receiving entities from automated analysis pipelines, it provides the pathway through which developers, agents, and curators directly assert facts, relationships, and cross-project edges into the same graph infrastructure that OnlineLearning and KMCoreMigration populate. Its behavior is documented across `docs/architecture/memory-systems.md`, `docs/architecture/cross-project-knowledge.md`, and `docs/agent-integration-guide.md`, though no dedicated source files have been identified in the current codebase scan.

The defining characteristic of ManualLearning is provenance: every entity it produces carries metadata explicitly marking it as human-authored, a concern delegated to its child component HumanProvenanceStamping. This provenance mark is a discriminating value on a shared provenance field — not a separate entity type — distinguishing manual records from the pipeline provenance stamps applied by KMCoreMigration during automated migration runs.

![ManualLearning — Architecture](images/manual-learning-architecture.png)

## Architecture and Design

ManualLearning sits within KnowledgeManagement alongside three siblings — OnlineLearning, KMCoreMigration, and EntityTypeRegistry — each contributing entities to the same underlying graph store. The architectural decision to unify all entry paths through a single write interface (GraphKMStore, backed by LevelDB) means ManualLearning does not own its own storage layer. Instead, it relies on GraphKMStore as the persistence gateway, ensuring that hand-crafted entities and pipeline-generated entities coexist in one addressable graph without structural divergence.

The design makes provenance a first-class attribute rather than an implicit assumption about which code path was invoked. This is a deliberate trade-off: it adds a metadata field to every entity but eliminates the need for separate storage partitions or query-time routing logic to distinguish human versus automated knowledge. The shared provenance field with distinct enum-like values (human-authored vs. pipeline-stamped) keeps the ontology flat and the query surface uniform.

![ManualLearning — Relationship](images/manual-learning-relationship.png)

Type conformance is enforced externally by EntityTypeRegistry, which maps all incoming entity types to the three-type ontology (System, Project, Pattern) before graph insertion. ManualLearning does not bypass this constraint — hand-crafted nodes must conform to the same classification surface as automated ones. This prevents ontology drift where human authors might introduce ad-hoc types that fragment the shared schema.

## Implementation Details

The core mechanics of ManualLearning operate through two concerns: identifier assignment and provenance stamping.

Identifier assignment follows the same UUIDv7 scheme established by KMCoreMigration. Manual entities receive time-ordered UUIDv7 IDs consistent with the canonical shape defined during migration, meaning legacy manual records and newly authored ones share the same identifier format. This is significant for graph traversal and temporal ordering — a UUIDv7 encodes creation time, so manual entities are naturally sortable alongside automated ones without a separate timestamp field.

Provenance stamping is the responsibility of HumanProvenanceStamping, ManualLearning's only child component. Based on the observation that provenance is a shared field with distinct values rather than a type split, HumanProvenanceStamping likely applies a specific provenance marker at write time, before or during the GraphKMStore persistence call. The contrast with KMCoreMigration's automated pipeline stamps suggests this is a well-defined enum or constant value rather than free-form metadata.

Cross-project edge authoring is an explicit capability of ManualLearning, as documented in `docs/architecture/cross-project-knowledge.md`. This means ManualLearning handles not just node creation but inter-project relationship assertion — a responsibility that requires awareness of entity identities across project boundaries. This positions ManualLearning as the primary mechanism for curating the relational structure of the knowledge graph where automation cannot infer connections.

## Integration Points

The `docs/agent-integration-guide.md` reference to direct observation injection indicates that ManualLearning exposes an API surface accessible to agents — allowing them to assert facts without triggering the automated analysis pipeline (OnlineLearning's path). This is a meaningful architectural boundary: it separates deliberate, curated assertions from continuous automated inference, giving consumers control over which pipeline semantics apply to a given fact.

GraphKMStore is the write dependency. All entities authored through ManualLearning are persisted via this interface to the LevelDB backend, placing ManualLearning downstream of GraphKMStore and upstream of the raw storage layer. EntityTypeRegistry acts as a schema gatekeeper that ManualLearning must satisfy before insertion succeeds. KMCoreMigration shares the UUIDv7 identifier contract, ensuring interoperability between migrated historical records and new manual entries.

## Usage Guidelines

Developers and agents authoring knowledge through ManualLearning should treat EntityTypeRegistry conformance as a hard constraint — all entities must resolve to System, Project, or Pattern before they can be persisted. Attempting to introduce novel types will be rejected at the classification layer, not silently coerced.

When asserting cross-project relationships, authors should be aware that ManualLearning is the designated path for inter-project edge authoring per `docs/architecture/cross-project-knowledge.md`. These edges are curated rather than inferred, so they carry implicit authority within the graph — <USER_ID_REDACTED> that traverse cross-project relationships are relying on the correctness of manually authored data.

The direct observation injection API documented in `docs/agent-integration-guide.md` should be used when an agent has high-confidence, deliberate facts to record that should not be re-derived by the automated pipeline. This avoids duplication and prevents automated analysis from overwriting or conflicting with intentional assertions. The provenance field, set by HumanProvenanceStamping, serves as the durable signal for downstream consumers to distinguish these authoritative records from pipeline-generated ones.

Since no dedicated source files were identified in the code scan, implementors working in this area should treat `docs/architecture/memory-systems.md`, `docs/architecture/cross-project-knowledge.md`, and `docs/agent-integration-guide.md` as the primary normative references until code-level symbols are indexed.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.

### Children
- [HumanProvenanceStamping](./HumanProvenanceStamping.md) -- Per the ManualLearning sub-component description, entities carry provenance metadata explicitly marking them as human-authored, contrasting with pipeline provenance stamps applied by KMCoreMigration — indicating a shared provenance field with distinct enum-like values rather than separate entity types.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- docs/architecture/memory-systems.md describes the Graph-Based Knowledge Storage Architecture that OnlineLearning populates, with Graphology as the in-memory layer backed by LevelDB
- [KMCoreMigration](./KMCoreMigration.md) -- The migration script migrate-leveldb-to-kmcore.mjs reads raw LevelDB B-shape records and rewrites them with UUIDv7 identifiers, providing stable, time-ordered IDs for all canonical entities
- [EntityTypeRegistry](./EntityTypeRegistry.md) -- EntityTypeRegistry enforces a three-type ontology (System/Project/Pattern) as the canonical classification surface, with all incoming entity types mapped through this consolidation layer before graph insertion


---

*Generated from 6 observations*

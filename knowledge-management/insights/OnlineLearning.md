# OnlineLearning

**Type:** SubComponent

RELEASE-2.0.md (docs/RELEASE-2.0.md) documents the Ontology Integration System, indicating OnlineLearning was extended to emit ontology-classified entity types aligned with the EntityTypeRegistry normalization layer

# OnlineLearning — Technical Insight Document

## What It Is

OnlineLearning is a SubComponent of KnowledgeManagement responsible for automated, pipeline-driven knowledge extraction and graph population. Unlike its sibling ManualLearning — which sources entities from human-authored inputs marked with human-provenance metadata — OnlineLearning operates through a structured batch-analysis pipeline that ingests machine-readable signals: git history, LSL session data, and source code ASTs. The result is a continuously refreshed stream of entities and relationships written into GraphKMStore, the Graphology/LevelDB storage layer that OnlineLearning directly populates.

The pipeline is scoped to a single repository root, configured via the `CODING_REPO` environment variable, which defines the filesystem boundary for all AST indexing operations. There are no specific source file paths surfaced in code symbols at this time, but the pipeline's behavior is documented across `docs/architecture/memory-systems.md`, `docs/architecture/token-usage.md`, and `docs/RELEASE-2.0.md`.

---

## Architecture and Design

![OnlineLearning — Architecture](images/online-learning-architecture.png)

OnlineLearning is structured as a **DAG-based batch pipeline**, where discrete, ordered stages process different signal sources before committing entities to the knowledge graph. The three primary stages — git history extraction, LSL session analysis, and code analysis — are not interchangeable or concurrent; they represent a deliberate sequencing that mirrors the dependency structure of the knowledge they produce. Code analysis, for instance, depends on a stable repository root, while git history extraction provides temporal provenance context that enriches the resulting entities.

The code-analysis branch of the pipeline is anchored by the `CodeGraphAgent`, which uses **Tree-sitter AST parsing** to index repositories. Tree-sitter provides language-agnostic, incremental parsing, making this branch resilient to multi-language codebases while remaining deterministic in its output shape. This is a meaningful design choice: AST-derived entities carry structural certainty (symbol names, file locations, relationship types) that prose-derived or heuristic extraction cannot guarantee.

A notable architectural extension, documented in `docs/RELEASE-2.0.md` as the **Ontology Integration System**, aligned OnlineLearning's output with the EntityTypeRegistry normalization layer. This means the pipeline does not emit raw or ad-hoc entity types — all extracted entities are classified through the three-type ontology (System / Project / Pattern) before graph insertion. This constraint binds OnlineLearning tightly to its sibling EntityTypeRegistry and ensures that automated extraction cannot introduce type drift that would corrupt downstream graph <USER_ID_REDACTED>.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

---

## Implementation Details

The pipeline's LLM-assisted extraction steps are metered through the Token Usage Dashboard (`docs/architecture/token-usage.md`), indicating that at least some extraction stages involve language model inference — likely for entity classification, relationship labeling, or semantic summarization of code constructs that Tree-sitter alone cannot resolve (e.g., inferring that a class represents a "Pattern" rather than merely a "Project" artifact). The token metering implies these steps are budget-aware, and the dashboard provides operational visibility into batch run costs.

The `CODING_REPO` environment variable is the single configuration knob that scopes the entire AST indexer. This makes the pipeline explicitly **repo-scoped** — each invocation operates on one repository root, keeping extraction boundaries clean and avoiding cross-repository entity collisions. This is consistent with the parent KnowledgeManagement component's design, which treats the knowledge graph as a local-first, bounded structure rather than a federated one.

Entity identity within the pipeline is stabilized by the sibling component KMCoreMigration's UUIDv7 scheme. Records extracted by OnlineLearning are assigned time-ordered, stable UUIDv7 identifiers, which means re-runs of the batch pipeline can produce deterministically comparable entity sets rather than accumulating duplicates. The migration script `migrate-leveldb-to-kmcore.mjs` is the mechanism through which raw pipeline output is canonicalized into this identifier space.

---

## Integration Points

OnlineLearning's most direct downstream dependency is **GraphKMStore**, the child component that owns the Graphology in-memory graph backed by LevelDB. OnlineLearning is the primary writer to this store during batch runs; GraphKMStore exposes the graph surface that all consumers (query layers, the CodeGraphAgent's Memgraph integration) read from.

The relationship with **EntityTypeRegistry** is a hard constraint: OnlineLearning must route all emitted entity types through the three-type ontology (System / Project / Pattern) before insertion. This normalization gate prevents the automated pipeline from polluting the graph with uncategorized or inconsistently typed nodes, which would degrade the reliability of graph traversals used by the parent KnowledgeManagement infrastructure.

The CodeGraphAgent serves as both a consumer and a contributor to the pipeline — it uses Tree-sitter to index repositories (feeding OnlineLearning's code-analysis stage) and separately integrates with Memgraph for external graph database <USER_ID_REDACTED>, as described in the KnowledgeManagement parent context. This dual role means changes to the CodeGraphAgent's parsing behavior have direct consequences for the shape and completeness of OnlineLearning's output.

---

## Usage Guidelines

**Repository scoping is mandatory.** The `CODING_REPO` environment variable must be set correctly before any batch run. Because the AST indexer and git history extractor both anchor to this root, an incorrect path will silently produce an empty or partial extraction rather than a visible error — developers should validate this variable as a pre-flight check.

**Stage ordering must be respected.** The DAG-based pipeline model means stages have implicit dependencies. Running code analysis before git history extraction, for example, may produce entities lacking the provenance context that makes them useful for downstream reasoning. The DAG structure should be treated as a contract, not a suggestion.

**LLM steps incur token costs.** Because batch runs are metered (per `docs/architecture/token-usage.md`), developers should avoid triggering full pipeline re-runs unnecessarily. Incremental or scoped runs — where only changed files or new commits are processed — are preferable to full re-indexing when the repository has not changed substantially.

**Ontology compliance is non-negotiable.** Any extension to OnlineLearning's extraction logic must emit entities that resolve cleanly through EntityTypeRegistry's three-type surface. Introducing new entity type strings without updating the registry will cause classification failures at the normalization layer, potentially blocking graph insertion entirely. Coordinate with the EntityTypeRegistry before adding new entity categories to the pipeline.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.

### Children
- [GraphKMStore](./GraphKMStore.md) -- docs/architecture/memory-systems.md describes the Graph-Based Knowledge Storage Architecture that OnlineLearning populates, with Graphology as the in-memory layer backed by LevelDB

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are distinguished by provenance metadata that marks their origin as human-authored, contrasting with the automated pipeline provenance stamps applied by KMCoreMigration
- [KMCoreMigration](./KMCoreMigration.md) -- The migration script migrate-leveldb-to-kmcore.mjs reads raw LevelDB B-shape records and rewrites them with UUIDv7 identifiers, providing stable, time-ordered IDs for all canonical entities
- [EntityTypeRegistry](./EntityTypeRegistry.md) -- EntityTypeRegistry enforces a three-type ontology (System/Project/Pattern) as the canonical classification surface, with all incoming entity types mapped through this consolidation layer before graph insertion


---

*Generated from 6 observations*

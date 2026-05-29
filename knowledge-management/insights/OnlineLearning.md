# OnlineLearning

**Type:** SubComponent

The batch analysis pipeline is referenced in docs/architecture-report.md with step-level orchestration (batch-analysis.yaml), suggesting OnlineLearning steps declare explicit depends_on edges to sequence extraction before graph ingestion

# OnlineLearning — Technical Insight Document

## What It Is

OnlineLearning is a SubComponent of KnowledgeManagement responsible for the automated, continuous ingestion of knowledge into the system's graph infrastructure. Unlike its sibling ManualLearning — which manages human-curated facts with explicit provenance protections — OnlineLearning orchestrates the pipeline-driven side of knowledge acquisition, sourcing structured observations from three distinct extraction channels and writing them into GraphDatabaseService (and ultimately the canonical GraphKMStore) after ontology validation.

The component is described in `docs/architecture/memory-systems.md` and referenced in `docs/architecture-report.md`, with its batch orchestration defined in `batch-analysis.yaml`. Its child component, AutomaticKnowledgeExtraction, implements the actual extraction logic across git history, LSL sessions, and code analysis — the three sources explicitly identified in `docs/architecture/memory-systems.md`.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

## Architecture and Design

The central architectural decision in OnlineLearning is the separation of **extraction** from **ingestion**, sequenced through explicit `depends_on` edges declared in `batch-analysis.yaml`. This step-level orchestration ensures that AutomaticKnowledgeExtraction completes its typed entity production before any graph write operations occur, avoiding partial or inconsistent states in the knowledge graph. The pipeline structure, as referenced in `docs/architecture-report.md`, positions OnlineLearning as a batch-oriented orchestrator rather than a real-time processor.

A second significant design decision is **ontology-gated writing**. Per `docs/RELEASE-2.0.md` (Ontology Integration System), automatically extracted entities must be classified against the ontology schema before they can be written to GraphDatabaseService. This means OnlineLearning includes — or depends on — a resolution step that maps raw extracted entities to known ontology types. This gate prevents schema drift: unrecognized or malformed entity types are rejected before they pollute the graph. This contrasts with how ManualLearning entities enter the system, where human authorship implies a higher trust level and likely a different (or lighter) validation path.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

The third key design decision is **provenance stamping**. All entities produced by OnlineLearning carry `source: pipeline` metadata, distinguishing them from `source: human` entities contributed by ManualLearning. This distinction is not cosmetic — it feeds directly into KnowledgeDecayTracker's decay policies. Because KnowledgeDecayTracker uses `validFrom` and `validUntil` fields to manage knowledge expiry without physical deletion, the provenance stamp allows it to apply more aggressive decay schedules to pipeline-generated entities, which may be noisier or more volatile than human-curated facts.

## Implementation Details

AutomaticKnowledgeExtraction, as OnlineLearning's sole child component, implements the three extraction sources: git history, LSL sessions, and code analysis. Each source produces **typed graph entities** — the typing step is what enables downstream ontology classification. The `batch-analysis.yaml` pipeline sequences these extraction steps, with explicit `depends_on` edges ensuring graph ingestion only begins after extraction is complete.

The ontology resolution step — described in the Ontology Integration System release notes in `docs/RELEASE-2.0.md` — must occur between extraction and write. Entity types produced by AutomaticKnowledgeExtraction are matched against the ontology schema; only entities that resolve successfully proceed to GraphDatabaseService. This acts as a schema enforcement layer within the pipeline, keeping the graph's type system coherent as new extraction sources or patterns are added.

Provenance metadata (`source: pipeline`) is attached at write time, before entities reach GraphDatabaseService. This stamp is what allows KnowledgeDecayTracker and merge operations to differentiate pipeline entities from ManualLearning entities. The sibling ManualLearning component's design explicitly protects human-curated facts from being overwritten by pipeline-generated observations during merges — a protection that relies entirely on this provenance distinction being present and reliable.

Once validated and stamped, entities are written into GraphDatabaseService (the LevelDB/Graphology store managed by the parent KnowledgeManagement component). Migration tooling within KnowledgeManagement can subsequently promote these entities into GraphKMStore, where they receive UUIDv7 identifiers (as described in the GraphKMStore sibling documentation) rather than the legacy ID scheme used by the LevelDB store.

## Integration Points

**KnowledgeManagement (parent):** OnlineLearning writes into the Graphology/LevelDB graph managed by KnowledgeManagement via GraphDatabaseService. The parent provides the persistence layer; OnlineLearning is the automated write path into it.

**AutomaticKnowledgeExtraction (child):** The extraction pipeline — covering git history, LSL sessions, and code analysis — is entirely encapsulated in this child component. OnlineLearning's role is to orchestrate, validate, stamp, and commit what AutomaticKnowledgeExtraction produces.

**KnowledgeDecayTracker (sibling):** The `source: pipeline` provenance stamps written by OnlineLearning are consumed by KnowledgeDecayTracker to determine which decay policy applies to each entity. Pipeline-sourced entities may have shorter validity windows than human-sourced ones, reflecting their lower epistemic certainty.

**ManualLearning (sibling):** The merge-protection logic that prevents ManualLearning entities from being overwritten depends on the reliability of OnlineLearning's provenance stamps. These two components represent the two write paths into the knowledge graph, and their provenance metadata must remain mutually exclusive and consistently applied.

**GraphKMStore (sibling):** OnlineLearning writes to GraphDatabaseService first; GraphKMStore receives entities through the migration tooling that KnowledgeManagement manages. UUIDv7 assignment happens at the GraphKMStore layer, not within OnlineLearning's pipeline.

**Batch orchestration (`batch-analysis.yaml`):** The pipeline is scheduled or event-triggered independently of the interactive agent session, as noted in `docs/architecture/cross-project-knowledge.md`. This means OnlineLearning operates as a background process, decoupled from real-time user interactions.

## Usage Guidelines

**Provenance discipline is non-negotiable.** Any modification to OnlineLearning's write path must preserve the `source: pipeline` stamp on all entities it produces. The downstream behavior of KnowledgeDecayTracker and merge operations in ManualLearning both depend on this distinction being applied uniformly. Introducing a write path that omits or misclassifies provenance will silently corrupt decay scheduling and potentially allow pipeline data to overwrite human knowledge.

**Ontology classification is a hard gate, not a soft warning.** The Ontology Integration System requirement described in `docs/RELEASE-2.0.md` means that adding a new extraction source to AutomaticKnowledgeExtraction requires ensuring its output entity types are registered in the ontology schema. Entities that fail classification should be rejected or quarantined, not written with a fallback generic type, as this would undermine the type system enforced across the rest of KnowledgeManagement.

**Pipeline sequencing via `depends_on` is the consistency mechanism.** The `batch-analysis.yaml` step dependencies are not merely organizational — they are the primary guard against partial graph states. Any extension or modification to the pipeline should maintain strict extraction-before-ingestion ordering. Parallelizing steps across this boundary would risk writing incomplete or unclassified entities into GraphDatabaseService.

**Background scheduling must account for session isolation.** Because `docs/architecture/cross-project-knowledge.md` describes OnlineLearning as a continuous background process separate from the interactive agent session, care must be taken to avoid write contention with session-driven operations on GraphDatabaseService. The LevelDB backing store used by KnowledgeManagement may have locking constraints that need to be respected when scheduling pipeline runs relative to active agent sessions.

**Scalability note:** The three current extraction sources (git history, LSL sessions, code analysis) represent distinct data volumes and update frequencies. Git history is largely append-only and grows slowly; code analysis may produce large volumes on significant refactors; LSL sessions are bounded by interaction frequency. Pipeline scheduling should account for these different cadences rather than treating all three as uniform batch jobs.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing entity storage, querying, and lifecycle management. It uses a Graphology in-memory graph backed by LevelDB for persistence, storing entities with typed attributes (System, Project, Pattern) and relationships. The system supports multiple knowledge stores: a local LevelDB/Graphology store (GraphDatabaseService) and a canonical km-core shape store (GraphKMStore), with migration tooling to move between them.

### Children
- [AutomaticKnowledgeExtraction](./AutomaticKnowledgeExtraction.md) -- docs/architecture/memory-systems.md explicitly identifies git history, LSL sessions, and code analysis as the three automatic extraction sources feeding OnlineLearning

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are distinguished from automatically extracted knowledge by provenance metadata, ensuring human-curated facts are not overwritten by pipeline-generated observations during merge operations
- [GraphKMStore](./GraphKMStore.md) -- GraphKMStore uses UUIDv7 entity IDs (time-ordered UUIDs) rather than the legacy IDs used by GraphDatabaseService/LevelDB, enabling chronological ordering and distributed ID generation without coordination
- [KnowledgeDecayTracker](./KnowledgeDecayTracker.md) -- KnowledgeDecayTracker attaches validFrom and validUntil fields to each entity, enabling time-range <USER_ID_REDACTED> that exclude expired knowledge without physically deleting records from the Graphology graph


---

*Generated from 5 observations*

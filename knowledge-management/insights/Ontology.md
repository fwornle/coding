# Ontology

**Type:** SubComponent

The system maintains a two-level ontology hierarchy (upper/lower) with separate definition files, paths to which are managed by OntologyConfigManager, allowing the classification tier to be reconfigured without code changes

# Ontology — Technical Insight Document

## What It Is

The Ontology subsystem is a structured classification engine embedded within the SemanticAnalysis component (`integrations/mcp-server-semantic-analysis`). Its responsibility is to take raw observation categories produced earlier in the pipeline and resolve them into well-defined ontology classes, enriching entities with typed metadata before they flow downstream to persistence and querying layers. It was introduced as a major architectural addition, documented under *Release 2.0 - Ontology Integration System* in `docs/RELEASE-2.0.md`, signaling that ontology-awareness was a deliberate, bounded upgrade rather than an organic growth of the codebase.

The subsystem owns two direct child components — OntologyConfigManager and TwoLevelOntologyHierarchy — and operates alongside siblings Pipeline, Insights, and LegacyOntologyAdapter within SemanticAnalysis. Its outputs (structured `entityType` and `ontologyClass` metadata attached to entities) are the contract that makes the entire SemanticAnalysis pipeline ontology-aware.

## Architecture and Design

![Ontology — Architecture](images/ontology-architecture.png)

The central architectural decision is the **two-level ontology hierarchy**: an upper ontology tier capturing broad categorical concepts and a lower ontology tier holding domain-specific classes. These tiers are defined in separate files, the paths to which are managed exclusively by OntologyConfigManager. This separation enforces a clean abstraction boundary — upper ontology provides stable root anchors while lower ontology can evolve independently with domain vocabulary. OntologyClassifier consumes both tiers simultaneously, selecting the most specific matching lower-ontology class while anchoring the result to an upper-ontology root, ensuring every classified entity has both a precise label and a stable categorical parent.

OntologyConfigManager is implemented as a singleton, consistent with its role across the broader SemanticAnalysis pipeline. A singleton guarantees that OntologyClassifier and OntologyValidator share identical configuration — the same file paths, the same classification thresholds — throughout an entire batch run. This directly prevents the class of bug where the classifier uses one threshold to assign a class that the validator then rejects because it loaded a different configuration. The sibling Insights component also respects OntologyConfigManager's boundaries, with LLM budget constraints configured there, illustrating that OntologyConfigManager is a cross-cutting configuration authority across multiple siblings.

The **LegacyOntologyAdapter** pattern addresses a live migration problem. During Phase 42-03, the system is transitioning from a legacy ontology source to `km-core`'s OntologyRegistry. Rather than modifying OntologyValidator and OntologyClassifier to understand the new registry directly, LegacyOntologyAdapter wraps OntologyRegistry behind a legacy-compatible interface. This isolates the migration boundary to a single adapter, allowing both classifying and validating components to continue functioning without modification — a textbook application of the Adapter pattern to manage migration risk.

## Implementation Details

![Ontology — Relationship](images/ontology-relationship.png)

**OntologyClassifier** is the core classification engine. It ingests definitions from both ontology tiers and applies hierarchical classification logic: given a raw observation category, it traverses the lower ontology to find the most specific matching class, then resolves the corresponding upper-ontology root. Classification is not binary — a quantitative threshold configured in OntologyConfigManager governs ambiguous assignments. This means that when a raw category sits near a class boundary, the threshold determines whether the entity receives a confident class assignment or is treated as unresolvable, preventing spurious classifications from propagating downstream.

**OntologyValidator** enforces structural and semantic constraints on classified entities. Critically, during the Phase 42-03 migration, it does not receive entities directly from OntologyRegistry. Instead, LegacyOntologyAdapter mediates the feed, ensuring the validator's interface contract remains stable. This design means the validator's correctness guarantees are preserved across the migration boundary — it validates the same shape of data it has always validated, regardless of where that data originates.

**TwoLevelOntologyHierarchy** as a child component represents the definitional content itself — the actual upper and lower ontology files — while OntologyConfigManager represents the runtime wiring that points to those files. This separation means the hierarchy can be versioned, swapped, or extended purely by updating file paths in OntologyConfigManager, with no code changes required. The classification tier is effectively a pluggable configuration artifact.

Once classification completes, results are attached as structured metadata fields — `entityType` and `ontologyClass` — directly to the entity before it exits the Ontology subsystem. This attachment makes the metadata portable: downstream persistence and querying layers do not need to re-derive ontology information; it travels with the entity as a first-class attribute.

## Integration Points

The Ontology subsystem sits downstream of raw observation/categorization stages and upstream of persistence in the SemanticAnalysis pipeline. Its primary upstream dependency is the source of raw observation categories (fed through the pipeline orchestrated by the Pipeline sibling). Its downstream consumers are the persistence layer and any query mechanisms that filter or aggregate by `entityType` or `ontologyClass`.

The integration with LegacyOntologyAdapter is the most structurally significant current coupling. OntologyValidator's data path runs through the adapter, meaning the adapter's fidelity in translating OntologyRegistry output to the legacy interface is load-bearing for validation correctness. The sibling LegacyOntologyAdapter explicitly exists to protect this boundary during Phase 42-03.

OntologyConfigManager serves as the configuration integration point for siblings as well. Because Insights' LLM budget constraints are also housed there, OntologyConfigManager functions as a shared configuration authority across the SemanticAnalysis component, not merely an internal concern of the Ontology subsystem.

## Usage Guidelines

Developers modifying ontology definitions should do so exclusively through the files referenced by OntologyConfigManager, never by hardcoding paths or class names elsewhere in the codebase. The entire reconfigurability guarantee depends on OntologyConfigManager being the single source of path truth for both upper and lower ontology tiers.

Classification threshold values in OntologyConfigManager should be treated as semantically significant tuning parameters, not arbitrary numbers. Lowering a threshold increases the number of entities that receive class assignments, potentially at the cost of accuracy. Raising it increases precision but may leave more entities unclassified. Any threshold change should be validated against a representative batch before deployment.

During the Phase 42-03 migration period, changes to OntologyValidator or OntologyClassifier must account for the fact that their data path runs through LegacyOntologyAdapter. Direct integration with OntologyRegistry is not yet active for these components; bypassing the adapter would break the migration isolation contract. Once the migration completes and the adapter is retired, both components should be updated to consume OntologyRegistry directly, and this document should be revised accordingly.

New ontology tiers or structural changes to the two-level hierarchy should be reflected in TwoLevelOntologyHierarchy's definition files and validated against OntologyValidator's constraint set before promotion. Because OntologyClassifier anchors every classification to an upper-ontology root, removing or renaming upper-ontology classes is a breaking change for any downstream system that <USER_ID_REDACTED> by those root classes.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.

### Children
- [OntologyConfigManager](./OntologyConfigManager.md) -- Referenced in the Ontology sub-component description as the mechanism that decouples ontology file paths from code, allowing runtime reconfiguration of both upper and lower ontology tiers.
- [TwoLevelOntologyHierarchy](./TwoLevelOntologyHierarchy.md) -- The parent sub-component description explicitly states 'upper/lower' as the two tiers, with separate definition files for each, indicating a deliberate separation of broad categorical concepts from domain-specific ones.

### Siblings
- [Pipeline](./Pipeline.md) -- Pipeline is hosted within the `integrations/mcp-server-semantic-analysis` directory, establishing it as an MCP server that exposes pipeline control as tool endpoints to orchestrating agents
- [Insights](./Insights.md) -- Insight generation is LLM-driven, operating within the LLM budget constraints configured in OntologyConfigManager, meaning insight depth scales with available token budget per batch run
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton to ensure all pipeline agents share identical ontology configuration throughout a batch run, preventing mid-run config drift between classifier and validator instances
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Wraps km-core's OntologyRegistry behind a legacy-compatible interface, isolating the migration boundary so that OntologyValidator and OntologyClassifier continue to function without modification during Phase 42-03


---

*Generated from 6 observations*
